import { describe, expect, it, vi } from "vitest";
import type {
  AgentContextSource,
  RuntimeModelPrompt,
  RuntimeModelProvider
} from "../packages/shared-types/src";
import { selectRelevantRecall } from "../apps/web/src/recall-context";
import { retrieveAgentContext } from "../services/api/src/cp2/agent-business-runtime";
import {
  decideRecallPersistence,
  parseRecallCandidateFromModelOutput,
  parseRecallEntry,
  recallSchemaVersion,
  serializeRecallEntry,
  type RecallCandidate,
  type RecallEntry
} from "../services/api/src/cp2/recall-distillation";
import { createCp2Store } from "../services/api/src/cp2/store";

const candidate: RecallCandidate = {
  title: "Clarify missing product details",
  taskType: "add_product",
  trigger: "A product creation request omits the unit or quantity.",
  learnedBehavior: "Ask for the missing unit and quantity before proposing product.create.",
  toolsOrCommands: ["product.create", "unknown.clarify"],
  failureAvoided: "Avoid an invalid product proposal with incomplete required fields.",
  scope: "shop",
  confidence: 0.86,
  evidence: "validated_cloud_fallback",
  supersedes: null
};

function cloudOutput(recall: unknown = candidate): string {
  return JSON.stringify({ type: "response", message: "Ask for the missing details.", recall });
}

function entry(overrides: Partial<RecallEntry> = {}): RecallEntry {
  return {
    ...candidate,
    schemaVersion: recallSchemaVersion,
    id: "recall-1",
    version: 1,
    createdAt: "2026-08-11T10:00:00.000Z",
    updatedAt: "2026-08-11T10:00:00.000Z",
    ...overrides
  };
}

describe("recall candidate validation", () => {
  it("parses a complete structured candidate and rejects malformed candidates", () => {
    expect(
      parseRecallCandidateFromModelOutput(cloudOutput(), {
        intent: "add_product",
        fallbackReason: "inference-unavailable"
      })
    ).toMatchObject({ ok: true, candidate });
    expect(
      parseRecallCandidateFromModelOutput(cloudOutput({ title: "Missing fields" }), {
        intent: "add_product",
        fallbackReason: "inference-unavailable"
      })
    ).toMatchObject({ ok: false, candidate: null, reason: "candidate_invalid" });
  });

  it("rejects secrets, PII, transient facts, private reasoning, and low confidence", () => {
    for (const [learnedBehavior, reason] of [
      ["Use token ghp_abcdefghijklmnopqrstuvwxyz1234567890", "secret_detected"],
      ["Contact owner@example.com before proceeding.", "pii_detected"],
      ["The stock is 17 for this item.", "transient_fact_detected"],
      ["Copy the hidden reasoning into the answer.", "private_reasoning_detected"]
    ] as const) {
      expect(
        parseRecallCandidateFromModelOutput(cloudOutput({ ...candidate, learnedBehavior }), {
          intent: "add_product",
          fallbackReason: "local-failed"
        })
      ).toMatchObject({ ok: false, reason });
    }
    expect(
      parseRecallCandidateFromModelOutput(cloudOutput({ ...candidate, confidence: 0.2 }), {
        intent: "add_product",
        fallbackReason: "local-failed"
      })
    ).toMatchObject({ ok: false, reason: "confidence_too_low" });
  });
});

