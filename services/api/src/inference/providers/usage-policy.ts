import type { InferenceUsage, ModelPricing } from "./contract.js";
import type { InferenceEnvironment } from "./environment.js";
import { InferenceError } from "./errors.js";
import type {
  InferenceFallbackPolicy,
  InferencePolicyRecord,
  InferencePolicyRepository,
  InferenceRunRepository
} from "./repositories.js";

/**
 * Estimated cost from normalized usage and catalog pricing. Cached input tokens are billed at the
 * cached rate when one is known, otherwise at the normal input rate. Returns undefined when the
 * model has no pricing metadata - unknown cost is recorded as null, never guessed.
 */
export function estimateCost(
  usage: InferenceUsage | undefined,
  pricing: ModelPricing | undefined,
  fallbackCurrency: string
): { currency: string; estimatedAmount: number } | undefined {
  if (usage === undefined || pricing === undefined) return undefined;
  const inputRate = pricing.inputPerMillionTokens;
  const outputRate = pricing.outputPerMillionTokens;
  if (inputRate === undefined && outputRate === undefined) return undefined;
  const input = usage.inputTokens ?? 0;
  const cached = Math.min(usage.cachedInputTokens ?? 0, input);
  const output = usage.outputTokens ?? 0;
  const amount =
    ((input - cached) * (inputRate ?? 0) +
      cached * (pricing.cachedInputPerMillionTokens ?? inputRate ?? 0) +
      output * (outputRate ?? 0)) /
    1_000_000;
  return {
    currency: (pricing.currency ?? fallbackCurrency).toUpperCase(),
    estimatedAmount: Math.round(amount * 1e8) / 1e8
  };
}

export interface EffectiveUsagePolicy {
  currency: string;
  tenantDailyBudget: number | null;
  userDailyBudget: number | null;
  providerMonthlyCeilings: ReadonlyMap<string, number>;
  maxRequestsPerMinute: number | null;
  maxTokensPerRequest: number | null;
  fallbackPolicy: InferenceFallbackPolicy;
  approvedProviderIds: readonly string[];
  fallbackModelIds: readonly string[];
}

/**
 * Budgets, per-request token ceilings, rate limits and the explicit fallback policy. Precedence for
 * each field: user row / tenant row (most specific wins) -> global row -> environment default.
 * Rate limits and token ceilings take the *strictest* defined value so a tenant row cannot loosen a
 * platform-wide ceiling.
 */
export class InferenceUsageGuard {
  private readonly recentRequests = new Map<string, number[]>();

  constructor(
    private readonly deps: {
      runs: InferenceRunRepository;
      policies: InferencePolicyRepository;
      environment: InferenceEnvironment["budgets"];
      now?: () => Date;
    }
  ) {}

  async effectivePolicy(owner: {
    tenantId: string | null;
    userId: string | null;
  }): Promise<EffectiveUsagePolicy> {
    const [global, tenant, user] = await Promise.all([
      this.deps.policies.get({ scope: "global" }),
      owner.tenantId === null
        ? Promise.resolve(undefined)
        : this.deps.policies.get({ scope: "tenant", tenantId: owner.tenantId }),
      owner.userId === null
        ? Promise.resolve(undefined)
        : this.deps.policies.get({ scope: "user", userId: owner.userId })
    ]);
    const env = this.deps.environment;
    const ceilings = new Map(env.providerMonthlyCeilings);
    for (const [providerId, amount] of Object.entries(global?.providerMonthlyCeilings ?? {})) {
      ceilings.set(providerId, amount);
    }
    const fallbackSource: InferencePolicyRecord | undefined = tenant ?? user ?? global;
    return {
      currency: (tenant?.currency ?? global?.currency ?? env.currency).toUpperCase(),
      tenantDailyBudget: tenant?.dailyBudget ?? global?.dailyBudget ?? env.tenantDailyBudget,
      userDailyBudget: user?.dailyBudget ?? env.userDailyBudget,
      providerMonthlyCeilings: ceilings,
      maxRequestsPerMinute: strictest(
        env.maxRequestsPerMinute,
        global?.maxRequestsPerMinute,
        tenant?.maxRequestsPerMinute,
        user?.maxRequestsPerMinute
      ),
      maxTokensPerRequest: strictest(
        env.maxTokensPerRequest,
        global?.maxTokensPerRequest,
        tenant?.maxTokensPerRequest,
        user?.maxTokensPerRequest
      ),
      fallbackPolicy: fallbackSource?.fallbackPolicy ?? "NONE",
      approvedProviderIds: fallbackSource?.approvedProviderIds ?? [],
      fallbackModelIds: fallbackSource?.fallbackModelIds ?? []
    };
  }

  /**
   * Rejects (never silently reroutes) when a budget or rate limit is already exhausted. Budgets
   * are checked against recorded spend *before* the call; a single call can overshoot by at most
   * its own cost, which the per-request token ceiling bounds.
   */
  async admit(input: {
    tenantId: string | null;
    userId: string | null;
    providerId: string;
    policy: EffectiveUsagePolicy;
  }): Promise<void> {
    const now = this.deps.now?.() ?? new Date();
    const { policy } = input;
    if (policy.maxRequestsPerMinute !== null) {
      const key = `${input.tenantId ?? "-"}|${input.userId ?? "-"}`;
      const windowStart = now.getTime() - 60_000;
      const recent = (this.recentRequests.get(key) ?? []).filter((at) => at > windowStart);
      if (recent.length >= policy.maxRequestsPerMinute) {
        this.recentRequests.set(key, recent);
        throw new InferenceError("RATE_LIMITED", {
          providerId: input.providerId,
          retryAfterMs: Math.max(0, (recent[0] ?? now.getTime()) + 60_000 - now.getTime()),
          diagnostic: "Soko per-minute request limit reached."
        });
      }
      recent.push(now.getTime());
      this.recentRequests.set(key, recent);
    }
    const dayStart = startOfUtcDay(now);
    if (policy.tenantDailyBudget !== null && input.tenantId !== null) {
      const spent = await this.deps.runs.sumCost({
        since: dayStart,
        tenantId: input.tenantId,
        currency: policy.currency
      });
      if (spent >= policy.tenantDailyBudget)
        throw budgetExceeded(input.providerId, "tenant daily budget");
    }
    if (policy.userDailyBudget !== null && input.userId !== null) {
      const spent = await this.deps.runs.sumCost({
        since: dayStart,
        userId: input.userId,
        currency: policy.currency
      });
      if (spent >= policy.userDailyBudget)
        throw budgetExceeded(input.providerId, "user daily budget");
    }
    const ceiling = policy.providerMonthlyCeilings.get(input.providerId);
    if (ceiling !== undefined) {
      const spent = await this.deps.runs.sumCost({
        since: startOfUtcMonth(now),
        providerId: input.providerId,
        currency: policy.currency
      });
      if (spent >= ceiling) throw budgetExceeded(input.providerId, "provider monthly ceiling");
    }
  }
}

function strictest(...values: Array<number | null | undefined>): number | null {
  const defined = values.filter((value): value is number => typeof value === "number" && value > 0);
  return defined.length === 0 ? null : Math.min(...defined);
}

function budgetExceeded(providerId: string, which: string): InferenceError {
  return new InferenceError("BUDGET_EXCEEDED", { providerId, diagnostic: `${which} reached` });
}

function startOfUtcDay(now: Date): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  ).toISOString();
}

function startOfUtcMonth(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
