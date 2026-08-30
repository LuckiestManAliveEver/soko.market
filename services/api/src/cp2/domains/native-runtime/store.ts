import { createHash } from "node:crypto";

import type {
  ActiveNativeAgentBinding,
  AiModelSummary,
  ConversationSummary,
  ModelExecutionTarget,
  PlatformDefaultRuntimePolicy,
  NativeDefaultRuntimeProvisioningInput,
  NativeDefaultRuntimeProvisioningResult,
  NativeRuntimeAvailabilityStatus,
  NativeRuntimeActivationInput,
  NativeExecutionHostSummary,
  NativeModelInstallationSummary,
  NativeRuntimeAgentSummary,
  NativeRuntimeBindingModelSummary,
  NativeRuntimeBindingSummary,
  NativeRuntimeModelSummary,
  ResolvedNativeRuntimeBinding,
  ResolvedNativeRuntimeModel
} from "@soko/shared-types";
import {
  isModelExecutionTarget,
  repositoryDefaultRuntimePolicy,
  resolveRuntimeModel
} from "@soko/shared-types";

import { Cp2Error } from "../../cp2-error.js";
import { runtimeAdapterIdForAgent } from "../../../agent-harness/agent-runtime-adapter.js";

export const nativeRuntimeContractVersion = "1";
export const builtinRuntimeAgentId = "builtin:pi:v1";
export const legacyBuiltinRuntimeAgentId = "builtin:soko-agent:v1";
export const globalDefaultRuntimeBindingId = "builtin:soko-default-runtime:v1";

export interface NativeRuntimeSnapshot {
  nativeRuntimeAgents?: NativeRuntimeAgentSummary[];
  nativeRuntimeModels?: NativeRuntimeModelSummary[];
  nativeExecutionHosts?: NativeExecutionHostSummary[];
  nativeModelInstallations?: NativeModelInstallationSummary[];
  nativeRuntimeBindings?: NativeRuntimeBindingSummary[];
  nativeRuntimeBindingModels?: NativeRuntimeBindingModelSummary[];
}

export class NativeRuntimeBindingStore {
  private readonly agents = new Map<string, NativeRuntimeAgentSummary>();
  private readonly models = new Map<string, NativeRuntimeModelSummary>();
  private readonly hosts = new Map<string, NativeExecutionHostSummary>();
  private readonly installations = new Map<string, NativeModelInstallationSummary>();
  private readonly bindings = new Map<string, NativeRuntimeBindingSummary>();
  private readonly bindingModels = new Map<string, NativeRuntimeBindingModelSummary>();

  constructor(
    private readonly defaultRuntimePolicy: PlatformDefaultRuntimePolicy = repositoryDefaultRuntimePolicy
  ) {
    this.ensureGlobalDefault();
  }

  // Provider-neutral by construction: this creates only the two concepts genuinely built into
  // Soko itself (the built-in agent, and a global default runtime *slot*). It deliberately does
  // not create a model, execution host, or installation for that slot - no model vendor is
  // required for Soko to boot. The slot starts "draft" (see NativeRuntimeBindingStatus) with zero
  // model assignments; resolveRuntimeBinding reports that state as RUNTIME_MODEL_NOT_CONFIGURED
  // rather than resolving a fake or hardcoded model. See docs/architecture/
  // provider-neutral-runtime.md and infra/db/migrations/067_provider_agnostic_runtime_default.sql,
  // which converts the equivalent pre-existing production seed (migration 065's forced
  // openai-fast default) into this same unconfigured state.
  ensureGlobalDefault(now: Date = new Date()): NativeRuntimeBindingSummary {
    const timestamp = now.toISOString();
    const agentId = this.defaultRuntimePolicy.agentId;
    const adapterId = this.defaultRuntimePolicy.agentRuntimeAdapterId;
    const existingAgent = this.agents.get(agentId);
    this.agents.set(agentId, {
      id: agentId,
      businessId: null,
      accountId: null,
      name: this.defaultRuntimePolicy.agentName,
      provider: adapterId === "pi" ? "pi" : "soko-business-agent",
      packageRef: adapterId === "pi" ? "npm:@earendil-works/pi-agent-core@0.84.4" : null,
      version: "1",
      runtimeContractVersion: nativeRuntimeContractVersion,
      capabilities: ["tools", "mcp"],
      configuration: {
        runtimeAdapterId: this.defaultRuntimePolicy.agentRuntimeAdapterId,
        requiredModelCapabilities: ["chat"]
      },
      status: "active",
      createdAt: existingAgent?.createdAt ?? timestamp,
      updatedAt: timestamp
    });
    const existing = this.bindings.get(globalDefaultRuntimeBindingId);
    if (existing === undefined) {
      this.bindings.set(globalDefaultRuntimeBindingId, {
        id: globalDefaultRuntimeBindingId,
        businessId: null,
        accountId: null,
        agentId,
        name: `${this.defaultRuntimePolicy.agentName} default runtime`,
        status: "draft",
        isDefault: true,
        configuration: { source: "repository-default" },
        runtimeContractVersion: nativeRuntimeContractVersion,
        createdAt: timestamp,
        updatedAt: timestamp,
        updatedBy: "system"
      });
    }
    return this.bindings.get(globalDefaultRuntimeBindingId) as NativeRuntimeBindingSummary;
  }

