import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Render Blueprint", () => {
  it("provisions and wires the Postgres database into every database consumer", async () => {
    const blueprint = await readFile(new URL("../render.yaml", import.meta.url), "utf8");

    expect(blueprint).toContain("databases:\n  - name: soko-market-db");
    expect(blueprint).toContain("CP2_STORE\n        value: postgres");
    expect(blueprint).toContain("corepack pnpm db:migrate &&");
    expect(blueprint).not.toMatch(/key: (?:DIRECT_)?DATABASE_URL\n\s+sync: false/);
    expect(blueprint.match(/name: soko-market-db\n\s+property: connectionString/g)).toHaveLength(8);
  });
});
