import { indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  browserInferenceStoreNames,
  openBrowserInferenceRepository
} from "../apps/web/src/browser-inference-storage";
import {
  browserCheckpointCompatibilityContract,
  browserRuntimeContractForModel
} from "../apps/web/src/browser-inference-contracts";
import { getBrowserModel } from "../apps/web/src/browser-model-registry";
import type { BrowserInferenceSettings } from "../apps/web/src/browser-inference-types";

function settings(accountId: string, businessId: string): BrowserInferenceSettings {
  return {
    accountId,
    businessId,
    enabled: true,
    selectedModelId: "smollm2-360m-instruct-browser",
    status: "ready",
    downloadedAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
    lastErrorCode: null
  };
}

describe("browser inference IndexedDB", () => {
  it("creates every versioned store and isolates accounts", async () => {
    const name = `browser-inference-${crypto.randomUUID()}`;
    const repository = await openBrowserInferenceRepository({
      factory: indexedDB,
      databaseName: name
    });
    await repository.putSettings(settings("account-a", "shop"));
    await repository.putSettings(settings("account-b", "shop"));
    await repository.putSummary("account-a", {
      conversationId: "conversation",
      version: 1,
      coveredThroughMessageId: "m1",
      summaryText: "Private A summary",
      facts: [{ key: "fact", value: "A", sourceMessageIds: ["m1"] }],
      pendingActions: [],
      updatedAt: "2026-07-19T00:00:00.000Z"
    });

    expect(await repository.getSettings("account-a", "shop")).toMatchObject({
      accountId: "account-a"
    });
    expect(await repository.getSettings("account-b", "shop")).toMatchObject({
      accountId: "account-b"
    });
    await repository.clearAccountData("account-a");
    expect(await repository.getSettings("account-a", "shop")).toBeNull();
    expect(await repository.getSummary("account-a", "conversation")).toBeNull();
    expect(await repository.getSettings("account-b", "shop")).toMatchObject({
      accountId: "account-b"
    });
    repository.close();

    const request = indexedDB.open(name);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(Array.from(database.objectStoreNames).sort()).toEqual(
      [...browserInferenceStoreNames].sort()
    );
    database.close();
  });

  it("clears model metadata without deleting summaries or settings", async () => {
    const repository = await openBrowserInferenceRepository({
      factory: indexedDB,
      databaseName: `browser-inference-${crypto.randomUUID()}`
    });
    await repository.putSettings(settings("account-a", "shop"));
    await repository.putSummary("account-a", {
      conversationId: "conversation",
      version: 1,
      coveredThroughMessageId: "m1",
      summaryText: "Keep me",
      facts: [],
      pendingActions: [],
      updatedAt: "2026-07-19T00:00:00.000Z"
    });
    await repository.clearModelAssets("account-a");
    expect(await repository.getSettings("account-a", "shop")).not.toBeNull();
    expect(await repository.getSummary("account-a", "conversation")).toMatchObject({
      summaryText: "Keep me"
    });
    repository.close();
  });

  it("stores device outcomes and prunes expired task-state checkpoints", async () => {
    const model = getBrowserModel("smollm2-135m-instruct-browser")!;
    const repository = await openBrowserInferenceRepository({
      factory: indexedDB,
      databaseName: `browser-inference-${crypto.randomUUID()}`
    });
    await repository.putModelExecutionOutcome("account-a", {
      deviceProfileId: "chrome:130:mobile:low:wasm:2",
      modelId: "smollm2-135m-instruct-browser",
      backend: "wasm",
      successful: true,
      loadTimeMs: 2_000,
      readinessTimeMs: 500,
      readinessTokensPerSecond: 2,
      failureCode: null,
      updatedAt: "2026-07-29T00:00:00.000Z"
    });
    await repository.putTaskCheckpoint({
      version: 2,
      id: "expired",
      accountId: "account-a",
      businessId: "shop",
      conversationId: "conversation",
      requestId: "expired",
      modelId: model.id,
      runtimeContract: browserRuntimeContractForModel(model, "wasm"),
      compatibilityContract: browserCheckpointCompatibilityContract(model),
      objective: "Task",
      relevantMessages: [],
      partialOutput: "",
      continuationInstruction: "Continue.",
      reason: "task-start",
      status: "running",
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
      expiresAt: "2026-07-28T00:00:00.000Z"
    });

    expect(await repository.listModelExecutionOutcomes("account-a")).toEqual([
      expect.objectContaining({
        modelId: "smollm2-135m-instruct-browser",
        successful: true
      })
    ]);
    expect(
      await repository.pruneExpiredTaskCheckpoints(
        "account-a",
        new Date("2026-07-29T00:00:00.000Z")
      )
    ).toBe(1);
    expect(await repository.getTaskCheckpoint("account-a", "expired")).toBeNull();
    repository.close();
  });
});
