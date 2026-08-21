import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Phase 5 of docs/frontend/frontend.md's migration roadmap: every ShellView that exists today was
 * put there deliberately, either as permanent shell chrome or after an explicit per-domain audit
 * (Phases 4a-4l) that weighed a chat-invokable capability against a permanent page and documented
 * the verdict. This allowlist is that audit trail in enforceable form - adding a new ShellView
 * without adding it here (and to a matching section in docs/frontend/frontend.md) fails this
 * check, so a permanent page can never be added by accident or bypass the audit discipline the
 * rest of this roadmap established.
 */
const approvedShellViews = new Map([
  ["home", "shell chrome - session list / workspace root, not a domain page"],
  ["chat", "shell chrome - the conversation surface itself"],
  ["agent", "shell chrome - agent configuration entry point"],
  ["products", "Phase 4a - chat-invokable capability shipped; permanent page kept alongside it"],
  ["suppliers", "Phase 4b - chat-invokable capability shipped; permanent page kept alongside it"],
  ["customers", "Phase 4c - chat-invokable capability shipped; permanent page kept alongside it"],
  ["invoices", "Phase 4d - chat-invokable composer card shipped; permanent page kept alongside it"],
  ["network", "Phase 4g - audited; mostly browser-API-gated, no card, one bug fixed"],
  ["sync", "Phase 4i - audited; offline queue machinery, no natural chat phrasing, no card"],
  ["runtime", "Phase 4j - audited; plumbing chat itself runs on, no card"],
  ["payments", "Phase 4e - chat-invokable composer card shipped; permanent page kept alongside it"],
  ["imports", "Phase 4f - chat-invokable review card shipped; permanent page kept alongside it"],
  ["logistics", "Phase 4h - chat-invokable capability shipped; permanent page kept alongside it"],
  ["compliance", "Phase 4k - audited; internal-operator platform-posture dashboard, no card"],
  ["beta", "Phase 4k - audited; internal-operator platform-posture dashboard, no card"],
  ["launch", "Phase 4k - audited; internal-operator platform-posture dashboard, no card"],
  [
    "reports",
    "Phase 4l - chat navigation shipped (show_reports); permanent page kept alongside it"
  ],
  [
    "notifications",
    "Phase 4l - chat navigation shipped (show_notifications); permanent page kept alongside it"
  ]
]);

export function checkShellViewBoundary(workspace = process.cwd()) {
  const appShellSource = readFileSync(join(workspace, "apps/web/src/app-shell.ts"), "utf8");
  const unionStart = appShellSource.indexOf("export type ShellView =");
  if (unionStart === -1) {
    return {
      liveShellViews: [],
      violations: [
        "check-shellview-boundary: could not find `export type ShellView =` in app-shell.ts"
      ]
    };
  }
  const unionEnd = appShellSource.indexOf(";", unionStart);
  const unionSource = appShellSource.slice(unionStart, unionEnd);
  const liveShellViews = [...unionSource.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]);
  if (liveShellViews.length === 0) {
    return {
      liveShellViews,
      violations: ["check-shellview-boundary: parsed zero ShellView members - regex likely stale"]
    };
  }
  return {
    liveShellViews,
    violations: liveShellViews.filter((view) => !approvedShellViews.has(view))
  };
}

export function formatShellViewBoundaryViolations(violations) {
  if (violations[0]?.startsWith("check-shellview-boundary:")) return violations.join("\n");
  return [
    "ShellView boundary violation - undocumented permanent view(s) added:",
    ...violations.map((view) => `- "${view}"`),
    "\nEvery ShellView must be audited before it ships, per docs/frontend/frontend.md's Phase 4 " +
      "discipline: could this be a chat-invokable capability instead of (or alongside) a permanent " +
      "page? Write the audit as a new section in docs/frontend/frontend.md, then add the view name " +
      "and a one-line reason to the approvedShellViews map in scripts/check-shellview-boundary.mjs."
  ].join("\n");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkShellViewBoundary();
  if (result.violations.length > 0) {
    console.error(formatShellViewBoundaryViolations(result.violations));
    process.exitCode = 1;
  } else {
    console.log(
      `ShellView boundary check passed (${result.liveShellViews.length} views, all audited).`
    );
  }
}
