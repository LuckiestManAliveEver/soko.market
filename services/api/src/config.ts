import { resolveRuntimeModel, type EnvironmentConfig } from "@soko/shared-types";

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
  const configuredInferenceBaseUrl = stringFromEnv("BACKEND_INFERENCE_BASE_URL", "").trim();
  const backendInferenceBaseUrl =
    configuredInferenceBaseUrl !== "" &&
    !/^[a-z][a-z0-9+.-]*:\/\//iu.test(configuredInferenceBaseUrl)
      ? `http://${configuredInferenceBaseUrl}`
      : configuredInferenceBaseUrl;
  const inferenceServiceToken = stringFromEnv("INFERENCE_SERVICE_TOKEN", "").trim();
  if (backendInferenceEnabled && backendInferenceBaseUrl.length === 0) {
    throw new Error("BACKEND_INFERENCE_BASE_URL is required when BACKEND_INFERENCE_ENABLED=true.");
  }
  if (backendInferenceEnabled && inferenceServiceToken.length < 32) {
    throw new Error(
      "INFERENCE_SERVICE_TOKEN must contain at least 32 characters when backend inference is enabled."
    );
  }
  if (backendInferenceBaseUrl.length > 0) {
    const url = new URL(backendInferenceBaseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("BACKEND_INFERENCE_BASE_URL must use http or https.");
    }
    if (url.username !== "" || url.password !== "") {
      throw new Error("BACKEND_INFERENCE_BASE_URL must not include credentials.");
    }
    if (
      process.env.NODE_ENV === "production" &&
      process.env.RENDER_SERVICE_ID !== undefined &&
      ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    ) {
      throw new Error(
        "BACKEND_INFERENCE_BASE_URL cannot use loopback from the Render API service."
      );
    }
  }
  const backendInferenceModelId = stringFromEnv(
    "BACKEND_INFERENCE_MODEL_ID",
    "qwen2.5-0.5b-android"
  );
  const runtimeModel = resolveRuntimeModel(backendInferenceModelId);
  if (backendInferenceEnabled && (runtimeModel === null || !runtimeModel.enabled)) {
    throw new Error("BACKEND_INFERENCE_MODEL_ID must identify an enabled runtime model.");
  }
  const legacyProviderModel = stringFromEnv("BACKEND_INFERENCE_MODEL", "").trim();
  if (
    legacyProviderModel !== "" &&
    runtimeModel !== null &&
    legacyProviderModel !== runtimeModel.providerModelId
  ) {
    throw new Error("BACKEND_INFERENCE_MODEL must match the canonical runtime model mapping.");
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
    backendInferenceConnectTimeoutMs: numberFromEnv("BACKEND_INFERENCE_CONNECT_TIMEOUT_MS", 5_000),
    backendInferenceTimeoutMs: numberFromEnv("BACKEND_INFERENCE_TIMEOUT_MS", 90_000),
    backendInferenceModelId,
    backendInferenceRequired: booleanFromEnv("BACKEND_INFERENCE_REQUIRED", false),
    inferenceServiceToken,
    inferenceOwnerNodeEnabled: booleanFromEnv("INFERENCE_OWNER_NODE_ENABLED", false),
    inferenceCloudProvider: readCloudProvider(),
    inferenceCloudModelAllowlist: stringListFromEnv("INFERENCE_CLOUD_MODEL_ALLOWLIST", []),
    inferenceCloudMonthlyTokenBudget: numberFromEnv(
      "INFERENCE_CLOUD_MONTHLY_TOKEN_BUDGET",
      100_000
    ),
    inferenceMaxFallbacks: numberFromEnv("INFERENCE_MAX_FALLBACKS", 2),
    inferenceJobTimeoutMs: numberFromEnv("INFERENCE_JOB_TIMEOUT_MS", 120_000),
    workspaceDeliveryMaxFileBytes: numberFromEnv("WORKSPACE_DELIVERY_MAX_FILE_BYTES", 10_000_000),
    workspaceRoot: stringFromEnv("SOKO_WORKSPACE_ROOT", "").trim(),
    redisUrl: readRedisUrl()
  };
}

// Rate limiting requires a real, shared Redis so counters survive process restarts and are
// consistent across instances. Silently falling back to loopback in production would make the
// API connect to a Redis that doesn't exist there (each Render instance has no local Redis),
// producing the opaque `rate_limit_redis_connection_error` / ECONNREFUSED 127.0.0.1:6379 failure
// instead of a clear configuration error at boot. Non-production environments keep the loopback
// default so local dev and CI don't require REDIS_URL to be set.
function readRedisUrl(): string {
  const configured = stringFromEnv("REDIS_URL", "").trim();
  if (configured !== "") return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "REDIS_URL is required in production. Configure the Render Key Value service " +
        "(soko-market-rate-limit-cache) connection string; the API will not silently fall back " +
        "to a local Redis that does not exist in production."
    );
  }
  return "redis://127.0.0.1:6379";
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
  const runtimeModel = resolveRuntimeModel(modelId);
  if (runtimeModel !== null) return runtimeModel.providerModelId;
  if (modelId === configuredModelId) return configuredProviderModel;
  return modelId;
}
