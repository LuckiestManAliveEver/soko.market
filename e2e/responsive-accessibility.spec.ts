import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const viewportMatrix = [
  { name: "legacy compact phone", width: 280, height: 653 },
  { name: "small phone portrait", width: 320, height: 568 },
  { name: "Android phone portrait", width: 360, height: 800 },
  { name: "modern phone portrait", width: 390, height: 844 },
  { name: "large phone portrait", width: 430, height: 932 },
  { name: "phone landscape", width: 844, height: 390 },
  { name: "foldable cover", width: 540, height: 720 },
  { name: "tablet portrait", width: 768, height: 1024 },
  { name: "tablet landscape", width: 1024, height: 768 },
  { name: "small laptop", width: 1280, height: 720 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "full HD", width: 1920, height: 1080 },
  { name: "ultrawide", width: 2560, height: 1080 }
] as const;

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      "soko.chatFirst.activeBusiness",
      JSON.stringify({
        id: "responsive-certification-shop",
        name: "Jane's International Neighborhood Market and Supplies",
        language: "en",
        role: "owner",
        sokoId: "+254-A12345678"
      })
    );
    localStorage.setItem("soko.chatFirst.mode", "seller");
    localStorage.setItem("soko.market.marketplace-intro.completed.v1", "true");
  });
});

for (const viewport of viewportMatrix) {
  test(`${viewport.name}: model library reflows without clipped controls`, async ({ page }) => {
    await openModelLibrary(page, viewport);
    await expectNoViewportOverflow(page);
    await expectInteractiveControlsInsideViewport(page);
  });
}

test("WCAG 2.2 A/AA automated accessibility scan", async ({ page }) => {
  test.setTimeout(120_000);
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 }
  ]) {
    await openModelLibrary(page, viewport);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  }
});

test("200% text size and WCAG text spacing preserve reflow", async ({ page }) => {
  await openModelLibrary(page, { width: 640, height: 720 });
  await page.addStyleTag({
    content: `
      html { font-size: 200% !important; }
      p { line-height: 1.5 !important; margin-bottom: 2em !important; }
      * { letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
    `
  });
  await expectNoViewportOverflow(page);
  await expectInteractiveControlsInsideViewport(page);
});

test("keyboard navigation exposes a visible focus indicator", async ({ page }) => {
  await openModelLibrary(page, { width: 390, height: 844 });
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement) || element === document.body) return null;
      const style = getComputedStyle(element);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow
      };
    });
    expect(focus).not.toBeNull();
    expect(
      focus?.outlineStyle !== "none" || focus.outlineWidth !== "0px" || focus.boxShadow !== "none"
    ).toBe(true);
  }
});

test("touch controls satisfy the WCAG 2.2 minimum target size", async ({ page }) => {
  await openModelLibrary(page, { width: 360, height: 800 });
  const undersized = await page
    .locator("button, a[href], input, select, textarea")
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const node = element as HTMLElement;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        if (style.visibility === "hidden" || style.display === "none" || rect.width === 0)
          return [];
        return rect.width < 24 || rect.height < 24
          ? [
              {
                label: node.getAttribute("aria-label") ?? node.textContent?.trim(),
                ...rect.toJSON()
              }
            ]
          : [];
      })
    );
  expect(undersized).toEqual([]);
});

test("reduced-motion and forced-color preferences keep the page operable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await openModelLibrary(page, { width: 390, height: 844 });
  await expectNoViewportOverflow(page);
  await expect(page.getByRole("heading", { name: "Android model library" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Predownload" }).first()).toBeEnabled();
});

async function openModelLibrary(
  page: Page,
  viewport: { width: number; height: number }
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.getByRole("button", { name: "Account and agent settings" }).click();
  await expect(page.getByRole("heading", { name: "Android model library" })).toBeVisible();
}

async function expectNoViewportOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth
  }));
  expect(dimensions.scrollWidth, JSON.stringify(dimensions)).toBeLessThanOrEqual(
    dimensions.clientWidth + 1
  );
  expect(dimensions.bodyScrollWidth, JSON.stringify(dimensions)).toBeLessThanOrEqual(
    dimensions.clientWidth + 1
  );
}

async function expectInteractiveControlsInsideViewport(page: Page): Promise<void> {
  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  const clipped = await page.locator("button, a[href], input, select, textarea").evaluateAll(
    (elements, width) =>
      elements.flatMap((element) => {
        const node = element as HTMLElement;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        if (style.visibility === "hidden" || style.display === "none" || rect.width === 0)
          return [];
        return rect.left < -1 || rect.right > Number(width) + 1
          ? [
              {
                label: node.getAttribute("aria-label") ?? node.textContent?.trim(),
                left: rect.left,
                right: rect.right
              }
            ]
          : [];
      }),
    viewportWidth
  );
  expect(clipped).toEqual([]);
}

async function installApiMocks(page: Page): Promise<void> {
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/auth/oauth/providers") return json({ providers: [] });
    if (path === "/session") {
      return json({
        account: { id: "responsive-account" },
        user: { id: "responsive-user", displayName: "Jane Owner", language: "en" },
        session: { expiresAt: "2099-01-01T00:00:00.000Z" }
      });
    }
    if (path === "/v1/marketplace-intro") {
      return json({ completedAt: "2026-07-15T00:00:00.000Z" });
    }
    if (path === "/roles/check") return json({ allowed: true, role: "owner", permission: "*" });
    if (path === "/v1/ai-models") return json({ models: modelCatalog });
    if (path.endsWith("/ai-model")) return json({ modelId: "qwen2.5-0.5b-android" });
    if (path.endsWith("/social-accounts")) return json({ accounts: [] });
    if (path.endsWith("/shop-deletion/preview")) return json({}, 404);
    return json({ message: "Not needed by responsive certification" }, 404);
  });
}

const modelCatalog = [
  mockModel("smollm2-360m-android", "SmolLM2 360M (Android saver)", 386_000_000, 2),
  mockModel("qwen2.5-0.5b-android", "Qwen2.5 0.5B (Android recommended)", 491_000_000, 3, true),
  mockModel("qwen2.5-1.5b-android", "Qwen2.5 1.5B (high-end Android)", 1_120_000_000, 6)
];

function mockModel(
  id: string,
  label: string,
  fileSizeBytes: number,
  minimumMemoryGb: number,
  recommended = false
) {
  return {
    id,
    label,
    provider: "local",
    description: `${label} model description for responsive certification.`,
    capabilities: ["chat", "tool-routing", "offline", "multilingual"],
    available: true,
    source: "huggingface",
    format: "GGUF",
    license: "Apache-2.0",
    licenseUrl: "https://huggingface.co/license",
    modelCardUrl: "https://huggingface.co/model",
    downloadUrl: "https://huggingface.co/model.gguf",
    fileName: `${id}.gguf`,
    fileSizeBytes,
    minimumMemoryGb,
    recommended
  };
}

function formatViolations(
  violations: Array<{ id: string; help: string; nodes: Array<{ target: unknown }> }>
): string {
  return violations
    .map(
      (violation) =>
        `${violation.id}: ${violation.help}\n${violation.nodes
          .map((node) => `  ${JSON.stringify(node.target)}`)
          .join("\n")}`
    )
    .join("\n");
}
