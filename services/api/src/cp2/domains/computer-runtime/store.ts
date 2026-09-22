/**
 * ComputerRuntime domain (docs/architecture/computer-runtime.md). Owns session/profile/approval
 * state and is the ONLY place in services/api that is authorized to invoke a
 * ComputerRuntimeProvider. Like every other CP2 domain, this is an in-memory, synchronously
 * mutated store (see runtime-handoff/store.ts's header comment for why that is safe under this
 * repository's single-writer-process deployment model - docs/single-instance-store-ceiling.md).
 *
 * Every method here enforces, in order: business/account authorization, session ownership,
 * control-mode (agent actions are rejected while a human holds control), then the consequential-
 * action policy (packages/computer-runtime/src/policy.ts) before ever calling the provider. The
 * provider itself never sees an unauthorized or unapproved call.
 */
import { randomUUID } from "node:crypto";
import type {
  ClickInput as ProviderClickInput,
  ComputerActionClass,
  ComputerActionResult,
  ComputerApproval,
  ComputerApprovalStatus,
  ComputerControlMode,
  ComputerObservation,
  ComputerProfile,
  ComputerRuntimeProvider,
  ComputerSession,
  ComputerSessionStatus,
  TypeInput as ProviderTypeInput,
  UploadInput as ProviderUploadInput
} from "@soko/computer-runtime";
import {
  classifyComputerAction,
  canonicalizeComputerAction,
  evaluateNavigationPolicy,
  hashComputerAction,
  sanitizeObservationText,
  wrapUntrustedWebContent
} from "@soko/computer-runtime";
import type {
  AuthenticatedActorView,
  ConversationMessageAuthor,
  ConversationMessageContent,
  RuntimeCheckpointResult,
  RuntimeContextReference
} from "@soko/shared-types";
import type { BusinessEvent } from "@soko/event-core";
import type { BusinessPermission } from "@soko/business-core";
import type { ComputerRuntimeMetricEvent } from "@soko/observability";
import { Cp2Error } from "../../cp2-error.js";

const DEFAULT_APPROVAL_TTL_MS = 10 * 60 * 1000;

export interface StoredComputerSession extends ComputerSession {
  userId: string | null;
  /** Sanitized (redacted/truncated) - never raw provider output. */
  lastObservation: ComputerObservation | null;
}

export type StoredComputerApproval = ComputerApproval;

export interface StoredComputerProfile extends ComputerProfile {
  encryptedState: string | null;
}

export interface ComputerRuntimeSnapshot {
  computerSessions?: StoredComputerSession[];
  computerApprovals?: StoredComputerApproval[];
  computerProfiles?: StoredComputerProfile[];
}

export interface ComputerRuntimeDomainDeps {
  requireAuthorizedSession(
    sessionId: string | null,
    businessId: string,
    permission: BusinessPermission,
    now: Date
  ): AuthenticatedActorView;
  requireAuthenticatedActor(sessionId: string | null, now: Date): AuthenticatedActorView;
  provider: ComputerRuntimeProvider;
  checkpointTask(
    sessionId: string | null,
    input: {
      taskId: string;
      nextAction?: string | null;
      relevantContext?: RuntimeContextReference[];
    },
    now: Date
  ): RuntimeCheckpointResult;
  recordAuditEvent(input: {
    type: string;
    aggregateType: string;
    aggregateId: string;
    actorId: string;
    risk: BusinessEvent["risk"];
    occurredAt: string;
    payload: Record<string, unknown>;
  }): void;
  encryptSecret(value: string): string;
  decryptSecret(value: string): string;
  /** Posts the live-browser-session card into the conversation (generated-surface-registry.tsx's
   *  "computer-session" renderer) - the same createConversationMessage mechanism
   *  commerce/store.ts already uses for its own generated cards. */
  createConversationMessage(input: {
    sessionId: string | null;
    conversationId: string;
    clientMessageId: string;
    content: ConversationMessageContent;
    author?: ConversationMessageAuthor;
    now?: Date;
  }): unknown;
  resolveAttachment(input: {
    sessionId: string | null;
    conversationId: string;
    attachmentId: string;
    now: Date;
  }): Promise<{ filename: string; mimeType: string; bytes: Buffer }>;
  navigationPolicy?: { allowedDomains?: string[]; blockedDomains?: string[] };
  approvalTtlMs?: number;
  onMetric?: (event: ComputerRuntimeMetricEvent) => void;
}

export class ComputerRuntimeDomain {
  private readonly sessions = new Map<string, StoredComputerSession>();
  private readonly approvals = new Map<string, StoredComputerApproval>();
  private readonly profiles = new Map<string, StoredComputerProfile>();

  constructor(private readonly deps: ComputerRuntimeDomainDeps) {}

