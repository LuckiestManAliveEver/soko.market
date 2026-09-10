import { describe, expect, it, vi } from "vitest";
import { cacheVerifiedArtifacts, cacheArtifactsByUrl } from "../packages/offline-runtime/index";

describe("Pinned artifact integrity", () => {
  it("verifies hashes and byte counts, reuses verified bytes and never caches corrupt downloads", async () => {
    const data = new TextEncoder().encode("model bytes");
    const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const stored = new Map<string, Response>();
    const cache = {
      match: async (key: string) => stored.get(key)?.clone(),
      put: async (key: string, response: Response) => {
        stored.set(key, response);
      }
    } as unknown as Cache;
    const artifact = { url: "https://example.test/model", bytes: data.length, sha256 };
    const fetcher = vi.fn(async () => new Response(data));
    const progress = vi.fn();
    await cacheVerifiedArtifacts([artifact], cache, progress, fetcher);
    await cacheVerifiedArtifacts([artifact], cache, progress, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenLastCalledWith(data.length, data.length);
    await expect(
      cacheVerifiedArtifacts([{ ...artifact, sha256: "0".repeat(64) }], cache, progress, fetcher)
    ).rejects.toThrow("integrity");
    await expect(
      cacheVerifiedArtifacts(
        [{ ...artifact, bytes: 1, sha256: "1".repeat(64) }],
        cache,
        progress,
        fetcher
      )
    ).rejects.toThrow("declared size");
    expect(stored.size).toBe(1);
  });

  it("cacheArtifactsByUrl keys by the artifact's own URL so a Service Worker can serve it directly", async () => {
    const data = new TextEncoder().encode("worker script bytes");
    const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const stored = new Map<string, Response>();
    const cache = {
      match: async (key: string) => stored.get(key)?.clone(),
      put: async (key: string, response: Response) => {
        stored.set(key, response);
      }
    } as unknown as Cache;
    const artifact = { url: "/tesseract/worker.min.js", bytes: data.length, sha256 };
    const fetcher = vi.fn(async () => new Response(data));
    const progress = vi.fn();
    await cacheArtifactsByUrl([artifact], cache, progress, fetcher);
    await cacheArtifactsByUrl([artifact], cache, progress, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(stored.has(artifact.url)).toBe(true);
    await expect(
      cacheArtifactsByUrl([{ ...artifact, sha256: "0".repeat(64) }], cache, progress, fetcher)
    ).rejects.toThrow("integrity");
  });
});
