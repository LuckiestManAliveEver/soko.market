import type { Pool } from "pg";

import { isInferenceExecutionTarget } from "./contract.js";
import { isInferenceProviderType, type InferenceProviderConfig } from "./provider-config.js";
import type {
  InferencePolicyRecord,
  InferenceRepositories,
  InferenceRunRecord,
  ProviderCredentialRecord
} from "./repositories.js";

/**
 * Postgres implementations of the inference repositories (tables from
 * infra/db/migrations/101_multi_provider_inference.sql). Each write is a single statement on the
 * module's own pool - the same Postgres-authoritative, own-pool shape corridor fulfillment uses -
 * so credentials and telemetry never sit only in the CP2 in-memory snapshot.
 */
export function createPostgresInferenceRepositories(pool: Pool): InferenceRepositories {
  return {
    providers: {
      async list() {
        const result = await pool.query<ProviderRow>(
          `select id, display_name, provider_type, base_url, execution_target, enabled, capabilities,
                  credential_ref, byok_allowed, allow_credential_endpoint, allow_private_network,
                  allow_http, billing_product, verification, options
             from inference_providers
            order by id`
        );
        return result.rows.flatMap((row) => {
          const config = providerFromRow(row);
          return config === null ? [] : [config];
        });
      }
    },
    credentials: {
      async insert(record) {
        await pool.query(
          `insert into inference_provider_credentials (
             id, scope, tenant_id, user_id, provider_id, credential_type, encrypted_secret,
             key_version, secret_suffix, base_url, status, created_by, created_at, updated_at,
             revoked_at, last_verified_at, last_verification_status
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          credentialParams(record)
        );
      },
      async update(record) {
        await pool.query(
          `update inference_provider_credentials
              set encrypted_secret = $7, key_version = $8, secret_suffix = $9, base_url = $10,
                  status = $11, updated_at = $14, revoked_at = $15, last_verified_at = $16,
                  last_verification_status = $17
            where id = $1 and scope = $2 and tenant_id is not distinct from $3
              and user_id is not distinct from $4 and provider_id = $5 and credential_type = $6
              and created_by = $12 and created_at = $13`,
          credentialParams(record)
        );
      },
      async get(id) {
        const result = await pool.query<CredentialRow>(`${selectCredentials} where id = $1`, [id]);
        const row = result.rows[0];
        return row === undefined ? undefined : credentialFromRow(row);
      },
      async findActive(input) {
        const result = await pool.query<CredentialRow>(
          `${selectCredentials}
            where provider_id = $1 and scope = $2 and status = 'ACTIVE'
              and encrypted_secret is not null
              and ($2 <> 'tenant' or tenant_id = $3)
              and ($2 <> 'user' or user_id = $4)
            order by updated_at desc
            limit 1`,
          [input.providerId, input.scope, input.tenantId ?? null, input.userId ?? null]
        );
        const row = result.rows[0];
        return row === undefined ? undefined : credentialFromRow(row);
      },
      async listForOwner(input) {
        const result = await pool.query<CredentialRow>(
          `${selectCredentials}
            where ($1::text is not null and tenant_id = $1) or ($2::text is not null and user_id = $2)
            order by created_at, id`,
          [input.tenantId ?? null, input.userId ?? null]
        );
        return result.rows.map(credentialFromRow);
      },
      async deleteForOwner(input) {
        const result = await pool.query(
          `delete from inference_provider_credentials
            where ($1::text is not null and tenant_id = $1) or ($2::text is not null and user_id = $2)`,
          [input.tenantId ?? null, input.userId ?? null]
        );
        return result.rowCount ?? 0;
      }
    },
    runs: {
      async insert(run) {
        await pool.query(
          `insert into inference_runs (
             id, request_id, conversation_id, agent_id, tenant_id, user_id, model_id, provider_id,
             credential_scope, execution_target, input_tokens, output_tokens, cached_input_tokens,
             estimated_cost, currency, latency_ms, first_token_ms, status, error_code,
             fallback_from_provider_id, created_at
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
          runParams(run)
        );
      },
      async sumCost(input) {
        const result = await pool.query<{ total: string | null }>(
          `select coalesce(sum(estimated_cost), 0) as total
             from inference_runs
            where created_at >= $1 and currency = $2
              and ($3::text is null or tenant_id = $3)
              and ($4::text is null or user_id = $4)
              and ($5::text is null or provider_id = $5)`,
          [
            input.since,
            input.currency,
            input.tenantId ?? null,
            input.userId ?? null,
            input.providerId ?? null
          ]
        );
        return Number(result.rows[0]?.total ?? 0);
      },
      async deleteForOwner(input) {
        const result = await pool.query(
          `delete from inference_runs
            where ($1::text is not null and tenant_id = $1) or ($2::text is not null and user_id = $2)`,
          [input.tenantId ?? null, input.userId ?? null]
        );
        return result.rowCount ?? 0;
      }
    },
    policies: {
      async get(input) {
        const result = await pool.query<PolicyRow>(
          `select scope, tenant_id, user_id, currency, daily_budget, provider_monthly_ceilings,
                  max_requests_per_minute, max_tokens_per_request, fallback_policy,
                  approved_provider_ids, fallback_model_ids, updated_at
             from inference_policies
            where scope = $1 and owner_key = $2`,
          [input.scope, ownerKey(input.scope, input.tenantId ?? null, input.userId ?? null)]
        );
        const row = result.rows[0];
        return row === undefined ? undefined : policyFromRow(row);
      },
      async upsert(record) {
        await pool.query(
          `insert into inference_policies (
             scope, owner_key, tenant_id, user_id, currency, daily_budget, provider_monthly_ceilings,
             max_requests_per_minute, max_tokens_per_request, fallback_policy,
             approved_provider_ids, fallback_model_ids, updated_at
           ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::text[],$12::text[],$13)
           on conflict (scope, owner_key) do update set
             currency = excluded.currency,
             daily_budget = excluded.daily_budget,
             provider_monthly_ceilings = excluded.provider_monthly_ceilings,
             max_requests_per_minute = excluded.max_requests_per_minute,
             max_tokens_per_request = excluded.max_tokens_per_request,
             fallback_policy = excluded.fallback_policy,
             approved_provider_ids = excluded.approved_provider_ids,
             fallback_model_ids = excluded.fallback_model_ids,
             updated_at = excluded.updated_at`,
          [
            record.scope,
            ownerKey(record.scope, record.tenantId, record.userId),
            record.tenantId,
            record.userId,
            record.currency,
            record.dailyBudget,
            JSON.stringify(record.providerMonthlyCeilings),
            record.maxRequestsPerMinute,
            record.maxTokensPerRequest,
            record.fallbackPolicy,
            record.approvedProviderIds,
            record.fallbackModelIds,
            record.updatedAt
          ]
        );
      }
    }
  };
}

/** Tables this module requires; checked at boot like assertFulfillmentSchema. */
export async function assertInferenceSchema(pool: Pool): Promise<void> {
  const result = await pool.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name in ('inference_providers', 'inference_provider_credentials',
                           'inference_runs', 'inference_policies')`
  );
  if (result.rows.length !== 4) {
    throw new Error(
      "Inference provider tables are missing. Run `pnpm db:migrate` (101_multi_provider_inference.sql)."
    );
  }
}

const selectCredentials = `select id, scope, tenant_id, user_id, provider_id, credential_type,
  encrypted_secret, key_version, secret_suffix, base_url, status, created_by, created_at,
  updated_at, revoked_at, last_verified_at, last_verification_status
  from inference_provider_credentials`;

interface ProviderRow {
  id: string;
  display_name: string;
  provider_type: string;
  base_url: string | null;
  execution_target: string;
  enabled: boolean;
  capabilities: Record<string, unknown>;
  credential_ref: string | null;
  byok_allowed: boolean;
  allow_credential_endpoint: boolean;
  allow_private_network: boolean;
  allow_http: boolean;
  billing_product: string | null;
  verification: string;
  options: Record<string, unknown>;
}

function providerFromRow(row: ProviderRow): InferenceProviderConfig | null {
  if (
    !isInferenceProviderType(row.provider_type) ||
    !isInferenceExecutionTarget(row.execution_target)
  ) {
    return null;
  }
  const verification =
    row.verification === "minimal-completion" || row.verification === "none"
      ? row.verification
      : "models-endpoint";
  const options = row.options ?? {};
  return {
    id: row.id,
    displayName: row.display_name,
    type: row.provider_type,
    baseUrl: row.base_url,
    executionTarget: row.execution_target,
    enabled: row.enabled,
    capabilities: Object.fromEntries(
      Object.entries(row.capabilities ?? {}).filter(([, value]) => typeof value === "boolean")
    ),
    credentialRef: row.credential_ref,
    byokAllowed: row.byok_allowed,
    allowCredentialEndpoint: row.allow_credential_endpoint,
    allowPrivateNetwork: row.allow_private_network,
    allowHttp: row.allow_http,
    billingProduct: row.billing_product,
    verification,
    options: {
      ...(options.maxTokensParameter === "max_tokens" ||
      options.maxTokensParameter === "max_completion_tokens"
        ? { maxTokensParameter: options.maxTokensParameter }
        : {}),
      ...(typeof options.anthropicVersion === "string"
        ? { anthropicVersion: options.anthropicVersion }
        : {})
    },
    source: "database"
  };
}

interface CredentialRow {
  id: string;
  scope: ProviderCredentialRecord["scope"];
  tenant_id: string | null;
  user_id: string | null;
  provider_id: string;
  credential_type: "api_key";
  encrypted_secret: string | null;
  key_version: number;
  secret_suffix: string | null;
  base_url: string | null;
  status: ProviderCredentialRecord["status"];
  created_by: string;
  created_at: Date;
  updated_at: Date;
  revoked_at: Date | null;
  last_verified_at: Date | null;
  last_verification_status: "passed" | "failed" | null;
}

function credentialFromRow(row: CredentialRow): ProviderCredentialRecord {
  return {
    id: row.id,
    scope: row.scope,
    tenantId: row.tenant_id,
    userId: row.user_id,
    providerId: row.provider_id,
    credentialType: row.credential_type,
    encryptedSecret: row.encrypted_secret,
    keyVersion: row.key_version,
    secretSuffix: row.secret_suffix,
    baseUrl: row.base_url,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null,
    lastVerifiedAt: row.last_verified_at?.toISOString() ?? null,
    lastVerificationStatus: row.last_verification_status
  };
}

function credentialParams(record: ProviderCredentialRecord): unknown[] {
  return [
    record.id,
    record.scope,
    record.tenantId,
    record.userId,
    record.providerId,
    record.credentialType,
    record.encryptedSecret,
    record.keyVersion,
    record.secretSuffix,
    record.baseUrl,
    record.status,
    record.createdBy,
    record.createdAt,
    record.updatedAt,
    record.revokedAt,
    record.lastVerifiedAt,
    record.lastVerificationStatus
  ];
}

function runParams(run: InferenceRunRecord): unknown[] {
  return [
    run.id,
    run.requestId,
    run.conversationId,
    run.agentId,
    run.tenantId,
    run.userId,
    run.modelId,
    run.providerId,
    run.credentialScope,
    run.executionTarget,
    run.inputTokens,
    run.outputTokens,
    run.cachedInputTokens,
    run.estimatedCost,
    run.currency,
    run.latencyMs,
    run.firstTokenMs,
    run.status,
    run.errorCode,
    run.fallbackFromProviderId,
    run.createdAt
  ];
}

interface PolicyRow {
  scope: InferencePolicyRecord["scope"];
  tenant_id: string | null;
  user_id: string | null;
  currency: string;
  daily_budget: string | null;
  provider_monthly_ceilings: Record<string, unknown>;
  max_requests_per_minute: number | null;
  max_tokens_per_request: number | null;
  fallback_policy: InferencePolicyRecord["fallbackPolicy"];
  approved_provider_ids: string[];
  fallback_model_ids: string[];
  updated_at: Date;
}

function policyFromRow(row: PolicyRow): InferencePolicyRecord {
  return {
    scope: row.scope,
    tenantId: row.tenant_id,
    userId: row.user_id,
    currency: row.currency,
    dailyBudget: row.daily_budget === null ? null : Number(row.daily_budget),
    providerMonthlyCeilings: Object.fromEntries(
      Object.entries(row.provider_monthly_ceilings ?? {}).flatMap(([key, value]) =>
        typeof value === "number" || typeof value === "string" ? [[key, Number(value)]] : []
      )
    ),
    maxRequestsPerMinute: row.max_requests_per_minute,
    maxTokensPerRequest: row.max_tokens_per_request,
    fallbackPolicy: row.fallback_policy,
    approvedProviderIds: row.approved_provider_ids,
    fallbackModelIds: row.fallback_model_ids,
    updatedAt: row.updated_at.toISOString()
  };
}

function ownerKey(
  scope: InferencePolicyRecord["scope"],
  tenantId: string | null,
  userId: string | null
): string {
  return scope === "tenant" ? (tenantId ?? "") : scope === "user" ? (userId ?? "") : "";
}