  get sessionsMap(): Map<string, StoredComputerSession> {
    return this.sessions;
  }
  get approvalsMap(): Map<string, StoredComputerApproval> {
    return this.approvals;
  }
  get profilesMap(): Map<string, StoredComputerProfile> {
    return this.profiles;
  }

  clear(): void {
    this.sessions.clear();
    this.approvals.clear();
    this.profiles.clear();
  }

  restore(snapshot: ComputerRuntimeSnapshot): void {
    this.clear();
    for (const record of snapshot.computerSessions ?? []) this.sessions.set(record.id, record);
    for (const record of snapshot.computerApprovals ?? []) this.approvals.set(record.id, record);
    for (const record of snapshot.computerProfiles ?? []) this.profiles.set(record.id, record);
  }

  // -----------------------------------------------------------------------------------------
  // Session lifecycle
  // -----------------------------------------------------------------------------------------

  async createSession(
    sessionId: string | null,
    businessId: string,
    conversationId: string | undefined,
    input: { profileId?: string | null; startUrl?: string | null },
    now: Date = new Date()
  ): Promise<ComputerSession> {
    if (conversationId === undefined) {
      throw new Cp2Error(
        409,
        "CONVERSATION_UNAVAILABLE",
        "A computer session can only be opened from an active conversation."
      );
    }
    const auth = this.deps.requireAuthorizedSession(sessionId, businessId, "computer:use", now);
    const profile =
      input.profileId === null || input.profileId === undefined
        ? null
        : this.requireOwnedProfile(input.profileId, auth.account.id);

    if (input.startUrl !== undefined && input.startUrl !== null) {
      const decision = evaluateNavigationPolicy(input.startUrl, this.deps.navigationPolicy ?? {});
      if (!decision.allowed) {
        throw new Cp2Error(422, "COMPUTER_NAVIGATION_BLOCKED", decision.reason);
      }
    }

    const id = randomUUID();
    const providerSession = await this.deps.provider.createSession({
      sessionId: id,
      businessId,
      accountId: auth.account.id,
      conversationId,
      profileId: profile?.id ?? null,
      startUrl: input.startUrl ?? null
    });

    const stored: StoredComputerSession = {
      ...providerSession,
      id,
      businessId,
      accountId: auth.account.id,
      conversationId,
      userId: auth.user.id,
      profileId: profile?.id ?? null,
      status: "READY",
      controlMode: "AGENT",
      currentUrl: input.startUrl ?? null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lastCheckpointId: null,
      lastObservation: null
    };
    this.sessions.set(id, stored);
    this.deps.onMetric?.({ type: "session_created" });
    this.audit(auth, "computer.session_created", id, now, {
      businessId,
      profileId: profile?.id ?? null
    });
    this.deps.createConversationMessage({
      sessionId,
      conversationId,
      clientMessageId: randomUUID(),
      content: { type: "computer-session", businessId, computerSessionId: id },
      author: "system",
      now
    });
    return this.publicSession(stored);
  }

  /** Read-only session + latest sanitized observation, for the live-view card's polling
   *  (apps/web/src/ComputerSessionCard.tsx). Never touches the provider - it only ever returns
   *  what the last action already captured, so polling never adds provider load. */
  getSessionView(
    sessionId: string | null,
    businessId: string,
    computerSessionId: string,
    now: Date = new Date()
  ): {
    session: ComputerSession;
    observation: ComputerObservation | null;
    pendingApprovalId: string | null;
  } {
    const auth = this.deps.requireAuthorizedSession(sessionId, businessId, "computer:use", now);
    const session = this.requireOwnedSession(computerSessionId, businessId, auth, now);
    const pendingApproval = [...this.approvals.values()].find(
      (approval) => approval.sessionId === session.id && approval.status === "PENDING"
    );
    return {
      session: this.publicSession(session),
      observation: session.lastObservation,
      pendingApprovalId: pendingApproval?.id ?? null
    };
  }

  async resumeSession(
    sessionId: string | null,
    businessId: string,
    computerSessionId: string,
    now: Date = new Date()
  ): Promise<ComputerSession> {
    const auth = this.deps.requireAuthorizedSession(sessionId, businessId, "computer:use", now);
    const session = this.requireOwnedSession(computerSessionId, businessId, auth, now);
    const providerSession = await this.deps.provider.resumeSession(computerSessionId);
    const updated = this.update(session, {
      status: providerSession.status,
      controlMode: session.controlMode === "SUSPENDED" ? "AGENT" : session.controlMode,
      currentUrl: providerSession.currentUrl,
      updatedAt: now.toISOString()
    });
    this.audit(auth, "computer.session_resumed", computerSessionId, now, { businessId });
    return this.publicSession(updated);
  }

