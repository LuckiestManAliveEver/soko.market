import { parseCredentialKeyring } from "./credentials.js";
import type { InferenceProviderConfig } from "./provider-config.js";

/**
 * Environment-sourced inference configuration. Environment variables describe Soko-managed
 * (Soko-funded) credentials and deployment endpoints only; BYOK credentials always come from
 * encrypted persistence (inference_provider_credentials). Nothing here hardcodes a model id, and no
 * provider is required for the API to boot.
 */
export interface InferenceEnvironment {
  providers: InferenceProviderConfig[];
  /** Managed secrets by env var name, read once at boot. Values never leave the credential resolver. */
  managedSecrets: ReadonlyMap<string, string>;
  /** INFERENCE_CREDENTIAL_KEYS: versioned keys for BYOK credential encryption (see credentials.ts). */
  credentialKeys: ReadonlyMap<number, string>;
  defaultProviderId: string | null;
  defaultModelId: string | null;
  requestTimeoutMs: number;
  maxOutputTokens: number;
  budgets: {
    currency: string;
    tenantDailyBudget: number | null;
    userDailyBudget: number | null;
    providerMonthlyCeilings: ReadonlyMap<string, number>;
    maxRequestsPerMinute: number | null;
    maxTokensPerRequest: number | null;
  };
}

type Env = Readonly<Record<string, string | undefined>>;

const managedSecretNames = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ZAI_API_KEY",
  "ZAI_CODING_API_KEY",
  "SOKO_LLAMA_API_KEY"
] as const;

/** The providers every deployment knows about, disabled for execution until configured. */
export function builtinProviderConfigs(): InferenceProviderConfig[] {
  const base = {
    enabled: true,
    capabilities: {},
    credentialRef: null,
    byokAllowed: true,
    allowCredentialEndpoint: false,
    allowPrivateNetwork: false,
    allowHttp: false,
    billingProduct: null,
    verification: "models-endpoint" as const,
    options: {},
    source: "builtin" as const
  };
  return [
    {
      ...base,
      id: "openai",
      displayName: "OpenAI",
      type: "openai",
      baseUrl: "https://api.openai.com/v1",
      executionTarget: "remote-inference",
      billingProduct: "openai-api"
    },
    {
      ...base,
      id: "anthropic",
      displayName: "Anthropic",
      type: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      executionTarget: "remote-inference",
      billingProduct: "anthropic-api"
    },
    {
      ...base,
      id: "zai-general",
      displayName: "Z.ai",
      type: "zai",
      baseUrl: "https://api.z.ai/api/paas/v4",
      executionTarget: "remote-inference",
      billingProduct: "zai-general",
      // No free key-verification endpoint is relied on for Z.ai; a 1-token completion is the
      // cheapest safe check.
      verification: "minimal-completion"
    },
    {
      ...base,
      id: "local",
      displayName: "Local AI (this device)",
      type: "local",
      baseUrl: null,
      executionTarget: "browser-local",
      byokAllowed: false,
      verification: "none"
    }
  ];
}

