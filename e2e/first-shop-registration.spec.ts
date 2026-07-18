import { expect, test } from "@playwright/test";

test("a signed-in account registers its first shop without OTP", async ({ page }) => {
  let createBusinessBody: Record<string, unknown> | null = null;

  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/session") {
      return json({
        account: { id: "first-shop-account" },
        user: { id: "first-shop-user", displayName: "First Shop Owner", language: "en" },
        session: { expiresAt: "2099-01-01T00:00:00.000Z" }
      });
    }
    if (path === "/auth/oauth/providers") return json({ providers: [] });
    if (path === "/v1/marketplace-intro") {
      return json({ completedAt: "2026-07-17T00:00:00.000Z" });
    }
    if (path === "/v1/conversations" && request.method() === "GET") {
      return json({ conversations: [] });
    }
    if (path === "/v1/e2ee/devices" && request.method() === "POST") {
      return json({ id: "first-shop-device", accountId: "first-shop-account" });
    }
    if (path === "/businesses" && request.method() === "POST") {
      createBusinessBody = request.postDataJSON() as Record<string, unknown>;
      return json({
        business: {
          id: "first-shop",
          name: "No OTP Shop",
          language: "en",
          sokoId: "254A00000001"
        },
        membership: { role: "owner" }
      });
    }

    return json({ message: `The test does not provide ${request.method()} ${path}.` }, 404);
  });

  await page.addInitScript(() => {
    localStorage.setItem("soko.market.marketplace-intro.completed.v1", "true");
  });
  await page.goto("/marketplace");
  await page.getByTestId("sell-button").click();

  await expect(page.getByRole("heading", { name: "Set up your business" })).toBeVisible();
  await expect(
    page.getByText(
      "Create your shop once using your signed-in account. You can update these details later.",
      { exact: true }
    )
  ).toBeVisible();
  await expect(page.locator('input[autocomplete="one-time-code"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Send (SMS|email) code/ })).toHaveCount(0);

  await page.getByLabel("Business name").fill("No OTP Shop");
  await page.getByRole("button", { name: "Create business" }).click();

  await expect
    .poll(() => createBusinessBody)
    .toEqual({
      name: "No OTP Shop",
      language: "en"
    });
  await expect(page.getByRole("heading", { name: "Set up your business" })).toBeHidden();
});
