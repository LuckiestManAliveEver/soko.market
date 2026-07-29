import { apiFetch } from "./lib/api";
import {
  clearAllLocalData,
  createLocalDataRepository,
  type LocalDataDomain
} from "./local-data-repository";
import { recordApiCache } from "./performance";

interface CacheEntry {
  value: unknown;
  updatedAt: number;
  inFlight: Promise<unknown> | null;
}

const responseCache = new Map<string, CacheEntry>();
const defaultStaleTimeMs = 30_000;

export interface CachedGetOptions<T = unknown> {
  force?: boolean;
  onBackgroundUpdate?: (value: T) => void;
  staleTimeMs?: number;
}

export async function getCachedJson<TResponse>(
  path: string,
  options: CachedGetOptions<TResponse> = {}
): Promise<TResponse> {
  const now = Date.now();
  const staleTimeMs = options.staleTimeMs ?? staleTimeForPath(path);
  const existing = responseCache.get(path);

  if (existing?.inFlight !== null && existing?.inFlight !== undefined && existing.updatedAt === 0) {
    recordApiCache(path, "deduplicated");
    return existing.inFlight as Promise<TResponse>;
  }

  if (!options.force && existing !== undefined) {
    if (now - existing.updatedAt < staleTimeMs) {
      recordApiCache(path, "fresh");
      return existing.value as TResponse;
    }

    if (existing.inFlight !== null) {
      recordApiCache(path, "deduplicated");
      return existing.value as TResponse;
    }

    recordApiCache(path, "stale");
    existing.inFlight = refresh<TResponse>(path, existing, options.onBackgroundUpdate);
    void existing.inFlight.catch(() => undefined);
    return existing.value as TResponse;
  }

  if (existing?.inFlight !== null && existing?.inFlight !== undefined) {
    recordApiCache(path, "deduplicated");
    return existing.inFlight as Promise<TResponse>;
  }

  const entry: CacheEntry = existing ?? { value: undefined, updatedAt: 0, inFlight: null };
  entry.inFlight = hydrateOrRefresh<TResponse>(path, entry, options.onBackgroundUpdate);
  responseCache.set(path, entry);
  return entry.inFlight as Promise<TResponse>;
}

export function invalidateApiCacheForMutation(path: string): void {
  const normalized = path.split("?")[0] ?? path;
  const businessRoot = normalized.match(/^(\/businesses\/[^/]+)/)?.[1];
  const businessResource = normalized.match(/^(\/businesses\/[^/]+\/[^/]+)/)?.[1];
  const modelSelectionChanged =
    normalized.endsWith("/agent-model") || normalized.endsWith("/ai-model");

  for (const key of responseCache.keys()) {
    const cachePath = key.split("?")[0] ?? key;
    const invalid =
      cachePath === normalized ||
      (businessResource !== undefined && cachePath.startsWith(businessResource)) ||
      (modelSelectionChanged &&
        businessRoot !== undefined &&
        (cachePath === `${businessRoot}/agent-model` ||
          cachePath === `${businessRoot}/ai-model` ||
          cachePath === `${businessRoot}/agent-profile`)) ||
      (normalized.startsWith("/v1/messages") && cachePath.startsWith("/v1/conversations")) ||
      (normalized.startsWith("/v1/conversations") && cachePath.startsWith("/v1/conversations")) ||
      (normalized.startsWith("/auth/") && cachePath.startsWith("/auth/"));

    if (invalid) responseCache.delete(key);
  }
}

export function clearApiRequestCache(): void {
  responseCache.clear();
}

export async function clearPersistentApiRequestCache(): Promise<void> {
  responseCache.clear();
  await clearAllLocalData();
}

async function hydrateOrRefresh<TResponse>(
  path: string,
  entry: CacheEntry,
  onBackgroundUpdate?: (value: TResponse) => void
): Promise<TResponse> {
  const persistent = persistentRepository<TResponse>(path);
  if (persistent !== null) {
    const cached = await persistent.readCached(path);
    if (cached.value !== null) {
      entry.value = cached.value;
      entry.updatedAt = cached.updatedAt ?? Date.now();
      entry.inFlight = refresh(path, entry, onBackgroundUpdate, persistent);
      void entry.inFlight.catch(() => undefined);
      recordApiCache(path, "stale");
      return cached.value;
    }
  }
  return refresh(path, entry, onBackgroundUpdate, persistent);
}

function refresh<TResponse>(
  path: string,
  entry: CacheEntry,
  onBackgroundUpdate?: (value: TResponse) => void,
  persistent = persistentRepository<TResponse>(path)
): Promise<TResponse> {
  return apiFetch<TResponse>(path)
    .then(async (value) => {
      entry.value = value;
      entry.updatedAt = Date.now();
      await persistent?.writeCached(path, value);
      onBackgroundUpdate?.(value);
      return value;
    })
    .catch((error) => {
      if (entry.updatedAt === 0) responseCache.delete(path);
      throw error;
    })
    .finally(() => {
      entry.inFlight = null;
    });
}

function persistentRepository<T>(path: string) {
  const policy = persistentPolicy(path);
  return policy === null ? null : createLocalDataRepository<T>(policy.domain, policy.scope);
}

function persistentPolicy(path: string): { domain: LocalDataDomain; scope: string } | null {
  const pathname = path.split("?")[0] ?? path;
  const business = pathname.match(/^\/businesses\/([^/]+)\/(.+)$/);
  if (business !== null) {
    const scope = `business:${business[1]}`;
    const resource = business[2] ?? "";
    if (/^(?:products|suppliers|customers|invoices)(?:\/|$)/.test(resource)) {
      return {
        domain: resource.startsWith("products") ? "catalogue" : "shop",
        scope
      };
    }
    if (
      /^(?:reports|knowledge|notifications|payments|payment-summaries|customer-debts|imports|logistics|offline-cache|sync-queue)(?:\/|$)/.test(
        resource
      )
    ) {
      return { domain: resource.includes("sync") ? "sync" : "workspace", scope };
    }
    if (/^(?:agent-model|ai-model|agent-profile)(?:\/|$)/.test(resource)) {
      return { domain: "model", scope };
    }
  }
  if (pathname === "/network") return { domain: "workspace", scope: "account" };
  if (pathname === "/v1/conversations") {
    return { domain: "conversation", scope: "account" };
  }
  return null;
}

function staleTimeForPath(path: string): number {
  if (/\/(?:ai-models|agent-profile|product-fields)(?:[/?]|$)/.test(path)) {
    return 5 * 60_000;
  }
  if (/\/(?:reports|notifications|conversations|runtime)(?:[/?]|$)/.test(path)) {
    return 15_000;
  }
  return defaultStaleTimeMs;
}
