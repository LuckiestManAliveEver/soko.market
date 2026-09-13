import type {
  ResolvedRuntimeHandoff,
  RuntimeCheckpointResult,
  RuntimeHandoff,
  RuntimeOfflineSyncResult,
  RuntimeResumeResult,
  RuntimeSwapResult
} from "@soko/shared-types";
import type {
  LocalDatabase,
  LocalRuntimeHandoffSession,
  LocalRuntimeMessage,
  Scope
} from "@soko/offline-runtime";

export interface LocalResumeReceipt {
  handoffId: string;
  agentId: string;
  modelId: string;
  harness: boolean;
  artifacts: boolean;
  protectedContext: boolean;
  businessState: boolean;
}

/** Only a trusted, executable host adapter may register. supports must cover the complete
 * agent harness, model, protected-context export and durable conversation/event sync. An
 * inference-only adapter (including the standalone WebLLM assistant) cannot implement this. */
export interface LocalHandoffHost {
  id: string;
  executionHostId: string;
  supports(scope: Scope, handoff: RuntimeHandoff): Promise<boolean>;
  prepare(scope: Scope, handoff: RuntimeHandoff): Promise<LocalResumeReceipt>;
  resume(scope: Scope, handoff: RuntimeHandoff): Promise<LocalResumeReceipt>;
  turn(input: {
    scope: Scope;
    handoff: RuntimeHandoff;
    message: LocalRuntimeMessage;
    history: LocalRuntimeMessage[];
    executeTool: (operation: string, args: unknown) => Promise<unknown>;
  }): Promise<{ reply: LocalRuntimeMessage; checkpoint: RuntimeHandoff }>;
  /** Persist messages under their original IDs in the SAME backend conversation. Retriable,
   * idempotent, and authorized by the server; never replay assistant replies as user prompts. */
  syncMessages(
    scope: Scope,
    conversationId: string,
    messages: LocalRuntimeMessage[]
  ): Promise<string[]>;
}

export interface RuntimeHandoffDependencies {
  db: LocalDatabase;
  hosts: () => LocalHandoffHost[];
  cloud: <T>(path: string, body?: unknown, idempotencyKey?: string) => Promise<T>;
  prepareBusiness: (scope: Scope) => Promise<void>;
  syncBusiness: (scope: Scope) => Promise<void>;
  activate: (scope: Scope, offline: boolean) => Promise<void>;
  executeTool: (scope: Scope, operation: string, args: unknown) => Promise<unknown>;
  lock: <T>(scope: Scope, action: () => Promise<T>) => Promise<T>;
  assertAuthorized: (scope: Scope) => void;
  changed: () => void;
}

function assertReceipt(receipt: LocalResumeReceipt, handoff: RuntimeHandoff): void {
  if (
    receipt.handoffId !== handoff.id ||
    receipt.agentId !== handoff.runtime.agentId ||
    receipt.modelId !== handoff.runtime.modelId ||
    !receipt.harness ||
    !receipt.artifacts ||
    !receipt.protectedContext ||
    !receipt.businessState
  )
    throw new Error(
      "The local runtime could not confirm that it can resume this agent and conversation."
    );
}

export class RuntimeHandoffController {
  constructor(private readonly deps: RuntimeHandoffDependencies) {}

  async availability(
    scope: Scope,
    conversationId: string | null
  ): Promise<{ available: boolean; reason: string }> {
    if (!conversationId) return { available: false, reason: "Open an agent conversation first." };
    if (!this.deps.hosts().length)
      return {
        available: false,
        reason: "This agent has no compatible local execution host on this device."
      };
    this.deps.assertAuthorized(scope);
    const resolved = await this.resolve(conversationId);
    const host = await this.findHost(scope, resolved.activeHandoff);
    return host
      ? { available: true, reason: "Move this conversation to this device." }
      : {
          available: false,
          reason: "The current agent and model cannot resume on an available local host."
        };
  }

