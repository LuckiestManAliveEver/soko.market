import { apiFetch } from "./lib/api";
import { getCachedJson, invalidateApiCacheForMutation } from "./api-request-cache";

export async function postJson<TResponse>(
  path: string,
  body: Record<string, unknown>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<TResponse> {
  const response = await apiFetch<TResponse>(path, { method: "POST", body, ...options });
  await invalidateApiCacheForMutation(path);
  return response;
}

export async function patchJson<TResponse>(
  path: string,
  body: Record<string, unknown>
): Promise<TResponse> {
  const response = await apiFetch<TResponse>(path, { method: "PATCH", body });
  await invalidateApiCacheForMutation(path);
  return response;
}

export async function putJson<TResponse>(
  path: string,
  body: Record<string, unknown>,
  options: { signal?: AbortSignal } = {}
): Promise<TResponse> {
  const response = await apiFetch<TResponse>(path, { method: "PUT", body, ...options });
  await invalidateApiCacheForMutation(path);
  return response;
}

export async function deleteJson<TResponse>(
  path: string,
  body?: Record<string, unknown>
): Promise<TResponse> {
  const response = await apiFetch<TResponse>(path, { method: "DELETE", body });
  await invalidateApiCacheForMutation(path);
  return response;
}

export async function getJson<TResponse>(
  path: string,
  onBackgroundUpdate?: (value: TResponse) => void
): Promise<TResponse> {
  return getCachedJson<TResponse>(
    path,
    onBackgroundUpdate === undefined ? {} : { onBackgroundUpdate }
  );
}