  async checkpointSession(
    sessionId: string | null,
    businessId: string,
    computerSessionId: string,
    now: Date = new Date()
  ): Promise<{ checkpointId: string }> {
    const auth = this.deps.requireAuthorizedSession(sessionId, businessId, "computer:use", now);
    const session = this.requireOwnedSession(computerSessionId, businessId, auth, now);
    const result = this.checkpoint(sessionId, session, now);
    return { checkpointId: result.handoff.id };
  }

  async suspendSession(
    sessionId: string | null,
    businessId: string,
    computerSessionId: string,
    now: Date = new Date()
  ): Promise<void> {
    const auth = this.deps.requireAuthorizedSession(sessionId, businessId, "computer:use", now);
    const session = this.requireOwnedSession(computerSessionId, businessId, auth, now);
    await this.deps.provider.suspend(computerSessionId);
    this.update(session, {
      status: "SUSPENDED",
      controlMode: "SUSPENDED",
      updatedAt: now.toISOString()
    });
    this.audit(auth, "computer.session_suspended", computerSessionId, now, { businessId });
  }

  async closeSession(
    sessionId: string | null,
    businessId: string,
    computerSessionId: string,
    now: Date = new Date()
  ): Promise<void> {
    const auth = this.deps.requireAuthorizedSession(sessionId, businessId, "computer:use", now);
    const session = this.requireOwnedSession(computerSessionId, businessId, auth, now);
    await this.deps.provider.close(computerSessionId);
    this.update(session, {
      status: "CLOSED",
      controlMode: "SUSPENDED",
      updatedAt: now.toISOString()
    });
    this.deps.onMetric?.({ type: "session_closed" });
    this.audit(auth, "computer.session_closed", computerSessionId, now, { businessId });
  }

  // -----------------------------------------------------------------------------------------
  // Control ownership (task brief §11) - human/agent are mutually exclusive.
  // -----------------------------------------------------------------------------------------

  takeControl(
    sessionId: string | null,
    businessId: string,
    computerSessionId: string,
    now: Date = new Date()
  ): ComputerSession {
    const auth = this.deps.requireAuthorizedSession(sessionId, businessId, "computer:control", now);
    const session = this.requireOwnedSession(computerSessionId, businessId, auth, now);
    if (session.status === "CLOSED" || session.status === "FAILED") {
      throw new Cp2Error(409, "COMPUTER_SESSION_UNAVAILABLE", "This computer session has ended.");
    }
    // Synchronous map write, no await in between - this is the atomic transition the task brief
    // requires ("the server must atomically transition the session to HUMAN_CONTROLLED"). Any
    // in-flight agent action checks controlMode again after its own await resolves (see
    // performAction below) and discards its result if control moved during that await.
    const updated = this.update(session, {
      controlMode: "HUMAN",
      status: "HUMAN_CONTROLLED",
      updatedAt: now.toISOString()
    });
    this.deps.onMetric?.({ type: "human_takeover" });
    this.audit(auth, "computer.control_taken", computerSessionId, now, { businessId });
    return this.publicSession(updated);
  }

  async releaseControl(
    sessionId: string | null,
    businessId: string,
    computerSessionId: string,
    now: Date = new Date()
  ): Promise<ComputerSession> {
    const auth = this.deps.requireAuthorizedSession(sessionId, businessId, "computer:control", now);
    const session = this.requireOwnedSession(computerSessionId, businessId, auth, now);
    if (session.controlMode !== "HUMAN") {
      throw new Cp2Error(409, "COMPUTER_NOT_HUMAN_CONTROLLED", "The agent already has control.");
    }
    // Stop accepting further human input for this session by flipping control mode first, then
    // fetch a fresh observation before the agent is allowed to resume (task brief §11 steps 1-5).
    this.update(session, { controlMode: "SUSPENDED", updatedAt: now.toISOString() });
    const observation = this.sanitize(
      await this.deps.provider.observe({ sessionId: computerSessionId })
    );
    const refreshed = this.requireOwnedSession(computerSessionId, businessId, auth, now);
    const updated = this.update(refreshed, {
      controlMode: "AGENT",
      status: "READY",
      currentUrl: observation.url,
      lastObservation: observation,
      updatedAt: now.toISOString()
    });
    this.checkpoint(
      sessionId,
      updated,
      now,
      `Control returned to the agent at ${observation.url}.`
    );
    this.audit(auth, "computer.control_released", computerSessionId, now, { businessId });
    return this.publicSession(updated);
  }

  // -----------------------------------------------------------------------------------------
  // Read actions (navigate/observe/scroll) - never gated by approval.
  // -----------------------------------------------------------------------------------------