  // The general-purpose "choose a model" operation for the global default runtime slot: any
  // catalog model on any execution target can occupy it, and calling this again with a different
  // model swaps the primary assignment in place - the binding's id (and therefore every
  // conversation.runtimeBindingId pointing at it) never changes. This is the provider-neutral
  // replacement for the old hardcoded openai-fast seed: OpenAI, a local browser model, an owner
  // node model, or any future provider all go through this same call.
  activateGlobalDefaultModel(input: {
    model: AiModelSummary;
    executionTarget: ModelExecutionTarget;
    checkedAt: string;
    updatedBy: string;
  }): NativeRuntimeBindingSummary {
    const binding = this.bindings.get(globalDefaultRuntimeBindingId);
    const agent = this.agents.get(this.defaultRuntimePolicy.agentId);
    if (binding === undefined || agent === undefined) {
      throw new Cp2Error(
        503,
        "RUNTIME_DEFAULT_MISSING",
        "No global default runtime binding is configured."
      );
    }
    const model = this.upsertCatalogModel(input.model, input.executionTarget, input.checkedAt);
    this.validateCapabilityMatch(agent, model);
    const host = this.upsertVerifiedHost({
      accountId: null,
      businessId: null,
      executionTarget: input.executionTarget,
      checkedAt: input.checkedAt
    });
    this.upsertInstallation(model.id, host.id, input.checkedAt);
    for (const [id, role] of this.bindingModels) {
      if (role.runtimeBindingId === binding.id && role.role === "primary") {
        this.bindingModels.delete(id);
      }
    }
    const role = roleRecord(binding.id, model.id, "primary", 0, host.id, input.checkedAt);
    this.bindingModels.set(role.id, role);
    const nextBinding: NativeRuntimeBindingSummary = {
      ...binding,
      status: "active",
      updatedAt: input.checkedAt,
      updatedBy: input.updatedBy
    };
    this.bindings.set(binding.id, nextBinding);
    return { ...nextBinding };
  }

