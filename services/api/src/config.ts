import type { EnvironmentConfig } from "@soko/shared-types";

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function numberFromEnvList(names: string[], fallback: number): number {
  for (const name of names) {
    const value = process.env[name];

    if (value !== undefined && value.trim() !== "") {
      return numberFromEnv(name, fallback);
    }
  }

  return fallback;
}

function booleanFromEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`${name} must be true or false.`);
}

function stringFromEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? fallback : value;
}

function stringListFromEnv(name: string, fallback: string[]): string[] {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const values = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return values.length > 0 ? values : fallback;
}

export function readEnvironment(): EnvironmentConfig {
  const backendInferenceEnabled = booleanFromEnv("BACKEND_INFERENCE_ENABLED", false);
  const backendInferenceBaseUrl = stringFromEnv("BACKEND_INFERENCE_BASE_URL", "").trim();
  if (backendInferenceEnabled && backendInferenceBaseUrl.length === 0) {
    throw new Error("BACKEND_INFERENCE_BASE_URL is required when BACKEND_INFERENCE_ENABLED=true.");
  }
  if (backendInferenceBaseUrl.length > 0) {
    const url = new URL(backendInferenceBaseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("BACKEND_INFERENCE_BASE_URL must use http or https.");
    }
  }

  return {
    apiHost: stringFromEnv("API_HOST", "127.0.0.1"),
    apiPort: numberFromEnvList(["API_PORT", "PORT"], 4000),
    allowedCorsOrigins: stringListFromEnv("WEB_ORIGINS", [
      "http://127.0.0.1:5173",
      "http://localhost:5173"
    ]),
    databaseUrl: stringFromEnv(
      "DATABASE_URL",
      "postgres://soko:soko_dev_password@127.0.0.1:5432/soko_market"
    ),
    backendInferenceEnabled,
    backendInferenceBaseUrl,
    backendInferenceTimeoutMs: numberFromEnv("BACKEND_INFERENCE_TIMEOUT_MS", 120_000),
    backendInferenceModelId: stringFromEnv("BACKEND_INFERENCE_MODEL_ID", "qwen2.5-0.5b-android"),
    backendInferenceProviderModel: stringFromEnv("BACKEND_INFERENCE_MODEL", "qwen2.5:0.5b"),
    inferenceClientFirst: booleanFromEnv("INFERENCE_CLIENT_FIRST", true),
    inferenceOwnerNodeEnabled: booleanFromEnv("INFERENCE_OWNER_NODE_ENABLED", false),
    inferenceCloudFallbackEnabled: booleanFromEnv("INFERENCE_CLOUD_FALLBACK_ENABLED", false),
    inferenceCloudProvider: readCloudProvider(),
    inferenceCloudModelAllowlist: stringListFromEnv("INFERENCE_CLOUD_MODEL_ALLOWLIST", []),
    inferenceCloudMonthlyTokenBudget: numberFromEnv(
      "INFERENCE_CLOUD_MONTHLY_TOKEN_BUDGET",
      100_000
    ),
    inferenceMaxFallbacks: numberFromEnv("INFERENCE_MAX_FALLBACKS", 2),
    inferenceJobTimeoutMs: numberFromEnv("INFERENCE_JOB_TIMEOUT_MS", 120_000),
    redisUrl: stringFromEnv("REDIS_URL", "redis://127.0.0.1:6379")
  };
}

function readCloudProvider(): EnvironmentConfig["inferenceCloudProvider"] {
  const value = stringFromEnv("INFERENCE_CLOUD_PROVIDER", "").trim().toLowerCase();
  if (value === "" || value === "openai") {
    return value;
  }
  throw new Error("INFERENCE_CLOUD_PROVIDER must be empty or openai.");
}

// Kept as a pure compatibility helper for installed-app and owner-node configuration tooling.
// The Render API does not call it or construct an Ollama provider.
export function resolveOllamaModelName(
  modelId: string,
  configuredModelId: string,
  configuredProviderModel: string
): string {
  if (modelId === configuredModelId) return configuredProviderModel;
  return (
    {
      "qwen2.5-0.5b-android": "qwen2.5:0.5b",
      "qwen2.5-1.5b-android": "qwen2.5:1.5b",
      "smollm2-360m-android": "smollm2:360m"
    }[modelId] ?? modelId
  );
}
