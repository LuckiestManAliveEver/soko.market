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
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any"
        }),
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
    const serviceWorker = readFileSync("apps/web/public/sw.js", "utf8");

    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('rel="icon" href="/icons/soko-icon.svg"');
    expect(html).toContain('rel="icon" href="/icons/soko-icon-32.png"');
    expect(html).toContain('rel="shortcut icon" href="/favicon.ico"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(existsSync(`${publicDirectory}/favicon.ico`)).toBe(true);
    expect(existsSync(`${publicDirectory}/icons/soko-icon-32.png`)).toBe(true);
    expect(entrypoint).toContain("registerAppServiceWorker()");
    expect(serviceWorkerRegistration).toContain('.register("/sw.js"');
    expect(serviceWorkerRegistration).toContain('document.readyState === "complete"');
    expect(serviceWorker).toContain("const CACHE_NAME = `${CACHE_PREFIX}v6`");
    expect(serviceWorker).toContain('"/favicon.ico"');
    expect(serviceWorker).toContain('"/icons/soko-icon-32.png"');
    expect(serviceWorker).toContain("cacheName !== CACHE_NAME");
    expect(serviceWorker).toContain("caches.delete(cacheName)");
  });

  it("uses the canonical kiondo icon throughout branded application surfaces", () => {
    const icon = readFileSync(`${publicDirectory}/icons/soko-icon.svg`, "utf8");
    const iconComponent = readFileSync("apps/web/src/AppIcon.tsx", "utf8");
    const application = readFileSync("apps/web/src/SokoApplication.tsx", "utf8");
    const router = readFileSync("apps/web/src/AppRouter.tsx", "utf8");
    const legalPages = [
      "apps/web/src/legal/AccountDeletionPage.tsx",
      "apps/web/src/legal/PrivacyPolicyPage.tsx",
      "apps/web/src/legal/TermsOfServicePage.tsx"
    ].map((path) => readFileSync(path, "utf8"));

    expect(icon).toContain("Two round African woven kiondo baskets");
    expect(icon).toContain('viewBox="100 50 480 480"');
    expect(iconComponent).toContain('src="/icons/soko-icon.svg"');
    expect(application).toContain('<AppIcon className="logo-mark" />');
    expect(application).toContain('<AppIcon className="auth-brand-icon" />');
    expect(router).toContain('<AppIcon className="route-brand-icon" />');
    for (const legalPage of legalPages) {
      expect(legalPage).toContain('<AppIcon className="legal-brand-icon" />');
    }
  });
});
