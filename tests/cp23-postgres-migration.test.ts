import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CP23 Postgres migration", () => {
  it("stores hashed MCP tokens with relational ownership and expiry indexes", () => {
    const sql = readFileSync("infra/db/migrations/019_cp23_mcp_access_tokens.sql", "utf8");
    expect(sql).toContain("create table if not exists mcp_access_tokens");
    expect(sql).toContain("token_hash character(64) not null unique");
    expect(sql).toContain("session_id uuid not null references sessions");
    expect(sql).toContain("scopes text[] not null");
    expect(sql).toContain("mcp_access_tokens_account_updated_idx");
    expect(sql).toContain("mcp_access_tokens_expiry_idx");
  });

  it("has an explicit rollback", () => {
    const sql = readFileSync("infra/db/rollbacks/019_cp23_mcp_access_tokens.down.sql", "utf8");
    expect(sql).toContain("drop table if exists mcp_access_tokens");
  });
});