  async navigate(
    sessionId: string | null,
    businessId: string,
    input: { computerSessionId: string; url: string },
    now: Date = new Date()
  ): Promise<ComputerActionResult> {
    const decision = evaluateNavigationPolicy(input.url, this.deps.navigationPolicy ?? {});
    if (!decision.allowed) {
      this.deps.onMetric?.({ type: "action", toolName: "computer.navigate", outcome: "rejected" });
      throw new Cp2Error(422, "COMPUTER_NAVIGATION_BLOCKED", decision.reason);
    }
    return this.performAgentAction(
      sessionId,
      businessId,
      input.computerSessionId,
      "computer.navigate",
      now,
      async (session) => {
        const observation = this.sanitize(
          await this.deps.provider.navigate({ sessionId: session.id, url: input.url })
        );
        return { observation, providerResultExtra: {} };
      }
    );
  }

  async observe(
    sessionId: string | null,
    businessId: string,
    input: { computerSessionId: string },
    now: Date = new Date()
  ): Promise<ComputerActionResult> {
    return this.performAgentAction(
      sessionId,
      businessId,
      input.computerSessionId,
      "computer.observe",
      now,
      async (session) => {
        const observation = this.sanitize(
          await this.deps.provider.observe({ sessionId: session.id })
        );
        return { observation, providerResultExtra: {} };
      }
    );
  }

  async scroll(
    sessionId: string | null,
    businessId: string,
    input: { computerSessionId: string; direction: "up" | "down"; amountPx?: number },
    now: Date = new Date()
  ): Promise<ComputerActionResult> {
    return this.performAgentAction(
      sessionId,
      businessId,
      input.computerSessionId,
      "computer.scroll",
      now,
      async (session) => {
        const result = await this.deps.provider.scroll({
          sessionId: session.id,
          direction: input.direction,
          ...(input.amountPx === undefined ? {} : { amountPx: input.amountPx })
        });
        return {
          observation: result.observation === null ? null : this.sanitize(result.observation),
          providerResultExtra: {}
        };
      }
    );
  }

  // -----------------------------------------------------------------------------------------
  // Mutating/consequential actions (click/type/upload) - policy-gated.
  // -----------------------------------------------------------------------------------------

  async click(
    sessionId: string | null,
    businessId: string,
    input: { computerSessionId: string; targetDescription: string; targetRef?: string },
    now: Date = new Date()
  ): Promise<ComputerActionResult> {
    return this.performGatedAction({
      sessionId,
      businessId,
      computerSessionId: input.computerSessionId,
      toolName: "computer.click",
      target: {
        description: input.targetDescription,
        ...(input.targetRef === undefined ? {} : { ref: input.targetRef })
      },
      actionPayload: {
        targetDescription: input.targetDescription,
        targetRef: input.targetRef ?? null
      },
      now,
      execute: async (session) => {
        const result = await this.deps.provider.click({
          sessionId: session.id,
          target: {
            description: input.targetDescription,
            ...(input.targetRef === undefined ? {} : { ref: input.targetRef })
          }
        } satisfies ProviderClickInput);
        return result;
      }
    });
  }

  async type(
    sessionId: string | null,
    businessId: string,
    input: {
      computerSessionId: string;
      targetDescription: string;
      targetRef?: string;
      text: string;
      submit?: boolean;
    },
    now: Date = new Date()
  ): Promise<ComputerActionResult> {
    return this.performGatedAction({
      sessionId,
      businessId,
      computerSessionId: input.computerSessionId,
      toolName: "computer.type",
      target: {
        description: input.targetDescription,
        ...(input.targetRef === undefined ? {} : { ref: input.targetRef })
      },
      ...(input.submit === undefined ? {} : { submit: input.submit }),
      actionPayload: {
        targetDescription: input.targetDescription,
        targetRef: input.targetRef ?? null,
        text: input.text,
        submit: input.submit ?? false
      },
      now,
      execute: async (session) => {
        const result = await this.deps.provider.type({
          sessionId: session.id,
          target: {
            description: input.targetDescription,
            ...(input.targetRef === undefined ? {} : { ref: input.targetRef })
          },
          text: input.text,
          ...(input.submit === undefined ? {} : { submit: input.submit })
        } satisfies ProviderTypeInput);
        return result;
      }
    });
  }

  async upload(
    sessionId: string | null,
    businessId: string,
    conversationId: string | undefined,
    input: { computerSessionId: string; targetDescription: string; attachmentId: string },
    now: Date = new Date()
  ): Promise<ComputerActionResult> {
    if (conversationId === undefined) {
      throw new Cp2Error(
        409,
        "CONVERSATION_UNAVAILABLE",
        "A file can only be uploaded through the computer from an active conversation."
      );
    }
    const attachment = await this.deps.resolveAttachment({
      sessionId,
      conversationId,
      attachmentId: input.attachmentId,
      now
    });
    return this.performGatedAction({
      sessionId,
      businessId,
      computerSessionId: input.computerSessionId,
      toolName: "computer.upload",
      target: { description: input.targetDescription },
      actionPayload: {
        targetDescription: input.targetDescription,
        attachmentId: input.attachmentId
      },
      now,
      execute: async (session) => {
        const result = await this.deps.provider.upload({
          sessionId: session.id,
          target: { description: input.targetDescription },
          attachmentId: input.attachmentId,
          fileName: attachment.filename,
          contentType: attachment.mimeType,
          contentBase64: attachment.bytes.toString("base64")
        } satisfies ProviderUploadInput);
        return result;
      }
    });
  }

