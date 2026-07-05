import type { AuthChannel } from "@soko/shared-types";
import { Cp2Error } from "./store.js";

export interface OtpProvider {
  readonly name: string;
  readonly exposesDevOtp: boolean;
  readonly verifiesExternally: boolean;
  canHandle(channel: AuthChannel): boolean;
  requestOtp(input: { channel: AuthChannel; destination: string }): Promise<void>;
  verifyOtp(input: { channel: AuthChannel; destination: string; code: string }): Promise<boolean>;
}

interface TwilioVerifyConfig {
  accountSid: string;
  authToken: string;
  serviceSid: string;
}

interface TwilioVerificationResponse {
  status?: string;
  message?: string;
  code?: number;
}

class LocalOtpProvider implements OtpProvider {
  readonly name = "local";
  readonly exposesDevOtp = true;
  readonly verifiesExternally = false;

  canHandle(): boolean {
    return true;
  }

  async requestOtp(): Promise<void> {
    return;
  }

  async verifyOtp(): Promise<boolean> {
    return false;
  }
}

export class TwilioVerifyOtpProvider implements OtpProvider {
  readonly name = "twilio_verify";
  readonly exposesDevOtp = false;
  readonly verifiesExternally = true;
  private readonly authHeader: string;

  constructor(private readonly config: TwilioVerifyConfig) {
    this.authHeader = `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString(
      "base64"
    )}`;
  }

  canHandle(channel: AuthChannel): boolean {
    return channel === "phone";
  }

  async requestOtp(input: { channel: AuthChannel; destination: string }): Promise<void> {
    if (!this.canHandle(input.channel)) {
      throw new Cp2Error(400, "otp_channel_unsupported", "Twilio Verify only handles phone OTP.");
    }

    const response = await this.postTwilio("Verifications", {
      To: input.destination,
      Channel: "sms"
    });

    if (response.status !== "pending" && response.status !== "approved") {
      throw new Cp2Error(502, "otp_provider_failed", "Twilio did not start OTP verification.");
    }
  }

  async verifyOtp(input: {
    channel: AuthChannel;
    destination: string;
    code: string;
  }): Promise<boolean> {
    if (!this.canHandle(input.channel)) {
      return false;
    }

    const response = await this.postTwilio("VerificationCheck", {
      To: input.destination,
      Code: input.code
    });

    return response.status === "approved";
  }

  private async postTwilio(
    resource: "Verifications" | "VerificationCheck",
    values: Record<string, string>
  ): Promise<TwilioVerificationResponse> {
    const body = new URLSearchParams(values);
    const response = await fetch(
      `https://verify.twilio.com/v2/Services/${this.config.serviceSid}/${resource}`,
      {
        method: "POST",
        headers: {
          authorization: this.authHeader,
          "content-type": "application/x-www-form-urlencoded"
        },
        body
      }
    );
    const payload = (await response.json().catch(() => ({}))) as TwilioVerificationResponse;

    if (!response.ok) {
      throw new Cp2Error(
        response.status >= 500 ? 502 : 400,
        "otp_provider_failed",
        payload.message ?? "Twilio OTP request failed."
      );
    }

    return payload;
  }
}

export function createOtpProviderFromEnvironment(env = process.env): OtpProvider {
  const enabled = env.TWILIO_VERIFY_ENABLED?.trim().toLowerCase() === "true";
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  const serviceSid = env.TWILIO_VERIFY_SERVICE_SID?.trim();

  if (enabled && accountSid !== undefined && authToken !== undefined && serviceSid !== undefined) {
    return new TwilioVerifyOtpProvider({
      accountSid,
      authToken,
      serviceSid
    });
  }

  return new LocalOtpProvider();
}
