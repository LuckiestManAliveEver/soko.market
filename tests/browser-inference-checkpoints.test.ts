import { describe, expect, it, vi } from "vitest";
import {
  BrowserTaskCheckpointSession,
  taskCheckpointRecoveryContext
} from "../apps/web/src/browser-inference-checkpoints";
import {
  browserCheckpointCompatibilityContract,
  browserRuntimeContractForModel
} from "../apps/web/src/browser-inference-contracts";
import { getBrowserModel } from "../apps/web/src/browser-model-registry";
import type { BrowserTaskStateCheckpoint } from "../apps/web/src/browser-inference-types";

describe("browser task-state checkpoints", () => {
  it("persists bounded logical state and removes it after successful completion", async () => {
    const sourceModel = getBrowserModel("smollm2-360m-instruct-browser")!;
    const targetModel = getBrowserModel("smollm2-360m-instruct-webllm")!;
    const records = new Map<string, BrowserTaskStateCheckpoint>();
    const store = {
      putTaskCheckpoint: vi.fn(async (checkpoint: BrowserTaskStateCheckpoint) => {
        records.set(checkpoint.id, checkpoint);
      }),
      deleteTaskCheckpoint: vi.fn(async (_accountId: string, checkpointId: string) => {
        records.delete(checkpointId);
      })
    };
    const session = new BrowserTaskCheckpointSession(store, {
      accountId: "account",
      businessId: "shop",
      conversationId: "conversation",
      requestId: "request",
      modelId: sourceModel.id,
      runtimeContract: browserRuntimeContractForModel(sourceModel, "webgpu"),
      compatibilityContract: browserCheckpointCompatibilityContract(sourceModel),
      objective: "Summarize the latest customer message.",
      relevantMessages: [{ role: "user", content: "Hello" }],
      now: new Date("2026-07-29T00:00:00.000Z")
    });

    await session.start();
    session.appendOutput("Partial answer");
    await session.checkpointNow("page-hidden");

    const checkpoint = records.get("shop:request");
    expect(checkpoint).toMatchObject({
      status: "interrupted",
      reason: "page-hidden",
      partialOutput: "Partial answer"
    });
    expect(
      taskCheckpointRecoveryContext(checkpoint ?? null, {
        businessId: "shop",
        conversationId: "conversation",
        requestId: "request",
        compatibilityContract: browserCheckpointCompatibilityContract(targetModel),
        objective: "Summarize the latest customer message.",
        now: new Date("2026-07-29T01:00:00.000Z")
      })
    ).toEqual([
      expect.objectContaining({
        sourceId: "task-checkpoint:shop:request",
        content: expect.stringContaining("Partial answer")
      })
    ]);

    await session.complete();
    expect(records.size).toBe(0);
  });

  it("rejects expired or mismatched recovery state", () => {
    const model = getBrowserModel("smollm2-360m-instruct-browser")!;
    const checkpoint: BrowserTaskStateCheckpoint = {
      version: 2,
      id: "request",
      accountId: "account",
      businessId: "shop",
      conversationId: "conversation",
      requestId: "request",
      modelId: model.id,
      runtimeContract: browserRuntimeContractForModel(model, "webgpu"),
      compatibilityContract: browserCheckpointCompatibilityContract(model),
      objective: "Original task",
      relevantMessages: [],
      partialOutput: "private partial",
      continuationInstruction: "Continue.",
      reason: "generation-failed",
      status: "interrupted",
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
      expiresAt: "2026-07-28T00:00:00.000Z"
    };
    expect(
      taskCheckpointRecoveryContext(checkpoint, {
        businessId: "shop",
        conversationId: "conversation",
        requestId: "request",
        compatibilityContract: browserCheckpointCompatibilityContract(model),
        objective: "Original task",
        now: new Date("2026-07-29T00:00:00.000Z")
      })
    ).toEqual([]);
    expect(
      taskCheckpointRecoveryContext(checkpoint, {
        businessId: "shop",
        conversationId: "conversation",
        requestId: "other",
        compatibilityContract: browserCheckpointCompatibilityContract(model),
        objective: "Original task",
        now: new Date("2026-07-27T01:00:00.000Z")
      })
    ).toEqual([]);
  });
});
