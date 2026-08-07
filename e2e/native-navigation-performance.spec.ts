import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await installDelayedApi(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      "soko.chatFirst.activeBusiness",
      JSON.stringify({
        id: "performance-shop",
        name: "Performance Shop",
        language: "en",
        role: "owner",
        sokoId: "254P12345678"
      })
    );
    localStorage.setItem("soko.chatFirst.mode", "seller");
    localStorage.setItem("soko.market.marketplace-intro.completed.v1", "true");
  });
});

test("primary navigation remains local while data refreshes slowly", async ({ page }) => {
  await page.goto("/sell");
  await expect(page.getByRole("button", { name: "Catalogue" })).toBeVisible({
    timeout: 30_000
  });
  const shellId = await page.locator(".app-frame").getAttribute("data-shell-instance");
  const timings: Record<string, number> = {};

  for (const destination of [
    { label: "Catalogue", path: "/catalogue" },
    { label: "Sales and invoices", path: "/invoices" },
    { label: "Documents and receipts", path: "/receipts" },
    { label: "Business reports", path: "/reports" },
    { label: "Business overview", path: "/sell" }
  ]) {
    const duration = await clickToSecondPaint(page, destination.label);
    timings[destination.path] = Math.round(duration * 10) / 10;
    await expect(page).toHaveURL(new RegExp(`${destination.path}$`));
    expect(duration, `${destination.label} navigation`).toBeLessThan(500);
    expect(await page.locator(".app-frame").getAttribute("data-shell-instance")).toBe(shellId);
  }
  console.log("[SOKO_NAV_BENCH]", JSON.stringify(timings));
});

test("workspace and model settings do not replace the authenticated shell", async ({ page }) => {
  await page.goto("/sell");
  const shellId = await page.locator(".app-frame").getAttribute("data-shell-instance");

  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Workspace cards" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Account and agent settings" }).click();
  await expect(page).toHaveURL(/\/agents\//);
  await page.getByRole("button", { name: "Open model library" }).click();
  await expect(page.getByLabel("Cloud fallback models", { exact: true })).toBeVisible({
    timeout: 30_000
  });

  expect(await page.locator(".app-frame").getAttribute("data-shell-instance")).toBe(shellId);
});

async function clickToSecondPaint(page: Page, label: string): Promise<number> {
  return page.getByRole("button", { name: label, exact: true }).evaluate(async (button) => {
    const startedAt = performance.now();
    button.click();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
    return performance.now() - startedAt;
  });
}

async function installDelayedApi(page: Page): Promise<void> {
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname === "/auth/bootstrap") {
      return json({
        account: { id: "performance-account" },
        user: { id: "performance-user", displayName: "Performance Owner", language: "en" },
        session: { id: "performance-session", expiresAt: "2099-01-01T00:00:00.000Z" }
      });
    }
    if (url.pathname === "/auth/oauth/providers") return json({ providers: [] });
    if (url.pathname === "/v1/marketplace-intro") {
      return json({ completedAt: "2026-07-26T00:00:00.000Z" });
    }
    if (url.pathname === "/roles/check") return json({ allowed: true, role: "owner" });
    if (url.pathname === "/health") return json({ status: "ok" });
    // Opening the model library (agent settings > "Open model library") fetches these two
    // without their own fallback/catch, unlike the rest of loadAiModels's requests - an
    // unmocked 404 here throws and the library never expands. See loadAiModels in
    // SokoApplication.tsx.
    if (url.pathname === "/v1/ai-models") return json({ models: [] });
    if (url.pathname.endsWith("/ai-model") && url.pathname.startsWith("/businesses/")) {
      return json({
        businessId: "performance-shop",
        modelId: "qwen2.5-0.5b-android",
        activatedAt: "2026-07-26T00:00:00.000Z",
        activatedBy: "performance-account"
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 750));
    return json({ code: "performance_fixture_miss" }, 404);
  });
}
