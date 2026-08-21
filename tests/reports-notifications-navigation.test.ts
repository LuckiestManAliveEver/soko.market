import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const merchantCommandParser = readFileSync(
  "packages/tool-core/src/parsers/merchant-command.ts",
  "utf8"
);
const runtimeProposals = readFileSync(
  "packages/tool-core/src/parsers/runtime-proposals.ts",
  "utf8"
);
const chatRuntime = readFileSync("apps/web/src/hooks/useChatRuntimeState.ts", "utf8");
const sokoApplication = readFileSync("apps/web/src/SokoApplication.tsx", "utf8");

describe("reports + notifications chat navigation (Phase 4l)", () => {
  it("registers show_reports and show_notifications as read-only navigate intents", () => {
    expect(merchantCommandParser).toContain('intent: "show_reports"');
    expect(merchantCommandParser).toContain('intent: "show_notifications"');
    expect(runtimeProposals).toContain('toolName: "reports.summary"');
    expect(runtimeProposals).toContain('toolName: "notifications.list"');
  });

  it("navigates to reports/notifications and refreshes their data as soon as a turn executes the read tool", () => {
    expect(chatRuntime).toContain(
      'if (result.turn.plan.toolName === "reports.summary" && business !== null) {'
    );
    expect(chatRuntime).toContain(
      'if (result.turn.plan.toolName === "notifications.list" && business !== null) {'
    );
    expect(chatRuntime).toContain("await loadReports(business.id);");
    expect(chatRuntime).toContain("await loadNotifications(business.id);");
  });

  it("threads loadReports/loadNotifications from OwnerApp into the chat runtime hook", () => {
    expect(sokoApplication).toContain("useChatRuntimeState({");
    const chatCallStart = sokoApplication.indexOf("useChatRuntimeState({");
    const chatCallEnd = sokoApplication.indexOf("});", chatCallStart);
    const chatCallSource = sokoApplication.slice(chatCallStart, chatCallEnd);
    expect(chatCallSource).toContain("loadReports,");
    expect(chatCallSource).toContain("loadNotifications,");
  });
});
