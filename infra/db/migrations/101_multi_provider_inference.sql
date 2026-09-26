-- Multi-provider inference router (docs/architecture/multi-provider-inference-implementation.md).
--
-- Purely additive. It reuses the existing agent/binding/model/host graph and the existing model
-- catalog (cp2_model_catalog rows gain an optional `inference` block in their JSON record - no
-- column change is needed there) and adds only the four structures that did not exist:
--
--   inference_providers             operator-managed provider configuration overrides
--   inference_provider_credentials  encrypted BYOK / platform credentials (never plaintext)
--   inference_runs                  usage and cost telemetry (never prompts or outputs)
--   inference_policies              budgets, rate limits, and explicit fallback policy
--
-- Built-in providers (openai, anthropic, zai-general, local) are defined in application code and
-- configured from the environment, so no seed rows are required for the API to boot and no
-- provider is mandatory. A row here overrides or extends that configuration. No API route writes
-- inference_providers or inference_policies; they are operator-managed, like cp2_platform_operators.
--
-- Owner columns are text without foreign keys on purpose: CP2 business/account rows are persisted
-- by the asynchronous snapshot writer, and a credential connected moments after signup must not
-- fail on an FK whose parent row has not been flushed yet. Account and shop deletion purge these
-- rows explicitly (InferencePlatform.purgeOwner).

create table if not exists inference_providers (
  id text primary key,
  display_name text not null,
  provider_type text not null,
  base_url text,
  execution_target text not null,
  enabled boolean not null default true,
  capabilities jsonb not null default '{}'::jsonb,
  credential_ref text,
  byok_allowed boolean not null default true,
  allow_credential_endpoint boolean not null default false,
  allow_private_network boolean not null default false,
  allow_http boolean not null default false,
  billing_product text,
  verification text not null default 'models-endpoint',
  options jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint inference_providers_id_check check (id ~ '^[a-z0-9][a-z0-9:._-]{0,99}$'),
  constraint inference_providers_display_name_check check (
    char_length(display_name) between 1 and 120
  ),
  constraint inference_providers_type_check check (
    provider_type in ('openai', 'anthropic', 'zai', 'openai-compatible', 'local')
  ),
  constraint inference_providers_execution_target_check check (
    execution_target in ('browser-local', 'installed-app', 'remote-inference', 'remote-shop-device')
  ),
  constraint inference_providers_base_url_check check (
    base_url is null or base_url ~ '^https?://'
  ),
  -- A reference, never a secret: an environment variable name or a platform credential row id.
  constraint inference_providers_credential_ref_check check (
    credential_ref is null
    or credential_ref ~ '^env:[A-Z][A-Z0-9_]{0,99}$'
    or credential_ref ~ '^secret://[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  constraint inference_providers_verification_check check (
    verification in ('models-endpoint', 'minimal-completion', 'none')
  ),
  constraint inference_providers_capabilities_check check (jsonb_typeof(capabilities) = 'object'),
  constraint inference_providers_options_check check (jsonb_typeof(options) = 'object')
);

create table if not exists inference_provider_credentials (
  id uuid primary key,
  scope text not null,
  tenant_id text,
  user_id text,
  provider_id text not null,
  credential_type text not null default 'api_key',
  encrypted_secret text,
  key_version integer not null default 1,
  secret_suffix text,
  base_url text,
  status text not null,
  created_by text not null,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null,
  revoked_at timestamp with time zone,
  last_verified_at timestamp with time zone,
  last_verification_status text,
  constraint inference_provider_credentials_scope_check check (
    scope in ('tenant', 'user', 'platform')
  ),
  constraint inference_provider_credentials_owner_check check (
    (scope = 'tenant' and tenant_id is not null and user_id is null)
    or (scope = 'user' and user_id is not null and tenant_id is null)
    or (scope = 'platform' and tenant_id is null and user_id is null)
  ),
  constraint inference_provider_credentials_type_check check (credential_type in ('api_key')),
  constraint inference_provider_credentials_status_check check (
    status in ('ACTIVE', 'INVALID', 'REVOKED')
  ),
  -- Revocation removes the secret, it does not just hide it.
  constraint inference_provider_credentials_revoked_secret_check check (
    status <> 'REVOKED' or encrypted_secret is null
  ),
  -- The envelope format written by services/api/src/cp2/secret-box.ts. Rejects accidental plaintext.
  constraint inference_provider_credentials_envelope_check check (
    encrypted_secret is null or encrypted_secret ~ '^v[0-9]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
  ),
  constraint inference_provider_credentials_suffix_check check (
    secret_suffix is null or char_length(secret_suffix) <= 4
  ),
  constraint inference_provider_credentials_base_url_check check (
    base_url is null or base_url ~ '^https://'
  ),
  constraint inference_provider_credentials_verification_check check (
    last_verification_status is null or last_verification_status in ('passed', 'failed')
  )
);

