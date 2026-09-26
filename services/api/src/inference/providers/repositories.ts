import type { CredentialScope, InferenceExecutionTarget } from "./contract.js";
import type { InferenceProviderConfig } from "./provider-config.js";

/**
 * Persistence ports for the inference platform. Postgres-authoritative in production
 * (postgres-repositories.ts, following the fulfillment module's own-pool precedent) and in-memory
 * for tests and CP2_STORE=memory. None of these records ever holds a plaintext secret.
 */

export type ProviderCredentialOwnerScope = "tenant" | "user" | "platform";
export type ProviderCredentialStatus = "ACTIVE" | "INVALID" | "REVOKED";

export interface ProviderCredentialRecord {
  id: string;
  scope: ProviderCredentialOwnerScope;
  /** Business id for tenant scope; null otherwise. */
  tenantId: string | null;
  /** Account id for user scope; null otherwise. */
  userId: string | null;
  providerId: string;
  credentialType: "api_key";
  /** AES-256-GCM envelope from cp2/secret-box.ts. Never returned by any API. */
  encryptedSecret: string | null;
  keyVersion: number;
  /** Last four characters, only for keys of 16+ characters. */
  secretSuffix: string | null;
  /** BYOK custom endpoint, validated with the strict SSRF policy at connect time. */
  baseUrl: string | null;
  status: ProviderCredentialStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  lastVerifiedAt: string | null;
  lastVerificationStatus: "passed" | "failed" | null;
}

export interface ProviderCredentialRepository {
  insert(record: ProviderCredentialRecord): Promise<void>;
  update(record: ProviderCredentialRecord): Promise<void>;
  get(id: string): Promise<ProviderCredentialRecord | undefined>;
  /** Exact-owner lookup of the single active credential for a provider. Never widens scope. */
  findActive(input: {
    providerId: string;
    scope: ProviderCredentialOwnerScope;
    tenantId?: string;
    userId?: string;
  }): Promise<ProviderCredentialRecord | undefined>;
  listForOwner(input: { tenantId?: string; userId?: string }): Promise<ProviderCredentialRecord[]>;
  /** Hard delete on account/business deletion. Returns the number of rows removed. */
  deleteForOwner(input: { tenantId?: string; userId?: string }): Promise<number>;
}

export type InferenceRunStatus = "succeeded" | "failed" | "rejected";

/** Usage telemetry for one inference attempt. Deliberately has no prompt or output text. */
export interface InferenceRunRecord {
  id: string;
  requestId: string;
  conversationId: string | null;
  agentId: string | null;
  tenantId: string | null;
  userId: string | null;
  modelId: string;
  providerId: string;
  credentialScope: CredentialScope | null;
  executionTarget: InferenceExecutionTarget;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  estimatedCost: number | null;
  currency: string | null;
  latencyMs: number | null;
  firstTokenMs: number | null;
  status: InferenceRunStatus;
  errorCode: string | null;
  fallbackFromProviderId: string | null;
  createdAt: string;
}

export interface InferenceRunRepository {
  insert(run: InferenceRunRecord): Promise<void>;
  /** Sum of estimated cost since `since`, filtered by any combination of owner/provider. */
  sumCost(input: {
    since: string;
    tenantId?: string;
    userId?: string;
    providerId?: string;
    currency: string;
  }): Promise<number>;
  deleteForOwner(input: { tenantId?: string; userId?: string }): Promise<number>;
}

export type InferenceFallbackPolicy = "NONE" | "SAME_PROVIDER" | "APPROVED_PROVIDERS";

export interface InferencePolicyRecord {
  scope: "global" | "tenant" | "user";
  tenantId: string | null;
  userId: string | null;
  currency: string;
  dailyBudget: number | null;
  providerMonthlyCeilings: Record<string, number>;
  maxRequestsPerMinute: number | null;
  maxTokensPerRequest: number | null;
  fallbackPolicy: InferenceFallbackPolicy;
  /** For APPROVED_PROVIDERS: provider ids a request may move to. */
  approvedProviderIds: string[];
  /** Ordered catalog model ids to try after the selected model fails. */
  fallbackModelIds: string[];
  updatedAt: string;
}

