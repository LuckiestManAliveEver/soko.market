import type {
  BrowserInferenceSettings,
  BrowserModelDescriptor,
  ConversationSummary
} from "./browser-inference-types";

export const browserInferenceDatabaseName = "soko-browser-inference";
export const browserInferenceDatabaseVersion = 1;
export const browserInferenceStoreNames = [
  "browserModels",
  "modelAssets",
  "modelDownloadState",
  "conversationSummaries",
  "localChatCache",
  "retrievalIndexes",
  "offlineInferenceQueue",
  "browserInferenceSettings"
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
