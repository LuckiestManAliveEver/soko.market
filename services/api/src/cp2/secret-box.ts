import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { Cp2Error } from "./cp2-error.js";

/**
 * The API's one at-rest secret envelope: AES-256-GCM under AUTH_TOKEN_ENCRYPTION_KEY /
 * OAUTH_TOKEN_ENCRYPTION_KEY, serialized as "v1:<iv>:<tag>:<ciphertext>". Used for OAuth tokens,
 * external registry connections, and inference provider credentials. Split out of oauth.ts (which
 * re-exports these names unchanged) so modules outside the OAuth flow can reuse it without
 * importing store.ts transitively.
 */
export const secretEnvelopeKeyVersion = 1;

export function encryptOAuthToken(token: string): string {
  const key = getTokenEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptOAuthToken(value: string): string {
  const [version, ivValue, tagValue, encryptedValue] = value.split(":");

  if (
    version !== "v1" ||
    ivValue === undefined ||
    tagValue === undefined ||
    encryptedValue === undefined
  ) {
    throw new Cp2Error(500, "oauth_token_invalid", "Encrypted OAuth token is invalid.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getTokenEncryptionKey(),
    Buffer.from(ivValue, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function getTokenEncryptionKey(): Buffer {
  const configured =
    process.env.AUTH_TOKEN_ENCRYPTION_KEY?.trim() ?? process.env.OAUTH_TOKEN_ENCRYPTION_KEY?.trim();
  if (
    (configured === undefined || configured.length < 32) &&
    process.env.NODE_ENV === "production"
  ) {
    throw new Cp2Error(
      503,
      "oauth_token_encryption_unconfigured",
      "OAuth token storage is not configured."
    );
  }
  const source =
    configured === undefined || configured.length < 32
      ? "soko-market-local-oauth-token-encryption-key"
      : configured;

  return createHash("sha256").update(source).digest();
}
