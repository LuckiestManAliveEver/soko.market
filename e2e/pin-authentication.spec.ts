import { expect, test } from "@playwright/test";

test("signs up and later logs in from the welcome message with phone and PIN", async ({ page }) => {
  const phone = "+254712345678";
  const pin = "2468";
  let sessionActive = false;
  let signupCount = 0;
  let loginCount = 0;

  const session = {
    account: {
      id: "pin-browser-account",
      primaryAuthChannel: "phone",
      primaryAuthDestination: phone
    },
    user: { id: "pin-browser-user", displayName: "Trader 5678", language: "en" },
    session: {
      id: "pin-browser-session",
      absoluteExpiresAt: "2099-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z"
    }
  };

  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/auth/oauth/providers") return json({ providers: [] });
    if (path === "/session" || path === "/auth/bootstrap") {
      return sessionActive
        ? json(session)
        : json({ code: "auth_session_expired", message: "Authentication is required." }, 401);
    }
    if (path === "/v1/marketplace-intro") return json({ completedAt: null });
    if (path === "/auth/pin/signup" && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({
        method: "phone",
        contact: phone,
        country: "KE",
        pin
      });
      signupCount += 1;
      sessionActive = true;
      return json(session);
    }
    if (path === "/auth/pin/login" && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({
        method: "phone",
        contact: phone,
        country: "KE",
        pin
      });
      loginCount += 1;
      sessionActive = true;
      return json(session);
    }
    if (path === "/v1/e2ee/devices" && request.method() === "POST") {
      return json({ id: "pin-browser-device", accountId: session.account.id });
    }
    if (path === "/v1/conversations" && request.method() === "GET") {
      return json({ conversations: [] });
    }

    return json(
      { message: `The PIN auth test does not provide ${request.method()} ${path}.` },
      404
    );
  });

  await page.addInitScript(() => {
    localStorage.setItem("soko.market.marketplace-intro.completed.v1", "true");
  });
  await page.goto("/marketplace");
  await page.getByRole("button", { name: "Browse marketplace as guest" }).click();

  const welcome = page.getByTestId("welcome-message");
  await expect(welcome).toBeVisible();
  await expect(page.getByTestId("welcome-signup-button")).toBeVisible();
  await expect(page.getByTestId("welcome-login-button")).toBeVisible();

  await page.getByTestId("welcome-signup-button").click();
  await expect(page.getByRole("heading", { name: "Create your Soko account" })).toBeVisible();
  await page.getByLabel("Phone number").fill("712345678");
  await page.getByRole("button", { name: "Continue to sign up" }).click();
  await expect(page.getByLabel("4-digit PIN")).toHaveAttribute("autocomplete", "new-password");
  await page.getByLabel("4-digit PIN").fill(pin);
  await page.getByRole("button", { name: "Sign up", exact: true }).click();

  await expect.poll(() => signupCount).toBe(1);
  await expect(page.getByText("Authentication complete", { exact: true })).toBeVisible();

  sessionActive = false;
  await page.evaluate(() => localStorage.removeItem("soko.market.auth-bootstrap.v1"));
  await page.reload();

  await expect(page.getByRole("heading", { name: "Log in to Soko" })).toBeVisible();
  await page.getByLabel("Phone number").fill("712345678");
  await page.getByRole("button", { name: "Continue to log in" }).click();
  await expect(page.getByLabel("4-digit PIN")).toHaveAttribute("autocomplete", "current-password");
  await page.getByLabel("4-digit PIN").fill(pin);
  await page.getByRole("button", { name: "Log in", exact: true }).click();

  await expect.poll(() => loginCount).toBe(1);
  await expect(page.getByText("Authentication complete", { exact: true })).toBeVisible();
});
