import { createVerify } from "node:crypto";
import type { AuthChannel } from "@soko/shared-types";
import { Cp2Error } from "./store.js";

export type OtpDeliveryChannel = "sms";

export interface OtpProvider {
  readonly name: string;
  readonly exposesDevOtp: boolean;
  readonly verifiesExternally: boolean;
  canHandle(channel: AuthChannel): boolean;
  requestOtp(input: {
    channel: AuthChannel;
    deliveryChannel: OtpDeliveryChannel;
    destination: string;
  }): Promise<void>;
  verifyOtp(input: { channel: AuthChannel; destination: string; code: string }): Promise<boolean>;
}

interface FirebasePhoneOtpConfig {
  projectId: string;
}

interface FirebaseTokenHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface FirebaseTokenPayload {
  aud?: string;
  exp?: number;
  firebase?: {
    sign_in_provider?: string;
  };
  iat?: number;
  iss?: string;
  phone_number?: string;
  sub?: string;
}

const FIREBASE_CERT_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const FIREBASE_CERT_TTL_MS = 60 * 60 * 1000;

let cachedFirebaseCertificates: {
  fetchedAt: number;
  certs: Record<string, string>;
} | null = null;

class LocalOtpProvider implements OtpProvider {
  readonly name = "local";
  readonly exposesDevOtp = true;
  readonly verifiesExternally = false;

  canHandle(): boolean {
    return true;
  }

  async requestOtp(input: {
    channel: AuthChannel;
    deliveryChannel: OtpDeliveryChannel;
    destination: string;
  }): Promise<void> {
    void input;
  }

  async verifyOtp(): Promise<boolean> {
    return false;
  }
}

class UnconfiguredPhoneOtpProvider implements OtpProvider {
  readonly name = "firebase_phone_unconfigured";
  readonly exposesDevOtp = false;
  readonly verifiesExternally = true;

  canHandle(channel: AuthChannel): boolean {
    return channel === "phone";
  }

  async requestOtp(input: {
    channel: AuthChannel;
    deliveryChannel: OtpDeliveryChannel;
    destination: string;
  }): Promise<void> {
    void input;
    throw new Cp2Error(
      503,
      "firebase_phone_auth_unconfigured",
      "Firebase phone authentication is not configured on the server."
    );
  }

  async verifyOtp(): Promise<boolean> {
    return false;
  }
}

class FirebasePhoneOtpProvider implements OtpProvider {
  readonly name = "firebase_phone";
  readonly exposesDevOtp = false;
  readonly verifiesExternally = true;

  constructor(private readonly config: FirebasePhoneOtpConfig) {}

  canHandle(channel: AuthChannel): boolean {
    return channel === "phone";
  }

  async requestOtp(input: {
    channel: AuthChannel;
    deliveryChannel: OtpDeliveryChannel;
    destination: string;
  }): Promise<void> {
    if (!this.canHandle(input.channel)) {
      throw new Cp2Error(400, "otp_channel_unsupported", "Firebase phone OTP only handles phone.");
    }

    if (input.deliveryChannel !== "sms") {
      throw new Cp2Error(400, "otp_delivery_channel_invalid", "Firebase phone OTP uses SMS only.");
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

    try {
      const payload = await verifyFirebaseIdToken(input.code, this.config.projectId);

      return (
        payload !== null &&
        payload.firebase?.sign_in_provider === "phone" &&
        typeof payload.phone_number === "string" &&
        payload.phone_number === input.destination
      );
    } catch {
      return false;
    }
  }
}

function decodeBase64UrlJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

function readHeaderAndPayload(token: string): {
  header: FirebaseTokenHeader;
  payload: FirebaseTokenPayload;
  signingInput: string;
  signature: Buffer;
} | null {
  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  try {
    const [header, payload, signature] = parts as [string, string, string];

    return {
      header: decodeBase64UrlJson<FirebaseTokenHeader>(header),
      payload: decodeBase64UrlJson<FirebaseTokenPayload>(payload),
      signingInput: `${header}.${payload}`,
      signature: Buffer.from(signature, "base64url")
    };
  } catch {
    return null;
  }
}

async function getFirebaseCertificates(): Promise<Record<string, string>> {
  const now = Date.now();

  if (
    cachedFirebaseCertificates !== null &&
    now - cachedFirebaseCertificates.fetchedAt < FIREBASE_CERT_TTL_MS
  ) {
    return cachedFirebaseCertificates.certs;
  }

  const response = await fetch(FIREBASE_CERT_URL, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error("Failed to fetch Firebase public certificates.");
  }

  const certs = (await response.json()) as Record<string, string>;
  cachedFirebaseCertificates = {
    fetchedAt: now,
    certs
  };

  return certs;
}

async function verifyFirebaseIdToken(
  token: string,
  projectId: string
): Promise<FirebaseTokenPayload | null> {
  const parsed = readHeaderAndPayload(token);

  if (parsed === null) {
    return null;
  }

  if (parsed.header.alg !== "RS256" || typeof parsed.header.kid !== "string") {
    return null;
  }

  const certs = await getFirebaseCertificates();
  const certificate = certs[parsed.header.kid];

  if (typeof certificate !== "string" || certificate.length === 0) {
    return null;
  }

  const verifier = createVerify("RSA-SHA256");
  verifier.update(parsed.signingInput);
  verifier.end();

  if (!verifier.verify(certificate, parsed.signature)) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;

  if (
    parsed.payload.aud !== projectId ||
    parsed.payload.iss !== expectedIssuer ||
    typeof parsed.payload.sub !== "string" ||
    parsed.payload.sub.length === 0 ||
    typeof parsed.payload.exp !== "number" ||
    parsed.payload.exp <= now ||
    typeof parsed.payload.iat !== "number" ||
    parsed.payload.iat > now + 300
  ) {
    return null;
  }

  return parsed.payload;
}

export function createOtpProviderFromEnvironment(env = process.env): OtpProvider {
  const projectId = env.FIREBASE_PROJECT_ID?.trim();

  if (projectId !== undefined && projectId.length > 0) {
    return new FirebasePhoneOtpProvider({
      projectId
    });
  }

  if (env.NODE_ENV?.trim() === "production") {
    return new UnconfiguredPhoneOtpProvider();
  }

  return new LocalOtpProvider();
}
