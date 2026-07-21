export type ModelActivationState =
  | "idle"
  | "validating-installation"
  | "resolving-agent"
  | "creating-runtime-session"
  | "initializing-backend"
  | "loading-model"
  | "warming-model"
  | "binding-agent"
  | "health-checking"
  | "active"
  | "failed";

export function modelActivationMessage(state: ModelActivationState): string {
  const messages: Record<ModelActivationState, string> = {
    idle: "Use model",
    "validating-installation": "Checking installation…",
    "resolving-agent": "Restoring your agent…",
    "creating-runtime-session": "Starting model runtime…",
    "initializing-backend": "Preparing model backend…",
    "loading-model": "Loading model…",
    "warming-model": "Preparing model…",
    "binding-agent": "Connecting to agent…",
    "health-checking": "Testing model…",
    active: "Active",
    failed: "Retry activation"
  };
  return messages[state];
}