export interface InferencePolicyRepository {
  get(input: {
    scope: InferencePolicyRecord["scope"];
    tenantId?: string;
    userId?: string;
  }): Promise<InferencePolicyRecord | undefined>;
  upsert(record: InferencePolicyRecord): Promise<void>;
}

export interface ProviderConfigRepository {
  list(): Promise<InferenceProviderConfig[]>;
}

export interface InferenceRepositories {
  providers: ProviderConfigRepository;
  credentials: ProviderCredentialRepository;
  runs: InferenceRunRepository;
  policies: InferencePolicyRepository;
}

export function createMemoryInferenceRepositories(
  seed: { providers?: InferenceProviderConfig[]; policies?: InferencePolicyRecord[] } = {}
): InferenceRepositories & { runsSnapshot(): InferenceRunRecord[] } {
  const credentials = new Map<string, ProviderCredentialRecord>();
  const runs: InferenceRunRecord[] = [];
  const policies = new Map<string, InferencePolicyRecord>();
  const policyKey = (scope: string, tenantId?: string | null, userId?: string | null) =>
    `${scope}:${tenantId ?? ""}:${userId ?? ""}`;
  for (const policy of seed.policies ?? []) {
    policies.set(policyKey(policy.scope, policy.tenantId, policy.userId), policy);
  }
  const ownerMatches = (
    record: { tenantId: string | null; userId: string | null },
    input: { tenantId?: string; userId?: string }
  ) =>
    (input.tenantId !== undefined && record.tenantId === input.tenantId) ||
    (input.userId !== undefined && record.userId === input.userId);

  return {
    providers: {
      async list() {
        return (seed.providers ?? []).map((provider) => ({ ...provider }));
      }
    },
    credentials: {
      async insert(record) {
        credentials.set(record.id, { ...record });
      },
      async update(record) {
        credentials.set(record.id, { ...record });
      },
      async get(id) {
        const record = credentials.get(id);
        return record === undefined ? undefined : { ...record };
      },
      async findActive(input) {
        for (const record of credentials.values()) {
          if (
            record.providerId === input.providerId &&
            record.scope === input.scope &&
            record.status === "ACTIVE" &&
            record.encryptedSecret !== null &&
            (input.scope !== "tenant" || record.tenantId === (input.tenantId ?? null)) &&
            (input.scope !== "user" || record.userId === (input.userId ?? null))
          ) {
            return { ...record };
          }
        }
        return undefined;
      },
      async listForOwner(input) {
        return [...credentials.values()]
          .filter((record) => ownerMatches(record, input))
          .map((record) => ({ ...record }));
      },
      async deleteForOwner(input) {
        let removed = 0;
        for (const [id, record] of credentials) {
          if (ownerMatches(record, input)) {
            credentials.delete(id);
            removed += 1;
          }
        }
        return removed;
      }
    },
    runs: {
      async insert(run) {
        runs.push({ ...run });
      },
      async sumCost(input) {
        return runs
          .filter(
            (run) =>
              run.createdAt >= input.since &&
              run.currency === input.currency &&
              (input.tenantId === undefined || run.tenantId === input.tenantId) &&
              (input.userId === undefined || run.userId === input.userId) &&
              (input.providerId === undefined || run.providerId === input.providerId)
          )
          .reduce((total, run) => total + (run.estimatedCost ?? 0), 0);
      },
      async deleteForOwner(input) {
        let removed = 0;
        for (let index = runs.length - 1; index >= 0; index -= 1) {
          const run = runs[index] as InferenceRunRecord;
          if (ownerMatches(run, input)) {
            runs.splice(index, 1);
            removed += 1;
          }
        }
        return removed;
      }
    },
    policies: {
      async get(input) {
        const record = policies.get(policyKey(input.scope, input.tenantId, input.userId));
        return record === undefined ? undefined : structuredClone(record);
      },
      async upsert(record) {
        policies.set(
          policyKey(record.scope, record.tenantId, record.userId),
          structuredClone(record)
        );
      }
    },
    runsSnapshot() {
      return runs.map((run) => ({ ...run }));
    }
  };
}
