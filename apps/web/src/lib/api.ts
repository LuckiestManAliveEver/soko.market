import { getResponseErrorMessage } from "../user-facing-error";

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

export async function apiFetch<T>(pathOrUrl: string, options?: { method?: string; body?: unknown }) {
  const base = readApiBaseUrl();
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${base}${pathOrUrl}`;

  const response = await fetch(url, {
    method: options?.method ?? "GET",
    credentials: "include",
    ...(options?.body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(options.body) })
  });

  if (!response.ok) {
    throw new Error(await getResponseErrorMessage(response));
  }

  return (await response.json()) as T;
}
