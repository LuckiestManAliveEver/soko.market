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

function stringFromEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? fallback : value;
}

export function readEnvironment(): EnvironmentConfig {
  return {
    apiHost: stringFromEnv("API_HOST", "127.0.0.1"),
    apiPort: numberFromEnv("API_PORT", 4000),
    databaseUrl: stringFromEnv(
      "DATABASE_URL",
      "postgres://soko:soko_dev_password@127.0.0.1:5432/soko_market"
    ),
    redisUrl: stringFromEnv("REDIS_URL", "redis://127.0.0.1:6379")
  };
}
