import { randomUUID } from "node:crypto";

import type {
  ExecutionHistoryOutcome,
  ExecutionHistoryRecord,
  ModelExecutionPreference,
  ModelPreferenceScope,
  ModelPreferenceSummary,
  ModelQualityPreference,
  RuntimeHostSummary,
  RuntimeHostTrustLevel,
  RuntimeModelInstallationSummary
} from "@soko/shared-types";

import { Cp2Error } from "../../cp2-error.js";
import type { Cp2Snapshot } from "../../store.js";

/**
 * Persistence for the Execution Fabric entities (docs/architecture/agent-execution-fabric-phase1.md,
 * -phase2.md, -phase2-5.md). A Cp2Store domain slice in the same sense as agent-runtime/messaging/
 * etc. as of Phase 2.5: `Cp2Store.snapshot()`/`hydrateSnapshot()` include `modelPreferencesMap`/
 * `runtimeHostsMap`/`runtimeModelInstallationsMap` via `clear()`/`restore()` below (see
 * `store.ts`'s `hydrateSnapshot`), and `postgres-store.ts`'s generic `normalizedCollections`
 * mechanism persists them to `cp2_model_preferences`/`cp2_runtime_hosts`/
 * `cp2_runtime_model_installations` (migration 060) exactly like every other envelope-shaped
 * domain - no bespoke SQL was written for this class; it participates in the same generic
 * snapshot-diff-and-upsert machinery every other domain already uses.
 *
 * `executionHistory` deliberately stays in-memory-only (no getter/restore participation) - Phase 2
 * only ever required it to be logged, not persisted ("not necessarily persisted, but at minimum
 * logged"), and no migration exists for it; adding one was out of scope for Phase 2.5, which only
 * covers the three entities migration 060 already has tables for.
 *
 * Callers pass already-authenticated identity (accountId/userId/tenantId) rather than a
 * sessionId - this store does not perform session/membership authentication itself, since doing
 * so would require importing Cp2Store's auth internals and create exactly the coupling Phase 1
 * was meant to avoid. The real HTTP routes in front of this store (`agent-runtime/routes.ts`)
 * authenticate the caller before calling any method here.
 */
export class ExecutionFabricStore {
  private readonly modelPreferences = new Map<string, ModelPreferenceSummary>();
  private readonly runtimeHosts = new Map<string, RuntimeHostSummary>();
  private readonly runtimeModelInstallations = new Map<string, RuntimeModelInstallationSummary>();
  private readonly executionHistory = new Map<string, ExecutionHistoryRecord>();

  createModelPreference(input: {
    tenantId: string;
    scope: ModelPreferenceScope;
    scopeId: string;
    preferredModelIds: string[];
    fallbackModelIds: string[];
    requiredCapabilities: string[];
    executionPreference: ModelExecutionPreference;
    qualityPreference: ModelQualityPreference;
    allowCloudFallback: boolean;
    maxCostPerRequest: number | null;
    maxLatencyMs: number | null;
    minimumContextWindow: number | null;
    updatedBy: string;
    now?: Date;
  }): ModelPreferenceSummary {
    if (input.preferredModelIds.length === 0 && input.fallbackModelIds.length === 0) {
      throw new Cp2Error(
        400,
        "model_preference_empty",
        "A model preference must name at least one preferred or fallback model."
      );
    }
    const now = (input.now ?? new Date()).toISOString();
    const existing = this.findPreference(input.tenantId, input.scope, input.scopeId);
    const preference: ModelPreferenceSummary = {
      id: existing?.id ?? randomUUID(),
      tenantId: input.tenantId,
      scope: input.scope,
      scopeId: input.scopeId,
      preferredModelIds: [...input.preferredModelIds],
      fallbackModelIds: [...input.fallbackModelIds],
      requiredCapabilities: [...input.requiredCapabilities],
      executionPreference: input.executionPreference,
      qualityPreference: input.qualityPreference,
      allowCloudFallback: input.allowCloudFallback,
      maxCostPerRequest: input.maxCostPerRequest,
      maxLatencyMs: input.maxLatencyMs,
      minimumContextWindow: input.minimumContextWindow,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      updatedBy: input.updatedBy
    };
    this.modelPreferences.set(preference.id, preference);
    return { ...preference };
  }