  // -----------------------------------------------------------------------------------------
  // Approval decision (REST-only - task brief §10). Never re-derives the action from client
  // input; the stored approval's action is authoritative, so there is nothing for a client to
  // replay a changed action toward.
  // -----------------------------------------------------------------------------------------

  async decideApproval(
    sessionId: string | null,
    businessId: string,
    approvalId: string,
    decision: "approve" | "reject",
    now: Date = new Date()
  ): Promise<ComputerActionResult> {
    const auth = this.deps.requireAuthorizedSession(sessionId, businessId, "computer:use", now);
    const approval = this.approvals.get(approvalId);
    if (approval === undefined || approval.businessId !== businessId) {
      throw new Cp2Error(404, "COMPUTER_APPROVAL_NOT_FOUND", "Approval not found.");
    }
    if (approval.status !== "PENDING") {
      // Replay protection: a second decide call on an already-decided approval is rejected
      // outright, whatever decision it carries.
      throw new Cp2Error(
        409,
        "COMPUTER_APPROVAL_ALREADY_DECIDED",
        "This approval was already decided."
      );
    }
    if (new Date(approval.expiresAt).getTime() < now.getTime()) {
      this.approvals.set(approvalId, {
        ...approval,
        status: "EXPIRED",
        decidedAt: now.toISOString()
      });
      throw new Cp2Error(409, "COMPUTER_APPROVAL_EXPIRED", "This approval has expired.");
    }
    const session = this.requireOwnedSession(approval.sessionId, businessId, auth, now);

    if (decision === "reject") {
      this.approvals.set(approvalId, {
        ...approval,
        status: "REJECTED",
        decidedAt: now.toISOString()
      });
      this.deps.onMetric?.({ type: "approval_rejected" });
      this.audit(auth, "computer.approval_rejected", approvalId, now, {
        businessId,
        sessionId: session.id
      });
      this.update(session, { status: "READY", updatedAt: now.toISOString() });
      return {
        sessionId: session.id,
        status: "REJECTED",
        observation: null,
        reason: "Rejected by user."
      };
    }

    // Defense in depth: re-hash the stored action and compare against the stored hash before
    // executing. This can only fail if the stored row itself was corrupted (nothing here re-reads
    // client input), but it is a cheap, meaningful invariant check.
    const recomputedHash = hashComputerAction(
      canonicalizeComputerAction(approval.toolName, approval.sessionId, approval.action)
    );
    if (recomputedHash !== approval.actionHash) {
      throw new Cp2Error(
        409,
        "COMPUTER_APPROVAL_HASH_MISMATCH",
        "Approval binding is inconsistent."
      );
    }

    this.approvals.set(approvalId, {
      ...approval,
      status: "APPROVED",
      decidedAt: now.toISOString()
    });
    this.deps.onMetric?.({ type: "approval_approved" });
    this.audit(auth, "computer.approval_approved", approvalId, now, {
      businessId,
      sessionId: session.id
    });

    try {
      const result = await this.executeApprovedAction(session, approval);
      this.approvals.set(approvalId, {
        ...this.approvals.get(approvalId)!,
        status: "EXECUTED",
        executedAt: now.toISOString()
      });
      this.deps.onMetric?.({ type: "action", toolName: approval.toolName, outcome: "executed" });
      return result;
    } catch (error) {
      // Task brief §18: an uncertain consequential-action outcome must never be silently retried.
      // The approval is left APPROVED-but-not-EXECUTED (never re-decidable - status is no longer
      // PENDING) and the caller gets an explicit OUTCOME_UNKNOWN, not a thrown 5xx that might read
      // as "nothing happened".
      this.deps.onMetric?.({ type: "provider_error" });
      this.deps.onMetric?.({
        type: "action",
        toolName: approval.toolName,
        outcome: "outcome_unknown"
      });
      this.audit(auth, "computer.approval_outcome_unknown", approvalId, now, {
        businessId,
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error)
      });
      this.update(session, { status: "FAILED", updatedAt: now.toISOString() });
      return {
        sessionId: session.id,
        status: "OUTCOME_UNKNOWN",
        observation: null,
        reason:
          "The approved action's outcome could not be confirmed. Reconcile the session manually " +
          "before retrying - it was not automatically retried."
      };
    }
  }

  private async executeApprovedAction(
    session: StoredComputerSession,
    approval: StoredComputerApproval
  ): Promise<ComputerActionResult> {
    const action = approval.action;
    switch (approval.toolName) {
      case "computer.click": {
        const result = await this.deps.provider.click({
          sessionId: session.id,
          target: {
            description: String(action.targetDescription ?? ""),
            ...(typeof action.targetRef === "string" ? { ref: action.targetRef } : {})
          }
        });
        return this.finalizeActionResult(session, result);
      }
      case "computer.type": {
        const result = await this.deps.provider.type({
          sessionId: session.id,
          target: {
            description: String(action.targetDescription ?? ""),
            ...(typeof action.targetRef === "string" ? { ref: action.targetRef } : {})
          },
          text: String(action.text ?? ""),
          submit: action.submit === true
        });
        return this.finalizeActionResult(session, result);
      }
      case "computer.upload": {
        throw new Cp2Error(
          501,
          "COMPUTER_UPLOAD_APPROVAL_UNSUPPORTED",
          "Approved-upload re-execution is not supported; re-propose the upload."
        );
      }
      default:
        throw new Cp2Error(500, "COMPUTER_APPROVAL_TOOL_UNKNOWN", "Unknown approved action type.");
    }
  }

  // -----------------------------------------------------------------------------------------
  // Persistent profiles (task brief §12) - REST-only, account-scoped.
  // -----------------------------------------------------------------------------------------

  async saveSessionAsProfile(
    sessionId: string | null,
    businessId: string,
    computerSessionId: string,
    input: { label: string; site: string },
    now: Date = new Date()
  ): Promise<ComputerProfile> {
    const auth = this.deps.requireAuthorizedSession(sessionId, businessId, "computer:use", now);
    const session = this.requireOwnedSession(computerSessionId, businessId, auth, now);
    const checkpoint = await this.deps.provider.checkpoint(session.id);
    const existing = [...this.profiles.values()].find(
      (profile) => profile.accountId === auth.account.id && profile.site === input.site
    );
    const id = existing?.id ?? randomUUID();
    const record: StoredComputerProfile = {
      id,
      accountId: auth.account.id,
      label: input.label,
      site: input.site,
      status: "CONNECTED",
      encryptedState: this.deps.encryptSecret(checkpoint.opaqueState),
      createdAt: existing?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString()
    };
    this.profiles.set(id, record);
    this.update(session, { profileId: id, updatedAt: now.toISOString() });
    this.audit(auth, "computer.profile_saved", id, now, { site: input.site });
    return this.publicProfile(record);
  }

  disconnectProfile(sessionId: string | null, profileId: string, now: Date = new Date()): void {
    const auth = this.deps.requireAuthenticatedActor(sessionId, now);
    const profile = this.requireOwnedProfile(profileId, auth.account.id);
    this.profiles.set(profileId, {
      ...profile,
      status: "DISCONNECTED",
      encryptedState: null,
      updatedAt: now.toISOString()
    });
    this.audit(auth, "computer.profile_disconnected", profileId, now, {});
  }

  listProfiles(sessionId: string | null, now: Date = new Date()): ComputerProfile[] {
    const auth = this.deps.requireAuthenticatedActor(sessionId, now);
    return [...this.profiles.values()]
      .filter((profile) => profile.accountId === auth.account.id)
      .map((profile) => this.publicProfile(profile));
  }

  // -----------------------------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------------------------

  private async performAgentAction(
    sessionId: string | null,
    businessId: string,
    computerSessionId: string,
    toolName: string,
    now: Date,
    run: (session: StoredComputerSession) => Promise<{
      observation: ComputerObservation | null;
      providerResultExtra: Record<string, never>;
    }>
  ): Promise<ComputerActionResult> {
    const auth = this.deps.requireAuthorizedSession(sessionId, businessId, "computer:use", now);
    const session = this.requireAgentControlledSession(computerSessionId, businessId, auth, now);
    try {
      const { observation } = await run(session);
      // Re-check control mode after the await: a human may have taken control while the provider
      // call was in flight. Discard this result rather than overwrite human-driven state.
      const stillOwned = this.sessions.get(computerSessionId);
      if (stillOwned === undefined || stillOwned.controlMode !== "AGENT") {
        this.deps.onMetric?.({ type: "action", toolName, outcome: "rejected" });
        return {
          sessionId: computerSessionId,
          status: "REJECTED",
          observation: null,
          reason: "Control changed to the human user while this action was in flight."
        };
      }
      this.update(stillOwned, {
        status: "READY",
        currentUrl: observation?.url ?? stillOwned.currentUrl,
        ...(observation === null ? {} : { lastObservation: observation }),
        updatedAt: now.toISOString()
      });
      this.deps.onMetric?.({ type: "action", toolName, outcome: "executed" });
      return { sessionId: computerSessionId, status: "EXECUTED", observation };
    } catch (error) {
      this.deps.onMetric?.({ type: "provider_error" });
      throw this.wrapProviderError(error);
    }
  }

  private async performGatedAction(input: {
    sessionId: string | null;
    businessId: string;
    computerSessionId: string;
    toolName: string;
    target: { description: string; ref?: string };
    submit?: boolean;
    actionPayload: Record<string, unknown>;
    now: Date;
    execute: (session: StoredComputerSession) => Promise<ComputerActionResult>;
  }): Promise<ComputerActionResult> {
    const auth = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "computer:use",
      input.now
    );
    const session = this.requireAgentControlledSession(
      input.computerSessionId,
      input.businessId,
      auth,
      input.now
    );

    const targetSensitive =
      session.lastObservation?.interactiveElements.find(
        (element) => element.ref === input.target.ref || element.name === input.target.description
      )?.sensitive ?? false;

    const actionClass: ComputerActionClass = classifyComputerAction({
      toolName: input.toolName,
      target: input.target,
      targetSensitive,
      ...(input.submit === undefined ? {} : { submit: input.submit })
    });

    if (actionClass === "BLOCKED") {
      this.deps.onMetric?.({ type: "action", toolName: input.toolName, outcome: "blocked" });
      this.audit(auth, "computer.action_blocked", session.id, input.now, {
        businessId: input.businessId,
        toolName: input.toolName,
        targetDescription: input.target.description
      });
      throw new Cp2Error(
        403,
        "COMPUTER_ACTION_BLOCKED",
        "This action targets a credential-like field and is refused."
      );
    }

    if (actionClass === "CONSEQUENTIAL") {
      const existingPending = [...this.approvals.values()].find(
        (approval) => approval.sessionId === session.id && approval.status === "PENDING"
      );
      if (existingPending !== undefined) {
        return {
          sessionId: session.id,
          status: "AWAITING_APPROVAL",
          observation: null,
          approvalId: existingPending.id,
          reason: "A previous action on this session is already awaiting approval."
        };
      }
      const canonical = canonicalizeComputerAction(input.toolName, session.id, input.actionPayload);
      const approvalId = randomUUID();
      const approval: StoredComputerApproval = {
        id: approvalId,
        sessionId: session.id,
        businessId: input.businessId,
        accountId: session.accountId,
        status: "PENDING",
        actionClass,
        toolName: input.toolName,
        action: input.actionPayload,
        actionHash: hashComputerAction(canonical),
        summary: `${input.toolName} on "${input.target.description}"`,
        createdAt: input.now.toISOString(),
        expiresAt: new Date(
          input.now.getTime() + (this.deps.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS)
        ).toISOString(),
        decidedAt: null,
        executedAt: null
      };
      this.approvals.set(approvalId, approval);
      this.update(session, { status: "AWAITING_APPROVAL", updatedAt: input.now.toISOString() });
      this.checkpoint(
        input.sessionId,
        session,
        input.now,
        `Awaiting approval for ${input.toolName} on "${input.target.description}".`
      );
      this.deps.onMetric?.({ type: "approval_requested" });
      this.deps.onMetric?.({
        type: "action",
        toolName: input.toolName,
        outcome: "awaiting_approval"
      });
      this.audit(auth, "computer.approval_requested", approvalId, input.now, {
        businessId: input.businessId,
        sessionId: session.id,
        toolName: input.toolName
      });
      return {
        sessionId: session.id,
        status: "AWAITING_APPROVAL",
        observation: null,
        approvalId
      };
    }

    try {
      const result = await input.execute(session);
      const stillOwned = this.sessions.get(input.computerSessionId);
      if (stillOwned === undefined || stillOwned.controlMode !== "AGENT") {
        this.deps.onMetric?.({ type: "action", toolName: input.toolName, outcome: "rejected" });
        return {
          sessionId: input.computerSessionId,
          status: "REJECTED",
          observation: null,
          reason: "Control changed to the human user while this action was in flight."
        };
      }
      const observation = result.observation === null ? null : this.sanitize(result.observation);
      this.update(stillOwned, {
        status: "READY",
        currentUrl: observation?.url ?? stillOwned.currentUrl,
        ...(observation === null ? {} : { lastObservation: observation }),
        updatedAt: input.now.toISOString()
      });
      this.deps.onMetric?.({ type: "action", toolName: input.toolName, outcome: "executed" });
      return { sessionId: input.computerSessionId, status: "EXECUTED", observation };
    } catch (error) {
      this.deps.onMetric?.({ type: "provider_error" });
      throw this.wrapProviderError(error);
    }
  }

  private async finalizeActionResult(
    session: StoredComputerSession,
    result: ComputerActionResult
  ): Promise<ComputerActionResult> {
    const observation = result.observation === null ? null : this.sanitize(result.observation);
    const stillOwned = this.sessions.get(session.id) ?? session;
    this.update(stillOwned, {
      status: "READY",
      currentUrl: observation?.url ?? stillOwned.currentUrl,
      ...(observation === null ? {} : { lastObservation: observation }),
      updatedAt: new Date().toISOString()
    });
    return { sessionId: session.id, status: "EXECUTED", observation };
  }

  private checkpoint(
    sessionId: string | null,
    session: StoredComputerSession,
    now: Date,
    nextAction?: string
  ): RuntimeCheckpointResult {
    const result = this.deps.checkpointTask(
      sessionId,
      {
        taskId: session.conversationId,
        nextAction:
          nextAction ??
          `Computer session ${session.id} is ${session.status} at ${session.currentUrl ?? "no URL yet"}.`,
        relevantContext: [
          {
            kind: "computer_session",
            refId: session.id,
            description: `controlMode=${session.controlMode} status=${session.status}`
          }
        ]
      },
      now
    );
    this.update(session, { lastCheckpointId: result.handoff.id, updatedAt: now.toISOString() });
    this.deps.onMetric?.({ type: "checkpoint" });
    return result;
  }

  private requireOwnedSession(
    computerSessionId: string,
    businessId: string,
    auth: AuthenticatedActorView,
    now: Date
  ): StoredComputerSession {
    const session = this.sessions.get(computerSessionId);
    if (session === undefined || session.businessId !== businessId) {
      throw new Cp2Error(404, "COMPUTER_SESSION_NOT_FOUND", "Computer session not found.");
    }
    void auth;
    void now;
    return session;
  }

  private requireAgentControlledSession(
    computerSessionId: string,
    businessId: string,
    auth: AuthenticatedActorView,
    now: Date
  ): StoredComputerSession {
    const session = this.requireOwnedSession(computerSessionId, businessId, auth, now);
    if (session.status === "CLOSED" || session.status === "FAILED") {
      throw new Cp2Error(409, "COMPUTER_SESSION_UNAVAILABLE", "This computer session has ended.");
    }
    if (session.controlMode !== "AGENT") {
      throw new Cp2Error(
        409,
        "COMPUTER_CONTROL_NOT_AGENT",
        session.controlMode === "HUMAN"
          ? "The human user currently controls this session."
          : "This session is suspended."
      );
    }
    return session;
  }

  private requireOwnedProfile(profileId: string, accountId: string): StoredComputerProfile {
    const profile = this.profiles.get(profileId);
    if (profile === undefined || profile.accountId !== accountId) {
      throw new Cp2Error(404, "COMPUTER_PROFILE_NOT_FOUND", "Computer profile not found.");
    }
    return profile;
  }

  private update(
    session: StoredComputerSession,
    patch: Partial<StoredComputerSession>
  ): StoredComputerSession {
    const updated = { ...session, ...patch };
    this.sessions.set(session.id, updated);
    return updated;
  }

  private sanitize(observation: ComputerObservation): ComputerObservation {
    return { ...observation, contentSummary: sanitizeObservationText(observation.contentSummary) };
  }

  /** Called by the agent-runtime dispatcher before an observation's contentSummary is handed to
   *  the model, so this untrusted-content framing lives at exactly one call site. */
  static frameObservationForModel(observation: ComputerObservation): string {
    return wrapUntrustedWebContent(observation.url, observation.contentSummary);
  }

  /** Strips userId/lastObservation. Only the map getters above and this method's own callers ever
   *  see the full StoredComputerSession; every route/dispatch return value goes through this. */
  private publicSession(session: StoredComputerSession): ComputerSession {
    return {
      id: session.id,
      businessId: session.businessId,
      accountId: session.accountId,
      conversationId: session.conversationId,
      profileId: session.profileId,
      status: session.status,
      controlMode: session.controlMode,
      currentUrl: session.currentUrl,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      lastCheckpointId: session.lastCheckpointId
    };
  }

  /** Strips encryptedState - the only shape ever returned from a route or dispatch call, mirroring
   *  externalConnectionView's pattern (external-connections/shared.ts). */
  private publicProfile(profile: StoredComputerProfile): ComputerProfile {
    return {
      id: profile.id,
      accountId: profile.accountId,
      label: profile.label,
      site: profile.site,
      status: profile.status,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt
    };
  }

  private wrapProviderError(error: unknown): Cp2Error {
    if (error instanceof Cp2Error) return error;
    const message = error instanceof Error ? error.message : String(error);
    return new Cp2Error(502, "COMPUTER_PROVIDER_ERROR", `Computer worker error: ${message}`);
  }

  private audit(
    auth: AuthenticatedActorView,
    type: string,
    aggregateId: string,
    now: Date,
    payload: Record<string, unknown>
  ): void {
    this.deps.recordAuditEvent({
      type,
      aggregateType: "computer_session",
      aggregateId,
      actorId: auth.user.id,
      risk: "medium",
      occurredAt: now.toISOString(),
      payload
    });
  }
}

export type { ComputerSessionStatus, ComputerControlMode, ComputerApprovalStatus };
