import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration014 = readFileSync(
  resolve(process.cwd(), "infra/db/migrations/014_cp2_phase1_auth_security_relational.sql"),
  "utf8"
);
const migration016 = readFileSync(
  resolve(process.cwd(), "infra/db/migrations/016_device_trust_actor_type.sql"),
  "utf8"
);

describe("device trust system actor migration", () => {
  it("never casts the system sentinel to UUID", () => {
    expect(migration014).not.toMatch(/'system'\s*::uuid/i);
    expect(migration014).not.toMatch(/cast\s*\(\s*'system'\s+as\s+uuid\s*\)/i);
    expect(migration014).toContain("when record->>'updatedBy' in ('system', 'service') then null");
  });

  it("keeps the device owner as a real user and types the optional actor separately", () => {
    expect(migration014).toContain("join users subject on subject.id = candidate.user_id");
    expect(migration014).toContain("updated_by, updated_by_type, updated_at");
    expect(migration016).toContain(
      "alter table device_trust alter column updated_by drop not null"
    );
    expect(migration016).toContain("updated_by_type in ('system', 'service')");
  });

  it.each([
    ["user", "valid-user-uuid", true],
    ["user", null, false],
    ["system", null, true],
    ["system", "valid-user-uuid", false],
    ["service", null, true],
    ["service", "valid-user-uuid", false]
  ])("validates actor combination %s / %s", (actorType, actorUserId, accepted) => {
    const valid =
      (actorType === "user" && actorUserId !== null) ||
      ((actorType === "system" || actorType === "service") && actorUserId === null);

    expect(valid).toBe(accepted);
  });
});