  getModelPreference(
    tenantId: string,
    scope: ModelPreferenceScope,
    scopeId: string
  ): ModelPreferenceSummary | null {
    const preference = this.findPreference(tenantId, scope, scopeId);
    return preference === undefined ? null : { ...preference };
  }

  listModelPreferences(tenantId: string): ModelPreferenceSummary[] {
    return [...this.modelPreferences.values()]
      .filter((preference) => preference.tenantId === tenantId)
      .map((preference) => ({ ...preference }));
  }

  private findPreference(
    tenantId: string,
    scope: ModelPreferenceScope,
    scopeId: string
  ): ModelPreferenceSummary | undefined {
    return [...this.modelPreferences.values()].find(
      (preference) =>
        preference.tenantId === tenantId &&
        preference.scope === scope &&
        preference.scopeId === scopeId
    );
  }

  registerRuntimeHost(input: {
    accountId: string;
    ownerId: string;
    name: string;
    trustLevel: RuntimeHostTrustLevel;
    brokerNodeId?: string | null;
    declaredRuntimes: string[];
    maxConcurrentJobs: number;
    now?: Date;
  }): RuntimeHostSummary {
    const name = input.name.trim();
    if (name.length === 0 || name.length > 120) {
      throw new Cp2Error(400, "runtime_host_name_invalid", "Runtime host name is invalid.");
    }
    if (input.maxConcurrentJobs < 1 || input.maxConcurrentJobs > 8) {
      throw new Cp2Error(
        400,
        "runtime_host_concurrency_invalid",
        "maxConcurrentJobs must be between 1 and 8."
      );
    }
    const now = (input.now ?? new Date()).toISOString();
    const host: RuntimeHostSummary = {
      id: randomUUID(),
      accountId: input.accountId,
      ownerId: input.ownerId,
      name,
      trustLevel: input.trustLevel,
      brokerNodeId: input.brokerNodeId ?? null,
      declaredRuntimes: [...input.declaredRuntimes],
      maxConcurrentJobs: input.maxConcurrentJobs,
      createdAt: now,
      updatedAt: now
    };
    this.runtimeHosts.set(host.id, host);
    return { ...host };
  }

  getRuntimeHost(id: string): RuntimeHostSummary | null {
    const host = this.runtimeHosts.get(id);
    return host === undefined ? null : { ...host };
  }

  listRuntimeHosts(accountId: string): RuntimeHostSummary[] {
    return [...this.runtimeHosts.values()]
      .filter((host) => host.accountId === accountId)
      .map((host) => ({ ...host }));
  }

  installRuntimeModel(input: {
    runtimeHostId: string;
    accountId: string;
    modelId: string;
    now?: Date;
  }): RuntimeModelInstallationSummary {
    const host = this.runtimeHosts.get(input.runtimeHostId);
    if (host === undefined || host.accountId !== input.accountId) {
      throw new Cp2Error(404, "runtime_host_not_found", "Runtime host was not found.");
    }
    const modelId = input.modelId.trim();
    if (modelId.length === 0) {
      throw new Cp2Error(400, "runtime_model_id_invalid", "modelId is required.");
    }
    const now = (input.now ?? new Date()).toISOString();
    const existing = [...this.runtimeModelInstallations.values()].find(
      (installation) =>
        installation.runtimeHostId === input.runtimeHostId && installation.modelId === modelId
    );
    const installation: RuntimeModelInstallationSummary = {
      id: existing?.id ?? randomUUID(),
      runtimeHostId: input.runtimeHostId,
      accountId: input.accountId,
      modelId,
      status: "installed",
      installedAt: existing?.installedAt ?? now,
      updatedAt: now
    };
    this.runtimeModelInstallations.set(installation.id, installation);
    return { ...installation };
  }

