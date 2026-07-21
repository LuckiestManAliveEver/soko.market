import { getResponseErrorMessage } from "../user-facing-error";
import { recordApiRequest } from "../performance";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly recoverable: boolean;

  constructor(
    status: number,
    message: string,
    options: { code?: string | null; recoverable?: boolean } = {}
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = options.code ?? null;
    this.recoverable = options.recoverable ?? false;
  }
}

export type AuthenticationFailureCode =
  | "auth_refresh_required"
  | "auth_refresh_expired"
  | "auth_refresh_revoked"
  | "auth_refresh_reuse_detected"
  | "auth_session_expired"
  | "auth_reauthentication_required";

const refreshPath = "/auth/session/refresh";
const deviceIdStorageKey = "soko.market.device-id.v1";
let refreshInFlight: Promise<boolean> | null = null;

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
  options?: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    headers?: Record<string, string>;
    requestId?: string;
    idempotencyKey?: string;
    skipAuthRefresh?: boolean;
  }
) {
  const base = readApiBaseUrl();
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${base}${pathOrUrl}`;
  const method = options?.method ?? "GET";
  const requestId = options?.requestId ?? createRequestId();
  const headers = {
    ...deviceSessionHeaders(),
    "x-request-id": requestId,
    ...(options?.idempotencyKey === undefined ? {} : { "idempotency-key": options.idempotencyKey }),
    ...(options?.body === undefined ? {} : { "content-type": "application/json" }),
    ...options?.headers
  };

  const response = await performFetch(url, method, headers, options);
  if (
    response.status === 401 &&
    options?.skipAuthRefresh !== true &&
    !isAuthenticationEntryPoint(pathOrUrl)
  ) {
    const refreshed = await refreshAccountSession(base, options?.signal);
    if (refreshed) {
      const retried = await performFetch(url, method, headers, options);
      return parseApiResponse<T>(retried);
    }
  }
  return parseApiResponse<T>(response);
}

export async function refreshAccountSession(
  baseUrl = readApiBaseUrl(),
  signal?: AbortSignal
): Promise<boolean> {
  if (refreshInFlight !== null) return refreshInFlight;
  refreshInFlight = (async () => {
    const startedAt = performance.now();
    try {
      const response = await fetch(`${baseUrl}${refreshPath}`, {
        method: "POST",
        credentials: "include",
        headers: { ...deviceSessionHeaders(), "x-request-id": createRequestId() },
        ...(signal === undefined ? {} : { signal })
      });
      recordApiRequest("POST", `${baseUrl}${refreshPath}`, startedAt, response.status);
      return response.ok;
    } catch {
      recordApiRequest("POST", `${baseUrl}${refreshPath}`, startedAt, "failed");
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export function isDefinitiveAuthenticationError(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    error.status === 401 &&
    (error.code === "auth_required" ||
      error.code === "auth_session_expired" ||
      error.code === "auth_refresh_expired" ||
      error.code === "auth_refresh_revoked" ||
      error.code === "auth_refresh_reuse_detected" ||
      error.code === "auth_reauthentication_required")
  );
}

async function performFetch(
  url: string,
  method: string,
  headers: Record<string, string>,
  options?: { body?: unknown; signal?: AbortSignal }
): Promise<Response> {
  const startedAt = performance.now();

  try {
    const response = await fetch(url, {
      method,
      credentials: "include",
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      headers,
      ...(options?.body === undefined ? {} : { body: JSON.stringify(options.body) })
    });
    recordApiRequest(method, url, startedAt, response.status);
    return response;
  } catch (error) {
    recordApiRequest(method, url, startedAt, "failed");
    throw error;
  }
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = (await response
      .clone()
      .json()
      .catch(() => null)) as { code?: unknown; recoverable?: unknown } | null;
    throw new ApiRequestError(response.status, await getResponseErrorMessage(response), {
      code: typeof payload?.code === "string" ? payload.code : null,
      recoverable: payload?.recoverable === true
    });
  }
  return (await response.json()) as T;
}

function isAuthenticationEntryPoint(pathOrUrl: string): boolean {
  try {
    const pathname = pathOrUrl.startsWith("http") ? new URL(pathOrUrl).pathname : pathOrUrl;
    return (
      pathname === refreshPath ||
      pathname.startsWith("/auth/pin/") ||
      pathname.startsWith("/auth/otp/") ||
      pathname.startsWith("/auth/passkeys/login/") ||
      pathname.startsWith("/auth/oauth/")
    );
  } catch {
    return false;
  }
}

function deviceSessionHeaders(): Record<string, string> {
  const browserNavigator = typeof navigator === "undefined" ? undefined : navigator;
  const platform =
    (browserNavigator as (Navigator & { userAgentData?: { platform?: string } }) | undefined)
      ?.userAgentData?.platform ||
    browserNavigator?.platform ||
    "unknown";
  return {
    "x-soko-device-id": readStableDeviceId(),
    "x-soko-device-name": `${platform} device`,
    "x-soko-platform": platform,
    "x-soko-client":
      typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches
        ? "pwa"
        : "web"
  };
}

export function readStableDeviceId(): string {
  try {
    const stored = localStorage.getItem(deviceIdStorageKey)?.trim();
    if (stored) return stored;
    const created = createRequestId();
    localStorage.setItem(deviceIdStorageKey, created);
    return created;
  } catch {
    return "ephemeral-device";
  }
}

function createRequestId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `request-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
