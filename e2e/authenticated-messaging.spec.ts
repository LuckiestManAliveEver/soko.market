import { expect, test } from "@playwright/test";

test("messaging is locked until the visitor signs in", async ({ page }) => {
  await page.goto("/marketplace");

  const signInButton = page.getByRole("button", { name: "Sign in to message" });
  await expect(signInButton).toBeVisible({ timeout: 15_000 });
  await signInButton.click();

  await expect(page.getByRole("button", { name: "Use phone and PIN" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with email" })).toBeVisible();
  await expect(page.getByPlaceholder("+254 700 000 000 or name@example.com")).toHaveCount(0);
});
