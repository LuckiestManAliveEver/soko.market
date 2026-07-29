import type {
  BrowserInferenceSettings,
  BrowserModelDescriptor,
  BrowserModelExecutionOutcome,
  BrowserTaskStateCheckpoint,
  ConversationSummary
} from "./browser-inference-types";

export const browserInferenceDatabaseName = "soko-browser-inference";
export const browserInferenceDatabaseVersion = 2;
export const browserInferenceStoreNames = [
  "browserModels",
  "modelAssets",
  "modelDownloadState",
  "conversationSummaries",
  "localChatCache",
  "retrievalIndexes",
  "offlineInferenceQueue",
  "browserInferenceSettings",
  "deviceInferenceProfiles",
  "taskStateCheckpoints"
] as const;

type BrowserInferenceStoreName = (typeof browserInferenceStoreNames)[number];

interface NamespacedRecord {
  accountId: string;
  id: string;
  businessId?: string;
  updatedAt: string;
  [key: string]: unknown;
}

export class BrowserInferenceRepository {
  constructor(private readonly database: IDBDatabase) {}

  close(): void {
    this.database.close();
  }

  async putSettings(settings: BrowserInferenceSettings): Promise<void> {
    await this.put("browserInferenceSettings", {
      ...settings,
      id: settings.businessId
    });
  }

  async getSettings(
    accountId: string,
    businessId: string
  ): Promise<BrowserInferenceSettings | null> {
    return (
      (await this.get<BrowserInferenceSettings>(
        "browserInferenceSettings",
        accountId,
        businessId
      )) ?? null
    );
  }

  async putModel(accountId: string, model: BrowserModelDescriptor, status: string): Promise<void> {
    await this.put("browserModels", {
      accountId,
      id: model.id,
      model,
      status,
      updatedAt: new Date().toISOString()
    });
  }

  async listCachedModelIds(accountId: string): Promise<string[]> {
    const transaction = this.database.transaction("browserModels", "readonly");
    const completion = transactionCompletion(transaction);
    const records = await requestResult<Array<{ id?: unknown; status?: unknown }>>(
      transaction.objectStore("browserModels").index("by_account").getAll(accountId)
    );
    await completion;
    return records
      .filter(
        (record): record is { id: string; status: string } =>
          typeof record.id === "string" && record.status === "ready"
      )
      .map((record) => record.id)
      .sort();
  }

  async evictCachedModels(
    accountId: string,
    options: { keepModelIds: string[]; maximumEntries: number }
  ): Promise<string[]> {
    const transaction = this.database.transaction("browserModels", "readwrite");
    const completion = transactionCompletion(transaction);
    const store = transaction.objectStore("browserModels");
    const records = await requestResult<
      Array<{ accountId: string; id: string; updatedAt?: string }>
    >(store.index("by_account").getAll(accountId));
    const keep = new Set(options.keepModelIds);
    const candidates = records
      .filter((record) => !keep.has(record.id))
      .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
    const evicted = candidates
      .slice(Math.max(0, options.maximumEntries))
      .map((record) => record.id);
    for (const id of evicted) store.delete([accountId, id]);
    await completion;
    return evicted;
  }

  async putSummary(accountId: string, summary: ConversationSummary): Promise<void> {
    await this.put("conversationSummaries", {
      accountId,
      id: summary.conversationId,
      summary,
      updatedAt: summary.updatedAt
    });
  }

  async getSummary(accountId: string, conversationId: string): Promise<ConversationSummary | null> {
    const record = await this.get<{ summary: ConversationSummary }>(
      "conversationSummaries",
      accountId,
      conversationId
    );
    return record?.summary ?? null;
  }

  async enqueueOfflineInference(
    accountId: string,
    businessId: string,
    id: string,
    messageId: string
  ): Promise<void> {
    await this.put("offlineInferenceQueue", {
      accountId,
      businessId,
      id,
      messageId,
      updatedAt: new Date().toISOString()
    });
  }

  async putModelExecutionOutcome(
    accountId: string,
    outcome: BrowserModelExecutionOutcome
  ): Promise<void> {
    await this.put("deviceInferenceProfiles", {
      accountId,
      id: modelExecutionOutcomeId(outcome),
      outcome,
      updatedAt: outcome.updatedAt
    });
  }

  async listModelExecutionOutcomes(accountId: string): Promise<BrowserModelExecutionOutcome[]> {
    const transaction = this.database.transaction("deviceInferenceProfiles", "readonly");
    const completion = transactionCompletion(transaction);
    const records = await requestResult<Array<{ outcome?: BrowserModelExecutionOutcome }>>(
      transaction.objectStore("deviceInferenceProfiles").index("by_account").getAll(accountId)
    );
    await completion;
    return records
      .map((record) => record.outcome)
      .filter((outcome): outcome is BrowserModelExecutionOutcome => outcome !== undefined);
  }

