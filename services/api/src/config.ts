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
    redisUrl: stringFromEnv("REDIS_URL", "redis://127.0.0.1:6379")
  };
}
