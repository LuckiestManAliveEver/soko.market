import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const publicDirectory = "apps/web/public";

describe("PWA installability", () => {
  it("publishes a complete installable web app manifest", () => {
    const manifest = JSON.parse(
      readFileSync(`${publicDirectory}/manifest.webmanifest`, "utf8")
    ) as {
      name?: string;
      short_name?: string;
      start_url?: string;
      scope?: string;
      display?: string;
      icons?: Array<{ src?: string; sizes?: string; type?: string; purpose?: string }>;
    };

    expect(manifest.name).toBe("Soko.market");
    expect(manifest.short_name).toBe("Soko");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sizes: "192x192",
          type: "image/png",
          purpose: "any"
        }),
        expect.objectContaining({
          sizes: "512x512",
          type: "image/png",
          purpose: "any"
        }),
        expect.objectContaining({
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable"
        })
      ])
    );

    for (const icon of manifest.icons ?? []) {
      expect(icon.src).toMatch(/^\/icons\//);
      expect(existsSync(`${publicDirectory}${icon.src}`)).toBe(true);
    }
  });

  it("links the manifest and Apple touch icon and registers a service worker", () => {
    const html = readFileSync("apps/web/index.html", "utf8");
    const entrypoint = readFileSync("apps/web/src/main.tsx", "utf8");
    const serviceWorkerRegistration = readFileSync("apps/web/src/service-worker.ts", "utf8");

    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(entrypoint).toContain("registerAppServiceWorker()");
    expect(serviceWorkerRegistration).toContain('.register("/sw.js"');
    expect(serviceWorkerRegistration).toContain('document.readyState === "complete"');
  });
});
