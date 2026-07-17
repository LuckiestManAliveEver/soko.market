import { expect, test } from "@playwright/test";

test("signs up and later logs in with the same email and PIN", async ({ page }) => {
  const email = "browser.email@example.test";
  const pin = "2468";
  let sessionActive = false;
  let hasPin = false;
  let emailLoginCount = 0;

  const session = {
    account: {
      id: "email-browser-account",
      primaryAuthChannel: "email",
      primaryAuthDestination: email
    },
    user: { id: "email-browser-user", displayName: email, language: "en" },
    session: { expiresAt: "2099-01-01T00:00:00.000Z" }
  };

  await page.route("http://127.0.0.1:4000/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/auth/oauth/providers") return json({ providers: [] });
    if (path === "/session") {
      return sessionActive
        ? json(session)
        : json({ code: "auth_required", message: "Authentication is required." }, 401);
    }
    if (path === "/v1/marketplace-intro") return json({ completedAt: null });
    if (path === "/auth/otp/request" && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      expect(body).toMatchObject({
        method: "email",
        contact: email,
        deliveryChannel: "email",
        purpose: "signup"
      });
      return json({
        challengeId: "email-signup-challenge",
        destination: email,
        expiresAt: "2099-01-01T00:05:00.000Z",
        devOtp: "123456"
      });
    }
    if (path === "/auth/otp/verify" && request.method() === "POST") {
      expect(request.postDataJSON()).toMatchObject({
        method: "email",
        contact: email,
        challengeId: "email-signup-challenge",
        otp: "123456"
      });
      sessionActive = true;
      return json(session);
    }
    if (path === "/auth/pin/status") return json({ hasPin });
    if (path === "/auth/pin/setup" && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({ pin });
      hasPin = true;
      return json(session);
    }
    if (path === "/auth/pin/login" && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({ method: "email", contact: email, pin });
      emailLoginCount += 1;
      sessionActive = true;
      return json(session);
    }
    if (path === "/v1/e2ee/devices" && request.method() === "POST") {
      return json({ id: "email-browser-device", accountId: session.account.id });
    }
    if (path === "/v1/conversations" && request.method() === "GET") {
      return json({ conversations: [] });
    }

    return json(
      { message: `The email auth test does not provide ${request.method()} ${path}.` },
      404
    );
  });

  await page.addInitScript(() => {
    localStorage.setItem("soko.market.marketplace-intro.completed.v1", "true");
  });
  await page.goto("/marketplace");
  await page.getByTestId("welcome-message").getByRole("button", { name: "Sign up" }).click();
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send email code" }).click();
  await page.getByRole("button", { name: "Verify email" }).click();

  await expect(page.getByRole("heading", { name: "Create your owner PIN" })).toBeVisible();
  await page.getByLabel("PIN", { exact: true }).fill(pin);
  await page.getByLabel("Confirm PIN").fill(pin);
  await page.getByRole("button", { name: "Finish signup" }).click();
  await expect(page.getByRole("heading", { name: "Set up your business" })).toHaveCount(0);

  sessionActive = false;
  await page.reload();
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByLabel("Email address")).toHaveValue(email);
  await page.getByLabel("PIN", { exact: true }).fill(pin);
  await page.getByRole("button", { name: "Sign in with email" }).click();

  await expect.poll(() => emailLoginCount).toBe(1);
  await expect(page.getByText("Login complete", { exact: true })).toBeVisible();
});
