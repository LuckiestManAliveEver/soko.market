import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const viewportMatrix = [
  { name: "compact 280px phone", width: 280, height: 653 },
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
        sokoId: "254A12345678"
      })
    );
    localStorage.setItem("soko.chatFirst.mode", "seller");
    localStorage.setItem("soko.market.marketplace-intro.completed.v1", "true");
  });
});

test("secondary modules preserve the conversation URL and browser history", async ({ page }) => {
  await page.goto("/");
  const initialHistoryLength = await page.evaluate(() => history.length);

  await page.getByRole("button", { name: "Marketplace", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Marketplace" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => page.evaluate(() => history.length)).toBe(initialHistoryLength);
  await page.getByRole("button", { name: "Close Marketplace" }).click();
  await expect(page.getByRole("dialog", { name: "Marketplace" })).toHaveCount(0);

  await page.getByRole("button", { name: "Account and agent settings" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Account and agent settings" });
  await expect(settingsDialog).toBeVisible();
  await expect(
    settingsDialog.getByLabel("Open-source agent catalogue", { exact: true })
  ).toBeVisible();
  await expect(settingsDialog.getByText("Retail Agent", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => page.evaluate(() => history.length)).toBe(initialHistoryLength);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Account and agent settings" })).toHaveCount(0);
});

test("first run downloads the lowest-memory OSS agent and links it to chat", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-soko-test-agent-bootstrap": "true" });
  await page.goto("/");

  await expect
    .poll(() =>
      page.evaluate(() => {
        const bindings = JSON.parse(
          localStorage.getItem("soko.oss-agent-bindings.v1") ?? "[]"
        ) as Array<{ agentDefinitionId?: string }>;
        return bindings[0]?.agentDefinitionId ?? null;
      })
    )
    .toBe(mockOssAgent.id);

  const installedAgentId = await page.evaluate(() => {
    const manifests = JSON.parse(
      localStorage.getItem("soko.oss-agent-installations.v1") ?? "[]"
    ) as Array<{ agent?: { id?: string } }>;
    return manifests[0]?.agent?.id ?? null;
  });
  expect(installedAgentId).toBe(mockOssAgent.id);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const activeAgent = JSON.parse(
          localStorage.getItem("soko.chatFirst.agentSettings") ?? "null"
        ) as { agentDefinitionId?: string } | null;
        return activeAgent?.agentDefinitionId ?? null;
      })
    )
    .toBe(mockOssAgent.id);
});

test("workspace dialog traps focus, restores dismissed cards, and closes with Escape", async ({
  page
}) => {
  await page.goto("/sell");
  const workspaceButton = page.getByRole("button", { name: "Workspace", exact: true });
  await workspaceButton.click();
  const dialog = page.getByRole("dialog", { name: "Workspace" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close Catalogue card" }).click();
  await expect(dialog.getByRole("button", { name: "Catalogue", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Restore workspace cards" }).click();
  await expect(dialog.getByRole("button", { name: "Catalogue", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(workspaceButton).toBeFocused();
});

test("existing shops keep cards out of the chat until the launcher opens them", async ({
  page
}) => {
  await page.goto("/sell");
  await expect(page.getByLabel("Workspace cards")).toHaveCount(0);

  const launcher = page.getByRole("button", { name: "Workspace", exact: true });
  await launcher.click();
  const dialog = page.getByRole("dialog", { name: "Workspace" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("section.generated-card-message")).toHaveCount(1);

  await dialog.getByRole("button", { name: "Close Catalogue card" }).click();
  await expect(dialog.getByRole("button", { name: "Catalogue", exact: true })).toHaveCount(0);
  // 17 workspace cards total (10 original + 7 added when PrimaryNavigation was removed and its
  // destinations moved into this hub - see docs/frontend/frontend.md's Phase 6), minus the one
  // just closed above.
  await expect(dialog.locator(".generated-card-close")).toHaveCount(16);

  await dialog.getByRole("button", { name: "Close Workspace" }).click();
  await expect(page.getByLabel("Workspace cards")).toHaveCount(0);
  await expect(launcher).toBeFocused();

  await launcher.click();
  await expect(page.getByRole("dialog", { name: "Workspace" })).toHaveCount(1);
  await page.keyboard.press("Escape");

  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill("Cards are closed and chat still works.");
  await expect(composer).toHaveValue("Cards are closed and chat still works.");
  await expect(page.getByRole("dialog", { name: "Workspace" })).toHaveCount(0);
});

test("a switched device offers the hosted default without silently granting consent", async ({
  page
}) => {
  await page.setExtraHTTPHeaders({ "x-soko-test-device-switch": "true" });
  await page.goto("/sell");

  const fallback = page.getByRole("region", {
    name: "Use your selected OpenAI fallback here?"
  });
  await expect(fallback).toBeVisible({ timeout: 15_000 });
  const beforeConsent = await page.evaluate(() =>
    localStorage.getItem("soko.client-inference-preferences.v1")
  );
  expect(beforeConsent).toBeNull();

  await fallback.getByRole("button", { name: "Allow OpenAI fallback here" }).click();
  await expect(fallback).toBeHidden();
  await expect(
    page.getByText(
      "The explicitly selected OpenAI model is enabled only as a fallback on this device."
    )
  ).toBeVisible();
  const preferences = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("soko.client-inference-preferences.v1") ?? "[]")
  );
  expect(preferences).toEqual([
    expect.objectContaining({
      accountId: "responsive-account",
      businessId: "responsive-certification-shop",
      cloudConsent: true
    })
  ]);
});

test("SMS handoff confirms cost, normalizes the recipient, and preserves the draft", async ({
  page
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/sell");
  const composer = page.getByRole("textbox", { name: "Message" });
  const draft = `Hello from Soko. ${"This message may use more than one carrier SMS. ".repeat(4)}`;
  await composer.fill(draft);

  let sokoMessagePosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/v1/messages") {
      sokoMessagePosts += 1;
    }
  });

  await page.getByRole("button", { name: "Send as SMS", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Send as SMS" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Your mobile carrier may charge for this SMS.")).toBeVisible();
  await expect(dialog.getByText(/multiple charges may apply/)).toBeVisible();
  await dialog.getByLabel("Telephone number").fill("0712 345 678");
  await dialog.getByRole("button", { name: "Review SMS details" }).click();
  await expect(dialog.getByText("+254712345678")).toBeVisible();
  await expect(dialog.getByLabel("Message preview")).toHaveValue(draft);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(composer).toHaveValue(draft);
  expect(sokoMessagePosts).toBe(0);
});

test("persisted owner-control cards stay attached to their historical message", async ({
  page
}) => {
  await page.setExtraHTTPHeaders({ "x-soko-test-owner-controls": "true" });
  await page.goto("/sell");
  const historicalMessage = page
    .locator("article.message")
    .filter({ hasText: "Shared owner controls" });
  await expect(historicalMessage).toHaveCount(1, { timeout: 15_000 });
  await expect(historicalMessage.locator("section.generated-card-message")).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: "Workspace" })).toHaveCount(0);

  await historicalMessage.getByRole("button", { name: "Close Catalogue card" }).click();
  await expect(
    historicalMessage.getByRole("button", { name: "Catalogue", exact: true })
  ).toHaveCount(0);
});

test("account deletion requires DELETE, PIN, acknowledgement, and signs out", async ({ page }) => {
  let pinVerifications = 0;
  let deletionRequests = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/auth/pin/verify") pinVerifications += 1;
    if (path.endsWith("/compliance/account-deletion")) deletionRequests += 1;
  });

  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete account", exact: true }).click();
  await page.getByRole("button", { name: "Delete entire account" }).click();
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Continue to verification" }).click();
  await page
    .getByRole("group", { name: "Verify account deletion" })
    .getByLabel("Owner PIN")
    .fill("1234");
  await page.getByLabel(/I understand that all account access is disabled immediately/).check();
  await page.getByTestId("delete-account-confirm").click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(
    page.getByRole("heading", { name: "Start with your phone", level: 1 })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
  expect(pinVerifications).toBe(1);
  expect(deletionRequests).toBe(1);
});

test("shop deletion Continue and Quarantine buttons call the backend", async ({ page }) => {
  let startRequests = 0;
  let finalizeRequests = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/shop-deletion/request")) startRequests += 1;
    if (path.endsWith("/shop-deletion/responsive-shop-deletion/finalize")) {
      finalizeRequests += 1;
    }
  });

  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete account", exact: true }).click();
  await page.getByRole("button", { name: "Delete this shop", exact: true }).click();
  await page.getByLabel("Type the shop ID to continue").fill("254A12345678");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Login PIN").fill("1234");
  await page.getByLabel(/I understand the shop will be hidden now and permanently purged/).check();
  await page.getByRole("button", { name: "Quarantine shop" }).click();

  await expect(page.locator('.shop-deletion-card[role="status"]')).toContainText("QUARANTINED");
  expect(startRequests).toBe(1);
  expect(finalizeRequests).toBe(1);
});

