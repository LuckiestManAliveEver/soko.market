import { expect, test } from "@playwright/test";

test("messaging is locked until the visitor signs in", async ({ page }) => {
  await page.route("**/session", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "No active session." })
    });
  });
  await page.goto("/marketplace");

  const signupLink = page.getByRole("link", { name: "Sign in to continue" });
  await expect(signupLink).toBeVisible({ timeout: 15_000 });
  await expect(signupLink).toHaveAttribute("href", "#signup");
  await signupLink.click();
  await expect(page.getByRole("button", { name: "Continue with email" })).toBeVisible();

  await page.goto("/marketplace");
  const welcome = page.getByTestId("welcome-message");
  await expect(welcome.getByRole("button", { name: "Sign up" })).toBeVisible({ timeout: 15_000 });
  await expect(welcome.getByRole("button", { name: "Log in" })).toBeVisible();

  await page.getByTestId("sell-button").click();
  await expect(page.getByRole("status")).toContainText(
    "Sign up or log in from the welcome message"
  );
  await expect(page.locator('input[autocomplete="one-time-code"]')).toHaveCount(0);

  await welcome.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByRole("button", { name: "Continue with email" })).toBeVisible();

  await page.goto("/marketplace");
  const signInButton = page.getByRole("button", { name: "Sign in to message" });
  await expect(signInButton).toBeVisible({ timeout: 15_000 });
  await signInButton.click();

  await expect(page.getByRole("button", { name: "Use phone and PIN" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with email" })).toBeVisible();
  await expect(page.getByPlaceholder("+254 700 000 000 or name@example.com")).toHaveCount(0);
});