  async putTaskCheckpoint(checkpoint: BrowserTaskStateCheckpoint): Promise<void> {
    await this.put("taskStateCheckpoints", {
      ...checkpoint,
      id: checkpoint.id
    });
  }

  async getTaskCheckpoint(
    accountId: string,
    checkpointId: string
  ): Promise<BrowserTaskStateCheckpoint | null> {
    return (
      (await this.get<BrowserTaskStateCheckpoint>(
        "taskStateCheckpoints",
        accountId,
        checkpointId
      )) ?? null
    );
  }

  async deleteTaskCheckpoint(accountId: string, checkpointId: string): Promise<void> {
    const transaction = this.database.transaction("taskStateCheckpoints", "readwrite");
    const completion = transactionCompletion(transaction);
    transaction.objectStore("taskStateCheckpoints").delete([accountId, checkpointId]);
    await completion;
  }

  async pruneExpiredTaskCheckpoints(accountId: string, now = new Date()): Promise<number> {
    const transaction = this.database.transaction("taskStateCheckpoints", "readwrite");
    const completion = transactionCompletion(transaction);
    const store = transaction.objectStore("taskStateCheckpoints");
    const records = await requestResult<
      Array<{ accountId: string; id: string; expiresAt?: string }>
    >(store.index("by_account").getAll(accountId));
    const expired = records.filter(
      (record) =>
        typeof record.expiresAt !== "string" || Date.parse(record.expiresAt) <= now.getTime()
    );
    for (const record of expired) store.delete([record.accountId, record.id]);
    await completion;
    return expired.length;
  }

  async clearAccountData(accountId: string): Promise<void> {
    for (const storeName of browserInferenceStoreNames) {
      await this.deleteAccountRecords(storeName, accountId);
    }
  }

  async clearModelAssets(accountId: string): Promise<void> {
    for (const storeName of [
      "browserModels",
      "modelAssets",
      "modelDownloadState"
    ] satisfies BrowserInferenceStoreName[]) {
      await this.deleteAccountRecords(storeName, accountId);
    }
  }

  private async put(storeName: BrowserInferenceStoreName, value: NamespacedRecord): Promise<void> {
    const transaction = this.database.transaction(storeName, "readwrite");
    const completion = transactionCompletion(transaction);
    transaction.objectStore(storeName).put(value);
    await completion;
  }

  private async get<T>(
    storeName: BrowserInferenceStoreName,
    accountId: string,
    id: string
  ): Promise<T | undefined> {
    const transaction = this.database.transaction(storeName, "readonly");
    const completion = transactionCompletion(transaction);
    const result = await requestResult<T | undefined>(
      transaction.objectStore(storeName).get([accountId, id])
    );
    await completion;
    return result;
  }

  private async deleteAccountRecords(
    storeName: BrowserInferenceStoreName,
    accountId: string
  ): Promise<void> {
    const transaction = this.database.transaction(storeName, "readwrite");
    const completion = transactionCompletion(transaction);
    const store = transaction.objectStore(storeName);
    const keys = await requestResult(store.index("by_account").getAllKeys(accountId));
    for (const key of keys) store.delete(key);
    await completion;
  }
}

function modelExecutionOutcomeId(outcome: BrowserModelExecutionOutcome): string {
  return `${outcome.deviceProfileId}:${outcome.modelId}:${outcome.backend}`;
}

export async function openBrowserInferenceRepository(input?: {
  factory?: IDBFactory;
  databaseName?: string;
}): Promise<BrowserInferenceRepository> {
  const factory = input?.factory ?? globalThis.indexedDB;
  if (factory === undefined) throw new Error("IndexedDB is unavailable.");
  const request = factory.open(
    input?.databaseName ?? browserInferenceDatabaseName,
    browserInferenceDatabaseVersion
  );
  request.onupgradeneeded = () => upgradeBrowserInferenceDatabase(request.result);
  try {
    return new BrowserInferenceRepository(await requestResult(request));
  } catch (error) {
    if (error instanceof DOMException && error.name === "QuotaExceededError") {
      throw new Error("Browser inference storage quota was exceeded.");
    }
    throw error;
  }
}

export function upgradeBrowserInferenceDatabase(database: IDBDatabase): void {
  for (const storeName of browserInferenceStoreNames) {
    if (database.objectStoreNames.contains(storeName)) continue;
    const store = database.createObjectStore(storeName, { keyPath: ["accountId", "id"] });
    store.createIndex("by_account", "accountId", { unique: false });
  }
}

export async function browserInferenceStorageUsage(): Promise<{
  usageBytes: number | null;
  quotaBytes: number | null;
}> {
  const estimate = await navigator.storage?.estimate().catch(() => undefined);
  return {
    usageBytes: estimate?.usage ?? null,
    quotaBytes: estimate?.quota ?? null
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}
