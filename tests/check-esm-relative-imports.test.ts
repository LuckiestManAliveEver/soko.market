import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = join(process.cwd(), "scripts/check-esm-relative-imports.mjs");

function run(cwd: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [scriptPath], { cwd, encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    return { status: failure.status, stdout: failure.stdout, stderr: failure.stderr };
  }
}

/**
 * Regression coverage for the ERR_MODULE_NOT_FOUND bug this script exists to catch:
 * packages/business-core's freshly-split domain files used extensionless relative imports, which
 * tsc's "Bundler" resolution accepts but Node's real ESM resolver rejects at runtime once the
 * compiled dist/ is actually loaded - a failure mode invisible to tsc, vitest, and tsx alike.
 */
describe("check-esm-relative-imports script", () => {
  it("passes against the real repository (no regressions today)", () => {
    const result = run(process.cwd());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("carries an explicit extension");
  });

  it('fails and names the offending file when a "type": "module" package has an extensionless relative import', () => {
    const workspace = mkdtempSync(join(tmpdir(), "esm-import-check-"));
    try {
      const packageDir = join(workspace, "packages", "fixture-pkg");
      mkdirSync(join(packageDir, "src"), { recursive: true });
      writeFileSync(
        join(packageDir, "package.json"),
        JSON.stringify({ name: "@soko/fixture-pkg", type: "module" })
      );
      writeFileSync(
        join(packageDir, "src", "index.ts"),
        'import { helper } from "./helper";\nexport { helper };\n'
      );
      writeFileSync(join(packageDir, "src", "helper.ts"), "export function helper() {}\n");

      const result = run(workspace);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('imports "./helper" without an extension');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("passes once the extensionless import gains an explicit .js extension", () => {
    const workspace = mkdtempSync(join(tmpdir(), "esm-import-check-"));
    try {
      const packageDir = join(workspace, "packages", "fixture-pkg");
      mkdirSync(join(packageDir, "src"), { recursive: true });
      writeFileSync(
        join(packageDir, "package.json"),
        JSON.stringify({ name: "@soko/fixture-pkg", type: "module" })
      );
      writeFileSync(
        join(packageDir, "src", "index.ts"),
        'import { helper } from "./helper.js";\nexport { helper };\n'
      );
      writeFileSync(join(packageDir, "src", "helper.ts"), "export function helper() {}\n");

      const result = run(workspace);
      expect(result.status).toBe(0);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('ignores packages that aren\'t "type": "module"', () => {
    const workspace = mkdtempSync(join(tmpdir(), "esm-import-check-"));
    try {
      const packageDir = join(workspace, "packages", "fixture-pkg");
      mkdirSync(join(packageDir, "src"), { recursive: true });
      writeFileSync(
        join(packageDir, "package.json"),
        JSON.stringify({ name: "@soko/fixture-pkg" })
      );
      writeFileSync(join(packageDir, "src", "index.ts"), 'import { helper } from "./helper";\n');
      writeFileSync(join(packageDir, "src", "helper.ts"), "export function helper() {}\n");

      const result = run(workspace);
      expect(result.status).toBe(0);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
