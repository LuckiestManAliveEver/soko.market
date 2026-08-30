import { repositoryDefaultRuntimePolicy, resolveRuntimeModel } from "@soko/shared-types";

export interface InferenceServiceConfig {
  host: string;
  port: number;
  engine: "ollama";
  engineBaseUrl: string;
  serviceToken: string;
  primaryModelId: string;
  requestTimeoutMs: number;
  maximumInputCharacters: number;
  maximumOutputTokens: number;
  modelStoragePath: string;
  durableModelStorage: boolean;
  production: boolean;
  redisUrl: string;
}

export function readInferenceServiceConfig(
  environment: NodeJS.ProcessEnv = process.env
): InferenceServiceConfig {
  const production = environment.NODE_ENV === "production";
  const serviceToken = requiredString(environment, "INFERENCE_SERVICE_TOKEN");
  if (serviceToken.length < 32) {
    throw new Error("INFERENCE_SERVICE_TOKEN must contain at least 32 characters.");
  }
  const engine = (environment.INFERENCE_ENGINE ?? "ollama").trim().toLowerCase();
  if (engine !== "ollama") {
    throw new Error("INFERENCE_ENGINE must be ollama.");
  }
  const engineBaseUrl = normalizeHttpUrl(
    environment.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
    "OLLAMA_BASE_URL"
  );
  const primaryModelId = (
    environment.SOKO_PRIMARY_MODEL_ID ?? repositoryDefaultRuntimePolicy.modelId
  ).trim();
  const primaryModel = resolveRuntimeModel(primaryModelId);
  if (primaryModel === null || !primaryModel.enabled) {
    throw new Error("SOKO_PRIMARY_MODEL_ID must identify an enabled runtime model.");
  }
  const configuredProviderModel = environment.SOKO_PRIMARY_PROVIDER_MODEL_ID?.trim();
  if (
    configuredProviderModel !== undefined &&
    configuredProviderModel !== "" &&
    configuredProviderModel !== primaryModel.providerModelId
  ) {
    throw new Error(
      "SOKO_PRIMARY_PROVIDER_MODEL_ID must match the canonical Soko runtime model mapping."
    );
  }

  return {
    host: (environment.AI_RUNTIME_HOST ?? "0.0.0.0").trim(),
    port: positiveInteger(environment, ["PORT", "AI_RUNTIME_PORT"], 4002),
    engine: "ollama",
    engineBaseUrl,
    serviceToken,
    primaryModelId,
    requestTimeoutMs: positiveInteger(environment, ["INFERENCE_REQUEST_TIMEOUT_MS"], 90_000),
    maximumInputCharacters: positiveInteger(
      environment,
      ["INFERENCE_MAX_INPUT_CHARACTERS"],
      32_000
    ),
    maximumOutputTokens: positiveInteger(environment, ["INFERENCE_MAX_OUTPUT_TOKENS"], 512),
    modelStoragePath: (environment.MODEL_STORAGE_PATH ?? "/var/lib/soko-models").trim(),
    durableModelStorage: booleanValue(environment.MODEL_STORAGE_DURABLE, !production),
    production,
    redisUrl: (environment.REDIS_URL ?? "redis://127.0.0.1:6379").trim()
  };
}

function requiredString(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim() ?? "";
  if (value.length === 0) throw new Error(`${name} is required.`);
  return value;
}

function normalizeHttpUrl(value: string, name: string): string {
  const normalized = value.trim().replace(/\/+$/u, "");
  const url = new URL(normalized);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use http or https.`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error(`${name} must not include credentials.`);
  }
  return normalized;
}

function positiveInteger(
  environment: NodeJS.ProcessEnv,
  names: string[],
  fallback: number
): number {
  for (const name of names) {
    const raw = environment[name]?.trim();
    if (raw === undefined || raw === "") continue;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer.`);
    }
    return value;
  }
  return fallback;
}

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw new Error("MODEL_STORAGE_DURABLE must be true or false.");
}