  goOffline(scope: Scope, conversationId: string, messages: LocalRuntimeMessage[]): Promise<void> {
    return this.deps.lock(scope, async () => {
      this.deps.assertAuthorized(scope);
      const previous = await this.deps.db.read(scope);
      if (previous.offlineModeActive)
        throw new Error(
          "An offline session is already active. Return online before starting another handoff."
        );
      if (previous.runtimeHandoffSession && previous.runtimeHandoffSession.status !== "hosted")
        throw new Error(
          "A saved handoff needs recovery. Use Go online to resume its hosted runtime first."
        );
      const resolved = await this.resolve(conversationId);
      const source = resolved.activeHandoff;
      const host = await this.findHost(scope, source);
      if (!host) throw new Error("No local host can resume this agent and model.");
      const checkpoint = await this.deps.cloud<RuntimeCheckpointResult>(
        this.path(conversationId, "/checkpoints"),
        { promote: true, expectedHandoffId: source.id },
        crypto.randomUUID()
      );
      // Preparation must finish before changing the authoritative execution host.
      await this.deps.prepareBusiness(scope);
      assertReceipt(await host.prepare(scope, checkpoint.handoff), checkpoint.handoff);
      this.deps.assertAuthorized(scope);
      const session: LocalRuntimeHandoffSession = {
        adapterId: host.id,
        hostedExecutionHostId: checkpoint.handoff.runtime.executionHostId,
        cloudHandoffId: checkpoint.handoff.id,
        handoff: checkpoint.handoff,
        checkpoints: [],
        messages,
        pendingMessages: [],
        status: "prepared"
      };
      await this.save(scope, session);
      // A lost swap response is recoverable from the durable prepared session and task head.
      const swapped = await this.deps.cloud<RuntimeSwapResult>(
        this.path(conversationId, "/swaps/host"),
        { targetId: host.executionHostId, expectedHandoffId: checkpoint.handoff.id },
        `offline:${checkpoint.handoff.id}`
      );
      session.handoff = swapped.handoff;
      session.cloudHandoffId = swapped.handoff.id;
      await this.save(scope, session);
      if (swapped.activationFailed)
        throw new Error(
          swapped.activationError ??
            "Local host activation failed. Use Go online to recover the saved handoff."
        );
      assertReceipt(await host.resume(scope, swapped.handoff), swapped.handoff);
      this.deps.assertAuthorized(scope);
      session.status = "offline";
      await this.save(scope, session);
      await this.deps.activate(scope, true);
      this.deps.changed();
    });
  }

  goOnline(scope: Scope): Promise<void> {
    return this.deps.lock(scope, async () => {
      this.deps.assertAuthorized(scope);
      const session = (await this.deps.db.read(scope)).runtimeHandoffSession;
      if (!session)
        throw new Error(
          "This saved business-data session has no RuntimeHandoff. Sync it in offline settings."
        );
      const conversationId = session.handoff.conversationId;
      await this.deps.syncBusiness(scope);
      const state = await this.deps.db.read(scope);
      if (state.conflicts.length || state.operations.some((op) => op.syncStatus !== "ACKED"))
        throw new Error(
          "Resolve the pending business changes in offline settings before going online."
        );
      const host = this.deps.hosts().find((candidate) => candidate.id === session.adapterId);
      if (session.pendingMessages.length) {
        if (!host) throw new Error("Reconnect the local execution host to sync this conversation.");
        const acked = await host.syncMessages(scope, conversationId, session.pendingMessages);
        session.pendingMessages = session.pendingMessages.filter(
          (message) => !acked.includes(message.id)
        );
        await this.save(scope, session);
        if (session.pendingMessages.length)
          throw new Error(
            "Some conversation events still need syncing. The local conversation is saved."
          );
      }
      // Keep the local branch intact when another device moved the head. The existing handoff
      // merge API is the only way to reconcile it; a reconnect must never overwrite that branch.
      if (session.checkpoints.length) {
        const synced = await this.deps.cloud<RuntimeOfflineSyncResult>(
          this.path(conversationId, "/checkpoints/sync"),
          {
            checkpoints: session.checkpoints,
            promote: true,
            expectedHandoffId: session.cloudHandoffId
          },
          `sync:${session.checkpoints.at(-1)!.id}`
        );
        session.cloudHandoffId = synced.taskHead.activeHandoffId;
        session.checkpoints = [];
        await this.save(scope, session);
      }
      const resolved = await this.resolve(conversationId);
      // Prepared recovery may have lost the host-swap response. Accept only the exact child
      // created from our prepared checkpoint, preserving any independently advanced task head.
      const recoveringSwap =
        session.status === "prepared" &&
        resolved.activeHandoff.parentHandoffId === session.cloudHandoffId &&
        resolved.activeHandoff.runtime.executionHostId === host?.executionHostId;
      const recoveringReturn =
        session.status === "returning" &&
        resolved.activeHandoff.parentHandoffId === session.cloudHandoffId &&
        resolved.activeHandoff.runtime.executionHostId === session.hostedExecutionHostId;
      if (
        resolved.activeHandoff.id !== session.cloudHandoffId &&
        !recoveringSwap &&
        !recoveringReturn
      )
        throw new Error(
          "This conversation changed on another device. Resolve its RuntimeHandoff conflict before going online; local state is saved."
        );
      session.status = "returning";
      session.cloudHandoffId = resolved.activeHandoff.id;
      await this.save(scope, session);
      const swapped = await this.deps.cloud<RuntimeSwapResult>(
        this.path(conversationId, "/swaps/host"),
        { targetId: session.hostedExecutionHostId, expectedHandoffId: session.cloudHandoffId },
        `online:${session.cloudHandoffId}`
      );
      session.cloudHandoffId = swapped.handoff.id;
      session.handoff = swapped.handoff;
      await this.save(scope, session);
      if (swapped.activationFailed)
        throw new Error(
          swapped.activationError ?? "The hosted runtime is not ready. Your local state is saved."
        );
      const resumed = await this.deps.cloud<RuntimeResumeResult>(
        this.path(conversationId, "/resume"),
        {}
      );
      if (
        resumed.activeHandoff.id !== swapped.handoff.id ||
        resumed.runtimeInstance.activeHandoffId !== swapped.handoff.id ||
        !["READY", "RUNNING"].includes(resumed.runtimeInstance.status)
      )
        throw new Error("The hosted runtime has not confirmed resume. Your local state is saved.");
      this.deps.assertAuthorized(scope);
      await this.deps.activate(scope, false);
      session.status = "hosted";
      await this.save(scope, session);
      // Retain the local checkpoint and transcript even after acknowledgement; no destructive
      // cleanup is required to change routing, and retaining them makes interrupted returns safe.
      this.deps.changed();
    });
  }

