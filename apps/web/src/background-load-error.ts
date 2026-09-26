import { ApiRequestError } from "./lib/api";
import { getErrorMessage } from "./chat-message-plumbing";

// Background loads of a shop's data (products, invoices, logistics...) run for every member of
// the shop, but staff roles cannot read everything: a driver has no invoices, a cashier no
// suppliers. A 403 on such a read is the role working as designed, not something to announce in
// the status line; any other failure still is (docs/architecture/staff-invitations.md).
export function reportBackgroundLoadError(
  setStatusMessage: (message: string) => void,
  error: unknown
): void {
  // Only "your role cannot read this". Losing membership (removed from the shop) is different and
  // still reported, so a removed member is told rather than left looking at stale data.
  if (
    error instanceof ApiRequestError &&
    error.status === 403 &&
    error.code === "permission_denied"
  ) {
    return;
  }
  setStatusMessage(getErrorMessage(error));
}