  activateVerifiedModel(input: NativeRuntimeActivationInput): NativeRuntimeBindingSummary {
    const timestamp = input.checkedAt;
    // Precedence: an explicit request always wins; otherwise keep this shop's already-chosen
    // harness in place (a model swap must not silently reset it); a shop with no prior activation
    // starts from the platform default, not a hardcoded engine.
    const existingAgent = this.agents.get(input.agentId);
    const adapterId =
      input.agentRuntimeAdapterId ??
      (existingAgent === undefined
        ? this.defaultRuntimePolicy.agentRuntimeAdapterId
        : runtimeAdapterIdForAgent(existingAgent));
    const agent = this.upsertAgent({
      id: input.agentId,
      businessId: input.businessId,
      accountId: input.accountId,
      name: input.agentName,
      provider: adapterId === "pi" ? "pi" : "soko-business-agent",
      packageRef: adapterId === "pi" ? "npm:@earendil-works/pi-agent-core@0.84.4" : null,
      version: "1",
      runtimeContractVersion: nativeRuntimeContractVersion,
      capabilities: ["tools", "mcp"],
      configuration: {
        runtimeAdapterId: adapterId,
        requiredModelCapabilities: ["chat"]
      },
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    const primaryModel = this.upsertCatalogModel(input.model, input.executionTarget, timestamp);
    const primaryHost = this.upsertVerifiedHost({
      accountId: input.accountId,
      businessId: input.businessId,
      executionTarget: input.executionTarget,
      checkedAt: timestamp
    });
    this.upsertInstallation(primaryModel.id, primaryHost.id, timestamp);

    // accountId must scope this lookup exactly like every other binding lookup in this store
    // (ensureDefaultRuntimeBinding's "existing" check, assignConversationBinding) - otherwise two
    // staff accounts on the same shop share one agentId, and the second account's first activation
    // silently reassigns the first account's already-provisioned binding to itself instead of
    // creating its own.
    const matching = [...this.bindings.values()].find(
      (binding) =>
        binding.businessId === input.businessId &&
        binding.accountId === input.accountId &&
        binding.agentId === agent.id &&
        binding.status === "active"
    );
    const bindingId =
      matching?.id ??
      stableUuid(`native-runtime-binding:${input.accountId}:${input.businessId}:${input.agentId}`);
    const binding: NativeRuntimeBindingSummary = {
      id: bindingId,
      businessId: input.businessId,
      accountId: input.accountId,
      agentId: agent.id,
      name: `${input.agentName} runtime`,
      status: "active",
      isDefault: false,
      configuration: { source: "model-activation" },
      runtimeContractVersion: nativeRuntimeContractVersion,
      createdAt: matching?.createdAt ?? timestamp,
      updatedAt: timestamp,
      updatedBy: input.updatedBy
    };

    const roles: NativeRuntimeBindingModelSummary[] = [
      roleRecord(binding.id, primaryModel.id, "primary", 0, primaryHost.id, timestamp)
    ];
    if (input.fallbackModel !== null) {
      const fallbackTarget = input.fallbackExecutionTarget ?? input.executionTarget;
      const fallbackModel = this.upsertCatalogModel(input.fallbackModel, fallbackTarget, timestamp);
      const fallbackHost = this.upsertVerifiedHost({
        accountId: input.accountId,
        businessId: input.businessId,
        executionTarget: fallbackTarget,
        checkedAt: timestamp
      });
      this.upsertInstallation(fallbackModel.id, fallbackHost.id, timestamp);
      roles.push(
        roleRecord(binding.id, fallbackModel.id, "fallback", 0, fallbackHost.id, timestamp)
      );
    }

    validateActiveTopology(binding, roles);
    for (const existingBinding of this.bindings.values()) {
      if (
        existingBinding.id !== binding.id &&
        existingBinding.accountId === binding.accountId &&
        existingBinding.agentId === binding.agentId &&
        existingBinding.status === "active"
      ) {
        this.bindings.set(existingBinding.id, {
          ...existingBinding,
          status: "inactive",
          isDefault: false,
          updatedAt: timestamp,
          updatedBy: input.updatedBy
        });
      }
    }
    for (const [id, role] of this.bindingModels) {
      if (role.runtimeBindingId === binding.id) this.bindingModels.delete(id);
    }
    for (const role of roles) this.bindingModels.set(role.id, role);
    this.bindings.set(binding.id, binding);
    return { ...binding };
  }

  /**
   * Idempotently provisions the minimum shop-scoped graph needed by first chat. Candidates have
   * already passed adapter availability checks, so this method performs no network I/O. Existing
   * active bindings are never reset: explicit local-only/model preferences remain authoritative.
   * Stable IDs make simultaneous first-chat requests converge even across API processes.
   */
  ensureDefaultRuntimeBinding(
    input: NativeDefaultRuntimeProvisioningInput
  ): NativeDefaultRuntimeProvisioningResult {
    const candidates = dedupeProvisioningCandidates(input.candidates);
    const existing = [...this.bindings.values()]
      .filter(
        (binding) =>
          binding.businessId === input.businessId &&
          binding.accountId === input.accountId &&
          binding.agentId === input.agentId &&
          binding.status === "active"
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (existing !== undefined) {
      // An explicit local preference remains the primary. When its policy permits fallback, the
      // domain calls this method with an adapter-verified backend candidate so a later server
      // request has somewhere legitimate to run instead of treating the local host as reachable
      // from the API process.
      const roles = [...this.bindingModels.values()].filter(
        (role) => role.runtimeBindingId === existing.id && role.enabled
      );
      const hasBackendRole = roles.some(
        (role) =>
          (role.executionHostId === null
            ? this.models.get(role.modelId)?.configuration.executionTarget
            : this.hosts.get(role.executionHostId)?.type) === "backend"
      );
      const backendCandidate = candidates.find(
        (candidate) => candidate.executionTarget === "backend"
      );
      if (!hasBackendRole && backendCandidate !== undefined) {
        const agent = this.requireActiveAgent(existing);
        const model = this.upsertCatalogModel(
          backendCandidate.model,
          backendCandidate.executionTarget,
          input.checkedAt
        );
        this.validateCapabilityMatch(agent, model);
        const host = this.upsertVerifiedHost({
          accountId: input.accountId,
          businessId: input.businessId,
          executionTarget: backendCandidate.executionTarget,
          checkedAt: input.checkedAt
        });
        this.upsertInstallation(model.id, host.id, input.checkedAt);
        const fallbackPriority =
          Math.max(
            -1,
            ...roles.filter((role) => role.role === "fallback").map((role) => role.priority)
          ) + 1;
        const fallback = roleRecord(
          existing.id,
          model.id,
          "fallback",
          fallbackPriority,
          host.id,
          input.checkedAt
        );
        this.bindingModels.set(fallback.id, fallback);
        const extended: NativeRuntimeBindingSummary = {
          ...existing,
          configuration: { ...existing.configuration, allowFallback: true },
          updatedAt: input.checkedAt,
          updatedBy: input.updatedBy
        };
        this.bindings.set(extended.id, extended);
        return {
          binding: { ...extended },
          created: false,
          resolutionReason: "hosted-fallback-attached"
        };
      }
      return {
        binding: { ...existing },
        created: false,
        resolutionReason: "existing-binding-preserved"
      };
    }
    const [primary, ...fallbacks] = candidates;
    if (primary === undefined) {
      throw new Cp2Error(
        503,
        "RUNTIME_MODELS_UNAVAILABLE",
        "Soko AI is temporarily unavailable because no execution host can run a compatible model.",
        true
      );
    }

    const binding = this.activateVerifiedModel({
      businessId: input.businessId,
      accountId: input.accountId,
      agentId: input.agentId,
      agentName: input.agentName,
      ...(input.agentRuntimeAdapterId === undefined
        ? {}
        : { agentRuntimeAdapterId: input.agentRuntimeAdapterId }),
      model: primary.model,
      executionTarget: primary.executionTarget,
      fallbackModel: fallbacks[0]?.model ?? null,
      ...(fallbacks[0] === undefined
        ? {}
        : { fallbackExecutionTarget: fallbacks[0].executionTarget }),
      updatedBy: input.updatedBy,
      checkedAt: input.checkedAt
    });
    const provisioned: NativeRuntimeBindingSummary = {
      ...binding,
      isDefault: true,
      configuration: {
        ...binding.configuration,
        source: "zero-setup-provisioning",
        executionPolicy: "automatic-hosted-first",
        allowFallback: true
      }
    };
    this.bindings.set(provisioned.id, provisioned);
    return {
      binding: { ...provisioned },
      created: true,
      resolutionReason: "default-binding-created"
    };
  }

  bindingForBusinessAgent(businessId: string, agentId: string): NativeRuntimeBindingSummary | null {
    return (
      [...this.bindings.values()]
        .filter(
          (binding) =>
            binding.businessId === businessId &&
            binding.agentId === agentId &&
            binding.status === "active"
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
    );
  }

  /** The single per-shop-agent binding + its enabled primary model, the sole read path for "which
   *  model is this agent using" (replaces the retired legacy agentModelBindings map/table).
   *  Returns null rather than throwing when nothing is active yet, or when a matched binding has no
   *  enabled primary role - both are normal "not configured" states for a GET/routing read, not
   *  errors. */
  getActiveBindingForAgent(businessId: string, agentId: string): ActiveNativeAgentBinding | null {
    const binding = this.bindingForBusinessAgent(businessId, agentId);
    if (binding === null) return null;
    const role = [...this.bindingModels.values()].find(
      (candidate) =>
        candidate.runtimeBindingId === binding.id &&
        candidate.enabled &&
        candidate.role === "primary"
    );
    if (role === undefined) return null;
    const model = this.models.get(role.modelId);
    if (model === undefined) return null;
    const hostType =
      role.executionHostId === null ? undefined : this.hosts.get(role.executionHostId)?.type;
    const executionTarget = isModelExecutionTarget(hostType)
      ? hostType
      : isModelExecutionTarget(model.configuration.executionTarget)
        ? model.configuration.executionTarget
        : null;
    if (executionTarget === null) return null;
    return { binding, model, role, executionTarget };
  }

  /** The harness currently configured for a native runtime agent record, if one has ever been
   *  materialized (by activateVerifiedModel or ensureGlobalDefault) for this id. */
  resolveAgentRuntimeAdapterId(agentId: string): string | undefined {
    const agent = this.agents.get(agentId);
    return agent === undefined ? undefined : runtimeAdapterIdForAgent(agent);
  }

  deactivateBusinessAgentBinding(
    businessId: string,
    agentId: string,
    updatedBy: string,
    now: Date = new Date()
  ): string | null {
    const binding = this.bindingForBusinessAgent(businessId, agentId);
    if (binding === null) return null;
    this.bindings.set(binding.id, {
      ...binding,
      status: "inactive",
      isDefault: false,
      updatedAt: now.toISOString(),
      updatedBy
    });
    return binding.id;
  }

  assignConversationBinding(input: {
    accountId: string;
    activeShopId: string | null;
    requestedBindingId?: string | null;
  }): string {
    if (input.requestedBindingId !== undefined && input.requestedBindingId !== null) {
      const requested = this.requireAssignableBinding(input.requestedBindingId, input);
      return requested.id;
    }
    if (input.activeShopId !== null) {
      const tenantBinding = [...this.bindings.values()]
        .filter(
          (binding) =>
            binding.businessId === input.activeShopId &&
            binding.accountId === input.accountId &&
            binding.status === "active"
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      if (tenantBinding !== undefined) return tenantBinding.id;
    }
    return this.requireGlobalDefault().id;
  }

  resolveRuntimeBinding(
    conversationId: string,
    conversations: ReadonlyMap<string, ConversationSummary>
  ): ResolvedNativeRuntimeBinding {
    const conversation = conversations.get(conversationId);
    if (conversation === undefined) {
      throw new Cp2Error(404, "RUNTIME_CONVERSATION_NOT_FOUND", "Conversation was not found.");
    }
    const explicitId = conversation.runtimeBindingId;
    const binding =
      explicitId === null ? this.requireGlobalDefault() : this.bindings.get(explicitId);
    if (binding === undefined) {
      throw new Cp2Error(
        409,
        "RUNTIME_BINDING_NOT_FOUND",
        "The conversation runtime binding no longer exists.",
        false,
        { conversationId, runtimeBindingId: explicitId }
      );
    }
    return this.resolveBinding(binding, conversationId, explicitId === null);
  }

  resolveBindingForConversation(
    bindingId: string,
    conversationId = "runtime-unbound"
  ): ResolvedNativeRuntimeBinding {
    const binding = this.bindings.get(bindingId);
    if (binding === undefined) {
      throw new Cp2Error(409, "RUNTIME_BINDING_NOT_FOUND", "Runtime binding was not found.");
    }
    return this.resolveBinding(binding, conversationId, false);
  }

  // The binding/agent-only half of structural validity: does the binding exist and belong to an
  // active agent with a compatible contract version. Deliberately says nothing about whether a
  // model is assigned - a conversation must be attachable to a binding (requireAssignableBinding
  // below) whether or not one has been chosen yet, exactly like the implicit global-default path
  // (requireGlobalDefault). See docs/architecture/provider-neutral-runtime.md §5.
  private requireActiveAgent(binding: NativeRuntimeBindingSummary): NativeRuntimeAgentSummary {
    if (binding.status !== "active" && binding.status !== "draft") {
      throw new Cp2Error(409, "RUNTIME_BINDING_INACTIVE", "Runtime binding is not active.");
    }
    const agent = this.agents.get(binding.agentId);
    if (agent === undefined || agent.status !== "active") {
      throw new Cp2Error(409, "RUNTIME_AGENT_UNAVAILABLE", "Runtime binding agent is unavailable.");
    }
    if (agent.runtimeContractVersion !== binding.runtimeContractVersion) {
      throw incompatibleContract(binding.id, agent.id, null);
    }
    return agent;
  }

  // Full structural validity for turn-time resolution: the binding/agent check above, plus
  // whether a model is actually assigned. Deliberately does not resolve installation/host
  // availability - that unreachable-model case is a turn-time concern checked separately by
  // resolveBinding below (RUNTIME_MODELS_UNAVAILABLE); this only reports whether a model was ever
  // chosen at all (RUNTIME_MODEL_NOT_CONFIGURED).
  private validateBindingStructure(binding: NativeRuntimeBindingSummary): {
    agent: NativeRuntimeAgentSummary;
    primaryRole: NativeRuntimeBindingModelSummary;
    enabledRoles: NativeRuntimeBindingModelSummary[];
  } {
    const agent = this.requireActiveAgent(binding);
    const enabledRoles = [...this.bindingModels.values()].filter(
      (role) => role.runtimeBindingId === binding.id && role.enabled
    );
    const primaryRoles = enabledRoles.filter((role) => role.role === "primary");
    if (primaryRoles.length === 0) {
      if (binding.status === "draft") {
        throw new Cp2Error(
          503,
          "RUNTIME_MODEL_NOT_CONFIGURED",
          "No model is assigned to this runtime. Choose or install a model before sending an AI message."
        );
      }
      throw new Cp2Error(
        409,
        "RUNTIME_PRIMARY_INVALID",
        "An active runtime binding must have exactly one enabled primary model."
      );
    }
    if (primaryRoles.length > 1) {
      throw new Cp2Error(
        409,
        "RUNTIME_PRIMARY_INVALID",
        "An active runtime binding must have exactly one enabled primary model."
      );
    }
    return {
      agent,
      primaryRole: primaryRoles[0] as NativeRuntimeBindingModelSummary,
      enabledRoles
    };
  }

  private resolveBinding(
    binding: NativeRuntimeBindingSummary,
    conversationId: string,
    usedGlobalDefault: boolean
  ): ResolvedNativeRuntimeBinding {
    const { agent, primaryRole, enabledRoles } = this.validateBindingStructure(binding);
    const primary = this.resolveRole(binding, agent, primaryRole);
    const fallbacks = enabledRoles
      .filter((role) => role.role === "fallback")
      .sort(compareRoles)
      .map((role) => this.resolveRole(binding, agent, role));
    const auxiliaryEntries = enabledRoles
      .filter((role) => role.role !== "primary" && role.role !== "fallback")
      .sort(compareRoles)
      .map((role) => [role.role, this.resolveRole(binding, agent, role)] as const);
    const auxiliaries: Record<string, ResolvedNativeRuntimeModel[]> = {};
    for (const [role, resolved] of auxiliaryEntries) {
      (auxiliaries[role] ??= []).push(resolved);
    }
    const selected = [primary, ...fallbacks].find((candidate) => candidate.available);
    if (selected === undefined) {
      throw new Cp2Error(
        503,
        "RUNTIME_MODELS_UNAVAILABLE",
        "No available primary or fallback model exists for this runtime binding.",
        true,
        {
          bindingId: binding.id,
          candidates: JSON.stringify(
            [primary, ...fallbacks].map((candidate) => ({
              modelId: candidate.model.id,
              reason: candidate.unavailabilityReason
            }))
          )
        }
      );
    }
    return {
      conversationId,
      usedGlobalDefault,
      binding: { ...binding },
      agent: { ...agent },
      primary,
      fallbacks,
      auxiliaries,
      selected,
      fallbackUsed: selected.bindingModel.role === "fallback",
      fallbackReason:
        selected.bindingModel.role === "fallback"
          ? (primary.unavailabilityReason ?? "PRIMARY_UNAVAILABLE")
          : null,
      configuration: { ...binding.configuration }
    };
  }

  private resolveRole(
    binding: NativeRuntimeBindingSummary,
    agent: NativeRuntimeAgentSummary,
    role: NativeRuntimeBindingModelSummary
  ): ResolvedNativeRuntimeModel {
    const model = this.models.get(role.modelId);
    if (model === undefined) {
      throw new Cp2Error(409, "RUNTIME_MODEL_NOT_FOUND", "A bound runtime model was not found.");
    }
    this.validateCompatibility(agent, model);
    if (model.status !== "active") return unavailable(role, model, "MODEL_INACTIVE");
    const installations = [...this.installations.values()]
      .filter(
        (installation) =>
          installation.modelId === model.id &&
          (role.executionHostId === null || installation.executionHostId === role.executionHostId)
      )
      .sort((left, right) => left.executionHostId.localeCompare(right.executionHostId));
    if (installations.length === 0) return unavailable(role, model, "INSTALLATION_MISSING");
    for (const installation of installations) {
      const host = this.hosts.get(installation.executionHostId);
      if (!availabilityStatusUsable(installation.status)) continue;
      if (host === undefined || !availabilityStatusUsable(host.status)) continue;
      if (!hostAuthorizedForBinding(host, binding)) continue;
      return {
        bindingModel: { ...role },
        model: { ...model },
        installation: { ...installation },
        host: { ...host },
        available: true,
        unavailabilityReason: null
      };
    }
    const installation = installations[0] as NativeModelInstallationSummary;
    const host = this.hosts.get(installation.executionHostId) ?? null;
    return {
      bindingModel: { ...role },
      model: { ...model },
      installation: { ...installation },
      host: host === null ? null : { ...host },
      available: false,
      unavailabilityReason: !availabilityStatusUsable(installation.status)
        ? "INSTALLATION_UNAVAILABLE"
        : host === null
          ? "EXECUTION_HOST_MISSING"
          : !hostAuthorizedForBinding(host, binding)
            ? "EXECUTION_HOST_FORBIDDEN"
            : "EXECUTION_HOST_UNAVAILABLE"
    };
  }

  private validateCompatibility(
    agent: NativeRuntimeAgentSummary,
    model: NativeRuntimeModelSummary
  ): void {
    if (model.runtimeContractVersion !== agent.runtimeContractVersion) {
      throw incompatibleContract("unknown", agent.id, model.id);
    }
    this.validateCapabilityMatch(agent, model);
  }

  // Capability compatibility is checked purely against agent.configuration.requiredModelCapabilities
  // vs model.capabilities - never against provider/vendor name, per docs/architecture/
  // provider-neutral-runtime.md §13: any model from any provider that declares the right
  // capabilities (chat, tool-routing, reasoning, vision, coding, ...) is usable.
  private validateCapabilityMatch(
    agent: NativeRuntimeAgentSummary,
    model: NativeRuntimeModelSummary
  ): void {
    const required = Array.isArray(agent.configuration.requiredModelCapabilities)
      ? agent.configuration.requiredModelCapabilities.filter(
          (capability): capability is string => typeof capability === "string"
        )
      : [];
    const missing = required.filter((capability) => !model.capabilities.includes(capability));
    if (missing.length > 0) {
      throw new Cp2Error(
        409,
        "RUNTIME_MODEL_CAPABILITY_MISMATCH",
        "The selected model does not satisfy the agent's required capabilities.",
        false,
        { agentId: agent.id, modelId: model.id, missingCapabilities: missing.join(",") }
      );
    }
  }

  private requireAssignableBinding(
    bindingId: string,
    input: { accountId: string; activeShopId: string | null }
  ): NativeRuntimeBindingSummary {
    const binding = this.bindings.get(bindingId);
    // draft is accepted here for the same reason requireGlobalDefault accepts it: explicitly
    // requesting the (currently unconfigured) global default binding must succeed exactly like
    // falling back to it implicitly does - conversation creation must not depend on a model
    // already being assigned. See docs/architecture/provider-neutral-runtime.md §4.
    if (binding === undefined || (binding.status !== "active" && binding.status !== "draft")) {
      throw new Cp2Error(400, "RUNTIME_BINDING_INVALID", "Requested runtime binding is invalid.");
    }
    if (binding.accountId !== null && binding.accountId !== input.accountId) {
      throw new Cp2Error(
        403,
        "RUNTIME_BINDING_FORBIDDEN",
        "Runtime binding belongs to another account."
      );
    }
    if (binding.businessId !== null && binding.businessId !== input.activeShopId) {
      throw new Cp2Error(
        403,
        "RUNTIME_BINDING_FORBIDDEN",
        "Runtime binding belongs to another shop."
      );
    }
    this.requireActiveAgent(binding);
    return binding;
  }

  // Structural lookup only - draft (unconfigured) counts as a valid default just as much as
  // active, since assigning a conversation to the default slot (assignConversationBinding) must
  // succeed whether or not a model has been chosen yet. Whether that slot can actually run
  // inference is a separate, later question answered by validateBindingStructure/resolveBinding.
  private requireGlobalDefault(): NativeRuntimeBindingSummary {
    const defaults = [...this.bindings.values()].filter(
      (binding) =>
        binding.isDefault &&
        binding.businessId === null &&
        binding.accountId === null &&
        (binding.status === "active" || binding.status === "draft")
    );
    if (defaults.length !== 1) {
      throw new Cp2Error(
        503,
        "RUNTIME_DEFAULT_MISSING",
        "No unique global runtime binding is configured."
      );
    }
    return defaults[0] as NativeRuntimeBindingSummary;
  }

  private upsertAgent(agent: NativeRuntimeAgentSummary): NativeRuntimeAgentSummary {
    const existing = this.agents.get(agent.id);
    const next = { ...agent, createdAt: existing?.createdAt ?? agent.createdAt };
    this.agents.set(next.id, next);
    return next;
  }

  private upsertCatalogModel(
    model: AiModelSummary,
    executionTarget: ModelExecutionTarget,
    timestamp: string
  ): NativeRuntimeModelSummary {
    const existing = this.models.get(model.id);
    const providerMapping = resolveRuntimeModel(model.id);
    const next: NativeRuntimeModelSummary = {
      id: model.id,
      name: model.label,
      provider: providerMapping?.provider ?? model.provider,
      providerModelId: providerMapping?.providerModelId ?? model.id,
      runtimeContractVersion: nativeRuntimeContractVersion,
      capabilities: [...model.capabilities],
      configuration: {
        executionTarget,
        source: model.source,
        format: model.format,
        contextWindow: model.contextWindow
      },
      status: model.available ? "active" : "inactive",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    this.models.set(next.id, next);
    return next;
  }

  private upsertVerifiedHost(input: {
    accountId: string | null;
    businessId: string | null;
    executionTarget: ModelExecutionTarget;
    checkedAt: string;
  }): NativeExecutionHostSummary {
    const id = stableUuid(
      `native-runtime-host:${input.accountId ?? "global"}:${input.businessId ?? "global"}:${input.executionTarget}`
    );
    const existing = this.hosts.get(id);
    const host: NativeExecutionHostSummary = {
      id,
      businessId: input.businessId,
      accountId: input.accountId,
      type: input.executionTarget,
      name: hostName(input.executionTarget),
      endpoint: null,
      status: "healthy",
      capabilities: [input.executionTarget],
      configuration: { executionTarget: input.executionTarget },
      credentialReference: null,
      lastKnownHealthyAt: input.checkedAt,
      createdAt: existing?.createdAt ?? input.checkedAt,
      updatedAt: input.checkedAt
    };
    this.hosts.set(host.id, host);
    return host;
  }

  private upsertInstallation(modelId: string, hostId: string, timestamp: string): void {
    const id = stableUuid(`native-runtime-installation:${modelId}:${hostId}`);
    const existing = this.installations.get(id);
    this.installations.set(id, {
      id,
      modelId,
      executionHostId: hostId,
      status: "available",
      configuration: {},
      lastKnownHealthyAt: timestamp,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    });
  }

  clear(): void {
    this.agents.clear();
    this.models.clear();
    this.hosts.clear();
    this.installations.clear();
    this.bindings.clear();
    this.bindingModels.clear();
  }

  restore(snapshot: NativeRuntimeSnapshot): void {
    this.clear();
    for (const record of snapshot.nativeRuntimeAgents ?? []) this.agents.set(record.id, record);
    for (const record of snapshot.nativeRuntimeModels ?? []) this.models.set(record.id, record);
    for (const record of snapshot.nativeExecutionHosts ?? []) this.hosts.set(record.id, record);
    for (const record of snapshot.nativeModelInstallations ?? []) {
      this.installations.set(record.id, record);
    }
    for (const record of snapshot.nativeRuntimeBindings ?? []) this.bindings.set(record.id, record);
    for (const record of snapshot.nativeRuntimeBindingModels ?? []) {
      this.bindingModels.set(record.id, record);
    }
    this.ensureGlobalDefault();
  }

  get agentsMap(): Map<string, NativeRuntimeAgentSummary> {
    return this.agents;
  }
  get modelsMap(): Map<string, NativeRuntimeModelSummary> {
    return this.models;
  }
  get hostsMap(): Map<string, NativeExecutionHostSummary> {
    return this.hosts;
  }
  get installationsMap(): Map<string, NativeModelInstallationSummary> {
    return this.installations;
  }
  get bindingsMap(): Map<string, NativeRuntimeBindingSummary> {
    return this.bindings;
  }
  get bindingModelsMap(): Map<string, NativeRuntimeBindingModelSummary> {
    return this.bindingModels;
  }
}

function roleRecord(
  bindingId: string,
  modelId: string,
  role: string,
  priority: number,
  hostId: string,
  timestamp: string
): NativeRuntimeBindingModelSummary {
  return {
    id: stableUuid(`native-runtime-role:${bindingId}:${role}:${priority}:${modelId}`),
    runtimeBindingId: bindingId,
    modelId,
    role,
    priority,
    executionHostId: hostId,
    configuration: {},
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function dedupeProvisioningCandidates(
  candidates: NativeDefaultRuntimeProvisioningInput["candidates"]
): NativeDefaultRuntimeProvisioningInput["candidates"] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.model.id}:${candidate.executionTarget}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unavailable(
  role: NativeRuntimeBindingModelSummary,
  model: NativeRuntimeModelSummary,
  reason: string
): ResolvedNativeRuntimeModel {
  return {
    bindingModel: { ...role },
    model: { ...model },
    installation: null,
    host: null,
    available: false,
    unavailabilityReason: reason
  };
}

function hostAuthorizedForBinding(
  host: NativeExecutionHostSummary,
  binding: NativeRuntimeBindingSummary
): boolean {
  const accountAllowed = host.accountId === null || host.accountId === binding.accountId;
  const businessAllowed = host.businessId === null || host.businessId === binding.businessId;
  return accountAllowed && businessAllowed;
}

function availabilityStatusUsable(status: NativeRuntimeAvailabilityStatus): boolean {
  return status === "available" || status === "healthy" || status === "online";
}

function validateActiveTopology(
  binding: NativeRuntimeBindingSummary,
  roles: NativeRuntimeBindingModelSummary[]
): void {
  if (binding.status !== "active") return;
  if (roles.filter((role) => role.enabled && role.role === "primary").length !== 1) {
    throw new Cp2Error(
      409,
      "RUNTIME_PRIMARY_INVALID",
      "An active runtime binding must have exactly one enabled primary model."
    );
  }
  const fallbackPriorities = roles
    .filter((role) => role.enabled && role.role === "fallback")
    .map((role) => role.priority);
  if (new Set(fallbackPriorities).size !== fallbackPriorities.length) {
    throw new Cp2Error(
      409,
      "RUNTIME_FALLBACK_PRIORITY_CONFLICT",
      "Fallback priorities must be unique within a runtime binding."
    );
  }
}

function compareRoles(
  left: NativeRuntimeBindingModelSummary,
  right: NativeRuntimeBindingModelSummary
): number {
  return left.priority - right.priority || left.id.localeCompare(right.id);
}

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16] ?? "0", 16) % 4] as string;
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function hostName(target: ModelExecutionTarget): string {
  if (target === "remote-shop-device") return "Remote shop device runtime";
  return "Soko backend inference runtime";
}

function incompatibleContract(
  bindingId: string,
  agentId: string,
  modelId: string | null
): Cp2Error {
  return new Cp2Error(
    409,
    "RUNTIME_CONTRACT_INCOMPATIBLE",
    "The agent and model runtime contracts are incompatible.",
    false,
    { bindingId, agentId, modelId }
  );
}
