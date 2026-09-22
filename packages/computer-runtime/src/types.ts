/**
 * Provider-neutral domain types for Soko's ComputerRuntime (computer-use / browser-automation
 * capability). Nothing in this file may name Stagehand, Playwright, Browserbase, Browser Use, or
 * any other provider implementation - see docs/adr/ADR-computer-runtime-ownership.md for why. A
 * provider adapter (packages/computer-runtime/src/provider.ts) translates between these types and
 * whatever a concrete browser-automation implementation needs.
 *
 * Naming note: "browser" already means something else in this repository (client-side WebLLM
 * inference - see apps/web/src/webllm-runtime.ts, docs/architecture/browser-inference.md). This
 * module consistently says "computer" instead, per docs/architecture/computer-runtime-audit.md §8.
 */

/** Where a ComputerSession's browser process actually runs. Always a worker isolated from the
 *  main API process (docs/architecture/computer-runtime.md §"Deployment"); never a value the
 *  model can choose. */
export type ComputerProviderKind = "local-cdp" | "remote-worker";

export type ComputerSessionStatus =
  | "CREATING"
  | "READY"
  | "NAVIGATING"
  | "AWAITING_APPROVAL"
  | "HUMAN_CONTROLLED"
  | "SUSPENDED"
  | "RESUMING"
  | "CLOSED"
  | "FAILED";

/** Who is currently allowed to drive the session. Section 11 of the task brief: mutually
 *  exclusive, atomically transitioned, never both at once. */
export type ComputerControlMode = "AGENT" | "HUMAN" | "SUSPENDED";

/** Static registry-level risk lives on RuntimeToolDefinition (packages/tool-core). This is the
 *  dynamic, per-call classification a proposed action gets from ComputerActionPolicy, independent
 *  of which generic tool name (click/type/upload) carried it - see policy.ts. */
export type ComputerActionClass = "READ" | "MUTATE" | "CONSEQUENTIAL" | "BLOCKED";

export interface ComputerTarget {
  /** Human/model-readable description of the element, e.g. "Send button", "message input". Never
   *  raw arbitrary JS or a CSS selector the model invents freely - the provider resolves this
   *  against the last observation's accessibility tree. */
  description: string;
  /** Optional stable reference returned by a prior observe() call (e.g. an accessibility-tree
   *  node id), when the caller has one. */
  ref?: string;
}

export interface ComputerObservation {
  sessionId: string;
  url: string;
  title: string;
  /** Data-URI screenshot (downscaled, jpeg) for the live-view surface. Never expected to contain
   *  credential UI in cleartext beyond what the page itself renders. */
  screenshotDataUrl: string | null;
  /** A simplified, size-bounded accessibility/text summary of the page - what the model is
   *  actually allowed to read. Always UNTRUSTED - see redaction.ts and
   *  docs/architecture/computer-runtime-security.md §"Prompt injection". */
  contentSummary: string;
  /** Elements the model may reference by description/ref in a subsequent click/type/upload call. */
  interactiveElements: ComputerInteractiveElement[];
  capturedAt: string;
}

export interface ComputerInteractiveElement {
  ref: string;
  role: string;
  name: string;
  /** True for password/OTP/card-number-shaped fields; the domain refuses to type into these
   *  regardless of policy classification (task brief §8/§27: the model must never handle
   *  credentials). */
  sensitive: boolean;
}

export interface ComputerActionResult {
  sessionId: string;
  status: "EXECUTED" | "AWAITING_APPROVAL" | "REJECTED" | "OUTCOME_UNKNOWN";
  observation: ComputerObservation | null;
  /** Present only when status is AWAITING_APPROVAL. */
  approvalId?: string;
  /** Present only when status is REJECTED or OUTCOME_UNKNOWN. */
  reason?: string;
}

export interface ComputerSession {
  id: string;
  businessId: string;
  accountId: string;
  /** The owning conversation ("task", per RuntimeHandoff's vocabulary - Soko has no separate
   *  tasks entity, see docs/runtime/runtime-handoff.md). Required: a computer session always
   *  checkpoints into that conversation's RuntimeHandoff chain. */
  conversationId: string;
  profileId: string | null;
  status: ComputerSessionStatus;
  controlMode: ComputerControlMode;
  currentUrl: string | null;
  createdAt: string;
  updatedAt: string;
  /** The most recent RuntimeHandoff checkpoint id this session's progress was captured into, if
   *  any (docs/runtime/runtime-handoff.md). */
  lastCheckpointId: string | null;
}

/** The public (never-secret) view of a persistent, per-account browser profile. Mirrors
 *  ExternalConnectionRecord's shape (services/api/src/cp2/domains/external-connections/shared.ts):
 *  encrypted material never leaves the owning domain except through decrypt-for-worker-only. */
export interface ComputerProfile {
  id: string;
  accountId: string;
  label: string;
  /** Registrable domain this profile is scoped to, e.g. "instagram.com". Profiles are per-site,
   *  never a single credential store for the whole web (task brief §12/§27: no social-network
   *  special-casing, but also no blanket cross-site credential sharing). */
  site: string;
  status: "CONNECTED" | "DISCONNECTED" | "NEEDS_REAUTH";
  createdAt: string;
  updatedAt: string;
}

export type ComputerApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "EXECUTED";

/** A consequential action awaiting explicit user approval, bound to the exact action proposed -
 *  see policy.ts's canonicalizeComputerAction / hashComputerAction. Never re-derived from
 *  client-supplied input on approve; the stored `action` is authoritative. */
export interface ComputerApproval {
  id: string;
  sessionId: string;
  businessId: string;
  accountId: string;
  status: ComputerApprovalStatus;
  actionClass: ComputerActionClass;
  toolName: string;
  action: Record<string, unknown>;
  actionHash: string;
  summary: string;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  executedAt: string | null;
}

export interface CreateSessionInput {
  sessionId: string;
  businessId: string;
  accountId: string;
  conversationId: string;
  profileId: string | null;
  startUrl: string | null;
}

export interface NavigateInput {
  sessionId: string;
  url: string;
}

export interface ObserveInput {
  sessionId: string;
}

export interface ClickInput {
  sessionId: string;
  target: ComputerTarget;
}

export interface TypeInput {
  sessionId: string;
  target: ComputerTarget;
  text: string;
  /** True to submit (press Enter) after typing - kept a distinct explicit flag rather than
   *  overloading `text` with a trailing "\n", so policy can reason about it as its own signal. */
  submit?: boolean;
}

export interface ScrollInput {
  sessionId: string;
  direction: "up" | "down";
  amountPx?: number;
}

export interface UploadInput {
  sessionId: string;
  target: ComputerTarget;
  /** Content is resolved server-side from an already-authorized attachment reference, never a raw
   *  path the model supplies - mirrors workspace.deliver's attachment handling. */
  attachmentId: string;
  fileName: string;
  contentBase64: string;
  contentType: string;
}