  turn(
    scope: Scope,
    conversationId: string,
    message: LocalRuntimeMessage
  ): Promise<LocalRuntimeMessage> {
    return this.deps.lock(scope, async () => {
      this.deps.assertAuthorized(scope);
      const state = await this.deps.db.read(scope);
      const session = state.runtimeHandoffSession;
      if (
        !state.offlineModeActive ||
        !session ||
        session.status !== "offline" ||
        session.handoff.conversationId !== conversationId
      )
        throw new Error(
          "This conversation has no active local handoff. Return online to continue it."
        );
      const host = this.deps.hosts().find((candidate) => candidate.id === session.adapterId);
      if (!host)
        throw new Error(
          "The local execution host is unavailable. Reconnect it to resume this conversation."
        );
      assertReceipt(await host.resume(scope, session.handoff), session.handoff);
      const history = [...session.messages];
      session.messages.push(message);
      session.pendingMessages.push(message);
      await this.save(scope, session);
      const { reply, checkpoint } = await host.turn({
        scope,
        handoff: session.handoff,
        message,
        history,
        executeTool: (operation, args) => this.deps.executeTool(scope, operation, args)
      });
      if (
        checkpoint.parentHandoffId !== session.handoff.id ||
        checkpoint.conversationId !== conversationId ||
        checkpoint.taskId !== conversationId ||
        checkpoint.runtime.agentId !== session.handoff.runtime.agentId ||
        checkpoint.runtime.modelId !== session.handoff.runtime.modelId ||
        checkpoint.runtime.executionHostId !== session.handoff.runtime.executionHostId ||
        checkpoint.checkpointVersion !== null ||
        checkpoint.id === session.handoff.id ||
        reply.role !== "assistant" ||
        !reply.content.trim()
      )
        throw new Error(
          "The local runtime returned an invalid checkpoint. The conversation is saved."
        );
      session.handoff = checkpoint;
      session.checkpoints.push(checkpoint);
      session.messages.push(reply);
      session.pendingMessages.push(reply);
      await this.save(scope, session);
      this.deps.changed();
      return reply;
    });
  }

  private async findHost(scope: Scope, handoff: RuntimeHandoff) {
    for (const host of this.deps.hosts()) {
      if (await host.supports(scope, handoff)) return host;
    }
    return null;
  }
  private resolve(conversationId: string) {
    return this.deps.cloud<ResolvedRuntimeHandoff>(this.path(conversationId));
  }
  private path(conversationId: string, suffix = "") {
    return `/v1/runtime/${encodeURIComponent(conversationId)}${suffix}`;
  }
  private async save(scope: Scope, session: LocalRuntimeHandoffSession) {
    this.deps.assertAuthorized(scope);
    await this.deps.db.transaction(scope, (state) => {
      state.runtimeHandoffSession = structuredClone(session);
    });
    this.deps.changed();
  }
}