export function readInferenceEnvironment(env: Env = process.env): InferenceEnvironment {
  const managedSecrets = new Map<string, string>();
  for (const name of managedSecretNames) {
    const value = env[name]?.trim() ?? "";
    if (value !== "") managedSecrets.set(name, value);
  }

  const overrides = new Map<string, Partial<InferenceProviderConfig>>();
  const envBaseUrl = (name: string) => {
    const value = env[name]?.trim() ?? "";
    return value === "" ? undefined : value;
  };
  const managedRef = (name: string) => (managedSecrets.has(name) ? `env:${name}` : null);

  overrides.set("openai", {
    ...(envBaseUrl("OPENAI_BASE_URL") === undefined
      ? {}
      : { baseUrl: envBaseUrl("OPENAI_BASE_URL") as string }),
    credentialRef: managedRef("OPENAI_API_KEY")
  });
  overrides.set("anthropic", {
    ...(envBaseUrl("ANTHROPIC_BASE_URL") === undefined
      ? {}
      : { baseUrl: envBaseUrl("ANTHROPIC_BASE_URL") as string }),
    credentialRef: managedRef("ANTHROPIC_API_KEY")
  });
  overrides.set("zai-general", {
    ...(envBaseUrl("ZAI_BASE_URL") === undefined
      ? {}
      : { baseUrl: envBaseUrl("ZAI_BASE_URL") as string }),
    credentialRef: managedRef("ZAI_API_KEY")
  });

  const providers: InferenceProviderConfig[] = builtinProviderConfigs().map((config) => {
    const override = overrides.get(config.id);
    return override === undefined ? config : { ...config, ...override, source: "environment" };
  });

  // A coding-subscription endpoint is a *different billing product*: it only exists when an
  // operator configures it explicitly, under its own id, and is never a fallback for zai-general.
  const zaiCodingBaseUrl = envBaseUrl("ZAI_CODING_BASE_URL");
  if (zaiCodingBaseUrl !== undefined) {
    providers.push({
      id: "zai-coding",
      displayName: "Z.ai (coding plan)",
      type: "zai",
      baseUrl: zaiCodingBaseUrl,
      executionTarget: "remote-inference",
      enabled: true,
      capabilities: {},
      credentialRef: managedRef("ZAI_CODING_API_KEY"),
      byokAllowed: false,
      allowCredentialEndpoint: false,
      allowPrivateNetwork: false,
      allowHttp: false,
      billingProduct: "zai-coding",
      verification: "minimal-completion",
      options: {},
      source: "environment"
    });
  }

  // Soko-hosted llama.cpp (or any OpenAI-compatible server Soko operates). Hosting-neutral: the
  // URL can point at any host; nothing here knows or cares which one.
  const llamaBaseUrl = envBaseUrl("SOKO_LLAMA_BASE_URL");
  if (llamaBaseUrl !== undefined) {
    providers.push({
      id: "soko-llama",
      displayName: "Soko Cloud",
      type: "openai-compatible",
      baseUrl: llamaBaseUrl,
      executionTarget: "remote-inference",
      enabled: true,
      capabilities: {},
      credentialRef: managedRef("SOKO_LLAMA_API_KEY"),
      byokAllowed: false,
      allowCredentialEndpoint: false,
      // Operator-only: lets the API reach a llama-server on a private network next to it.
      allowPrivateNetwork: booleanEnv(env, "SOKO_LLAMA_ALLOW_PRIVATE_NETWORK"),
      allowHttp: booleanEnv(env, "SOKO_LLAMA_ALLOW_HTTP"),
      billingProduct: "soko-hosted",
      verification: "models-endpoint",
      options: {},
      source: "environment"
    });
  }

  return {
    providers,
    managedSecrets,
    credentialKeys: parseCredentialKeyring(env.INFERENCE_CREDENTIAL_KEYS),
    defaultProviderId: optionalId(env.INFERENCE_DEFAULT_PROVIDER),
    defaultModelId: optionalId(env.INFERENCE_DEFAULT_MODEL),
    requestTimeoutMs: positiveInteger(env, "INFERENCE_REQUEST_TIMEOUT_MS", 60_000),
    maxOutputTokens: positiveInteger(env, "INFERENCE_MAX_OUTPUT_TOKENS", 1_024),
    budgets: {
      currency: (env.INFERENCE_BUDGET_CURRENCY?.trim() || "USD").toUpperCase(),
      tenantDailyBudget: optionalAmount(env, "INFERENCE_TENANT_DAILY_BUDGET"),
      userDailyBudget: optionalAmount(env, "INFERENCE_USER_DAILY_BUDGET"),
      providerMonthlyCeilings: amountMap(env, "INFERENCE_PROVIDER_MONTHLY_CEILINGS"),
      maxRequestsPerMinute: optionalPositiveInteger(env, "INFERENCE_MAX_REQUESTS_PER_MINUTE"),
      maxTokensPerRequest: optionalPositiveInteger(env, "INFERENCE_MAX_TOKENS_PER_REQUEST")
    }
  };
}

function booleanEnv(env: Env, name: string): boolean {
  return ["1", "true", "yes", "on"].includes(env[name]?.trim().toLowerCase() ?? "");
}

function optionalId(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return null;
  if (!/^[a-z0-9][a-z0-9:._-]{0,199}$/u.test(trimmed)) {
    throw new Error("Inference default provider/model must be a portable lowercase identifier.");
  }
  return trimmed;
}

function positiveInteger(env: Env, name: string, fallback: number): number {
  return optionalPositiveInteger(env, name) ?? fallback;
}

function optionalPositiveInteger(env: Env, name: string): number | null {
  const raw = env[name]?.trim() ?? "";
  if (raw === "") return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function optionalAmount(env: Env, name: string): number | null {
  const raw = env[name]?.trim() ?? "";
  if (raw === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new Error(`${name} must be a non-negative number.`);
  return parsed;
}

/** "openai=500,anthropic=300" -> Map. */
function amountMap(env: Env, name: string): ReadonlyMap<string, number> {
  const raw = env[name]?.trim() ?? "";
  const map = new Map<string, number>();
  if (raw === "") return map;
  for (const entry of raw.split(",")) {
    const [key, value] = entry.split("=").map((part) => part.trim());
    const amount = Number(value);
    if (key === undefined || key === "" || !Number.isFinite(amount) || amount < 0) {
      throw new Error(`${name} must look like "provider=amount,provider=amount".`);
    }
    map.set(key, amount);
  }
  return map;
}
