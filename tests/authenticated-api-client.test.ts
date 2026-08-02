import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../apps/web/src/lib/api";

describe("authenticated API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses one refresh request for concurrent 401 responses and retries each body once", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value)
    });
    vi.stubGlobal("navigator", { platform: "Android" });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });

    let authenticated = false;
    let refreshRequests = 0;
    const requestBodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/auth/session/refresh")) {
          refreshRequests += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
          authenticated = true;
          return jsonResponse(200, { authenticated: true });
        }
        if (typeof init?.body === "string") requestBodies.push(init.body);
        return authenticated
          ? jsonResponse(200, { saved: true })
          : jsonResponse(401, {
              code: "auth_session_expired",
              message: "Refresh the access session."
            });
      })
    );

    const [first, second] = await Promise.all([
      apiFetch<{ saved: boolean }>("/protected-one", {
        method: "POST",
        body: { value: 1 },
        idempotencyKey: "write-one"
      }),
      apiFetch<{ saved: boolean }>("/protected-two", {
        method: "POST",
        body: { value: 2 },
        idempotencyKey: "write-two"
      })
    ]);

    expect(first.saved).toBe(true);
    expect(second.saved).toBe(true);
    expect(refreshRequests).toBe(1);
    expect(requestBodies.filter((body) => body === '{"value":1}')).toHaveLength(2);
    expect(requestBodies.filter((body) => body === '{"value":2}')).toHaveLength(2);
  });

  it("does not refresh an existing session after an account-entry credential failure", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined
    });
    vi.stubGlobal("navigator", { platform: "Android" });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/auth/session/refresh")) {
        return jsonResponse(200, { authenticated: true });
      }
      return jsonResponse(401, {
        code: "auth_credentials_invalid",
        message: "The account credentials are invalid."
      });
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(
      apiFetch("/auth/login/password", {
        method: "POST",
        body: { type: "phone", identifier: "+254712345678", password: "incorrect password" }
      })
    ).rejects.toMatchObject({ status: 401, code: "auth_credentials_invalid" });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("/auth/login/password");
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
