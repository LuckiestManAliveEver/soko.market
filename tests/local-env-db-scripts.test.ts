import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// `pnpm dev:local` reads .env and .env.local, but `pnpm db:migrate` used to read neither, so in
// local mode it either refused to run or never reached Neon, and migration 106 silently stayed
// unapplied. Schema-changing scripts must load the same env files as the API they migrate for.
const scripts = (
  JSON.parse(readFileSync(new URL("../services/api/package.json", import.meta.url), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;

describe("local env loading for database scripts", () => {
  it.each(["dev", "db:migrate", "db:rollback"])("%s loads .env and .env.local", (name) => {
    expect(scripts[name]).toContain("--env-file-if-exists=../../.env ");
    expect(scripts[name]).toContain("--env-file-if-exists=../../.env.local ");
  });
});