  removeRuntimeModelInstallation(id: string, accountId: string, now: Date = new Date()): void {
    const installation = this.runtimeModelInstallations.get(id);
    if (installation === undefined || installation.accountId !== accountId) {
      throw new Cp2Error(404, "runtime_model_installation_not_found", "Installation was not found.");
    }
    this.runtimeModelInstallations.set(id, {
      ...installation,
      status: "removed",
      updatedAt: now.toISOString()
    });
  }

  listRuntimeModelInstallations(runtimeHostId: string): RuntimeModelInstallationSummary[] {
    return [...this.runtimeModelInstallations.values()]
      .filter(
        (installation) =>
          installation.runtimeHostId === runtimeHostId && installation.status === "installed"
      )
      .map((installation) => ({ ...installation }));
  }

  /**
   * Opens one append-only execution-history record for a turn the flagged planner path is about
   * to attempt (docs/architecture/agent-execution-fabric-phase2.md §4). Never called on the
   * flag-off/legacy path - that path has no ExecutionPlan to record against.
   */
  startExecution(input: {
    conversationId: string | null;
    messageId: string | null;
    agentId: string;
    modelPreferenceId: string | null;
    now?: Date;
  }): ExecutionHistoryRecord {
    const record: ExecutionHistoryRecord = {
      executionId: randomUUID(),
      conversationId: input.conversationId,
      messageId: input.messageId,
      agentId: input.agentId,
      modelPreferenceId: input.modelPreferenceId,
      resolvedModelId: null,
      runtimeHostId: null,
      startedAt: (input.now ?? new Date()).toISOString(),
      completedAt: null,
      outcome: "failed",
      fallbackDepth: 0
    };
    this.executionHistory.set(record.executionId, record);
    return { ...record };
  }

  completeExecution(input: {
    executionId: string;
    resolvedModelId: string | null;
    runtimeHostId: string | null;
    outcome: ExecutionHistoryOutcome;
    fallbackDepth: number;
    now?: Date;
  }): ExecutionHistoryRecord {
    const existing = this.executionHistory.get(input.executionId);
    if (existing === undefined) {
      throw new Cp2Error(404, "execution_history_not_found", "Execution history record was not found.");
    }
    const record: ExecutionHistoryRecord = {
      ...existing,
      resolvedModelId: input.resolvedModelId,
      runtimeHostId: input.runtimeHostId,
      outcome: input.outcome,
      fallbackDepth: input.fallbackDepth,
      completedAt: (input.now ?? new Date()).toISOString()
    };
    this.executionHistory.set(record.executionId, record);
    return { ...record };
  }

  listExecutionHistory(agentId: string, limit = 50): ExecutionHistoryRecord[] {
    return [...this.executionHistory.values()]
      .filter((record) => record.agentId === agentId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .slice(0, limit)
      .map((record) => ({ ...record }));
  }

  // Phase 2.5 (docs/architecture/agent-execution-fabric-phase2-5.md). Exposed for
  // Cp2Store.snapshot() the same way every other domain exposes its maps (e.g.
  // AgentRuntimeDomain.agentModelBindingsMap) - `executionHistory` is deliberately not exposed
  // here (see the class doc comment).
  get modelPreferencesMap(): Map<string, ModelPreferenceSummary> {
    return this.modelPreferences;
  }

  get runtimeHostsMap(): Map<string, RuntimeHostSummary> {
    return this.runtimeHosts;
  }

  get runtimeModelInstallationsMap(): Map<string, RuntimeModelInstallationSummary> {
    return this.runtimeModelInstallations;
  }

  clear(): void {
    this.modelPreferences.clear();
    this.runtimeHosts.clear();
    this.runtimeModelInstallations.clear();
    // executionHistory is intentionally left untouched by clear()/restore() - it never
    // participates in snapshot/hydration (see the class doc comment).
  }

  restore(snapshot: Cp2Snapshot): void {
    for (const preference of snapshot.modelPreferences ?? []) {
      this.modelPreferences.set(preference.id, preference);
    }
    for (const host of snapshot.runtimeHosts ?? []) {
      this.runtimeHosts.set(host.id, host);
    }
    for (const installation of snapshot.runtimeModelInstallations ?? []) {
      this.runtimeModelInstallations.set(installation.id, installation);
    }
  }
}
