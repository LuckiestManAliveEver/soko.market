import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  checkShellViewBoundary,
  formatShellViewBoundaryViolations
} from "../scripts/check-shellview-boundary.mjs";

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
    const result = checkShellViewBoundary(process.cwd());
    expect(result.violations).toEqual([]);
    expect(result.liveShellViews).toHaveLength(19);
  });

  it("fails and names the offending view when an undocumented ShellView is added", () => {
    const workspace = mkdtempSync(join(tmpdir(), "shellview-boundary-check-"));
    try {
      writeFixtureAppShell(
        workspace,
        'export type ShellView =\n  | "home"\n  | "products"\n  | "warehouse-transfers";\n'
      );

      const result = checkShellViewBoundary(workspace);
      expect(result.violations).toEqual(["warehouse-transfers"]);
      const message = formatShellViewBoundaryViolations(result.violations);
      expect(message).toContain('"warehouse-transfers"');
      expect(message).toContain("docs/frontend/frontend.md");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("passes when a fixture only uses a subset of already-approved views", () => {
    const workspace = mkdtempSync(join(tmpdir(), "shellview-boundary-check-"));
    try {
      writeFixtureAppShell(workspace, 'export type ShellView =\n  | "home"\n  | "products";\n');

      expect(checkShellViewBoundary(workspace).violations).toEqual([]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
