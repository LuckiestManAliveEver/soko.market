import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("phone identity database audit", () => {
  const source = readFileSync("services/api/scripts/audit-phone-identities.ts", "utf8");

  it("defaults to dry-run, requires --apply, and skips colliding accounts", () => {
    expect(source).toContain('process.argv.includes("--apply")');
    expect(source).toContain('mode: apply ? "apply" : "dry-run"');
    expect(source).toContain("collidingRecords.has(recordKey(item))");
    expect(source).toContain('client.query("begin")');
    expect(source).toContain('client.query("rollback")');
  });

  it("audits every canonical phone identity location without logging full values", () => {
    expect(source).toContain("from users where phone_number_e164 is not null");
    expect(source).toContain("from accounts where primary_auth_channel = 'phone'");
    expect(source).toContain("from account_identities where type = 'phone'");
    expect(source).toContain("safeAuditMask");
    expect(source).not.toContain("stored: item.raw_phone");
  });
});
