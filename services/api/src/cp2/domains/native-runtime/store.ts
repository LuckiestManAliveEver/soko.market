import { createHash, randomUUID } from "node:crypto";

import type {
  AiModelSummary,
  ConversationSummary,
  ModelExecutionTarget,
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

import { Cp2Error } from "../../cp2-error.js";

export const nativeRuntimeContractVersion = "1";
export const builtinRuntimeAgentId = "builtin:soko-agent:v1";
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

  constructor() {
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
    const existingAgent = this.agents.get(builtinRuntimeAgentId);
    this.agents.set(builtinRuntimeAgentId, {
      id: builtinRuntimeAgentId,
      businessId: null,
      accountId: null,
      name: "Soko built-in agent",
      provider: "soko",
      packageRef: null,
      version: "1",
      runtimeContractVersion: nativeRuntimeContractVersion,
      capabilities: ["tools", "mcp"],
      configuration: { requiredModelCapabilities: ["chat", "tool-routing"] },
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
        agentId: builtinRuntimeAgentId,
        name: "Soko default runtime",
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
    const agent = this.agents.get(builtinRuntimeAgentId);
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
    const agent = this.upsertAgent({
      id: input.agentId,
      businessId: input.businessId,
      accountId: input.accountId,
      name: input.agentName,
      provider: "soko-business-agent",
      packageRef: null,
      version: "1",
      runtimeContractVersion: nativeRuntimeContractVersion,
      capabilities: ["tools", "mcp"],
      configuration: { requiredModelCapabilities: ["tool-routing"] },
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

    const matching = [...this.bindings.values()].find(
      (binding) =>
        binding.businessId === input.businessId &&
        binding.agentId === agent.id &&
        binding.status === "active"
    );
    const bindingId = matching?.id ?? randomUUID();
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
      const fallbackTarget: ModelExecutionTarget =
        input.fallbackModel.provider === "openai" ? "openai" : input.executionTarget;
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
    const primary = this.resolveRole(agent, primaryRole);
    const fallbacks = enabledRoles
      .filter((role) => role.role === "fallback")
      .sort(compareRoles)
      .map((role) => this.resolveRole(agent, role));
    const auxiliaryEntries = enabledRoles
      .filter((role) => role.role !== "primary" && role.role !== "fallback")
      .sort(compareRoles)
      .map((role) => [role.role, this.resolveRole(agent, role)] as const);
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
      if (installation.status !== "available") continue;
      if (host === undefined || host.status !== "available") continue;
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
      unavailabilityReason:
        installation.status !== "available"
          ? "INSTALLATION_UNAVAILABLE"
          : host === null
            ? "EXECUTION_HOST_MISSING"
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
      (binding) => binding.isDefault && (binding.status === "active" || binding.status === "draft")
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
    const next: NativeRuntimeModelSummary = {
      id: model.id,
      name: model.label,
      provider: model.provider,
      providerModelId: model.id,
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
      `native-runtime-host:${input.accountId ?? "global"}:${input.executionTarget}`
    );
    const existing = this.hosts.get(id);
    const host: NativeExecutionHostSummary = {
      id,
      businessId: input.businessId,
      accountId: input.accountId,
      type: input.executionTarget,
      name: hostName(input.executionTarget),
      endpoint: null,
      status: "available",
      capabilities: [input.executionTarget],
      configuration: { executionTarget: input.executionTarget },
      credentialReference: input.executionTarget === "openai" ? "env:OPENAI_API_KEY" : null,
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
  if (target === "openai") return "OpenAI remote runtime";
  if (target === "browser-local") return "Browser local runtime";
  if (target === "installed-app") return "Installed application runtime";
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
