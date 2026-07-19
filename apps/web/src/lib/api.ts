import { getResponseErrorMessage } from "../user-facing-error";
import { recordApiRequest } from "../performance";

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

export function isRetryableApiRequestError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof ApiRequestError &&
      (error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500))
  );
}

export function readApiBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_URL;

  if (configuredUrl !== undefined && configuredUrl.trim() !== "") {
    return configuredUrl.trim().replace(/\/+$/, "");
  }

  if (import.meta.env.PROD) {
    console.error("Soko.market frontend is missing VITE_API_BASE_URL; backend requests will fail.");
    return "";
  }

  return "http://127.0.0.1:4000";
}

export async function apiFetch<T>(
  pathOrUrl: string,
  options?: { method?: string; body?: unknown; signal?: AbortSignal }
) {
  const base = readApiBaseUrl();
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${base}${pathOrUrl}`;
  const method = options?.method ?? "GET";
  const startedAt = performance.now();

  try {
    const response = await fetch(url, {
      method,
      credentials: "include",
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(options?.body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(options.body) })
    });
    recordApiRequest(method, url, startedAt, response.status);

    if (!response.ok) {
      throw new ApiRequestError(response.status, await getResponseErrorMessage(response));
    }

    return (await response.json()) as T;
  } catch (error) {
    if (!(error instanceof ApiRequestError)) {
      recordApiRequest(method, url, startedAt, "failed");
    }
    throw error;
  }
}