-- One active credential per (provider, owner). Replacing a key revokes the old row first.
create unique index if not exists inference_provider_credentials_active_owner_idx
  on inference_provider_credentials (
    provider_id, scope, coalesce(tenant_id, ''), coalesce(user_id, '')
  )
  where status = 'ACTIVE';

create index if not exists inference_provider_credentials_tenant_idx
  on inference_provider_credentials (tenant_id)
  where tenant_id is not null;

create index if not exists inference_provider_credentials_user_idx
  on inference_provider_credentials (user_id)
  where user_id is not null;

create table if not exists inference_runs (
  id uuid primary key,
  request_id text not null,
  conversation_id text,
  agent_id text,
  tenant_id text,
  user_id text,
  model_id text not null,
  provider_id text not null,
  credential_scope text,
  execution_target text not null,
  input_tokens integer,
  output_tokens integer,
  cached_input_tokens integer,
  estimated_cost numeric(18, 8),
  currency text,
  latency_ms integer,
  first_token_ms integer,
  status text not null,
  error_code text,
  fallback_from_provider_id text,
  created_at timestamp with time zone not null default now(),
  constraint inference_runs_status_check check (status in ('succeeded', 'failed', 'rejected')),
  constraint inference_runs_credential_scope_check check (
    credential_scope is null or credential_scope in ('explicit', 'tenant', 'user', 'platform')
  ),
  constraint inference_runs_execution_target_check check (
    execution_target in ('browser-local', 'installed-app', 'remote-inference', 'remote-shop-device')
  ),
  constraint inference_runs_token_counts_check check (
    (input_tokens is null or input_tokens >= 0)
    and (output_tokens is null or output_tokens >= 0)
    and (cached_input_tokens is null or cached_input_tokens >= 0)
  ),
  constraint inference_runs_cost_check check (estimated_cost is null or estimated_cost >= 0)
);

create index if not exists inference_runs_tenant_created_idx
  on inference_runs (tenant_id, created_at)
  where tenant_id is not null;

create index if not exists inference_runs_user_created_idx
  on inference_runs (user_id, created_at)
  where user_id is not null;

create index if not exists inference_runs_provider_created_idx
  on inference_runs (provider_id, created_at);

create table if not exists inference_policies (
  scope text not null,
  owner_key text not null,
  tenant_id text,
  user_id text,
  currency text not null default 'USD',
  daily_budget numeric(18, 6),
  provider_monthly_ceilings jsonb not null default '{}'::jsonb,
  max_requests_per_minute integer,
  max_tokens_per_request integer,
  fallback_policy text not null default 'NONE',
  approved_provider_ids text[] not null default '{}'::text[],
  fallback_model_ids text[] not null default '{}'::text[],
  updated_at timestamp with time zone not null default now(),
  primary key (scope, owner_key),
  constraint inference_policies_scope_check check (scope in ('global', 'tenant', 'user')),
  constraint inference_policies_owner_check check (
    (scope = 'global' and owner_key = '' and tenant_id is null and user_id is null)
    or (scope = 'tenant' and owner_key = tenant_id and user_id is null)
    or (scope = 'user' and owner_key = user_id and tenant_id is null)
  ),
  constraint inference_policies_fallback_check check (
    fallback_policy in ('NONE', 'SAME_PROVIDER', 'APPROVED_PROVIDERS')
  ),
  constraint inference_policies_limits_check check (
    (daily_budget is null or daily_budget >= 0)
    and (max_requests_per_minute is null or max_requests_per_minute > 0)
    and (max_tokens_per_request is null or max_tokens_per_request > 0)
  ),
  constraint inference_policies_ceilings_check check (
    jsonb_typeof(provider_monthly_ceilings) = 'object'
  )
);
