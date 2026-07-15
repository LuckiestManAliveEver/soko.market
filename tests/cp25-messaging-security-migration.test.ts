import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CP25 messaging security migration", () => {
  it("persists device public keys and Web Push subscriptions", () => {
    const sql = readFileSync("infra/db/migrations/021_messaging_push_e2ee.sql", "utf8");
    expect(sql).toContain("cp2_e2ee_devices");
    expect(sql).toContain("cp2_push_subscriptions");
    expect(sql).toContain("account_id");
  });

  it("provides a scoped rollback", () => {
    const sql = readFileSync("infra/db/rollbacks/021_messaging_push_e2ee.down.sql", "utf8");
    expect(sql).toContain("drop table if exists cp2_push_subscriptions");
    expect(sql).toContain("drop table if exists cp2_e2ee_devices");
  });
});
