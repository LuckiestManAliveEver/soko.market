const BEARER_PREFIX = "Bearer ";

/**
 * Mirrors services/ai-runtime/src/app.ts's validAuthorization: compare SHA-256 digests
 * (fixed-length regardless of input length) rather than the raw strings, so neither the
 * token's length nor its content leaks through timing. Web Crypto's digest() replaces
 * Node's createHash/timingSafeEqual, which aren't available without nodejs_compat.
 */
export async function isAuthorized(
  authorizationHeader: string | null,
  expectedToken: string
): Promise<boolean> {
  if (authorizationHeader === null || !authorizationHeader.startsWith(BEARER_PREFIX)) {
    return false;
  }
  const candidate = authorizationHeader.slice(BEARER_PREFIX.length);
  const [expectedDigest, candidateDigest] = await Promise.all([
    digest(expectedToken),
    digest(candidate)
  ]);
  return timingSafeEqual(expectedDigest, candidateDigest);
}

async function digest(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(hash);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}
