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
    expect(duration, `${destination.label} navigation`).toBeLessThan(300);
    expect(await page.locator(".app-frame").getAttribute("data-shell-instance")).toBe(shellId);
  }
  console.log("[SOKO_NAV_BENCH]", JSON.stringify(timings));
});

test("workspace and model settings do not replace the authenticated shell", async ({ page }) => {
  await page.goto("/sell");
  const shellId = await page.locator(".app-frame").getAttribute("data-shell-instance");

  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Workspace" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Account and agent settings" }).click();
  await expect(page.getByRole("dialog", { name: "Account and agent settings" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "Open model library" }).click();
  await expect(page.getByLabel("Backend fallback models", { exact: true })).toBeVisible({
    timeout: 30_000
  });

  expect(await page.locator(".app-frame").getAttribute("data-shell-instance")).toBe(shellId);
});

test("backend model activation survives reload and can be removed", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/sell");
  await page.getByRole("button", { name: "Account and agent settings" }).click();
  await expect(page.getByRole("dialog", { name: "Account and agent settings" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/u);
  await page.getByRole("button", { name: "Open model library" }).click();
  const backendModels = page.getByLabel("Soko backend models", { exact: true });
  await expect(backendModels).toBeVisible();

  await backendModels.getByRole("button", { name: "Use with agent", exact: true }).click();
  await expect(
    backendModels.getByRole("button", { name: "Remove from agent", exact: true })
  ).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Open model library" }).click();
  await expect(
    backendModels.getByRole("button", { name: "Remove from agent", exact: true })
  ).toBeVisible();

  await backendModels.getByRole("button", { name: "Remove from agent", exact: true }).click();
  await expect(
    backendModels.getByRole("button", { name: "Use with agent", exact: true })
  ).toBeVisible();
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
  let activeBinding: Record<string, unknown> | null = null;
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
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
    if (url.pathname.endsWith("/model-binding") && url.pathname.startsWith("/api/agents/")) {
      if (method === "DELETE") {
        const removedBindingId = typeof activeBinding?.id === "string" ? activeBinding.id : null;
        activeBinding = null;
        return json({
          agentId: "performance-shop",
          shopId: "performance-shop",
          binding: null,
          removedBindingId
        });
      }
      return json({ binding: activeBinding });
    }
    if (
      method === "POST" &&
      url.pathname === "/api/agents/performance-shop/models/qwen2.5-0.5b-android/activate"
    ) {
      activeBinding = {
        id: "performance-qwen-binding",
        accountId: "performance-account",
        shopId: "performance-shop",
        agentId: "performance-shop",
        modelId: "qwen2.5-0.5b-android",
        status: "active",
        executionTarget: "backend",
        executionMode: "LOCAL_FIRST",
        fallbackPolicy: "WHEN_LOCAL_UNAVAILABLE",
        permissions: {
          allowInstalledApp: false,
          allowRemoteShopDevice: false,
          allowBackendFallback: false
        },
        fallbackModelId: null,
        activatedAt: "2026-08-14T00:00:00.000Z",
        verifiedAt: "2026-08-14T00:00:00.000Z",
        lastVerificationStatus: "passed",
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
        updatedBy: "performance-user"
      };
      return json({
        binding: activeBinding,
        healthCheck: {
          ok: true,
          modelId: "qwen2.5-0.5b-android",
          provider: "ollama",
          executionTarget: "backend",
          latencyMs: 12,
          responsePreview: "SOKO_MODEL_OK",
          errorCode: null,
          message: null,
          retryable: false,
          checkedAt: "2026-08-14T00:00:00.000Z"
        }
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 750));
    return json({ code: "performance_fixture_miss" }, 404);
  });
}
