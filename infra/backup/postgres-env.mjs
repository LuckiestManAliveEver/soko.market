import { URL } from "node:url";

export function postgresEnvironment(databaseUrl, baseEnvironment = process.env) {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Database URL must use postgres:// or postgresql://.");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\/+/u, ""));
  if (url.hostname === "" || database === "") throw new Error("Database URL is incomplete.");
  return {
    database,
    environment: {
      ...baseEnvironment,
      PGHOST: url.hostname,
      PGPORT: url.port || "5432",
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: database,
      ...(url.searchParams.has("sslmode")
        ? { PGSSLMODE: url.searchParams.get("sslmode") ?? "prefer" }
        : {})
    }
  };
}
