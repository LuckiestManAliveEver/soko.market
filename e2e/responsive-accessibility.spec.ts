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
        sokoId: "254A12345678"
      })
    );
    localStorage.setItem("soko.chatFirst.mode", "seller");
    localStorage.setItem("soko.market.marketplace-intro.completed.v1", "true");
  });
});

test("central navigation preserves marketplace, settings, and browser back behavior", async ({
  page
}) => {
  await page.goto("/marketplace");
  await page.getByRole("button", { name: "Account and agent settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/marketplace$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/settings$/);
});

test("workspace dialog traps a useful action, reports unavailable cards, and closes with Escape", async ({
  page
}) => {
  await page.goto("/sell");
  const workspaceButton = page.getByRole("button", { name: "Workspace", exact: true });
  await workspaceButton.click();
  const dialog = page.getByRole("dialog", { name: "Workspace cards" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /\+ Add card/ }).click();
  await expect(page.getByRole("status")).toContainText("This feature is not available yet.");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(workspaceButton).toBeFocused();
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
  await page.getByLabel("Owner PIN").fill("1234");
  await page.getByLabel(/I understand that all account access is disabled immediately/).check();
  await page.getByTestId("delete-account-confirm").click();
  await expect(page.getByLabel("signup options")).toBeVisible();
  await page.getByRole("button", { name: "Continue with phone" }).click();
  await expect(page.getByRole("heading", { name: "Continue with phone" })).toBeVisible();
  await expect(page.getByLabel("Phone number")).toBeVisible();
  await expect(page.getByLabel("Create owner PIN")).toBeVisible();
  await expect(page.getByLabel("Confirm owner PIN")).toBeVisible();
  await expect(page.getByLabel(/verification code/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Back to signup options" }).click();
  await expect(page.getByRole("button", { name: "Continue with email" })).toBeVisible();
  await expect(page.getByLabel("login options")).toHaveCount(0);
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
      await page.getByRole("button", { name: "Conversations" }).click();
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
  await expect(page.getByRole("button", { name: "Predownload & install" }).first()).toBeVisible();
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
    const method = route.request().method();
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
    if (path === "/v1/e2ee/devices" && method === "POST") {
      return json({ id: "responsive-device", accountId: "responsive-account" });
    }
    if (path === "/v1/conversations" && method === "GET") {
      return json({ conversations: [mockConversationInbox] });
    }
    if (path === "/v1/conversations/responsive-conversation" && method === "GET") {
      return json(mockConversationView);
    }
    if (path === "/v1/conversations/responsive-conversation" && method === "PATCH") {
      return json(mockConversationView);
    }
    if (path.endsWith("/typing")) return json({ typing: [] });
    if (path === "/v1/messages") return json(mockMessage);
    if (path === "/roles/check") return json({ allowed: true, role: "owner", permission: "*" });
    if (path === "/v1/ai-models") return json({ models: modelCatalog });
    if (path.endsWith("/ai-model")) return json({ modelId: "qwen2.5-0.5b-android" });
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
