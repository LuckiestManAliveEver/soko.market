import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = join(process.cwd(), "scripts/check-shellview-boundary.mjs");

function run(cwd: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [scriptPath], { cwd, encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    return { status: failure.status, stdout: failure.stdout, stderr: failure.stderr };
  }
}

function writeFixtureAppShell(workspace: string, shellViewSource: string): void {
  const shellDir = join(workspace, "apps", "web", "src");
  mkdirSync(shellDir, { recursive: true });
  writeFileSync(join(shellDir, "app-shell.ts"), shellViewSource);
}

/**
 * Phase 5 of docs/frontend/frontend.md: this script is the enforceable form of the per-domain
 * audit discipline Phases 4a-4l established - a new permanent ShellView must be documented (added
 * to the script's own approvedShellViews map, cross-referenced with a docs/frontend/frontend.md
 * audit section) before it can ship, so the "could this be a chat capability instead" question
 * this session asked by hand fifteen times can never again be silently skipped.
 */
describe("check-shellview-boundary script", () => {
  it("passes against the real repository (every current ShellView is documented)", () => {
    const result = run(process.cwd());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("boundary check passed");
  });

  it("fails and names the offending view when an undocumented ShellView is added", () => {
    const workspace = mkdtempSync(join(tmpdir(), "shellview-boundary-check-"));
    try {
      writeFixtureAppShell(
        workspace,
        'export type ShellView =\n  | "home"\n  | "products"\n  | "warehouse-transfers";\n'
      );

      const result = run(workspace);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('"warehouse-transfers"');
      expect(result.stderr).toContain("docs/frontend/frontend.md");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("passes when a fixture only uses a subset of already-approved views", () => {
    const workspace = mkdtempSync(join(tmpdir(), "shellview-boundary-check-"));
    try {
      writeFixtureAppShell(workspace, 'export type ShellView =\n  | "home"\n  | "products";\n');

      const result = run(workspace);
      expect(result.status).toBe(0);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
