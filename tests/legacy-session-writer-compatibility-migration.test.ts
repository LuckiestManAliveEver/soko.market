import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("legacy session writer compatibility migration", () => {
  it("fills every required native-session field for older API writers", async () => {
    const sql = await readFile(
      "infra/db/migrations/037_legacy_session_writer_compatibility.sql",
      "utf8"
    );

    expect(sql).toContain("before insert or update on sessions");
    expect(sql).toContain("new.device_id := coalesce(new.device_id");
    expect(sql).toContain("new.session_family_id := coalesce(new.session_family_id, new.id)");
    expect(sql).toContain(
      "new.refresh_expires_at := coalesce(new.refresh_expires_at, new.expires_at)"
    );
    expect(sql).toContain("new.last_used_at := coalesce(new.last_used_at, new.created_at)");
  });

  it("removes only the compatibility trigger and function on rollback", async () => {
    const sql = await readFile(
      "infra/db/rollbacks/037_legacy_session_writer_compatibility.down.sql",
      "utf8"
    );

    expect(sql).toContain("drop trigger if exists sessions_native_defaults_trigger on sessions");
    expect(sql).toContain("drop function if exists populate_native_session_defaults()");
  });
});
