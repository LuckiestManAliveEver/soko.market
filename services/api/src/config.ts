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

function floatFromEnv(name: string, fallback: number): number {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number.`);
  }

  return parsed;
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
    localModelEnabled: booleanFromEnv("LOCAL_MODEL_ENABLED", false),
    localModelEndpoint: stringFromEnv("LOCAL_MODEL_ENDPOINT", "http://127.0.0.1:8080"),
    localModelMaxTokens: numberFromEnv("LOCAL_MODEL_MAX_TOKENS", 128),
    localModelProfile: stringFromEnv("LOCAL_MODEL_PROFILE", "tinyllama-1.1b-chat-q4-k-m-android"),
    localModelTemperature: floatFromEnv("LOCAL_MODEL_TEMPERATURE", 0),
    localModelTimeoutMs: numberFromEnv("LOCAL_MODEL_TIMEOUT_MS", 8000),
    redisUrl: stringFromEnv("REDIS_URL", "redis://127.0.0.1:6379")
  };
}
