import { apiFetch } from "./lib/api";
import { recordApiCache } from "./performance";

interface CacheEntry {
  value: unknown;
  updatedAt: number;
  inFlight: Promise<unknown> | null;
}

const responseCache = new Map<string, CacheEntry>();
const defaultStaleTimeMs = 30_000;

export interface CachedGetOptions {
  force?: boolean;
  staleTimeMs?: number;
}

export async function getCachedJson<TResponse>(
  path: string,
  options: CachedGetOptions = {}
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
    existing.inFlight = refresh<TResponse>(path, existing);
    void existing.inFlight.catch(() => undefined);
    return existing.value as TResponse;
  }

  if (existing?.inFlight !== null && existing?.inFlight !== undefined) {
    recordApiCache(path, "deduplicated");
    return existing.inFlight as Promise<TResponse>;
  }

  const entry: CacheEntry = existing ?? { value: undefined, updatedAt: 0, inFlight: null };
  entry.inFlight = refresh<TResponse>(path, entry);
  responseCache.set(path, entry);
  return entry.inFlight as Promise<TResponse>;
}

export function invalidateApiCacheForMutation(path: string): void {
  const normalized = path.split("?")[0] ?? path;
  const businessResource = normalized.match(/^(\/businesses\/[^/]+\/[^/]+)/)?.[1];

  for (const key of responseCache.keys()) {
    const cachePath = key.split("?")[0] ?? key;
    const invalid =
      cachePath === normalized ||
      (businessResource !== undefined && cachePath.startsWith(businessResource)) ||
      (normalized.startsWith("/v1/messages") && cachePath.startsWith("/v1/conversations")) ||
      (normalized.startsWith("/v1/conversations") && cachePath.startsWith("/v1/conversations")) ||
      (normalized.startsWith("/auth/") && cachePath.startsWith("/auth/"));

    if (invalid) responseCache.delete(key);
  }
}

export function clearApiRequestCache(): void {
  responseCache.clear();
}

function refresh<TResponse>(path: string, entry: CacheEntry): Promise<TResponse> {
  return apiFetch<TResponse>(path)
    .then((value) => {
      entry.value = value;
      entry.updatedAt = Date.now();
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

function staleTimeForPath(path: string): number {
  if (/\/(?:ai-models|agent-profile|product-fields)(?:[/?]|$)/.test(path)) {
    return 5 * 60_000;
  }
  if (/\/(?:reports|notifications|conversations|runtime)(?:[/?]|$)/.test(path)) {
    return 15_000;
  }
  return defaultStaleTimeMs;
}
