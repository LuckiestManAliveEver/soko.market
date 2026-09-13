import type { AuthBootstrapState } from "../../packages/shared-types/src";

export interface AgentSessionAuthScenario {
  name: string;
  bootstrapState: AuthBootstrapState;
  serverSessionCreationAllowed: boolean;
}

/** Frozen lifecycle cases for the agent-session authentication regression. */
export const agentSessionAuthScenarios: AgentSessionAuthScenario[] = [
  {
    name: "bootstrap has not started evaluating any session yet",
    bootstrapState: "initializing",
    serverSessionCreationAllowed: false
  },
  {
    name: "cached PWA identity has not been validated",
    bootstrapState: "offline-authenticated",
    serverSessionCreationAllowed: false
  },
  {
    name: "canonical bootstrap is refreshing credentials",
    bootstrapState: "restoring-session",
    serverSessionCreationAllowed: false
  },
  {
    name: "an already-authenticated session is silently rotating its refresh token",
    bootstrapState: "refreshing-session",
    serverSessionCreationAllowed: false
  },
  {
    name: "network bootstrap failed while cached data remains visible",
    bootstrapState: "failed",
    serverSessionCreationAllowed: false
  },
  {
    name: "refresh was rejected and login is required",
    bootstrapState: "reauthentication-required",
    serverSessionCreationAllowed: false
  },
  {
    name: "bootstrap completed and found no session at all",
    bootstrapState: "unauthenticated",
    serverSessionCreationAllowed: false
  },
  {
    name: "canonical bootstrap validated the HTTP-only cookie family",
    bootstrapState: "authenticated",
    serverSessionCreationAllowed: true
  }
];
