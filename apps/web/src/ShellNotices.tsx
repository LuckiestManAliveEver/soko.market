import type { AccountShopSummary } from "@soko/shared-types";
import { AuthenticationActionMessage } from "./AuthenticationActionMessage";
import { isRedundantAgentErrorMessage } from "./chat-message-plumbing";
import StaffInvitationsPrompt from "./StaffInvitationsPrompt";

// The notices at the top of the app shell: the last action's status line, and invitations to
// join a business waiting for the signed-in person (docs/architecture/staff-invitations.md).
// Extracted from SokoApplication so the shell stays within its modularity budget.
export default function ShellNotices(props: {
  /** Empty hides the status line (for example on the sign-in screens). */
  statusMessage: string;
  working: boolean;
  /** The signed-in account, or null while signing in, bootstrapping or signed out. */
  accountId: string | null;
  onJoinedShop: (shop: AccountShopSummary) => Promise<void> | void;
}) {
  return (
    <>
      {props.statusMessage.length > 0 && !isRedundantAgentErrorMessage(props.statusMessage) ? (
        <div className="app-action-notice" role="status" aria-live="polite">
          {props.working ? (
            "Working…"
          ) : (
            <AuthenticationActionMessage message={props.statusMessage} />
          )}
        </div>
      ) : null}
      {props.accountId === null ? null : (
        <StaffInvitationsPrompt accountId={props.accountId} onJoined={props.onJoinedShop} />
      )}
    </>
  );
}
