import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

// Migration 106: session retention must follow the refreshable lifetime, not the ~15 minute
// access token, or every API restart signs out users who were idle for more than ~15 minutes.
describe("session retention migration 106", () => {
  const read = (path: string) => readFile(path, "utf8");

  it("revokes only once refresh, inactivity, or absolute lifetime is over", async () => {
    const sql = await read("infra/db/migrations/106_session_retention_uses_refresh_lifetime.sql");
    expect(sql).toContain(
      "least(new.refresh_expires_at, new.inactivity_expires_at, new.absolute_expires_at)"
    );
    expect(sql).toContain("nullif(new.record->>'refreshExpiresAt', '')::timestamptz");
    expect(sql).toContain("nullif(new.record->>'inactivityExpiresAt', '')::timestamptz");
    expect(sql).toContain("nullif(new.record->>'absoluteExpiresAt', '')::timestamptz");
    expect(sql).not.toMatch(/if new\.expires_at < now\(\)/u);
  });

  it("restores only sessions that are still within their refreshable lifetime", async () => {
    const sql = await read("infra/db/migrations/106_session_retention_uses_refresh_lifetime.sql");
    expect(sql).toMatch(
      /update sessions\s+set revoked_at = null,\s+revocation_reason = null\s+where revocation_reason = 'expired'\s+and least\(refresh_expires_at, inactivity_expires_at, absolute_expires_at\) > now\(\);/u
    );
  });

  it("rolls back the trigger functions without re-revoking restored sessions", async () => {
    const sql = await read(
      "infra/db/rollbacks/106_session_retention_uses_refresh_lifetime.down.sql"
    );
    expect(sql).toContain("create or replace function revoke_expired_session()");
    expect(sql).not.toMatch(/update\s+(sessions|cp2_sessions)/u);
  });

  it("is required before the API boots", async () => {
    const store = await read("services/api/src/cp2/postgres-store.ts");
    expect(store).toContain('"106_session_retention_uses_refresh_lifetime.sql"');
  });
});
