import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApi } from "../services/api/src/app";
import {
  createEmailProviderFromEnvironment,
  type EmailOtpInput,
  type EmailProvider
} from "../services/api/src/cp2/email-provider";
import { createCp2Store } from "../services/api/src/cp2/store";

describe("transactional email API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends signup OTPs and privacy-preserving encrypted-message notifications through Resend", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ id: "email-test-1" }), { status: 200 });
      })
    );
    const provider = createEmailProviderFromEnvironment({
      NODE_ENV: "production",
      RESEND_API_KEY: "re_mock_api_key",
      SOKO_EMAIL_FROM: "Soko <messages@soko.test>"
    });

    await provider.sendOtp({
      challengeId: "challenge-email-1",
      code: "483921",
      expiresAt: "2026-07-17T15:00:00.000Z",
      to: "email-user@example.test"
    });
    await expect(
      provider.sendEncryptedMessageNotification({
        conversationId: "conversation-email-1",
        messageId: "message-email-1",
        openUrl: "https://soko.market/?conversation=conversation-email-1",
        to: "email-user@example.test"
      })
    ).resolves.toBe("sent");

    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe("https://api.resend.com/emails");
    expect(requests[0]?.init.headers).toMatchObject({
      authorization: "Bearer re_mock_api_key",
      "idempotency-key": "otp-challenge-email-1"
    });
    const otpBody = JSON.parse(String(requests[0]?.init.body)) as Record<string, unknown>;
    expect(otpBody).toMatchObject({
      from: "Soko <messages@soko.test>",
      to: ["email-user@example.test"],
      subject: "Your Soko verification code"
    });
    expect(otpBody.text).toContain("483921");

    const notificationBody = JSON.parse(String(requests[1]?.init.body)) as Record<string, unknown>;
    expect(notificationBody.text).toContain("end-to-end encrypted");
    expect(notificationBody.text).toContain("https://soko.market/?conversation=");
    expect(notificationBody.text).not.toContain("private phone to email message");
  });

  it("fails closed for production email signup when the email API is unconfigured", async () => {
    const provider = createEmailProviderFromEnvironment({ NODE_ENV: "production" });

    expect(provider.exposesDevOtp).toBe(false);
    await expect(
      provider.sendOtp({
        challengeId: "challenge-email-2",
        code: "123456",
        expiresAt: "2026-07-17T15:00:00.000Z",
        to: "email-user@example.test"
      })
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "email_api_unconfigured"
    });
  });

  it("routes email signup OTP through the email provider without exposing the code", async () => {
    const deliveries: EmailOtpInput[] = [];
    const emailProvider: EmailProvider = {
      name: "mock-email-api",
      exposesDevOtp: false,
      sendOtp: async (input) => {
        deliveries.push(input);
      },
      sendEncryptedMessageNotification: async () => "sent"
    };
    const app = buildApi({ cp2: { store: createCp2Store(), emailProvider } });
    const requested = await app.inject({
      method: "POST",
      url: "/auth/otp/request",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        method: "email",
        contact: "mock-email-api@example.test",
        deliveryChannel: "email",
        purpose: "signup"
      })
    });

    expect(requested.statusCode).toBe(200);
    expect(requested.json()).not.toHaveProperty("devOtp");
    expect(deliveries).toEqual([
      expect.objectContaining({
        challengeId: requested.json<{ challengeId: string }>().challengeId,
        to: "mock-email-api@example.test"
      })
    ]);

    const verified = await app.inject({
      method: "POST",
      url: "/auth/otp/verify",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        challengeId: requested.json<{ challengeId: string }>().challengeId,
        code: deliveries[0]?.code
      })
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.headers["set-cookie"]).toBeDefined();
    await app.close();
  });
});
