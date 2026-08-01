import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

export interface ChallengeResult {
  challengeId: string;
  expiresAt: string;
  developmentCode?: string;
}

export interface VerificationResult {
  verified: boolean;
}

export interface PhoneVerificationProvider {
  readonly exposesDevelopmentCode: boolean;
  sendChallenge(phoneE164: string): Promise<ChallengeResult>;
  verifyChallenge(
    phoneE164: string,
    challengeId: string,
    code: string
  ): Promise<VerificationResult>;
}

interface DevelopmentChallenge {
  phoneHash: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  consumed: boolean;
}

/** Local/test adapter. It never stores a plaintext verification code. */
export class DevelopmentPhoneVerificationProvider implements PhoneVerificationProvider {
  readonly exposesDevelopmentCode = true;
  private readonly challenges = new Map<string, DevelopmentChallenge>();

  async sendChallenge(phoneE164: string): Promise<ChallengeResult> {
    const challengeId = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const expiresAt = Date.now() + 5 * 60_000;
    this.challenges.set(challengeId, {
      phoneHash: hash(phoneE164),
      codeHash: hash(`${challengeId}:${code}:${verificationSecret()}`),
      expiresAt,
      attempts: 0,
      consumed: false
    });
    return { challengeId, expiresAt: new Date(expiresAt).toISOString(), developmentCode: code };
  }

  async verifyChallenge(
    phoneE164: string,
    challengeId: string,
    code: string
  ): Promise<VerificationResult> {
    const challenge = this.challenges.get(challengeId);
    if (
      challenge === undefined ||
      challenge.consumed ||
      challenge.expiresAt <= Date.now() ||
      challenge.attempts >= 5 ||
      !safeEqual(challenge.phoneHash, hash(phoneE164))
    ) {
      return { verified: false };
    }
    challenge.attempts += 1;
    const verified = safeEqual(
      challenge.codeHash,
      hash(`${challengeId}:${code.trim()}:${verificationSecret()}`)
    );
    if (verified) challenge.consumed = true;
    return { verified };
  }
}

/** Generic webhook adapter for an SMS vendor gateway owned by the deployment. */
export class WebhookPhoneVerificationProvider implements PhoneVerificationProvider {
  readonly exposesDevelopmentCode = false;
  constructor(
    private readonly endpoint: string,
    private readonly secret: string
  ) {}

  async sendChallenge(phoneE164: string): Promise<ChallengeResult> {
    return this.request<ChallengeResult>("send", { phoneE164 });
  }

  async verifyChallenge(
    phoneE164: string,
    challengeId: string,
    code: string
  ): Promise<VerificationResult> {
    return this.request<VerificationResult>("verify", { phoneE164, challengeId, code });
  }

  private async request<T>(action: string, body: Record<string, string>): Promise<T> {
    const response = await fetch(`${this.endpoint.replace(/\/+$/u, "")}/${action}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.secret}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error("Phone verification provider request failed.");
    return (await response.json()) as T;
  }
}

export function createPhoneVerificationProviderFromEnvironment(): PhoneVerificationProvider {
  const endpoint = process.env.PHONE_VERIFICATION_WEBHOOK_URL?.trim();
  const secret = process.env.PHONE_VERIFICATION_WEBHOOK_SECRET?.trim();
  if (endpoint && secret && secret.length >= 32) {
    return new WebhookPhoneVerificationProvider(endpoint, secret);
  }
  if (process.env.NODE_ENV === "production") {
    return new UnavailablePhoneVerificationProvider();
  }
  return new DevelopmentPhoneVerificationProvider();
}

class UnavailablePhoneVerificationProvider implements PhoneVerificationProvider {
  readonly exposesDevelopmentCode = false;
  async sendChallenge(): Promise<ChallengeResult> {
    throw new Error("Phone verification is not configured.");
  }
  async verifyChallenge(): Promise<VerificationResult> {
    return { verified: false };
  }
}

function verificationSecret(): string {
  return process.env.OTP_HMAC_SECRET?.trim() || "soko-market-local-phone-verification-secret";
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
