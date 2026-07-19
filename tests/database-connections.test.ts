import { describe, expect, it } from "vitest";
import {
  databasePoolConfig,
  isAcceptedMigrationChecksum,
  normalizeDatabaseUrl,
  readDatabaseUrl
} from "../services/api/scripts/database-connection.mjs";

describe("database connection policy", () => {
  it("falls back from a blank direct URL to the pooled URL", () => {
    expect(
      readDatabaseUrl({
        DIRECT_DATABASE_URL: "  ",
        DATABASE_URL: " postgres://pooled.example/soko?sslmode=require "
      })
    ).toBe("postgres://pooled.example/soko?sslmode=verify-full");
  });

  it("prefers a configured direct URL and normalizes transport security", () => {
    expect(
      readDatabaseUrl({
        DIRECT_DATABASE_URL: "postgres://direct.example/soko?sslmode=verify-ca",
        DATABASE_URL: "postgres://pooled.example/soko"
      })
    ).toBe("postgres://direct.example/soko?sslmode=verify-full");
    expect(normalizeDatabaseUrl(" postgres://db.example/soko?sslmode=prefer ")).toBe(
      "postgres://db.example/soko?sslmode=verify-full"
    );
  });

  it("applies bounded pool settings and identifies connections", () => {
    expect(
      databasePoolConfig("postgres://project.neon.tech/soko", {
        applicationName: "schema-audit",
        environment: {
          DB_CONNECTION_TIMEOUT_MS: "7000",
          DB_IDLE_TIMEOUT_MS: "9000",
          DB_POOL_MAX: "3",
          DB_QUERY_TIMEOUT_MS: "11000",
          DB_STATEMENT_TIMEOUT_MS: "13000"
        }
      })
    ).toMatchObject({
      application_name: "schema-audit",
      connectionTimeoutMillis: 7000,
      idleTimeoutMillis: 9000,
      max: 3,
      query_timeout: 11000,
      statement_timeout: 13000,
      ssl: true
    });
  });

  it("keeps the approved historical migration checksum policy shared", () => {
    expect(
      isAcceptedMigrationChecksum(
        "014_cp2_phase1_auth_security_relational.sql",
        "695019b487acf03ba6dfe87c64c5dd4204bbb52bfb9d551d8623cff2519560a6",
        "current"
      )
    ).toBe(true);
    expect(isAcceptedMigrationChecksum("001_example.sql", "changed", "current")).toBe(false);
  });
});