test("messaging inbox and thread adapt across phone and desktop screens", async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 1440, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    if (viewport.width < 760) {
      await page.getByRole("button", { name: "Messages", exact: true }).click();
    }
    await expect(page.getByRole("heading", { name: "Messages" })).toBeVisible();
    await page.getByRole("button", { name: /Delivery coordination/ }).click();
    await expect(
      page.locator(".messenger-thread").getByText("The order is ready.", { exact: true })
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
    await expectNoViewportOverflow(page);
  }
});

test("draft Terms of Service reflow and pass an automated accessibility scan", async ({ page }) => {
  test.setTimeout(90_000);
  for (const viewport of [
    { width: 280, height: 653 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/terms");
    await expect(page.getByRole("heading", { name: "Terms of Service", level: 1 })).toBeVisible({
      timeout: 20_000
    });
    await expect(page.getByText("Version 1.0 (Draft) · Parts I–IV")).toBeVisible();
    await expect(page.getByText("Effective Date: To Be Inserted")).toBeVisible();
    await expect(page.getByRole("heading", { name: "1. Introduction" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "15. The Soko.market Services" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "33. Subscription Plans" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "77. Effective Date and Version History" })
    ).toBeVisible();
    await expectNoViewportOverflow(page);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  }
});

test("draft Privacy Policy reflows and passes an automated accessibility scan", async ({
  page
}) => {
  test.setTimeout(90_000);
  for (const viewport of [
    { width: 280, height: 653 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { name: "Privacy Policy", level: 1 })).toBeVisible({
      timeout: 20_000
    });
    await expect(page.getByText("Version 1.0 (Draft) · Parts I–IV")).toBeVisible();
    await expect(page.getByText("Effective Date: To Be Inserted")).toBeVisible();
    await expect(page.getByRole("heading", { name: "1. Introduction" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "40. Version History" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Annex D – Data Subject Rights Summary" })
    ).toBeVisible();
    await expectNoViewportOverflow(page);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  }
});

test("public account deletion resource reflows and passes accessibility", async ({ page }) => {
  for (const viewport of [
    { width: 280, height: 653 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/account-deletion");
    await expect(
      page.getByRole("heading", { name: "Delete your Soko.market account", level: 1 })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Continue to secure deletion request" })
    ).toHaveAttribute("href", "/?intent=account-deletion");
    await expect(
      page.getByText("You do not need to reinstall or open the Android app.")
    ).toBeVisible();
    await expectNoViewportOverflow(page);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  }
});

for (const viewport of viewportMatrix) {
  test(`${viewport.name}: model library reflows without clipped controls`, async ({ page }) => {
    await openModelLibrary(page, viewport);
    await expectNoViewportOverflow(page);
    await expectInteractiveControlsInsideViewport(
      page,
      page.getByRole("dialog", { name: "Account and agent settings" })
    );
  });
}

test("downloaded models show green when active and red when inactive", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-soko-test-local-model-buttons": "true" });
  await page.addInitScript((models) => {
    localStorage.setItem("soko.device-model-scope.v1", "responsive-model-device");
    localStorage.setItem("soko.local-ai-models.v2", JSON.stringify(models));
  }, installedModels);

  await openModelLibrary(page, { width: 390, height: 844 });

  const activeButton = page
    .getByRole("button", { name: "Active on this device", exact: true })
    .first();
  const inactiveButton = page
    .getByRole("button", { name: "Not active · Activate on this device", exact: true })
    .first();

  await expect(activeButton).toBeVisible();
  await expect(activeButton).toBeDisabled();
  await expect(activeButton).toHaveAttribute("aria-pressed", "true");
  await expect(inactiveButton).toBeVisible();
  await expect(inactiveButton).toBeEnabled();
  await expect(inactiveButton).toHaveAttribute("aria-pressed", "false");
  expect(await activeButton.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    "rgb(17, 122, 79)"
  );
  expect(
    await inactiveButton.evaluate((element) => getComputedStyle(element).backgroundColor)
  ).toBe("rgb(180, 35, 24)");
});

test("device activation preserves the previous assignment when the GGUF runtime is unavailable", async ({
  page
}) => {
  const readinessUpdates: string[] = [];
  await page.setExtraHTTPHeaders({ "x-soko-test-model-binding": "true" });
  await page.addInitScript((model) => {
    localStorage.setItem("soko.device-model-scope.v1", "responsive-model-device");
    localStorage.setItem("soko.local-ai-models.v2", JSON.stringify([model]));
  }, bindableInstalledModel);
  page.on("request", (request) => {
    if (request.method() === "PUT" && new URL(request.url()).pathname.endsWith("/agent-model")) {
      const body = request.postDataJSON() as { readinessStatus?: string };
      if (body.readinessStatus !== undefined) readinessUpdates.push(body.readinessStatus);
    }
  });

  await page.goto("/");
  await page.evaluate(async (fileName) => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("soko-ai-models", { create: true });
    const file = await directory.getFileHandle(fileName, { create: true });
    const writable = await file.createWritable();
    await writable.write(new TextEncoder().encode("GGUF"));
    await writable.close();
  }, bindableInstalledModel.fileName);
  await page.getByRole("button", { name: "Account and agent settings" }).click();
  await page.getByRole("button", { name: "Open model library" }).click();
  await page
    .getByRole("button", { name: "Not active · Activate on this device", exact: true })
    .click();

  await expect(
    page.getByRole("status").filter({
      hasText: /The local model could not be loaded.*previous working model was left unchanged/u
    })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Not active · Retry device activation", exact: true })
  ).toBeVisible();
  await expect.poll(() => readinessUpdates).toEqual([]);
});

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
  await expectInteractiveControlsInsideViewport(
    page,
    page.getByRole("dialog", { name: "Account and agent settings" })
  );
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
    .getByRole("dialog", { name: "Account and agent settings" })
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
  await expect(page.getByRole("button", { name: "Predownload & install" }).first()).toBeVisible();
});

async function openModelLibrary(
  page: Page,
  viewport: { width: number; height: number }
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.getByRole("button", { name: "Account and agent settings" }).click();
  await expect(page.getByRole("dialog", { name: "Account and agent settings" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Android model library" })).toBeVisible();
  await page.getByRole("button", { name: "Open model library" }).click();
  await expect(
    page
      .getByRole("button", {
        name: /^(?:Predownload & install|Active on this device|Not active · Activate on this device)$/u
      })
      .first()
  ).toBeVisible({ timeout: 15_000 });
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

async function expectInteractiveControlsInsideViewport(page: Page, root: Locator): Promise<void> {
  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  const clipped = await root.locator("button, a[href], input, select, textarea").evaluateAll(
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
  let accountDeleted = false;
  let agentProfile = { ...mockAgentProfile };
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const agentBootstrap = route.request().headers()["x-soko-test-agent-bootstrap"] === "true";
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/auth/oauth/providers") return json({ providers: [] });
    if (path === "/session" || path === "/auth/bootstrap") {
      if (accountDeleted) return json({ code: "session_invalid" }, 401);
      return json({
        account: { id: "responsive-account" },
        user: { id: "responsive-user", displayName: "Jane Owner", language: "en" },
        session: { expiresAt: "2099-01-01T00:00:00.000Z" }
      });
    }
    if (path === "/v1/marketplace-intro") {
      return json({ completedAt: "2026-07-15T00:00:00.000Z" });
    }
    if (path === "/v1/e2ee/devices" && method === "POST") {
      return json({ id: "responsive-device", accountId: "responsive-account" });
    }
    if (path === "/v1/conversations" && method === "GET") {
      return json({ conversations: [mockConversationInbox] });
    }
    if (path === "/v1/conversations/responsive-conversation" && method === "GET") {
      return json(
        route.request().headers()["x-soko-test-owner-controls"] === "true"
          ? mockOwnerControlsConversationView
          : mockConversationView
      );
    }
    if (path === "/v1/conversations/responsive-conversation" && method === "PATCH") {
      return json(mockConversationView);
    }
    if (path.endsWith("/typing")) return json({ typing: [] });
    if (path === "/v1/messages") return json(mockMessage);
    if (path.endsWith("/runtime/sessions") && method === "GET") return json([mockRuntimeSession]);
    if (path.endsWith("/runtime/sessions") && method === "POST") {
      return json(mockRuntimeSession);
    }
    if (path === "/roles/check") return json({ allowed: true, role: "owner", permission: "*" });
    if (agentBootstrap && path.endsWith("/agent-profile") && method === "GET") {
      return json(agentProfile);
    }
    if (agentBootstrap && path.endsWith("/agent-profile") && method === "PUT") {
      const update = route.request().postDataJSON() as Record<string, unknown>;
      agentProfile = {
        ...agentProfile,
        ...update,
        runtimeVersion: agentProfile.runtimeVersion + 1
      };
      return json(agentProfile);
    }
    if (agentBootstrap && path.endsWith("/agent-runtime/readiness")) {
      return json({
        tenantId: "responsive-certification-shop",
        shopId: "responsive-certification-shop",
        agentId: "responsive-certification-shop",
        runtimeVersion: agentProfile.runtimeVersion,
        ready: true,
        issues: [],
        checkedAt: "2026-07-15T12:00:00.000Z"
      });
    }
    if (path === "/v1/oss-agents/github") {
      return json({
        agents: [],
        status: "available",
        connection: "public",
        message: "GitHub connected."
      });
    }
    if (path === "/v1/oss-agents/huggingface") {
      return json({
        agents: [mockOssAgent],
        status: "available",
        connection: "public",
        message: "Hugging Face connected."
      });
    }
    if (path === "/v1/ai-models") return json({ models: modelCatalog });
    if (path === "/v1/models/installed" && method === "POST") return json({ registered: true });
    if (path.startsWith("/v1/models/") && path.endsWith("/validate") && method === "POST") {
      return json({
        installationStatus: "INSTALLED",
        compatibilityStatus: "COMPATIBLE",
        validationError: null
      });
    }
    if (path.endsWith("/agent-model")) {
      const switchedDevice = route.request().headers()["x-soko-test-device-switch"] === "true";
      const localModelButtons =
        route.request().headers()["x-soko-test-local-model-buttons"] === "true";
      const modelBinding = route.request().headers()["x-soko-test-model-binding"] === "true";
      const bindingBody =
        modelBinding && method === "PUT"
          ? (route.request().postDataJSON() as {
              installationId: string;
              preferredExecutionMode: string;
              fallbackPolicy: string;
              readinessStatus: string;
              lastSuccessfulInferenceAt: string | null;
              lastErrorCode: string | null;
            })
          : null;
      return json({
        agentId: "responsive-certification-shop",
        businessId: "responsive-certification-shop",
        accountId: "responsive-account",
        userId: "responsive-user",
        deviceId: "responsive-model-device",
        activeModelInstallationId:
          bindingBody?.installationId ??
          (localModelButtons ? "responsive-qwen-installation" : null),
        modelId: bindingBody
          ? "qwen2.5-0.5b-android"
          : localModelButtons
            ? "qwen2.5-0.5b-android"
            : switchedDevice
              ? "openai-fast"
              : "sokoclaw-local",
        preferredExecutionMode:
          bindingBody?.preferredExecutionMode ?? (localModelButtons ? "LOCAL_FIRST" : "CLOUD_ONLY"),
        fallbackPolicy: bindingBody?.fallbackPolicy ?? "WHEN_LOCAL_UNAVAILABLE",
        readinessStatus: bindingBody?.readinessStatus ?? "READY",
        runtimeBackend:
          bindingBody || localModelButtons
            ? "LLAMA_CPP_ANDROID"
            : switchedDevice
              ? "CLOUD"
              : "OLLAMA",
        lastSuccessfulInferenceAt:
          bindingBody?.lastSuccessfulInferenceAt ??
          (localModelButtons ? "2026-07-21T23:59:00.000Z" : null),
        lastErrorCode:
          bindingBody?.lastErrorCode ??
          (switchedDevice ? "PREFERRED_MODEL_NOT_INSTALLED_ON_DEVICE" : null),
        updatedAt: "2026-07-21T00:00:00.000Z",
        updatedBy: "responsive-user"
      });
    }
    if (path.endsWith("/ai-model")) {
      return json({
        modelId:
          route.request().headers()["x-soko-test-device-switch"] === "true"
            ? "openai-fast"
            : "qwen2.5-0.5b-android"
      });
    }
    if (path.endsWith("/social-accounts")) return json({ accounts: [] });
    if (path.endsWith("/shop-deletion/preview")) {
      return json({
        businessId: "responsive-certification-shop",
        accountId: "responsive-account",
        counts: { products: 1, customers: 2, suppliers: 1, salesRecords: 3, uploadedFiles: 1 },
        generatedAt: "2026-07-15T00:00:00.000Z"
      });
    }
    if (path.endsWith("/shop-deletion/request") && method === "POST") {
      return json({
        request: {
          id: "responsive-shop-deletion",
          status: "PENDING_VERIFICATION",
          anonymizeAfter: "2026-08-14T00:00:00.000Z"
        },
        preview: {
          businessId: "responsive-certification-shop",
          accountId: "responsive-account",
          counts: { products: 1, customers: 2, suppliers: 1, salesRecords: 3, uploadedFiles: 1 },
          generatedAt: "2026-07-15T00:00:00.000Z"
        }
      });
    }
    if (path.endsWith("/shop-deletion/responsive-shop-deletion/finalize") && method === "POST") {
      return json({
        id: "responsive-shop-deletion",
        status: "QUARANTINED",
        anonymizeAfter: "2026-08-14T00:00:00.000Z"
      });
    }
    if (path === "/auth/pin/verify" && method === "POST") return json({ verified: true });
    if (path.endsWith("/compliance/account-deletion") && method === "POST") {
      accountDeleted = true;
      return json({
        id: "responsive-deletion",
        accountId: "responsive-account",
        userId: "responsive-user",
        businessId: "responsive-certification-shop",
        actorId: "responsive-user",
        status: "scheduled",
        reason: null,
        requestedAt: "2026-07-15T00:00:00.000Z",
        deactivatedAt: "2026-07-15T00:00:00.000Z",
        anonymizeAfter: "2026-08-14T00:00:00.000Z",
        retention: {}
      });
    }
    return json({ message: "Not needed by responsive certification" }, 404);
  });
}

const mockMessage = {
  id: "responsive-message",
  conversationId: "responsive-conversation",
  clientMessageId: "responsive-client-message",
  author: "agent",
  authorId: "account-responsive-account-agent",
  content: { type: "text", text: "The order is ready." },
  status: "delivered",
  deliveredAt: "2026-07-15T12:00:00.000Z",
  readAt: null,
  editedAt: null,
  deletedAt: null,
  replyToMessageId: null,
  forwardedFromMessageId: null,
  reactions: [],
  clientTimestamp: "2026-07-15T12:00:00.000Z",
  createdAt: "2026-07-15T12:00:00.000Z"
};

const mockOwnerControlsMessage = {
  ...mockMessage,
  id: "responsive-owner-controls-message",
  clientMessageId: "responsive-owner-controls-client-message",
  content: { type: "owner-controls", shopId: "responsive-certification-shop" }
};

const mockParticipant = {
  id: "responsive-participant",
  conversationId: "responsive-conversation",
  role: "account",
  accountId: "responsive-account",
  businessId: null,
  agentId: null,
  displayName: "Jane Owner",
  lastReadAt: "2026-07-15T12:00:00.000Z",
  archivedAt: null,
  mutedUntil: null,
  pinnedAt: null,
  createdAt: "2026-07-15T11:00:00.000Z"
};

const mockConversationInbox = {
  id: "responsive-conversation",
  accountId: "responsive-account",
  kind: "personal",
  activeShopId: null,
  title: "Delivery coordination",
  createdAt: "2026-07-15T11:00:00.000Z",
  updatedAt: "2026-07-15T12:00:00.000Z",
  lastMessage: mockMessage,
  unreadCount: 0,
  participant: mockParticipant
};

const mockConversationView = {
  conversation: mockConversationInbox,
  participants: [mockParticipant],
  messages: [mockMessage],
  typing: []
};

const mockRuntimeSession = {
  id: "responsive-runtime-session",
  businessId: "responsive-certification-shop",
  userId: "responsive-user",
  status: "active",
  turnCount: 0,
  createdAt: "2026-07-15T12:00:00.000Z",
  updatedAt: "2026-07-15T12:00:00.000Z"
};

const mockOwnerControlsConversationView = {
  ...mockConversationView,
  messages: [mockOwnerControlsMessage]
};

const mockOssAgent = {
  id: "huggingface:example/retail-agent",
  label: "Retail Agent",
  description: "A licensed retail assistant Space.",
  source: "huggingface",
  sourceId: "example/retail-agent",
  sourceUrl: "https://huggingface.co/spaces/example/retail-agent",
  license: "apache-2.0",
  licenseUrl: "https://huggingface.co/spaces/example/retail-agent/blob/main/LICENSE",
  licenseVerified: true,
  runtime: "gradio",
  executionMode: "hosted-api",
  minimumDeviceTier: "low",
  minimumMemoryGb: 2,
  requiresGpu: false,
  popularity: 120,
  capabilities: ["agent", "retail"],
  updatedAt: "2026-07-15T00:00:00.000Z"
};

const mockAgentProfile = {
  agentDefinitionId: "builtin:shopkeeper",
  businessId: "responsive-certification-shop",
  tenantId: "responsive-certification-shop",
  shopId: "responsive-certification-shop",
  agentId: "responsive-certification-shop",
  runtimeVersion: 1,
  createdAt: "2026-07-15T00:00:00.000Z",
  name: "Shopkeeper",
  description: "A safe shop assistant.",
  modelId: "qwen2.5-0.5b-android",
  role: "Business assistant",
  language: "en",
  personality: "Warm and concise",
  personalityConfig: { responseLength: "brief", additionalGuidance: "Warm and concise" },
  instructions: "Help the owner operate the shop.",
  instructionPolicy: { generalOperatingRules: ["Help the owner operate the shop."] },
  knowledge: "Use saved shop records.",
  tools: ["Products"],
  skillBindings: [],
  integrations: ["Soko.market storefront"],
  contextScripts: [],
  memoryPolicy: {},
  evaluationPolicy: {},
  supportedLanguages: ["en"],
  businessCategory: "general",
  publicIntroduction: "Welcome to the shop.",
  status: "active"
};

const modelCatalog = [
  {
    id: "openai-fast",
    label: "OpenAI fast",
    provider: "openai",
    description: "Fast hosted reasoning for connected shops.",
    capabilities: ["chat", "tool-routing"],
    available: true,
    source: "hosted",
    format: "remote",
    license: null,
    licenseUrl: null,
    modelCardUrl: null,
    downloadUrl: null,
    fileName: null,
    fileSizeBytes: null,
    minimumMemoryGb: null,
    recommended: false,
    contextWindow: 128_000
  },
  mockModel("smollm2-360m-android", "SmolLM2 360M (Android saver)", 386_000_000, 2),
  mockModel("qwen2.5-0.5b-android", "Qwen2.5 0.5B (Android recommended)", 491_000_000, 3, true),
  mockModel("qwen2.5-1.5b-android", "Qwen2.5 1.5B (high-end Android)", 1_120_000_000, 6)
];

const installedModels = [
  installedModel(
    "responsive-qwen-installation",
    "qwen2.5-0.5b-android",
    "Qwen2.5 0.5B (Android recommended)",
    "qwen2.5-0.5b-instruct-q4_k_m.gguf",
    491_000_000
  ),
  installedModel(
    "responsive-smollm-installation",
    "smollm2-360m-android",
    "SmolLM2 360M (Android saver)",
    "smollm2-360m-instruct-q8_0.gguf",
    386_000_000
  )
];

const bindableInstalledModel = {
  ...installedModels[0],
  fileSizeBytes: 4
};

function installedModel(
  id: string,
  modelId: string,
  label: string,
  fileName: string,
  fileSizeBytes: number
) {
  return {
    id,
    modelId,
    label,
    displayName: label,
    provider: "huggingface",
    repositoryId: modelId.startsWith("qwen")
      ? "Qwen/Qwen2.5-0.5B-Instruct-GGUF"
      : "HuggingFaceTB/SmolLM2-360M-Instruct-GGUF",
    fileName,
    storageKey: fileName,
    format: "GGUF",
    quantization: modelId.startsWith("qwen") ? "Q4_K_M" : "Q8_0",
    architecture: modelId.startsWith("qwen") ? "qwen2" : "llama",
    parameterCount: modelId.startsWith("qwen") ? 500_000_000 : 360_000_000,
    contextLength: 2048,
    fileSizeBytes,
    checksum: null,
    license: "Apache-2.0",
    commercialUseAllowed: true,
    runtimeBackend: "LLAMA_CPP_ANDROID",
    installationStatus: "INSTALLED",
    compatibilityStatus: "COMPATIBLE",
    deviceId: "responsive-model-device",
    storedAt: "2026-07-21T23:50:00.000Z",
    installedAt: "2026-07-21T23:50:00.000Z",
    lastVerifiedAt: "2026-07-21T23:51:00.000Z",
    validationError: null
  };
}

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
