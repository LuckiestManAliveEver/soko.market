import { expect, test } from "@playwright/test";

test("an unsigned visitor can prepare a carrier SMS from the Messages inbox", async ({ page }) => {
  await page.goto("/join");

  await expect(page).toHaveURL(/\/join$/u);
  await expect(page.getByRole("heading", { name: "Messages" })).toBeVisible();
  await page.getByRole("button", { name: "New", exact: true }).click();

  await expect(page.getByText("No Soko account is needed.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Mobile number" })).toBeVisible();
  await expect(page.getByPlaceholder("Write a normal text message")).toBeVisible();
  await expect(page.getByText(/carrier SMS charges may apply/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue in Messages" })).toBeVisible();
});
