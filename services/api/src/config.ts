import {
  repositoryDefaultRuntimePolicy,
  type EnvironmentConfig,
  type ModelExecutionTarget
} from "@soko/shared-types";

export function readEnvironment(): EnvironmentConfig {
  const vercelInferenceUrl = stringFromEnv("VERCEL_INFERENCE_URL", "").trim();
  const inferenceRequired = booleanFromEnv("INFERENCE_REQUIRED", false);
  const inferenceServiceToken = stringFromEnv("SOKO_INFERENCE_SERVICE_TOKEN", "").trim();
  if (inferenceRequired && vercelInferenceUrl === "") {
    throw new Error("VERCEL_INFERENCE_URL is required when INFERENCE_REQUIRED=true.");
  }
  if (vercelInferenceUrl !== "") validateHttpsUrl(vercelInferenceUrl, "VERCEL_INFERENCE_URL");
  if (vercelInferenceUrl !== "" && inferenceServiceToken.length < 32) {
    throw new Error("SOKO_INFERENCE_SERVICE_TOKEN must contain at least 32 characters.");
  }
  const neonModelStorageEndpoint = stringFromEnv("NEON_MODEL_STORAGE_ENDPOINT", "").trim();
  const neonModelStorageAccessKeyId = stringFromEnv("NEON_MODEL_STORAGE_ACCESS_KEY_ID", "").trim();
  const neonModelStorageSecretAccessKey = stringFromEnv(
    "NEON_MODEL_STORAGE_SECRET_ACCESS_KEY",
    ""
  ).trim();
  if (vercelInferenceUrl !== "") {
    if (neonModelStorageEndpoint === "")
      throw new Error("NEON_MODEL_STORAGE_ENDPOINT is required for Vercel inference.");
    validateHttpsUrl(neonModelStorageEndpoint, "NEON_MODEL_STORAGE_ENDPOINT");
    if (neonModelStorageAccessKeyId === "" || neonModelStorageSecretAccessKey === "") {
      throw new Error("Neon model-storage credentials are required for Vercel inference.");
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
    vercelInferenceUrl,
    vercelInferenceTimeoutMs: numberFromEnv("VERCEL_INFERENCE_TIMEOUT_MS", 300_000),
    inferenceRequired,
    inferenceServiceToken,
    neonModelStorageEndpoint,
    neonModelStorageRegion: stringFromEnv("NEON_MODEL_STORAGE_REGION", "us-east-1").trim(),
    neonModelStorageAccessKeyId,
    neonModelStorageSecretAccessKey,
    modelArtifactUrlTtlSeconds: numberFromEnv("MODEL_ARTIFACT_URL_TTL_SECONDS", 900),
    inferenceOwnerNodeEnabled: booleanFromEnv("INFERENCE_OWNER_NODE_ENABLED", false),
    inferenceMaxFallbacks: numberFromEnv("INFERENCE_MAX_FALLBACKS", 2),
    inferenceJobTimeoutMs: numberFromEnv("INFERENCE_JOB_TIMEOUT_MS", 120_000),
    workspaceDeliveryMaxFileBytes: numberFromEnv("WORKSPACE_DELIVERY_MAX_FILE_BYTES", 10_000_000),
    workspaceRoot: stringFromEnv("SOKO_WORKSPACE_ROOT", "").trim(),
    redisUrl: readRedisUrl(),
    platformDefaultRuntime: {
      agentId: portableIdFromEnv(
        "PLATFORM_DEFAULT_AGENT_ID",
        repositoryDefaultRuntimePolicy.agentId
      ),
      agentName: stringFromEnv(
        "PLATFORM_DEFAULT_AGENT_NAME",
        repositoryDefaultRuntimePolicy.agentName
      ).trim(),
      agentRuntimeAdapterId: portableIdFromEnv(
        "PLATFORM_DEFAULT_AGENT_ADAPTER_ID",
        repositoryDefaultRuntimePolicy.agentRuntimeAdapterId
      ),
      modelId: portableIdFromEnv(
        "PLATFORM_DEFAULT_MODEL_ID",
        repositoryDefaultRuntimePolicy.modelId
      ),
      executionTarget: executionTargetFromEnv(
        "PLATFORM_DEFAULT_EXECUTION_TARGET",
        repositoryDefaultRuntimePolicy.executionTarget
      )
    }
  };
}

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function numberFromEnvList(names: string[], fallback: number): number {
  const configured = names.find((name) => (process.env[name]?.trim() ?? "") !== "");
  return configured === undefined ? fallback : numberFromEnv(configured, fallback);
}

function booleanFromEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === undefined || value === "") return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`${name} must be true or false.`);
}

function stringFromEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? fallback : value;
}

function stringListFromEnv(name: string, fallback: string[]): string[] {
  const values = (process.env[name] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length === 0 ? fallback : values;
}

function portableIdFromEnv(name: string, fallback: string): string {
  const value = stringFromEnv(name, fallback).trim();
  if (!/^[a-z0-9][a-z0-9:._-]{0,199}$/u.test(value))
    throw new Error(`${name} must be a portable lowercase identifier.`);
  return value;
}

function executionTargetFromEnv(
  name: string,
  fallback: ModelExecutionTarget
): ModelExecutionTarget {
  const value = stringFromEnv(name, fallback).trim();
  if (["vercel", "backend", "remote-shop-device"].includes(value))
    return value as ModelExecutionTarget;
  throw new Error(`${name} is not a supported model execution target.`);
}

function validateHttpsUrl(value: string, name: string): void {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(process.env.NODE_ENV !== "production" && url.protocol === "http:")
  ) {
    throw new Error(`${name} must use https.`);
  }
  if (url.username !== "" || url.password !== "")
    throw new Error(`${name} must not include credentials.`);
}

function readRedisUrl(): string {
  const configured = stringFromEnv("REDIS_URL", "").trim();
  if (configured !== "") return configured;
  if (process.env.NODE_ENV === "production")
    throw new Error("REDIS_URL is required in production.");
  return "redis://127.0.0.1:6379";
}
