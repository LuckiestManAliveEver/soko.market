import type { AuthBootstrapState, AuthSessionView } from "@soko/shared-types";

const cachedSessionKey = "soko.market.auth-bootstrap.v1";

export interface CachedAuthSession {
  account: AuthSessionView["account"];
  user: AuthSessionView["user"];
  session: AuthSessionView["session"];
  cachedAt: string;
}

export function isAuthBootstrapPending(state: AuthBootstrapState): boolean {
  return (
    state === "initializing" || state === "restoring-session" || state === "refreshing-session"
  );
}

export function saveCachedAuthSession(session: AuthSessionView): CachedAuthSession {
  const cached = { ...session, cachedAt: new Date().toISOString() };
  localStorage.setItem(cachedSessionKey, JSON.stringify(cached));
  return cached;
}

export function readCachedAuthSession(): CachedAuthSession | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(cachedSessionKey) ?? "null");
    if (!isCachedAuthSession(value)) return null;
    return value;
  } catch {
    return null;
  }
}

export function clearCachedAuthSession(): void {
  localStorage.removeItem(cachedSessionKey);
}

export function bootstrapProgressMessage(
  state: AuthBootstrapState,
  hasBusiness: boolean,
  hasAgent: boolean
): string {
  if (state === "initializing") return "Opening your shop…";
  if (state === "restoring-session") return "Restoring your session…";
  if (state === "refreshing-session") return "Refreshing your secure session…";
  if (hasBusiness && !hasAgent) return "Starting your agent…";
  if (hasBusiness) return "Loading local model…";
  return "Opening Soko.market…";
}

function isCachedAuthSession(value: unknown): value is CachedAuthSession {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CachedAuthSession>;
  return (
    typeof candidate.account?.id === "string" &&
    typeof candidate.user?.id === "string" &&
    typeof candidate.session?.id === "string" &&
    typeof candidate.session?.expiresAt === "string" &&
    typeof candidate.cachedAt === "string"
  );
}
