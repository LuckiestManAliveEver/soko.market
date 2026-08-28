import { expect, test } from "@playwright/test";

test("messaging is locked until the visitor chooses signup or login", async ({ page }) => {
  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === "/auth/oauth/providers"
        ? { providers: [] }
        : path === "/v1/marketplace-intro"
          ? { completedAt: null }
          : { code: "auth_session_expired", message: "No active session." };
    const status =
      path === "/auth/bootstrap" || path === "/session"
        ? 401
        : path === "/auth/oauth/providers" || path === "/v1/marketplace-intro"
          ? 200
          : 404;
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body)
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem("soko.market.marketplace-intro.completed.v1", "true");
  });
  await page.goto("/marketplace");
  await page.getByRole("button", { name: "Continue to marketplace as guest" }).click();

  const welcome = page.getByTestId("welcome-message");
  await expect(welcome).toBeVisible();
  await expect(page.getByTestId("welcome-signup-button")).toBeVisible();
  await expect(page.getByTestId("welcome-login-button")).toBeVisible();

  await page.getByTestId("sell-button").click();
  await expect(page.locator(".app-action-notice")).toContainText(
    "Sign up or log in from the welcome message"
  );
  await expect(page.locator('input[autocomplete="one-time-code"]')).toHaveCount(0);

  await page.getByTestId("welcome-signup-button").click();
  await expect(page).toHaveURL(/\/signup$/u);
  await expect(page.getByRole("heading", { name: "Connect with your market" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to marketplace as guest" }).click();
  await expect(welcome).toBeVisible();

  await page.getByTestId("welcome-login-button").click();
  await expect(page).toHaveURL(/\/login$/u);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});