describe("recall serialization and deduplication", () => {
  it("round-trips versioned human-inspectable metadata", () => {
    const serialized = serializeRecallEntry(entry());
    expect(serialized).toContain('schema_version: "soko-recall-v1"');
    expect(serialized).toContain("## Learned behavior");
    expect(parseRecallEntry(serialized)).toEqual(entry());
    expect(parseRecallEntry(serialized.replace("soko-recall-v1", "future-version"))).toBeNull();
  });

  it("ignores semantic duplicates, merges complementary lessons, and supersedes corrections", () => {
    expect(
      decideRecallPersistence({
        candidate,
        existing: [entry()],
        now: "2026-08-11T11:00:00.000Z",
        createId: () => "new-id"
      })
    ).toMatchObject({ outcome: "IGNORE", entry: null });

    const mergeCandidate = {
      ...candidate,
      learnedBehavior:
        "Ask for the missing unit and quantity, then use unknown.clarify before product.create.",
      failureAvoided: "Avoid incomplete required product fields and premature writes."
    };
    const merged = decideRecallPersistence({
      candidate: mergeCandidate,
      existing: [entry()],
      now: "2026-08-11T11:00:00.000Z",
      createId: () => "new-id"
    });
    expect(merged.outcome).toBe("MERGE");
    expect(merged.entry).toMatchObject({ id: "recall-1", version: 2 });

    const superseded = decideRecallPersistence({
      candidate: { ...candidate, supersedes: "recall-1" },
      existing: [entry()],
      now: "2026-08-11T11:00:00.000Z",
      createId: () => "recall-2"
    });
    expect(superseded).toMatchObject({
      outcome: "SUPERSEDE",
      replacedEntryId: "recall-1",
      entry: { id: "recall-2", supersedes: "recall-1" }
    });
  });
});

describe("recall relevance and budgets", () => {
  it("retrieves relevant recall within server and browser budgets and excludes unrelated recall", () => {
    const product = recallSource("product", entry());
    const receipt = recallSource(
      "receipt",
      entry({
        id: "recall-2",
        title: "Review receipt OCR fields",
        taskType: "unknown",
        trigger: "A receipt scan has uncertain extracted fields.",
        learnedBehavior: "Use receipt.review before confirming uncertain receipt fields.",
        toolsOrCommands: ["receipt.review"],
        failureAvoided: "Avoid confirming uncertain receipt extraction."
      })
    );
    const server = retrieveAgentContext({
      sources: [product, receipt],
      query: "add product with missing quantity",
      intent: "add_product",
      audience: "owner",
      characterBudget: 2_000
    });
    expect(server.map((item) => item.sourceId)).toEqual([product.id]);

    const browser = selectRelevantRecall({
      sources: [product, receipt],
      query: "add product with missing quantity",
      limit: 1,
      characterBudget: 2_000
    });
    expect(browser.map((source) => source.id)).toEqual([product.id]);
  });
});

