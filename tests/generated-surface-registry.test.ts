import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const registry = readFileSync("apps/web/src/generated-surface-registry.tsx", "utf8");
const chatSurface = readFileSync("apps/web/src/ChatSurface.tsx", "utf8");
const appShell = readFileSync("apps/web/src/app-shell.ts", "utf8");
const chatMessagePlumbing = readFileSync("apps/web/src/chat-message-plumbing.ts", "utf8");

describe("generated-surface registry", () => {
  it("dispatches each known ConversationMessageContent type to its card, keyed by content.type", () => {
    expect(registry).toContain('"product-capture-progress": (content, context) => {');
    expect(registry).toContain('"status-broadcast": (content, context) => {');
    expect(registry).toContain('"unified-checkout": (content) => {');
    expect(registry).toContain("<ProductCaptureItemsCard");
    expect(registry).toContain("<StatusBroadcastCard");
    expect(registry).toContain("<FulfilmentSplitCard");
  });

  it("degrades safely for an unrecognized content.type instead of crashing the thread", () => {
    expect(registry).toContain("const renderer = generatedSurfaceRegistry[content.type];");
    expect(registry).toContain(
      "return renderer === undefined ? null : renderer(content, context);"
    );
    // No default/fallback branch that would throw or render something unexpected for a type this
    // client hasn't shipped a renderer for - the Partial<Record<...>> lookup returning undefined
    // is the only path for an unrecognized type, and it must resolve to null, not throw.
    expect(registry).not.toContain("throw");
  });

  it("returns null (renders nothing) when content is absent, rather than requiring callers to guard it themselves", () => {
    expect(registry).toContain("if (content === undefined) return null;");
  });

  it("ChatSurface dispatches through the registry instead of one if-block per card field", () => {
    expect(chatSurface).toContain("renderGeneratedSurface(message.content, {");
    expect(chatSurface).not.toContain("message.productCaptureJobId");
    expect(chatSurface).not.toContain("message.statusBroadcastId");
    expect(chatSurface).not.toContain("message.unifiedCheckoutId");
    expect(chatSurface).not.toContain("message.businessCards");
    // owner-controls is the one card kept out of the registry (see docs/frontend/frontend.md) -
    // it needs component-local navigation state (setWorkspaceCardView), not just businessId, so
    // forcing it into the generic registry context would leak local state into a shared contract.
    expect(chatSurface).toContain('message.content?.type === "owner-controls"');
  });

  it("ChatMessage carries the typed union unflattened instead of one optional field per card type", () => {
    expect(appShell).toContain("content?: ConversationMessageContent;");
    expect(appShell).not.toContain("productCaptureJobId?: string;");
    expect(appShell).not.toContain("statusBroadcastId?: string;");
    expect(appShell).not.toContain("unifiedCheckoutId?: string;");
    expect(appShell).not.toContain("businessCards?: {");
  });

  it("mapConversationMessage carries content through directly instead of spreading one field per variant", () => {
    expect(chatMessagePlumbing).not.toContain(
      'message.content.type === "product-capture-progress"\n      ? { productCaptureJobId'
    );
    expect(chatMessagePlumbing).toContain("{ content: message.content }");
    // A deleted message must not carry its content forward, so a deleted status/checkout message
    // can't still render its card.
    expect(chatMessagePlumbing).toContain(
      "message.deletedAt !== null && message.deletedAt !== undefined\n      ? {}\n      : { content: message.content }"
    );
  });
});
