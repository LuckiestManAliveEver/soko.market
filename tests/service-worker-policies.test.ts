import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("apps/web/public/sw.js", "utf8");

describe("service-worker route policies", () => {
  it("uses navigation preload and an immediate version-matched shell fallback", () => {
    expect(source).toContain("navigationPreload?.enable()");
    expect(source).toContain("navigationResponse(event)");
    expect(source).toContain("shellCache.match");
    expect(source).toContain("event.preloadResponse");
  });

  it("separates immutable assets from public stale-while-revalidate reads", () => {
    expect(source).toContain("cacheFirst(request, STATIC_CACHE)");
    expect(source).toContain("staleWhileRevalidate(event, request, PUBLIC_READ_CACHE)");
    expect(source).toContain('url.pathname.startsWith("/public/storefronts/")');
  });

  it("keeps authentication, private business data, messaging, and model APIs network-only", () => {
    const policyStart = source.indexOf("function isNetworkOnlyRequest");
    const policy = source.slice(policyStart, source.indexOf("function isPublicCatalogueRead"));

    expect(policy).toContain('url.pathname.startsWith("/auth/")');
    expect(policy).toContain('url.pathname.startsWith("/businesses/")');
    expect(policy).toContain('url.pathname.startsWith("/v1/conversations")');
    expect(policy).toContain('url.pathname.startsWith("/v1/messages")');
    expect(policy).toContain('url.pathname.startsWith("/v1/models/")');
  });
});
