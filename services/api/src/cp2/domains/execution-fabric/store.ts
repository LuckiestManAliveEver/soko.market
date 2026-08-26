import { randomUUID } from "node:crypto";

import type {
  ModelExecutionPreference,
  ModelPreferenceScope,
  ModelPreferenceSummary,
  ModelQualityPreference,
  RuntimeHostSummary,
  RuntimeHostTrustLevel,
  RuntimeModelInstallationSummary
} from "@soko/shared-types";

import { Cp2Error } from "../../cp2-error.js";

/**
 * Standalone, additive persistence for the Phase 1 Execution Fabric entities
 * (docs/architecture/agent-execution-fabric-phase1.md). Deliberately NOT a Cp2Store domain slice
 * (unlike agent-runtime/messaging/etc.) - it is not imported by services/api/src/cp2/store.ts,
 * postgres-store.ts, or routes.ts anywhere. That is intentional for this phase ("sits next to the
 * current routing path, not in front of it yet"): wiring this into Cp2Store's unified
 * snapshot/hydration/deletion-propagation machinery, and giving it real session-authenticated HTTP
 * routes, is Phase 2 work, done at the same time as cutover.
 *
 * Persisted shape backed by migration 060_execution_fabric_entities.sql
 * (cp2_model_preferences, cp2_runtime_hosts, cp2_runtime_model_installations) - this class itself
 * is in-memory only for this phase, exactly like every other Cp2Store domain is in-memory-first
 * with a separate Postgres mapping layer; that Postgres mapping is Phase 2 work alongside the
 * Cp2Store wiring above, not duplicated ahead of time here.
 *
 * Callers pass already-authenticated identity (accountId/userId/tenantId) rather than a
 * sessionId - this store does not perform session/membership authentication itself, since doing
 * so would require importing Cp2Store's auth internals and create exactly the coupling this phase
 * is meant to avoid. A real HTTP route in front of this store (Phase 2) is responsible for
 * authenticating the caller before calling any method here.
 */
export class ExecutionFabricStore {
  private readonly modelPreferences = new Map<string, ModelPreferenceSummary>();
  private readonly runtimeHosts = new Map<string, RuntimeHostSummary>();
  private readonly runtimeModelInstallations = new Map<string, RuntimeModelInstallationSummary>();

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
}
