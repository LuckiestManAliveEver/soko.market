import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("MCP integration principal migration", () => {
  it("preserves creator provenance without retaining a browser-session lifecycle dependency", () => {
    const sql = readFileSync("infra/db/migrations/061_mcp_integration_principal.sql", "utf8");

    expect(sql).toContain("drop constraint if exists mcp_access_tokens_session_id_fkey");
    expect(sql).toContain("rename column session_id to created_by_session_id");
    expect(sql).toContain("alter column created_by_session_id drop not null");
    expect(sql).not.toContain("on delete cascade");
  });

  it("provides an explicit rollback to the legacy session-bound schema", () => {
    const sql = readFileSync("infra/db/rollbacks/061_mcp_integration_principal.down.sql", "utf8");

    expect(sql).toContain("rename column created_by_session_id to session_id");
    expect(sql).toContain("alter column session_id set not null");
    expect(sql).toContain("foreign key (session_id) references sessions (id) on delete cascade");
  });
});
