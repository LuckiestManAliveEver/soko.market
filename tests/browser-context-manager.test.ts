import { describe, expect, it } from "vitest";
import {
  buildBrowserModelContext,
  estimateTokens,
  stablePrefixCacheKey,
  updateRollingConversationSummary
} from "../apps/web/src/browser-context-manager";
import type { RetrievedContext } from "../apps/web/src/browser-inference-types";

function context(sourceId: string, content: string): RetrievedContext {
  return {
    sourceType: "catalogue",
    sourceId,
    content,
    relevanceScore: 1,
    timestamp: "2026-07-19T00:00:00.000Z",
    tokenEstimate: estimateTokens(content),
    trustLevel: "authoritative"
  };
}

describe("browser context manager", () => {
  it("preserves protected input and drops complete low-priority sources first", async () => {
    const built = await buildBrowserModelContext({
      systemPrompt: "Required safety instruction.",
      agentIdentity: "Business assistant and storefront attendant",
      shopIdentity: "Jane's Shop",
      currentMessage: "Do you sell rice?",
      recentMessages: [
        { id: "m1", role: "user", content: "Hello" },
        { id: "m2", role: "assistant", content: "How can I help?" }
      ],
      contextScripts: [context("script", "Use only authoritative catalogue values.")],
      catalogue: [context("rice", "Rice 2kg, price 500, quantity 4")],
      memory: [context("memory", "A long lower priority memory ".repeat(20))],
      summary: {
        conversationId: "conversation",
        version: 1,
        coveredThroughMessageId: "old",
        summaryText: "An older low-priority summary ".repeat(20),
        facts: [],
        pendingActions: [],
        updatedAt: "2026-07-19T00:00:00.000Z"
      },
      toolDescriptions: ["Optional tool description ".repeat(20)],
      contextWindowTokens: 256,
      reservedGenerationTokens: 64
    });

    expect(built.estimatedPromptTokens + built.reservedGenerationTokens).toBeLessThanOrEqual(
      built.totalBudgetTokens
    );
    expect(built.messages.map((message) => message.content).join(" ")).toContain(
      "Required safety instruction"
    );
    expect(built.messages.map((message) => message.content).join(" ")).toContain(
      "Do you sell rice?"
    );
    expect(built.includedSources.some((source) => source.type === "catalogue")).toBe(true);
    expect(
      built.droppedSources.some((source) => source.type === "summary" || source.type === "memory")
    ).toBe(true);
    expect(built.warnings.join(" ")).toContain("conservative estimate");
  });

  it("uses a tokenizer result when available and marks it exact", async () => {
    const built = await buildBrowserModelContext({
      systemPrompt: "Safe.",
      agentIdentity: "Agent.",
      shopIdentity: "Shop.",
      currentMessage: "Hello.",
      recentMessages: [],
      contextScripts: [],
      catalogue: [],
      memory: [],
      summary: null,
      contextWindowTokens: 256,
      reservedGenerationTokens: 64,
      tokenizer: {
        async countTokens() {
          return 42;
        }
      }
    });
    expect(built.estimatedPromptTokens).toBe(42);
    expect(built.tokenCountEstimated).toBe(false);
  });

  it("uses the tokenizer to drop optional records until the exact prompt fits", async () => {
    const calls: number[] = [];
    const built = await buildBrowserModelContext({
      systemPrompt: "Safe.",
      agentIdentity: "Agent.",
      shopIdentity: "Shop.",
      currentMessage: "Hello.",
      recentMessages: [{ id: "recent", role: "assistant", content: "Recent context." }],
      contextScripts: [],
      catalogue: [context("optional", "Optional catalogue context.")],
      memory: [],
      summary: null,
      contextWindowTokens: 200,
      reservedGenerationTokens: 60,
      tokenizer: {
        async countTokens(messages) {
          calls.push(messages.length);
          return messages.some((message) => message.content.includes("Optional catalogue"))
            ? 150
            : 100;
        }
      }
    });
    expect(calls.length).toBeGreaterThan(1);
    expect(built.estimatedPromptTokens).toBe(100);
    expect(built.droppedSources).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "optional" })])
    );
  });

  it("generates deterministic stable-prefix cache keys", () => {
    expect(stablePrefixCacheKey("same prefix")).toBe(stablePrefixCacheKey("same prefix"));
    expect(stablePrefixCacheKey("same prefix")).not.toBe(stablePrefixCacheKey("changed prefix"));
  });

  it("updates summaries only after a defined boundary and retains source ids", () => {
    const messages = Array.from({ length: 12 }, (_, index) => ({
      id: `m-${index}`,
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: index === 4 ? "Please remember to follow up on order 42." : `Message ${index}`
    }));
    expect(
      updateRollingConversationSummary({
        conversationId: "c1",
        messages: messages.slice(0, 4),
        previous: null
      })
    ).toBeNull();

    const summary = updateRollingConversationSummary({
      conversationId: "c1",
      messages,
      previous: null,
      now: new Date("2026-07-19T01:00:00.000Z")
    });
    expect(summary).toMatchObject({ conversationId: "c1", version: 1 });
    expect(summary?.facts.flatMap((fact) => fact.sourceMessageIds)).toContain("m-0");
    expect(summary?.pendingActions).toContain("Please remember to follow up on order 42.");
  });
});
