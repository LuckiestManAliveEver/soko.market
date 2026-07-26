create table if not exists cp2_agent_model_bindings (
  entity_id text primary key,
  business_id text,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint cp2_agent_model_bindings_status_check
    check (
      record ->> 'status' in ('inactive', 'verifying', 'active', 'failed', 'unavailable')
    ),
  constraint cp2_agent_model_bindings_target_check
    check (
      record ->> 'executionTarget' in (
        'backend',
        'browser-local',
        'installed-app',
        'remote-shop-device',
        'openai'
      )
    )
);

create index if not exists cp2_agent_model_bindings_shop_idx
  on cp2_agent_model_bindings ((record ->> 'shopId'));

create index if not exists cp2_agent_model_bindings_model_idx
  on cp2_agent_model_bindings ((record ->> 'modelId'));

create unique index if not exists cp2_agent_model_bindings_one_active_per_agent_idx
  on cp2_agent_model_bindings ((record ->> 'agentId'))
  where record ->> 'status' = 'active';

insert into cp2_agent_model_bindings (
  entity_id,
  business_id,
  account_id,
  user_id,
  parent_id,
  record,
  updated_at
)
select distinct on (record ->> 'agentId')
  'migrated:' || (record ->> 'agentId'),
  business_id,
  account_id,
  user_id,
  parent_id,
  jsonb_build_object(
    'id', 'migrated:' || (record ->> 'agentId'),
    'agentId', record ->> 'agentId',
    'shopId', record ->> 'businessId',
    'accountId', record ->> 'accountId',
    'modelId', record ->> 'modelId',
    'status', 'active',
    'executionMode', coalesce(record ->> 'preferredExecutionMode', 'LOCAL_FIRST'),
    'fallbackPolicy', coalesce(record ->> 'fallbackPolicy', 'WHEN_LOCAL_UNAVAILABLE'),
    'executionTarget',
      case record ->> 'runtimeBackend'
        when 'LLAMA_CPP_ANDROID' then 'installed-app'
        when 'LLAMA_CPP_BROWSER' then 'browser-local'
        when 'OLLAMA' then 'backend'
        when 'CLOUD' then 'openai'
        else 'installed-app'
      end,
    'permissions', jsonb_build_object(
      'allowInstalledApp', (record ->> 'runtimeBackend') = 'LLAMA_CPP_ANDROID',
      'allowRemoteShopDevice', false,
      'allowOpenAIFallback', false
    ),
    'fallbackModelId', null,
    'activatedAt', record ->> 'lastSuccessfulInferenceAt',
    'lastVerifiedAt', record ->> 'lastSuccessfulInferenceAt',
    'lastVerificationStatus', 'passed',
    'lastErrorCode', null,
    'lastErrorMessage', null,
    'createdAt', record ->> 'updatedAt',
    'updatedAt', record ->> 'updatedAt',
    'updatedBy', record ->> 'updatedBy'
  ),
  coalesce((record ->> 'updatedAt')::timestamp with time zone, now())
from cp2_agent_model_assignments
where
  record ->> 'readinessStatus' = 'READY'
  and record ->> 'lastSuccessfulInferenceAt' is not null
  and record ->> 'agentId' is not null
  and record ->> 'modelId' is not null
order by record ->> 'agentId', updated_at desc
on conflict (entity_id) do nothing;