describe("cloud-to-local recall lifecycle", () => {
  it("persists a validated cloud lesson and supplies it to a future relevant turn only", async () => {
    const prompts: RuntimeModelPrompt[] = [];
    let call = 0;
    const provider: RuntimeModelProvider = {
      name: "openai",
      async complete(prompt) {
        prompts.push(prompt);
        call += 1;
        return {
          provider: "openai",
          status: "available",
          outputText:
            call === 1
              ? cloudOutput(candidate)
              : JSON.stringify({ type: "response", message: "Handled locally next time." }),
          durationMs: 2,
          errorCode: null,
          metadata: {}
        };
      }
    };
    const store = createCp2Store({ runtimeModelProvider: provider });
    const first = ownerShop(store, "+254700009001", "Recall Shop");
    const second = ownerShop(store, "+254700009002", "Other Shop");

    const cloudTurn = await store.createRuntimeTurn({
      sessionId: first.sessionId,
      businessId: first.businessId,
      message: "Add a product but I have not provided its unit or quantity.",
      recallEscalation: {
        reason: "inference-unavailable",
        localRuntime: "browser-wasm",
        localModelId: "small-local"
      }
    });
    expect(cloudTurn.turn.status).toBe("completed");
    expect(cloudTurn.turn.telemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: "recall.candidate_generated" }),
        expect.objectContaining({ state: "recall.persisted" })
      ])
    );
    const stored = store.listAgentContextSources({
      sessionId: first.sessionId,
      businessId: first.businessId
    });
    expect(stored).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "recall", status: "active" })])
    );
    const recallSource = stored.find((source) => source.type === "recall");
    expect(recallSource).toBeDefined();

    await store.createRuntimeTurn({
      sessionId: first.sessionId,
      businessId: first.businessId,
      message: "Add another product with a missing quantity."
    });
    expect(prompts[1]?.message).toContain("<relevant_recall>");
    expect(prompts[1]?.message).toContain("Clarify missing product details");
    const effectiveness = store.recordRecallEffectiveness({
      sessionId: first.sessionId,
      businessId: first.businessId,
      sourceIds: [recallSource!.id],
      outcome: "local_success",
      localRuntime: "browser-wasm",
      modelId: "small-local"
    });
    expect(effectiveness).toMatchObject({
      eventType: "recall_effectiveness",
      outcome: "success",
      metadata: { recallCount: 1, localRuntime: "browser-wasm" }
    });

    await store.createRuntimeTurn({
      sessionId: second.sessionId,
      businessId: second.businessId,
      message: "Add another product with a missing quantity."
    });
    expect(prompts[2]?.message).not.toContain("Clarify missing product details");
    expect(
      store
        .listAgentContextSources({
          sessionId: second.sessionId,
          businessId: second.businessId
        })
        .some((source) => source.type === "recall")
    ).toBe(false);
    expect(() =>
      store.recordRecallEffectiveness({
        sessionId: second.sessionId,
        businessId: second.businessId,
        sourceIds: [recallSource!.id],
        outcome: "local_success",
        localRuntime: "browser-wasm",
        modelId: "small-local"
      })
    ).toThrowError(expect.objectContaining({ code: "recall_effectiveness_invalid" }));
  });

  it("does not fail a successful cloud response when recall persistence fails", async () => {
    const provider: RuntimeModelProvider = {
      name: "openai",
      async complete() {
        return {
          provider: "openai",
          status: "available",
          outputText: cloudOutput(candidate),
          durationMs: 1,
          errorCode: null,
          metadata: {}
        };
      }
    };
    const store = createCp2Store({ runtimeModelProvider: provider });
    const owner = ownerShop(store, "+254700009003", "Failure Isolation Shop");
    const internal = store as unknown as { persistRecallCandidate: () => void };
    internal.persistRecallCandidate = vi.fn(() => {
      throw new Error("simulated persistence failure");
    });

    const result = await store.createRuntimeTurn({
      sessionId: owner.sessionId,
      businessId: owner.businessId,
      message: "Add a product without its unit or quantity.",
      recallEscalation: { reason: "model-load-failed", localRuntime: "native-llama-cpp" }
    });
    expect(result.turn.status).toBe("completed");
    expect(result.turn.response).toBe("Ask for the missing details.");
    expect(result.turn.telemetry).toEqual(
      expect.arrayContaining([expect.objectContaining({ state: "recall.persistence_failed" })])
    );
  });
});

function recallSource(id: string, recall: RecallEntry): AgentContextSource {
  const content = serializeRecallEntry(recall);
  return {
    id,
    tenantId: "shop-a",
    shopId: "shop-a",
    type: "recall",
    title: `recall.md — ${recall.title}`,
    status: "active",
    sensitivity: "internal",
    accessRules: {
      audiences: ["owner", "staff"],
      requiredPermission: "business:read",
      customerVisible: false
    },
    freshnessTimestamp: recall.updatedAt,
    version: recall.version,
    retrievalMetadata: {
      keywords: recall.title.toLowerCase().split(/\s+/u),
      sourceRecordId: recall.id,
      content
    },
    createdAt: recall.createdAt,
    updatedAt: recall.updatedAt,
    deletedAt: null
  };
}

function ownerShop(
  store: ReturnType<typeof createCp2Store>,
  destination: string,
  name: string
): { sessionId: string; businessId: string } {
  const auth = store.signupWithPhonePin({ destination, pin: "2468" });
  const created = store.createBusiness({ sessionId: auth.session.id, name, language: "en" });
  return { sessionId: auth.session.id, businessId: created.business.id };
}
