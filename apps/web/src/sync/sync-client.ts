import type { LocalSyncSnapshot, SyncPullPage } from "@soko/shared-types";
import { readApiBaseUrl } from "../lib/api";

export interface AccountSyncRepository {
  loadSnapshot<T>(accountId: string): Promise<LocalSyncSnapshot<T>>;
  applyPullPage<T>(page: SyncPullPage<T>): Promise<LocalSyncSnapshot<T>>;
  clearAccount(accountId: string): Promise<void>;
}

export interface CatchUpAccountSyncOptions {
  accountId: string;
  repository: AccountSyncRepository;
  fetcher?: typeof fetch;
  endpoint?: string;
  pageSize?: number;
  maxPages?: number;
}

export async function catchUpAccountSync<T = unknown>(
  options: CatchUpAccountSyncOptions
): Promise<LocalSyncSnapshot<T>> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const endpoint = options.endpoint ?? `${readApiBaseUrl()}/v1/sync/changes`;
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 100));
  const maxPages = Math.max(1, options.maxPages ?? 1_000);
  let snapshot = await options.repository.loadSnapshot<T>(options.accountId);
  let resetAttempted = false;

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const parameters = new URLSearchParams({ limit: String(pageSize) });
    if (snapshot.cursor !== null) {
      parameters.set("cursor", snapshot.cursor);
    }
    const response = await fetcher(`${endpoint}?${parameters.toString()}`, {
      credentials: "include"
    });

    if (response.status === 409 && !resetAttempted) {
      await options.repository.clearAccount(options.accountId);
      snapshot = await options.repository.loadSnapshot<T>(options.accountId);
      resetAttempted = true;
      continue;
    }

    if (!response.ok) {
      throw new Error(`Account sync failed with HTTP ${response.status}.`);
    }

    const page = (await response.json()) as SyncPullPage<T>;
    if (page.accountId !== options.accountId) {
      throw new Error("The sync response belongs to another account.");
    }
    snapshot = await options.repository.applyPullPage(page);

    if (!page.hasMore) {
      return snapshot;
    }
  }

  throw new Error("Account sync exceeded the maximum page count.");
}
