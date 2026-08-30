/**
 * Ninth slice of in-process domain modularization for the Cp2Store monolith (see
 * docs/architecture/domain-modularization-roadmap.md). The largest slice by method count and by
 * total line volume: owns `activeAiModels`, `agentProfiles`, `agentRuntimeVersions`,
 * `agentContextSources`, `agentEvaluationEvents`, `agentOwnerCorrections`,
 * `installedAgentModels` (+ the ephemeral `agentModelActivationLocks` mutex Set),
 * `runtimeSessions`, `runtimeTurns`, and `pendingRuntimeActions` (never persisted - no
 * `Cp2Snapshot` field) - plus the entire `createRuntimeTurn` pipeline (context retrieval, tool
 * proposal, confirmation, execution, model routing, recall persistence) and every
 * AI-model-catalog/activation/assignment method.
 *
 * **There is no `agentModelBindings` map here.** "Which model is this agent using" has exactly
 * one answer, read/written entirely through `deps.getActiveNativeRuntimeBinding`/
 * `deps.activateVerifiedRuntimeBinding` into `NativeRuntimeBindingStore`
 * (`../native-runtime/store.ts`) - the sole runtime-binding source of truth. The legacy table this
 * domain used to own directly, and the even-older `agentModelAssignments`/
 * `browserInferenceAssignments` tables before it, are gone (see migrations 075 and 076 under
 * infra/db/migrations/); `native-binding-projection.ts` builds the `AgentModelBindingSummary`
 * wire shape `AgentModelPanel.tsx`/`QuickRuntimeSwitcher.tsx` read as a read-through projection of
 * the native graph, not a second persisted representation.
 *
 * **`mcpAccessTokens`/`mcpTokenIdByHash` deliberately stayed on `Cp2Store`, not here** - despite
 * being declared next to this domain's Maps. Zero code coupling either direction was found
 * (confirmed by exhaustive read), they have their own dedicated route module
 * (`services/api/src/mcp/routes.ts`, entirely separate from `cp2/routes.ts`'s agent-runtime
 * routes), and `scripts/purge-all-users.sql` classifies them in a different delete-batch from
 * every agent-runtime table. A generic external-API-credential concern, not an agent-runtime one.
 *
 * **`attemptPublicAgentReply` and `publicAgentReplyRateLimited` also stayed on `Cp2Store`**
 * (already established when the messaging domain was extracted) - `attemptPublicAgentReply`
 * depends on seven agent-runtime primitives (`createCustomerCatalogueRuntimeTurn`,
 * `computeAgentRuntimeReadiness`, `currentAgentProfile`, `resolveActiveRuntimeModelId`,
 * `buildShopAgentRuntime`, `resolveRuntimeModelProvider`, `contextSourcesForRuntime` - one more
 * than originally documented when messaging was extracted; `createCustomerCatalogueRuntimeTurn`
 * was missed until this domain's own dependency-mapping research caught it). Rather than
 * reshaping `MessagingDomain`'s deps to inject all seven individually,
 * `createCustomerCatalogueRuntimeTurn` and `agentModelRecoveryGuidance` became deliberately
 * public accessors here (mirroring `ComplianceDomain`'s public `getOrCreate*` pattern), and
 * `Cp2Store`'s own `attemptPublicAgentReply`/messaging-constructor-wiring now call
 * `this.agentRuntimeDomain.X(...)` directly instead of `this.X(...)`.
 *
 * **Known pre-existing gap, preserved as-is (zero-behavior-change refactor, not a bugfix
 * opportunity):** `deleteShopOwnedData` (business-scoped deletion, stays on `Cp2Store`) only
 * sweeps `runtimeSessions`/`runtimeTurns`/`pendingRuntimeActions` -
 * `activeAiModels`/`agentProfiles`/`agentRuntimeVersions`/`agentContextSources`/
 * `agentEvaluationEvents`/`agentOwnerCorrections`/`installedAgentModels`/the native runtime
 * binding graph are never touched by shop-level deletion, only by the account-level purge
 * (`deleteAccountOwnedData`, which sweeps all of them completely - see that method's own comment
 * for exactly which native-runtime maps it sweeps and why `modelsMap` is deliberately excluded).
 * This was true before this extraction; flagging it here rather than silently fixing it as a
 * side effect, since shop-deletion semantics for business-scoped agent config deserve a
 * deliberate product decision, not an incidental one made while moving code.
 *
 * Coupling with the not-yet-extracted core auth/identity kernel and other domains, resolved as
 * constructor-injected callbacks/raw Map references (same pattern used throughout this refactor):
 * `businesses`/`sessions`/`products`/`customers`/`invoices` as read-only raw Map references (this
 * domain's own tiny `productsForBusiness`/`customersForBusiness`/`invoicesForBusiness` filters,
 * duplicated inline rather than injected as callbacks since they're one-line filters, same
 * choice `MessagingDomain` made for its own core-kernel Map reads); `buildRuntimeContext`
 * (cross-cutting report builder, stays on `Cp2Store`), `imageForProduct` (`publicProductImage`,
 * shared with the non-agent `queryCatalogue` path), `importsForBusiness`/`requireDocumentImport`
 * (`DocumentImportDomain` public accessors), `suppliersForBusiness`/`purchaseReceipts`
 * (`SupplierDomain` public accessors), and the `executeRuntimeAction` tool-dispatch table's
 * callbacks into `Cp2Store`'s own commerce/customer/product/messaging/document-import public
 * methods (`queryCatalogue`, `listProducts`, `listInvoices`, `createProduct`, `deleteProduct`,
 * `createCustomer`, `listPurchaseReceipts`, `confirmProductImport`, `confirmSupplierImport`,
 * `sendChannelMessage`).
 */
import { randomUUID } from "node:crypto";
import type {
  ActiveAiModelSummary,
  ActiveNativeAgentBinding,
  AgentAudience,
  AgentContextSource,
  AgentEvaluationEvent,
  AgentEvaluationEventType,
  AgentEvaluationSummary,
  AgentModelActivationResult,
  AgentModelBindingPermissions,
  AgentModelBindingRemovalResult,
  AgentModelBindingSummary,
  AgentOwnerCorrection,
  AgentRuntimeReadiness,
  AgentRuntimeVersion,
  AiModelSummary,
  InstalledAgentModelSummary,
  ModelExecutionTarget,
  ModelRuntimeHealthSummary,
  NativeRuntimeAgentSummary,
  PreferredExecutionMode,
  RuntimeContextSummary,
  RuntimeModelConversationMessage,
  RuntimeModelProvider,
  RuntimeModelTrace,
  RuntimePlannedAction,
  RuntimeSessionSummary,
  RuntimeTelemetryEvent,
  RuntimeToolName,
  RuntimeTurnResult,
  RuntimeTurnSummary,
  ShopAgentRuntime
} from "@soko/shared-types";
import { defaultAgentDefinitionId } from "@soko/shared-types";
import {
  createRuntimeToolProposal,
  createRuntimeToolProposalFromProductContextScript,
  parseMerchantCommand,
  parseProductContextScriptCommand,
  parseReceiptContextScriptCommand,
  parseRuntimeHashtagInvocation,
  productContextScriptMatchToParseResult,
  receiptContextScriptMatchToParseResult,
  runtimeToolRegistry
} from "@soko/tool-core";
import { queryCatalogueProducts, roleCan, type BusinessPermission } from "@soko/business-core";
import { Cp2Error } from "../../cp2-error.js";
import { asModelRuntimeError, type ModelRuntimeAdapter } from "../../../inference/model-runtime.js";
import { normalizeRequiredBoundedText } from "../../text-normalization.js";
import {
  agentAudienceForBusinessRole,
  enforceAgentPolicy,
  retrieveAgentContext
} from "../../agent-business-runtime.js";
import type { CustomerRuntimeCapabilityRecord } from "../../domain-contracts.js";
import type { Cp2Snapshot } from "../../store.js";
import type { AgentRuntimeDomainDeps } from "./domain-deps.js";
export type { AgentRuntimeDomainDeps } from "./domain-deps.js";
import {
  buildShopAgentRuntime as buildShopAgentRuntimeModule,
  contextSourcesForRuntime as contextSourcesForRuntimeModule
} from "./runtime-context.js";
import { createRuntimeModelRoute } from "./runtime-model-routing.js";
import {
  assertResolvedRuntimeAvailable,
  resolveNativeRuntimeModelProvider,
  type ExecutionTargetResolutionSource
} from "./native-runtime-routing.js";
import {
  projectActiveNativeBinding,
  projectNativeBinding
} from "./native-binding-projection.js";
import { executeRuntimeCapability } from "./capabilities.js";
import {
  createRuntimeDocumentImportProposal,
  createRuntimeCommerceProposal,
  createRuntimeMessagingProposal,
  createRuntimeNetworkProposal,
  createRuntimeReceiptProposal
} from "./planning.js";
import {
  cloneAgentContextSource,
  cloneAgentInstructions,
  cloneAgentPersonality,
  cloneAgentRuntimeVersion,
  cloneAgentSkillBinding,
  cloneBusinessAgentProfile,
  cloneInstalledAgentModel,
  contextCharacterBudgetForModel,
  contextKeywords,
  contextSourceRecord,
  createDefaultBusinessAgentProfile,
  createRuntimePlan,
  createRuntimeResponse,
  createRuntimeVerification,
  defaultAiModelId,
  downloadableAiModelIdPattern,
  ensureRequiredAgentContextScripts,
  healthSummary,
  hydrateBusinessAgentProfile,
  isUnavailableRuntimeCode,
  maxRuntimeTurnsPerSession,
  modelHealthError,
  normalizeBusinessAgentProfile,
  normalizeInstalledAgentModel,
  normalizeModelCatalogSearch,
  resolveDefaultDeviceModelId,
  runtimeAgentProfileFromStored,
  runtimeEvaluationSampled,
  runtimeStatusFromPlan,
  validateAgentModelBindingConfiguration,
  type BusinessAgentProfileInput,
  type BusinessAgentProfileSummary,
  type PendingRuntimeAction
} from "./shared.js";
export class AgentRuntimeDomain {
  private readonly activeAiModels = new Map<string, ActiveAiModelSummary>();
  private readonly agentProfiles = new Map<string, BusinessAgentProfileSummary>();
  private readonly agentRuntimeVersions = new Map<string, AgentRuntimeVersion>();
  private readonly agentContextSources = new Map<string, AgentContextSource>();
  private readonly agentEvaluationEvents = new Map<string, AgentEvaluationEvent>();
  private readonly agentOwnerCorrections = new Map<string, AgentOwnerCorrection>();
  private readonly installedAgentModels = new Map<string, InstalledAgentModelSummary>();
  private readonly agentModelActivationLocks = new Set<string>();
  private readonly runtimeSessions = new Map<string, RuntimeSessionSummary>();
  private readonly runtimeTurns = new Map<string, RuntimeTurnSummary>();
  private readonly pendingRuntimeActions = new Map<string, PendingRuntimeAction>();

  constructor(private readonly deps: AgentRuntimeDomainDeps) {}

  get activeAiModelsMap(): Map<string, ActiveAiModelSummary> {
    return this.activeAiModels;
  }

  get agentProfilesMap(): Map<string, BusinessAgentProfileSummary> {
    return this.agentProfiles;
  }

  get agentRuntimeVersionsMap(): Map<string, AgentRuntimeVersion> {
    return this.agentRuntimeVersions;
  }

  get agentContextSourcesMap(): Map<string, AgentContextSource> {
    return this.agentContextSources;
  }

  get agentEvaluationEventsMap(): Map<string, AgentEvaluationEvent> {
    return this.agentEvaluationEvents;
  }

  get agentOwnerCorrectionsMap(): Map<string, AgentOwnerCorrection> {
    return this.agentOwnerCorrections;
  }

  get installedAgentModelsMap(): Map<string, InstalledAgentModelSummary> {
    return this.installedAgentModels;
  }

  get runtimeSessionsMap(): Map<string, RuntimeSessionSummary> {
    return this.runtimeSessions;
  }

  get runtimeTurnsMap(): Map<string, RuntimeTurnSummary> {
    return this.runtimeTurns;
  }

  get pendingRuntimeActionsMap(): Map<string, PendingRuntimeAction> {
    return this.pendingRuntimeActions;
  }

  clear(): void {
    this.activeAiModels.clear();
    this.agentProfiles.clear();
    this.agentRuntimeVersions.clear();
    this.agentContextSources.clear();
    this.agentEvaluationEvents.clear();
    this.agentOwnerCorrections.clear();
    this.installedAgentModels.clear();
    this.agentModelActivationLocks.clear();
    this.runtimeSessions.clear();
    this.runtimeTurns.clear();
    this.pendingRuntimeActions.clear();
  }

  restore(snapshot: Cp2Snapshot): void {
    for (const selection of snapshot.activeAiModels ?? []) {
      this.activeAiModels.set(selection.businessId, selection);
    }

    for (const profile of snapshot.agentProfiles ?? []) {
      this.agentProfiles.set(
        profile.businessId,
        cloneBusinessAgentProfile(hydrateBusinessAgentProfile(profile))
      );
    }

    for (const version of snapshot.agentRuntimeVersions ?? []) {
      this.agentRuntimeVersions.set(version.id, cloneAgentRuntimeVersion(version));
    }

    for (const source of snapshot.agentContextSources ?? []) {
      this.agentContextSources.set(source.id, cloneAgentContextSource(source));
    }

    for (const event of snapshot.agentEvaluationEvents ?? []) {
      this.agentEvaluationEvents.set(event.id, {
        ...event,
        metadata: { ...event.metadata }
      });
    }

    for (const correction of snapshot.agentOwnerCorrections ?? []) {
      this.agentOwnerCorrections.set(correction.id, { ...correction });
    }

    for (const model of snapshot.installedAgentModels ?? []) {
      this.installedAgentModels.set(model.id, cloneInstalledAgentModel(model));
    }

    for (const item of snapshot.runtimeSessions) {
      this.runtimeSessions.set(item.id, item);
    }

    for (const item of snapshot.runtimeTurns) {
      const legacy = item as RuntimeTurnSummary & Partial<{ runtimeVersion: number }>;
      this.runtimeTurns.set(item.id, {
        ...item,
        runtimeVersion:
          legacy.runtimeVersion ?? this.agentProfiles.get(item.businessId)?.runtimeVersion ?? 1
      });
    }
  }

  listAiModels(search?: string): AiModelSummary[] {
    const normalizedSearch = search?.trim().toLowerCase();
    const compactSearch =
      normalizedSearch === undefined ? undefined : normalizeModelCatalogSearch(normalizedSearch);
    return this.deps
      .listModelCatalog()
      .filter((model) => {
        if (!normalizedSearch) return true;
        const exactMatch =
          model.label.toLowerCase().includes(normalizedSearch) ||
          model.description.toLowerCase().includes(normalizedSearch) ||
          model.capabilities.some((capability) =>
            capability.toLowerCase().includes(normalizedSearch)
          ) ||
          model.id.toLowerCase().includes(normalizedSearch);
        return (
          exactMatch ||
          (compactSearch !== undefined &&
            normalizeModelCatalogSearch(
              `${model.id} ${model.label} ${model.description} ${model.capabilities.join(" ")}`
            ).includes(compactSearch))
        );
      })
      .map((model) => ({
        ...model,
        capabilities: [...model.capabilities],
        runtimeAvailability: {
          backend:
            this.deps.modelRuntimeAdapterResolver?.({
              modelId: model.id,
              executionTarget: "backend",
              agentId: "model-catalog",
              shopId: "model-catalog"
            }) === undefined
              ? "unconfigured"
              : "configured"
        }
      }));
  }

  getActiveAiModel(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): ActiveAiModelSummary {
    const now = input.now ?? new Date();
    const session = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "business:read",
      now
    );
    const stored = this.activeAiModels.get(input.businessId);
    const preferredModelId = stored?.modelId ?? "sokoclaw-local";
    const modelId = resolveDefaultDeviceModelId(
      preferredModelId,
      this.deps.resolveCatalogModel(preferredModelId)
    );
    return {
      businessId: input.businessId,
      modelId,
      activatedAt: stored?.activatedAt ?? now.toISOString(),
      activatedBy: stored?.activatedBy ?? session.user.id
    };
  }

  activateAiModel(input: {
    sessionId: string | null;
    businessId: string;
    modelId: string;
    now?: Date;
  }): ActiveAiModelSummary {
    const now = input.now ?? new Date();
    const session = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "membership:manage",
      now
    );
    const model = this.deps.resolveCatalogModel(input.modelId);
    if (model === undefined || model.source !== "hosted" || !model.available) {
      throw new Cp2Error(
        400,
        "cloud_model_unavailable",
        "The selected backend fallback model is unavailable."
      );
    }
    const selection: ActiveAiModelSummary = {
      businessId: input.businessId,
      modelId: model?.id ?? input.modelId,
      activatedAt: now.toISOString(),
      activatedBy: session.user.id
    };
    this.activeAiModels.set(input.businessId, selection);
    this.deps.recordAuditEvent({
      type: "cloud_fallback_model.selected",
      aggregateType: "business",
      aggregateId: input.businessId,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: { modelId: selection.modelId }
    });
    const profile = this.currentAgentProfile(input.businessId, now);
    const revised = {
      ...profile,
      modelId: selection.modelId,
      runtimeVersion: profile.runtimeVersion + 1,
      updatedAt: now.toISOString(),
      updatedBy: session.user.id
    };
    this.agentProfiles.set(input.businessId, revised);
    this.recordAgentRuntimeVersion(revised, session.user.id, "Cloud fallback model changed");
    return selection;
  }

  getActiveAgentModelBinding(input: {
    sessionId: string | null;
    businessId: string;
    agentId: string;
    now?: Date;
  }): AgentModelBindingSummary | null {
    const now = input.now ?? new Date();
    const session = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "business:read",
      now
    );
    this.requireBusinessAgent(input.businessId, input.agentId, now);
    const active = this.deps.getActiveNativeRuntimeBinding(input.businessId, input.agentId);
    return projectActiveNativeBinding(active, input.businessId, session.account.id);
  }

  /** The harness (AgentRuntimeAdapter) currently selected for this shop's agent, or the platform
   *  default if nothing has been explicitly activated yet - what a "current harness" selector
   *  should show. */
  getAgentRuntimeHarness(input: {
    sessionId: string | null;
    businessId: string;
    agentId: string;
    now?: Date;
  }): { agentRuntimeAdapterId: string } {
    const now = input.now ?? new Date();
    this.deps.requireAuthorizedSession(input.sessionId, input.businessId, "business:read", now);
    this.requireBusinessAgent(input.businessId, input.agentId, now);
    return {
      agentRuntimeAdapterId:
        this.deps.resolveAgentRuntimeAdapterId(input.agentId) ??
        this.deps.platformDefaultRuntime.agentRuntimeAdapterId
    };
  }

  removeAgentModelBinding(input: {
    sessionId: string | null;
    businessId: string;
    agentId: string;
    now?: Date;
  }): AgentModelBindingRemovalResult {
    const now = input.now ?? new Date();
    const session = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "membership:manage",
      now
    );
    const profile = this.requireBusinessAgent(input.businessId, input.agentId, now);
    if (this.agentModelActivationLocks.has(input.agentId)) {
      throw new Cp2Error(
        409,
        "MODEL_ACTIVATION_CONFLICT",
        "Another model activation is already running for this agent.",
        true,
        { agentId: input.agentId }
      );
    }

    const active = this.deps.getActiveNativeRuntimeBinding(input.businessId, input.agentId);
    if (active === null) {
      return {
        agentId: input.agentId,
        shopId: input.businessId,
        binding: null,
        removedBindingId: null
      };
    }

    const removedAt = now.toISOString();
    this.deps.deactivateRuntimeBinding({
      businessId: input.businessId,
      accountId: session.account.id,
      agentId: input.agentId,
      updatedBy: session.user.id,
      now
    });
    const inactive: AgentModelBindingSummary = {
      ...projectNativeBinding(active, input.businessId, session.account.id),
      status: "inactive",
      updatedAt: removedAt,
      updatedBy: session.user.id
    };

    const fallbackModelId = resolveDefaultDeviceModelId(
      this.activeAiModels.get(input.businessId)?.modelId ?? defaultAiModelId,
      this.deps.resolveCatalogModel(
        this.activeAiModels.get(input.businessId)?.modelId ?? defaultAiModelId
      )
    );
    const revised: BusinessAgentProfileSummary = {
      ...profile,
      modelId: fallbackModelId,
      runtimeVersion: profile.runtimeVersion + 1,
      updatedAt: removedAt,
      updatedBy: session.user.id
    };
    this.agentProfiles.set(input.businessId, revised);
    this.recordAgentRuntimeVersion(revised, session.user.id, "Agent model binding removed");
    this.recordAgentModelBindingAudit("agent_model.binding_removed", inactive, session.user.id, {});

    return {
      agentId: input.agentId,
      shopId: input.businessId,
      binding: null,
      removedBindingId: inactive.id
    };
  }

  async testAgentModel(input: {
    sessionId: string | null;
    businessId: string;
    agentId: string;
    modelId: string;
    executionTarget: ModelExecutionTarget;
    signal?: AbortSignal;
    now?: Date;
  }): Promise<ModelRuntimeHealthSummary> {
    const now = input.now ?? new Date();
    this.deps.requireAuthorizedSession(input.sessionId, input.businessId, "membership:manage", now);
    this.requireBusinessAgent(input.businessId, input.agentId, now);
    this.requireCanonicalAiModel(input.modelId);
    const adapter = this.requireModelRuntimeAdapter(input);
    const health = await adapter.healthCheck({
      agentId: input.agentId,
      shopId: input.businessId,
      modelId: input.modelId,
      ...(input.signal === undefined ? {} : { signal: input.signal })
    });
    const summary = healthSummary(health, now);
    if (!summary.ok) {
      throw modelHealthError(summary);
    }
    return summary;
  }

  async activateAgentModel(input: {
    sessionId: string | null;
    businessId: string;
    agentId: string;
    modelId: string;
    executionTarget: ModelExecutionTarget;
    executionMode: PreferredExecutionMode;
    permissions: AgentModelBindingPermissions;
    // Absent keeps this shop's current harness (or the platform default, if none is set yet).
    agentRuntimeAdapterId?: string;
    signal?: AbortSignal;
    onStage?: (stage: string, elapsedMs: number) => void;
    now?: Date;
  }): Promise<AgentModelActivationResult> {
    const now = input.now ?? new Date();
    const startedAt = Date.now();
    const session = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "membership:manage",
      now
    );
    input.onStage?.("auth_resolved", Date.now() - startedAt);
    this.requireBusinessAgent(input.businessId, input.agentId, now);
    input.onStage?.("agent_resolved", Date.now() - startedAt);
    if (
      input.agentRuntimeAdapterId !== undefined &&
      this.deps.agentRuntimeAdapterResolver(input.agentRuntimeAdapterId) === undefined
    ) {
      throw new Cp2Error(
        404,
        "AGENT_RUNTIME_ADAPTER_NOT_FOUND",
        "The requested agent runtime adapter is not registered."
      );
    }
    const model = this.requireCanonicalAiModel(input.modelId);
    validateAgentModelBindingConfiguration(input, model);
    input.onStage?.("model_resolved", Date.now() - startedAt);
    const existingActive = this.deps.getActiveNativeRuntimeBinding(input.businessId, input.agentId);
    if (
      existingActive !== null &&
      // An explicit harness request always goes through the full (re)activation path below, even
      // when it happens to match what's already active - it's a deliberate action, not a probe.
      input.agentRuntimeAdapterId === undefined &&
      existingActive.model.id === input.modelId &&
      existingActive.executionTarget === input.executionTarget
    ) {
      input.onStage?.("runtime_probe_started", Date.now() - startedAt);
      const health = healthSummary(
        await this.requireModelRuntimeAdapter(input).healthCheck({
          agentId: input.agentId,
          shopId: input.businessId,
          modelId: input.modelId,
          ...(input.signal === undefined ? {} : { signal: input.signal })
        }),
        now
      );
      input.onStage?.("runtime_probe_completed", Date.now() - startedAt);
      if (!health.ok) throw modelHealthError(health);
      const result = this.finalizeVerifiedActivation({
        businessId: input.businessId,
        agentId: input.agentId,
        accountId: session.account.id,
        actorId: session.user.id,
        model,
        executionTarget: input.executionTarget,
        checkedAt: health.checkedAt,
        auditType: "agent_model.activation_reverified",
        latencyMs: health.latencyMs,
        // Model and execution target are unchanged from what's already active - this is a health
        // re-verification, not a configuration change, so the agent profile's runtimeVersion must
        // not bump (matches the pre-consolidation fast path, which never touched agentProfiles).
        bumpProfile: false
      });
      input.onStage?.("binding_staged", Date.now() - startedAt);
      return { binding: result, healthCheck: health };
    }
    if (this.agentModelActivationLocks.has(input.agentId)) {
      throw new Cp2Error(
        409,
        "MODEL_ACTIVATION_CONFLICT",
        "Another model activation is already running for this agent.",
        true,
        { agentId: input.agentId }
      );
    }

    this.agentModelActivationLocks.add(input.agentId);
    try {
      const adapter = this.requireModelRuntimeAdapter(input);
      input.onStage?.("runtime_probe_started", Date.now() - startedAt);
      const health = healthSummary(
        await adapter.healthCheck({
          agentId: input.agentId,
          shopId: input.businessId,
          modelId: input.modelId,
          ...(input.signal === undefined ? {} : { signal: input.signal })
        }),
        now
      );
      input.onStage?.("runtime_probe_completed", Date.now() - startedAt);
      if (!health.ok) {
        this.recordAgentModelBindingAudit(
          "agent_model.activation_failed",
          failedActivationAuditFields(input, health.checkedAt, health.errorCode),
          session.user.id,
          { errorCode: health.errorCode, latencyMs: health.latencyMs }
        );
        throw modelHealthError(health);
      }

      const result = this.finalizeVerifiedActivation({
        businessId: input.businessId,
        agentId: input.agentId,
        accountId: session.account.id,
        actorId: session.user.id,
        model,
        executionTarget: input.executionTarget,
        checkedAt: health.checkedAt,
        auditType: "agent_model.activation_succeeded",
        latencyMs: health.latencyMs,
        bumpProfile: true,
        ...(input.agentRuntimeAdapterId === undefined
          ? {}
          : { agentRuntimeAdapterId: input.agentRuntimeAdapterId })
      });
      input.onStage?.("binding_staged", Date.now() - startedAt);
      return { binding: result, healthCheck: health };
    } catch (error) {
      if (error instanceof Cp2Error) {
        const failedAt = new Date().toISOString();
        this.recordAgentModelBindingAudit(
          "agent_model.activation_failed",
          failedActivationAuditFields(input, failedAt, error.code),
          session.user.id,
          { errorCode: error.code }
        );
        throw error;
      }
      const runtimeError = asModelRuntimeError(error);
      const failedAt = new Date().toISOString();
      this.recordAgentModelBindingAudit(
        "agent_model.activation_failed",
        failedActivationAuditFields(input, failedAt, runtimeError.code),
        session.user.id,
        { errorCode: runtimeError.code }
      );
      throw new Cp2Error(
        runtimeError.code === "INFERENCE_TIMEOUT" ? 504 : 503,
        runtimeError.code,
        runtimeError.message,
        runtimeError.retryable,
        {
          agentId: input.agentId,
          modelId: input.modelId,
          executionTarget: input.executionTarget
        }
      );
    } finally {
      this.agentModelActivationLocks.delete(input.agentId);
    }
  }

  /** Writes the (sole) native runtime binding and re-reads it back joined with its model/role so
   *  the HTTP response and audit trail are built from exactly what was persisted, not from the
   *  input that requested it. Shared by activateAgentModel's fast (re-verify) and full paths -
   *  both do nothing but a health check before reaching here. */
  private finalizeVerifiedActivation(input: {
    businessId: string;
    agentId: string;
    accountId: string;
    actorId: string;
    model: AiModelSummary;
    executionTarget: ModelExecutionTarget;
    checkedAt: string;
    auditType: string;
    latencyMs: number;
    bumpProfile: boolean;
    agentRuntimeAdapterId?: string;
  }): AgentModelBindingSummary {
    const profile = this.currentAgentProfile(input.businessId, new Date(input.checkedAt));
    const nativeBinding = this.deps.activateVerifiedRuntimeBinding({
      businessId: input.businessId,
      accountId: input.accountId,
      agentId: profile.agentId,
      agentName: profile.name,
      ...(input.agentRuntimeAdapterId === undefined
        ? {}
        : { agentRuntimeAdapterId: input.agentRuntimeAdapterId }),
      model: input.model,
      executionTarget: input.executionTarget,
      fallbackModel: null,
      updatedBy: input.actorId,
      checkedAt: input.checkedAt
    });
    const refreshed = this.deps.getActiveNativeRuntimeBinding(input.businessId, input.agentId);
    if (refreshed === null) {
      throw new Cp2Error(
        500,
        "RUNTIME_BINDING_WRITE_FAILED",
        "Failed to persist the activated runtime binding."
      );
    }
    const verified = projectNativeBinding(refreshed, input.businessId, input.accountId);
    if (input.bumpProfile) {
      const revised = {
        ...profile,
        modelId: input.model.id,
        runtimeVersion: profile.runtimeVersion + 1,
        updatedAt: input.checkedAt,
        updatedBy: input.actorId
      };
      this.agentProfiles.set(input.businessId, revised);
      this.recordAgentRuntimeVersion(revised, input.actorId, "Verified agent model activated");
    }
    this.recordAgentModelBindingAudit(input.auditType, verified, input.actorId, {
      latencyMs: input.latencyMs,
      nativeRuntimeBindingId: nativeBinding.id
    });
    return verified;
  }

  listInstalledAgentModels(input: {
    sessionId: string | null;
    deviceId?: string;
    now?: Date;
  }): InstalledAgentModelSummary[] {
    const session = this.deps.requirePinVerifiedSession(input.sessionId, input.now ?? new Date());
    return [...this.installedAgentModels.values()]
      .filter(
        (model) =>
          model.accountId === session.account.id &&
          model.userId === session.user.id &&
          (input.deviceId === undefined || model.deviceId === input.deviceId) &&
          model.installationStatus !== "REMOVED"
      )
      .sort((left, right) => right.installedAt.localeCompare(left.installedAt))
      .map(cloneInstalledAgentModel);
  }

  registerInstalledAgentModel(input: {
    sessionId: string | null;
    model: Omit<InstalledAgentModelSummary, "accountId" | "userId">;
    now?: Date;
  }): InstalledAgentModelSummary {
    const now = input.now ?? new Date();
    const session = this.deps.requirePinVerifiedSession(input.sessionId, now);
    const model = normalizeInstalledAgentModel(input.model, session.account.id, session.user.id);
    const existing = this.installedAgentModels.get(model.id);
    if (
      existing !== undefined &&
      (existing.accountId !== session.account.id ||
        existing.userId !== session.user.id ||
        existing.deviceId !== model.deviceId)
    ) {
      throw new Cp2Error(
        403,
        "model_installation_owner_mismatch",
        "This model installation belongs to another account or device."
      );
    }
    this.installedAgentModels.set(model.id, model);
    this.deps.recordAuditEvent({
      type: "agent_model.installation_registered",
      aggregateType: "model_installation",
      aggregateId: model.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {
        modelId: model.modelId,
        deviceId: model.deviceId,
        installationStatus: model.installationStatus,
        compatibilityStatus: model.compatibilityStatus,
        runtimeBackend: model.runtimeBackend
      }
    });
    return cloneInstalledAgentModel(model);
  }

  validateInstalledAgentModel(input: {
    sessionId: string | null;
    installationId: string;
    deviceId: string;
    installationStatus: InstalledAgentModelSummary["installationStatus"];
    compatibilityStatus: InstalledAgentModelSummary["compatibilityStatus"];
    validationError: string | null;
    now?: Date;
  }): InstalledAgentModelSummary {
    const now = input.now ?? new Date();
    const session = this.deps.requirePinVerifiedSession(input.sessionId, now);
    const existing = this.requireOwnedModelInstallation(
      session.account.id,
      session.user.id,
      input.deviceId,
      input.installationId
    );
    const updated: InstalledAgentModelSummary = {
      ...existing,
      installationStatus: input.installationStatus,
      compatibilityStatus: input.compatibilityStatus,
      validationError:
        input.validationError === null
          ? null
          : normalizeRequiredBoundedText(input.validationError, "validation error", 120),
      lastVerifiedAt: now.toISOString()
    };
    this.installedAgentModels.set(updated.id, updated);
    return cloneInstalledAgentModel(updated);
  }

  getAgentProfile(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): BusinessAgentProfileSummary {
    const now = input.now ?? new Date();
    const session = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "business:read",
      now
    );
    const stored = this.agentProfiles.get(input.businessId);
    if (stored !== undefined) {
      return cloneBusinessAgentProfile({
        ...hydrateBusinessAgentProfile(stored),
        contextScripts: ensureRequiredAgentContextScripts(stored.contextScripts)
      });
    }

    const business = this.deps.requireBusiness(input.businessId);
    return createDefaultBusinessAgentProfile({
      business,
      modelId: this.activeAiModels.get(input.businessId)?.modelId ?? defaultAiModelId,
      updatedAt: now.toISOString(),
      updatedBy: session.user.id,
      agentDefinition: this.deps.resolveAgentCatalogEntry(defaultAgentDefinitionId)
    });
  }

  updateAgentProfile(input: {
    sessionId: string | null;
    businessId: string;
    profile: BusinessAgentProfileInput;
    now?: Date;
  }): BusinessAgentProfileSummary {
    const now = input.now ?? new Date();
    const session = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "membership:manage",
      now
    );
    const profile = normalizeBusinessAgentProfile(input.profile);
    const business = this.deps.requireBusiness(input.businessId);
    const current = hydrateBusinessAgentProfile(
      this.agentProfiles.get(input.businessId) ??
        createDefaultBusinessAgentProfile({
          business,
          modelId: this.activeAiModels.get(input.businessId)?.modelId ?? defaultAiModelId,
          updatedAt: now.toISOString(),
          updatedBy: session.user.id,
          agentDefinition: this.deps.resolveAgentCatalogEntry(defaultAgentDefinitionId)
        })
    );
    const model = this.deps.resolveCatalogModel(profile.modelId);
    const deviceModel = downloadableAiModelIdPattern.test(profile.modelId);
    if ((!deviceModel && model === undefined) || model?.available === false) {
      throw new Cp2Error(400, "ai_model_unavailable", "The selected AI model is unavailable.");
    }
    const updated: BusinessAgentProfileSummary = {
      businessId: input.businessId,
      tenantId: input.businessId,
      shopId: input.businessId,
      agentId: current.agentId,
      runtimeVersion: current.runtimeVersion + 1,
      createdAt: current.createdAt,
      ...profile,
      contextScripts: ensureRequiredAgentContextScripts(profile.contextScripts),
      modelId: model?.id ?? profile.modelId,
      updatedAt: now.toISOString(),
      updatedBy: session.user.id
    };
    if (this.runtimeVersionsForBusiness(input.businessId).length === 0) {
      this.synchronizeProfileContextSources(current, new Date(current.updatedAt));
      this.recordAgentRuntimeVersion(current, session.user.id, "Initial business runtime");
    }
    this.agentProfiles.set(input.businessId, updated);
    this.synchronizeProfileContextSources(updated, now);
    this.recordAgentRuntimeVersion(updated, session.user.id, "Agent profile updated");
    this.deps.recordAuditEvent({
      type: "agent_profile.updated",
      aggregateType: "business",
      aggregateId: input.businessId,
      actorId: session.user.id,
      occurredAt: updated.updatedAt,
      payload: {
        agentDefinitionId: updated.agentDefinitionId,
        language: updated.language,
        modelId: updated.modelId,
        status: updated.status
      }
    });

    return cloneBusinessAgentProfile(updated);
  }

  getAgentRuntime(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): ShopAgentRuntime {
    const now = input.now ?? new Date();
    this.deps.requireAuthorizedSession(input.sessionId, input.businessId, "business:read", now);
    return this.buildShopAgentRuntime(
      this.currentAgentProfile(input.businessId, now),
      now,
      "owner"
    );
  }

  listAgentRuntimeVersions(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): AgentRuntimeVersion[] {
    this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "business:read",
      input.now ?? new Date()
    );
    return this.runtimeVersionsForBusiness(input.businessId).map(cloneAgentRuntimeVersion);
  }

  rollbackAgentRuntimeVersion(input: {
    sessionId: string | null;
    businessId: string;
    version: number;
    now?: Date;
  }): ShopAgentRuntime {
    const now = input.now ?? new Date();
    const session = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "membership:manage",
      now
    );
    const target = this.runtimeVersionsForBusiness(input.businessId).find(
      (candidate) => candidate.version === input.version
    );
    if (target === undefined) {
      throw new Cp2Error(404, "agent_runtime_version_not_found", "Runtime version was not found.");
    }
    const current = this.currentAgentProfile(input.businessId, now);
    const runtime = target.runtime;
    const targetContextSourceIds = new Set(runtime.context.sources.map((source) => source.id));
    const restoredContextScripts = runtime.context.sources
      .filter((source) => source.type === "context_script" && source.status === "active")
      .map(
        (source) =>
          source.retrievalMetadata.content ??
          this.agentContextSources.get(source.id)?.retrievalMetadata.content ??
          ""
      )
      .filter((content) => content !== "");
    for (const source of this.agentContextSources.values()) {
      if (source.shopId !== input.businessId || source.type === "context_script") continue;
      const targetSource = runtime.context.sources.find((candidate) => candidate.id === source.id);
      if (targetSource === undefined || !targetContextSourceIds.has(source.id)) {
        source.status = "archived";
        source.deletedAt = now.toISOString();
      } else {
        source.status = targetSource.status;
        source.deletedAt = targetSource.status === "archived" ? now.toISOString() : null;
      }
      source.updatedAt = now.toISOString();
    }
    const restored: BusinessAgentProfileSummary = {
      ...current,
      name: runtime.identity.agentName,
      description: runtime.identity.shopDescription,
      modelId: runtime.model.modelId,
      role: runtime.identity.role,
      language: runtime.identity.supportedLanguages[0] ?? current.language,
      supportedLanguages: [...runtime.identity.supportedLanguages],
      businessCategory: runtime.identity.businessCategory,
      publicIntroduction: runtime.identity.publicIntroduction,
      personality: runtime.personality.additionalGuidance || current.personality,
      personalityConfig: cloneAgentPersonality(runtime.personality),
      instructions: runtime.instructions.generalOperatingRules.join("\n") || current.instructions,
      instructionPolicy: cloneAgentInstructions(runtime.instructions),
      skillBindings: runtime.skills.map(cloneAgentSkillBinding),
      memoryPolicy: { ...runtime.memory },
      evaluationPolicy: { ...runtime.evaluations },
      contextScripts: restoredContextScripts,
      status:
        runtime.status === "paused" || runtime.status === "archived" ? "draft" : runtime.status,
      runtimeVersion: current.runtimeVersion + 1,
      updatedAt: now.toISOString(),
      updatedBy: session.user.id
    };
    this.agentProfiles.set(input.businessId, restored);
    this.synchronizeProfileContextSources(restored, now);
    this.recordAgentRuntimeVersion(
      restored,
      session.user.id,
      `Rolled back to runtime version ${target.version}`
    );
    this.deps.recordAuditEvent({
      type: "agent_runtime.rolled_back",
      aggregateType: "business",
      aggregateId: input.businessId,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {
        fromVersion: current.runtimeVersion,
        targetVersion: target.version,
        activeVersion: restored.runtimeVersion
      }
    });
    return this.buildShopAgentRuntime(restored, now, "owner");
  }

  getAgentRuntimeReadiness(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): AgentRuntimeReadiness {
    const now = input.now ?? new Date();
    this.deps.requireAuthorizedSession(input.sessionId, input.businessId, "business:read", now);
    return this.computeAgentRuntimeReadiness(input.businessId, now);
  }

  /**
   * The readiness computation itself does not depend on who is asking — only on the business's
   * own agent configuration — so it is factored out from the authorization check above. Reused by
   * the public, memberless storefront-reply path, which has no session to authorize.
   */
  computeAgentRuntimeReadiness(businessId: string, now: Date): AgentRuntimeReadiness {
    const business = this.deps.businesses.get(businessId);
    const profile = this.agentProfiles.get(businessId);
    const effectiveProfile =
      business === undefined ? null : this.currentAgentProfile(businessId, now);
    const issues: AgentRuntimeReadiness["issues"] = [];
    if (business === undefined || effectiveProfile === null) {
      issues.push({
        code: "AGENT_NOT_FOUND",
        message: "The business agent was not found.",
        actionable: true
      });
    } else {
      if (effectiveProfile.tenantId !== businessId || effectiveProfile.shopId !== businessId) {
        issues.push({
          code: "TENANT_BINDING_INVALID",
          message: "The runtime tenant and shop binding is invalid.",
          actionable: true
        });
      }
      if (effectiveProfile.modelId.trim() === "") {
        issues.push({
          code: "MODEL_NOT_SELECTED",
          message: "Select a model for this agent.",
          actionable: true
        });
      } else if (
        !downloadableAiModelIdPattern.test(effectiveProfile.modelId) &&
        this.deps.resolveCatalogModel(effectiveProfile.modelId)?.available !== true &&
        effectiveProfile.modelId !== "sokoclaw-local"
      ) {
        issues.push({
          code: "MODEL_UNAVAILABLE",
          message: "The selected model is unavailable.",
          actionable: true
        });
      }
      if (
        effectiveProfile.skillBindings.length === 0 ||
        effectiveProfile.skillBindings.some((binding) => !(binding.skillId in runtimeToolRegistry))
      ) {
        issues.push({
          code: "TOOL_REGISTRY_UNAVAILABLE",
          message: "The runtime tool registry does not match the active skill bindings.",
          actionable: true
        });
      }
      if (profile !== undefined && profile.status !== "active") {
        issues.push({
          code: "INVALID_RUNTIME_PROFILE",
          message: "Activate the agent profile before using chat.",
          actionable: true
        });
      }
    }
    return {
      tenantId: businessId,
      shopId: businessId,
      agentId: effectiveProfile?.agentId ?? businessId,
      runtimeVersion: effectiveProfile?.runtimeVersion ?? 0,
      ready: issues.length === 0,
      issues,
      checkedAt: now.toISOString()
    };
  }

  listAgentContextSources(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): AgentContextSource[] {
    const now = input.now ?? new Date();
    this.deps.requireAuthorizedSession(input.sessionId, input.businessId, "business:read", now);
    return this.contextSourcesForRuntime(this.currentAgentProfile(input.businessId, now)).map(
      cloneAgentContextSource
    );
  }

  upsertAgentContextSource(input: {
    sessionId: string | null;
    businessId: string;
    sourceId?: string;
    type: AgentContextSource["type"];
    title: string;
    content: string;
    sensitivity: AgentContextSource["sensitivity"];
    customerVisible: boolean;
    status: AgentContextSource["status"];
    now?: Date;
  }): AgentContextSource {
    const now = input.now ?? new Date();
    const session = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "membership:manage",
      now
    );
    const existing =
      input.sourceId === undefined ? undefined : this.agentContextSources.get(input.sourceId);
    if (
      existing !== undefined &&
      (existing.tenantId !== input.businessId || existing.shopId !== input.businessId)
    ) {
      throw new Cp2Error(403, "agent_context_tenant_mismatch", "Context source access was denied.");
    }
    const profile = this.currentAgentProfile(input.businessId, now);
    if (this.runtimeVersionsForBusiness(input.businessId).length === 0) {
      this.synchronizeProfileContextSources(profile, new Date(profile.updatedAt));
      this.recordAgentRuntimeVersion(profile, session.user.id, "Initial business runtime");
    }
    if (existing !== undefined) {
      this.agentContextSources.set(existing.id, {
        ...existing,
        status: "archived",
        updatedAt: now.toISOString(),
        deletedAt: now.toISOString()
      });
    }
    const source: AgentContextSource = {
      id: randomUUID(),
      tenantId: input.businessId,
      shopId: input.businessId,
      type: input.type,
      title: normalizeRequiredBoundedText(input.title, "context title", 160),
      status: input.status,
      sensitivity: input.sensitivity,
      accessRules: {
        audiences: input.customerVisible ? ["owner", "staff", "customer"] : ["owner", "staff"],
        requiredPermission: input.customerVisible ? null : "business:read",
        customerVisible: input.customerVisible
      },
      freshnessTimestamp: now.toISOString(),
      version: (existing?.version ?? 0) + 1,
      retrievalMetadata: {
        keywords: contextKeywords(`${input.title} ${input.content}`),
        sourceRecordId: null,
        content: normalizeRequiredBoundedText(input.content, "context content", 4000)
      },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      deletedAt: input.status === "archived" ? now.toISOString() : null
    };
    this.agentContextSources.set(source.id, source);
    const revised = {
      ...profile,
      runtimeVersion: profile.runtimeVersion + 1,
      updatedAt: now.toISOString(),
      updatedBy: session.user.id
    };
    this.agentProfiles.set(input.businessId, revised);
    this.recordAgentRuntimeVersion(
      revised,
      session.user.id,
      `Context source ${source.title} updated`
    );
    return cloneAgentContextSource(source);
  }

  listAgentOwnerCorrections(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): AgentOwnerCorrection[] {
    this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "business:read",
      input.now ?? new Date()
    );
    return this.ownerCorrectionsForBusiness(input.businessId).map((correction) => ({
      ...correction
    }));
  }

  submitAgentOwnerCorrection(input: {
    sessionId: string | null;
    businessId: string;
    correction: string;
    category: AgentOwnerCorrection["category"];
    sourceMessageId?: string | null;
    promoteToInstruction: boolean;
    now?: Date;
  }): AgentOwnerCorrection {
    const now = input.now ?? new Date();
    const session = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "membership:manage",
      now
    );
    const current = this.currentAgentProfile(input.businessId, now);
    const correctionText = normalizeRequiredBoundedText(input.correction, "owner correction", 1000);
    if (this.runtimeVersionsForBusiness(input.businessId).length === 0) {
      this.synchronizeProfileContextSources(current, new Date(current.updatedAt));
      this.recordAgentRuntimeVersion(current, session.user.id, "Initial business runtime");
    }
    const revised: BusinessAgentProfileSummary = {
      ...current,
      ...(input.promoteToInstruction
        ? {
            instructions: [current.instructions, correctionText].filter(Boolean).join("\n"),
            instructionPolicy: {
              ...cloneAgentInstructions(current.instructionPolicy),
              generalOperatingRules: [
                ...current.instructionPolicy.generalOperatingRules,
                correctionText
              ]
            }
          }
        : {}),
      runtimeVersion: current.runtimeVersion + 1,
      updatedAt: now.toISOString(),
      updatedBy: session.user.id
    };
    this.agentProfiles.set(input.businessId, revised);
    this.recordAgentRuntimeVersion(
      revised,
      session.user.id,
      input.promoteToInstruction ? "Owner correction promoted" : "Owner correction memory added"
    );
    const runtimeVersion = revised.runtimeVersion;
    const correction: AgentOwnerCorrection = {
      id: randomUUID(),
      tenantId: input.businessId,
      shopId: input.businessId,
      agentId: current.agentId,
      runtimeVersion,
      correction: correctionText,
      category: input.category,
      status: "active",
      sourceMessageId: input.sourceMessageId ?? null,
      promotedToInstruction: input.promoteToInstruction,
      createdBy: session.user.id,
      createdAt: now.toISOString(),
      disabledAt: null
    };
    this.agentOwnerCorrections.set(correction.id, correction);
    this.recordAgentEvaluationEvent({
      businessId: input.businessId,
      runtimeVersion,
      modelId: current.modelId,
      eventType: "owner_correction",
      outcome: "success",
      score: 1,
      reason: input.promoteToInstruction
        ? "Owner correction promoted to a structured instruction."
        : "Owner correction saved as runtime memory.",
      metadata: { category: input.category, promoted: input.promoteToInstruction },
      sessionId: null,
      messageId: input.sourceMessageId ?? null,
      now
    });
    return { ...correction };
  }

  disableAgentOwnerCorrection(input: {
    sessionId: string | null;
    businessId: string;
    correctionId: string;
    now?: Date;
  }): AgentOwnerCorrection {
    const now = input.now ?? new Date();
    const session = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "membership:manage",
      now
    );
    const existing = this.agentOwnerCorrections.get(input.correctionId);
    if (existing === undefined || existing.shopId !== input.businessId) {
      throw new Cp2Error(404, "agent_correction_not_found", "Owner correction was not found.");
    }
    const updated = { ...existing, status: "disabled" as const, disabledAt: now.toISOString() };
    this.agentOwnerCorrections.set(updated.id, updated);
    const profile = this.currentAgentProfile(input.businessId, now);
    const revised = {
      ...profile,
      runtimeVersion: profile.runtimeVersion + 1,
      updatedAt: now.toISOString(),
      updatedBy: session.user.id
    };
    this.agentProfiles.set(input.businessId, revised);
    this.recordAgentRuntimeVersion(revised, session.user.id, "Owner correction memory disabled");
    return { ...updated };
  }

  submitAgentFeedback(input: {
    sessionId: string | null;
    businessId: string;
    messageId?: string | null;
    correct: boolean;
    reason?: string | null;
    now?: Date;
  }): AgentEvaluationEvent {
    const now = input.now ?? new Date();
    this.deps.requireAuthorizedSession(input.sessionId, input.businessId, "business:read", now);
    const profile = this.currentAgentProfile(input.businessId, now);
    return this.recordAgentEvaluationEvent({
      businessId: input.businessId,
      runtimeVersion: profile.runtimeVersion,
      modelId: profile.modelId,
      eventType: "owner_feedback",
      outcome: input.correct ? "success" : "failure",
      score: input.correct ? 1 : 0,
      reason:
        input.reason === undefined || input.reason === null
          ? null
          : normalizeRequiredBoundedText(input.reason, "feedback reason", 500),
      metadata: { correct: input.correct },
      sessionId: null,
      messageId: input.messageId ?? null,
      now
    });
  }

  getAgentEvaluationSummary(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): AgentEvaluationSummary {
    const now = input.now ?? new Date();
    this.deps.requireAuthorizedSession(input.sessionId, input.businessId, "business:read", now);
    const profile = this.currentAgentProfile(input.businessId, now);
    const events = this.evaluationEventsForBusiness(input.businessId);
    const scores = events
      .map((event) => event.score)
      .filter((score): score is number => score !== null);
    return {
      tenantId: input.businessId,
      shopId: input.businessId,
      runtimeVersion: profile.runtimeVersion,
      total: events.length,
      success: events.filter((event) => event.outcome === "success").length,
      partial: events.filter((event) => event.outcome === "partial").length,
      failure: events.filter((event) => event.outcome === "failure").length,
      blocked: events.filter((event) => event.outcome === "blocked").length,
      averageScore:
        scores.length === 0 ? null : scores.reduce((sum, score) => sum + score, 0) / scores.length,
      recentEvents: events.slice(0, 20).map((event) => ({ ...event }))
    };
  }

  agentModelRecoveryGuidance(businessId: string, error: Cp2Error): string {
    const profile = this.agentProfiles.get(businessId);
    const binding =
      profile === undefined
        ? null
        : this.deps.getActiveNativeRuntimeBinding(businessId, profile.agentId);
    if (binding === null) {
      return [
        "I can’t use a working model for this chat yet, but your message is saved.",
        "To continue:",
        "1. Open Agent settings → Model.",
        "2. Test an available model, then activate it for this agent.",
        "3. Return here and send your message again."
      ].join("\n");
    }

    const modelName = this.deps.resolveCatalogModel(binding.model.id)?.label ?? binding.model.id;
    return [
      `I couldn’t reach ${modelName}, but your message is saved.`,
      "To continue:",
      "1. Retry in a moment, or open Agent settings → Model and run the model test.",
      "2. If it keeps failing, activate a different available model for this agent.",
      "3. Return here and send your message again.",
      `Reference: ${error.code}.`
    ].join("\n");
  }

  createRuntimeSession(input: {
    sessionId: string | null;
    businessId: string;
    idempotencyKey?: string;
    now?: Date;
  }): RuntimeSessionSummary {
    const now = input.now ?? new Date();
    const session = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "business:read",
      now
    );
    const idempotencyKey = input.idempotencyKey?.trim();
    if (
      idempotencyKey !== undefined &&
      (idempotencyKey.length < 8 || idempotencyKey.length > 120)
    ) {
      throw new Cp2Error(
        400,
        "runtime_session_idempotency_key_invalid",
        "Runtime session idempotency key must be between 8 and 120 characters."
      );
    }
    if (idempotencyKey !== undefined) {
      const existing = [...this.runtimeSessions.values()].find(
        (candidate) =>
          candidate.businessId === input.businessId &&
          candidate.userId === session.user.id &&
          candidate.idempotencyKey === idempotencyKey
      );
      if (existing !== undefined) return existing;
    }
    const runtimeSession: RuntimeSessionSummary = {
      id: randomUUID(),
      businessId: input.businessId,
      userId: session.user.id,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      status: "active",
      turnCount: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    this.runtimeSessions.set(runtimeSession.id, runtimeSession);
    this.deps.recordAuditEvent({
      type: "runtime.session_created",
      aggregateType: "runtime_session",
      aggregateId: runtimeSession.id,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {
        businessId: input.businessId
      }
    });

    return runtimeSession;
  }

  listRuntimeSessions(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): RuntimeSessionSummary[] {
    const session = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "business:read",
      input.now
    );

    return [...this.runtimeSessions.values()]
      .filter(
        (runtimeSession) =>
          runtimeSession.businessId === input.businessId &&
          runtimeSession.userId === session.user.id
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  listRuntimeTurns(input: {
    sessionId: string | null;
    businessId: string;
    runtimeSessionId: string;
    now?: Date;
  }): RuntimeTurnSummary[] {
    const session = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "business:read",
      input.now
    );
    const runtimeSession = this.requireRuntimeSession(input.businessId, input.runtimeSessionId);

    if (runtimeSession.userId !== session.user.id) {
      throw new Cp2Error(403, "runtime_actor_mismatch", "Runtime session belongs to another user.");
    }

    return [...this.runtimeTurns.values()]
      .filter((turn) => turn.sessionId === runtimeSession.id)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  createCustomerCatalogueRuntimeTurn(input: {
    capability: CustomerRuntimeCapabilityRecord;
    message: string;
    now: Date;
  }): RuntimeTurnResult | null {
    const match = parseProductContextScriptCommand({
      message: input.message,
      tenantId: input.capability.businessId
    });
    if (match === null) return null;
    const proposal = createRuntimeToolProposalFromProductContextScript(match);
    if (proposal.toolName !== "products.list") return null;
    const runtimeSession =
      [...this.runtimeSessions.values()].find(
        (candidate) =>
          candidate.businessId === input.capability.businessId &&
          candidate.userId === `external:${input.capability.platformIdentityId}` &&
          candidate.status === "active" &&
          candidate.turnCount < maxRuntimeTurnsPerSession
      ) ??
      this.createCustomerRuntimeSession({
        businessId: input.capability.businessId,
        actorId: `external:${input.capability.platformIdentityId}`,
        now: input.now
      });
    const query =
      typeof proposal.input.query === "string" ? proposal.input.query : input.message.trim();
    const result = queryCatalogueProducts({
      businessId: input.capability.businessId,
      products: [...this.deps.products.values()],
      query,
      imageForProduct: (product) => this.deps.imageForProduct(product)
    });
    const plan = createRuntimePlan({
      toolName: "products.list",
      input: { query },
      validationErrors: [],
      confirmationToken: null,
      status: "safe_to_execute"
    });
    plan.executedAt = input.now.toISOString();
    const verification = createRuntimeVerification({
      requiresConfirmation: false,
      confirmationSatisfied: false,
      roleAllowed: true,
      rateLimited: false,
      errors: []
    });
    const context = this.buildCustomerRuntimeContext(
      input.capability.businessId,
      `external:${input.capability.platformIdentityId}`
    );
    const turnId = randomUUID();
    const telemetry: RuntimeTelemetryEvent[] = [
      {
        id: randomUUID(),
        sessionId: runtimeSession.id,
        turnId,
        state: "turn.received",
        occurredAt: input.now.toISOString(),
        toolName: null,
        risk: null,
        status: "completed",
        metadata: { principal: "customer_capability" }
      },
      {
        id: randomUUID(),
        sessionId: runtimeSession.id,
        turnId,
        state: "tool.executed",
        occurredAt: input.now.toISOString(),
        toolName: "products.list",
        risk: "low",
        status: "completed",
        metadata: { resultCount: result.total }
      }
    ];
    return this.storeRuntimeTurn({
      runtimeSession,
      turn: {
        id: turnId,
        sessionId: runtimeSession.id,
        businessId: input.capability.businessId,
        actorId: `external:${input.capability.platformIdentityId}`,
        message: input.message,
        normalizedInput: input.message.trim().toLowerCase(),
        parserIntent: "show_products",
        parserConfidence: match.confidence,
        status: "completed",
        context,
        plan,
        verification,
        model: null,
        response: createRuntimeResponse({
          plan,
          proposalReason: proposal.reason,
          toolResult: result,
          verification
        }),
        toolResult: result,
        telemetry,
        runtimeVersion: this.currentAgentProfile(input.capability.businessId, input.now)
          .runtimeVersion,
        createdAt: input.now.toISOString()
      },
      now: input.now
    });
  }

  private createCustomerRuntimeSession(input: {
    businessId: string;
    actorId: string;
    now: Date;
  }): RuntimeSessionSummary {
    const session: RuntimeSessionSummary = {
      id: randomUUID(),
      businessId: input.businessId,
      userId: input.actorId,
      status: "active",
      turnCount: 0,
      createdAt: input.now.toISOString(),
      updatedAt: input.now.toISOString()
    };
    this.runtimeSessions.set(session.id, session);
    return session;
  }

  private buildCustomerRuntimeContext(businessId: string, actorId: string): RuntimeContextSummary {
    return {
      businessId,
      userId: actorId,
      role: "view_only",
      productCount: [...this.deps.products.values()].filter(
        (product) => product.businessId === businessId
      ).length,
      customerCount: 0,
      supplierCount: 0,
      invoiceCount: 0,
      openInvoiceCount: 0,
      paymentCount: 0,
      importJobCount: 0,
      logisticsCount: 0,
      activeLogisticsCount: 0,
      complianceExportCount: 0,
      scheduledDeletionCount: 0,
      verificationTier: "unverified",
      deviceTrustLevel: "unknown",
      betaAccessStatus: "not_invited",
      betaReadinessStatus: "blocked",
      openSupportTicketCount: 0,
      crashFreeSessionRate: 1,
      publicLaunchStatus: "closed",
      launchReadinessStatus: "blocked",
      openLaunchIncidentCount: 0,
      lowStockCount: 0,
      outstandingDebtTotal: 0,
      unreadNotificationCount: 0,
      knowledgeFactCount: 0
    };
  }

  async createRuntimeTurn(input: {
    sessionId: string | null;
    businessId: string;
    conversationId?: string;
    runtimeSessionId?: string;
    message: string;
    conversationHistory?: RuntimeModelConversationMessage[];
    confirmationToken?: string;
    signal?: AbortSignal;
    now?: Date;
  }): Promise<RuntimeTurnResult> {
    const now = input.now ?? new Date();
    const auth = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "business:read",
      now
    );
    // Every current caller of this method is an authenticated business member (this endpoint
    // requires "business:read"); there is no customer-facing entry point yet. Only the owner role
    // gets the "owner" context/prompt audience; every other membership role is treated as "staff"
    // so non-owner members never see owner-only context sources. "customer" audience remains
    // reserved for a future customer-facing entry point and is intentionally never derived here.
    const callerAudience: AgentAudience = agentAudienceForBusinessRole(
      this.deps.requireMembership(input.businessId, auth.user.id).role
    );
    const readiness = this.getAgentRuntimeReadiness({
      sessionId: input.sessionId,
      businessId: input.businessId,
      now
    });
    if (!readiness.ready) {
      throw new Cp2Error(
        409,
        "agent_runtime_not_ready",
        readiness.issues.map((issue) => issue.message).join(" ")
      );
    }
    const hashtagInvocation = parseRuntimeHashtagInvocation(input.message);
    const storedAgentProfile = this.currentAgentProfile(input.businessId, now);
    if (
      input.conversationId !== undefined &&
      input.confirmationToken === undefined &&
      hashtagInvocation === null
    ) {
      await this.ensureDefaultRuntimeForTurn({
        conversationId: input.conversationId,
        businessId: input.businessId,
        accountId: auth.account.id,
        userId: auth.user.id,
        profile: storedAgentProfile,
        now
      });
    }
    const { activeBinding, activeModelId, nativeResolution } = this.resolveActiveRuntimeModelId(
      input.businessId,
      storedAgentProfile,
      input.conversationId
    );
    if (
      input.conversationId === undefined &&
      this.deps.modelRuntimeAdapterResolver !== undefined &&
      activeBinding === null &&
      input.confirmationToken === undefined &&
      hashtagInvocation === null
    ) {
      throw new Cp2Error(
        409,
        "AGENT_MODEL_NOT_CONFIGURED",
        "This agent does not have a working model yet. Open Agent model settings and activate one.",
        false,
        { agentId: storedAgentProfile.agentId, shopId: input.businessId }
      );
    }
    const runtimeModelId = activeModelId;
    const agentProfile = runtimeAgentProfileFromStored(storedAgentProfile, runtimeModelId);
    const shopRuntime = this.buildShopAgentRuntime(
      storedAgentProfile,
      now,
      callerAudience,
      runtimeModelId
    );
    const runtimeSession =
      input.runtimeSessionId === undefined
        ? this.createRuntimeSession({
            sessionId: input.sessionId,
            businessId: input.businessId,
            now
          })
        : this.requireRuntimeSession(input.businessId, input.runtimeSessionId);

    if (runtimeSession.userId !== auth.user.id) {
      throw new Cp2Error(403, "runtime_actor_mismatch", "Runtime session belongs to another user.");
    }

    const context = this.deps.buildRuntimeContext(input.businessId, auth.user.id);
    const turnId = randomUUID();
    const startedAt = now.toISOString();
    const telemetry: RuntimeTelemetryEvent[] = [];
    const appendTelemetry = (
      state: RuntimeTelemetryEvent["state"],
      status: RuntimeTelemetryEvent["status"],
      toolName: RuntimeToolName | null,
      risk: RuntimePlannedAction["risk"] | null,
      metadata: RuntimeTelemetryEvent["metadata"] = {}
    ) => {
      telemetry.push({
        id: randomUUID(),
        sessionId: runtimeSession.id,
        turnId,
        state,
        occurredAt: now.toISOString(),
        toolName,
        risk,
        status,
        metadata
      });
    };

    appendTelemetry("turn.received", "completed", null, null, {
      messageLength: input.message.trim().length,
      hasConfirmationToken: input.confirmationToken !== undefined,
      runtimeBindingId: nativeResolution?.binding.id ?? activeBinding?.binding.id ?? null,
      runtimeAgentId: nativeResolution?.agent.id ?? storedAgentProfile.agentId,
      selectedPrimaryModelId:
        nativeResolution?.primary.model.id ?? activeBinding?.model.id ?? null,
      selectedActualModelId:
        nativeResolution?.selected.model.id ?? activeBinding?.model.id ?? null,
      executionHostId: nativeResolution?.selected.host?.id ?? null,
      modelInstallationId: nativeResolution?.selected.installation?.id ?? null,
      fallbackUsed: nativeResolution?.fallbackUsed ?? false,
      fallbackReason: nativeResolution?.fallbackReason ?? null
    });

    if (runtimeSession.turnCount >= maxRuntimeTurnsPerSession) {
      const plan = createRuntimePlan({
        toolName: "unknown.clarify",
        input: {},
        validationErrors: ["Runtime session turn limit reached."],
        confirmationToken: null,
        status: "blocked"
      });
      const verification = createRuntimeVerification({
        requiresConfirmation: false,
        confirmationSatisfied: false,
        roleAllowed: true,
        rateLimited: true,
        errors: ["Runtime session turn limit reached."]
      });
      appendTelemetry("turn.rate_limited", "rate_limited", plan.toolName, plan.risk, {
        maxTurns: maxRuntimeTurnsPerSession
      });

      return this.storeRuntimeTurn({
        runtimeSession,
        turn: {
          id: turnId,
          sessionId: runtimeSession.id,
          businessId: input.businessId,
          actorId: auth.user.id,
          message: input.message,
          normalizedInput: input.message.trim().toLowerCase(),
          parserIntent: "unknown",
          parserConfidence: 0,
          status: "rate_limited",
          context,
          plan,
          verification,
          model: null,
          response: "This runtime session has reached its action limit. Start a new session.",
          toolResult: null,
          telemetry,
          runtimeVersion: shopRuntime.version,
          createdAt: startedAt
        },
        now
      });
    }

    appendTelemetry("context.built", "completed", null, null, {
      productCount: context.productCount,
      invoiceCount: context.invoiceCount,
      importJobCount: context.importJobCount
    });

    if (input.confirmationToken !== undefined) {
      return await this.confirmRuntimeAction({
        authUserId: auth.user.id,
        businessId: input.businessId,
        context,
        message: input.message,
        now,
        runtimeSession,
        telemetry,
        turnId,
        token: input.confirmationToken,
        runtimeVersion: shopRuntime.version
      });
    }

    const documentImportProposal = createRuntimeDocumentImportProposal(
      this.deps,
      input.businessId,
      input.message
    );
    const messagingProposal = createRuntimeMessagingProposal(
      this.deps,
      input.businessId,
      input.message
    );
    const networkProposal = createRuntimeNetworkProposal(input.message);
    const commerceProposal = createRuntimeCommerceProposal(input.message);
    const receiptContextScriptMatch = parseReceiptContextScriptCommand({
      message: input.message,
      tenantId: input.businessId,
      contextScripts: agentProfile?.contextScripts ?? []
    });
    const receiptProposal =
      receiptContextScriptMatch === null
        ? null
        : createRuntimeReceiptProposal(this.deps, {
            sessionId: input.sessionId,
            businessId: input.businessId,
            message: input.message,
            match: receiptContextScriptMatch,
            now
          });
    const contextScriptMatch = parseProductContextScriptCommand({
      message: input.message,
      tenantId: input.businessId,
      contextScripts: agentProfile?.contextScripts ?? []
    });
    const effectiveContextScriptMatch = receiptContextScriptMatch ?? contextScriptMatch;
    const parserResult =
      effectiveContextScriptMatch === null
        ? parseMerchantCommand(input.message)
        : receiptContextScriptMatch !== null
          ? receiptContextScriptMatchToParseResult(receiptContextScriptMatch)
          : productContextScriptMatchToParseResult(contextScriptMatch!);
    const retrievedContext = retrieveAgentContext({
      sources: this.contextSourcesForRuntime(storedAgentProfile),
      query: input.message,
      audience: callerAudience,
      limit: 6,
      intent: parserResult.intent,
      characterBudget: contextCharacterBudgetForModel(
        runtimeModelId,
        this.deps.resolveCatalogModel(runtimeModelId)
      )
    });
    const runtimeMemory = shopRuntime.memory.ownerCorrectionsEnabled
      ? this.ownerCorrectionsForBusiness(input.businessId)
          .filter((correction) => correction.status === "active")
          .slice(0, shopRuntime.memory.maximumItemsPerScope)
          .map((correction) => correction.correction)
      : [];
    const modelRoute =
      hashtagInvocation === null &&
      documentImportProposal === null &&
      messagingProposal === null &&
      networkProposal === null &&
      commerceProposal === null &&
      effectiveContextScriptMatch === null
        ? await this.createRuntimeModelRoute({
            message: input.message,
            ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
            ...(input.conversationHistory === undefined
              ? {}
              : { conversationHistory: input.conversationHistory }),
            modelId: runtimeModelId,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
            context,
            now,
            appendTelemetry,
            shopRuntime,
            retrievedContext,
            memory: runtimeMemory,
            intent: parserResult.intent
          })
        : {
            proposal: null,
            trace: null
          };
    if (
      activeBinding !== null &&
      modelRoute.trace !== null &&
      modelRoute.trace.status !== "available"
    ) {
      throw new Cp2Error(
        modelRoute.trace.status === "timeout" ? 504 : 503,
        "AGENT_MODEL_UNAVAILABLE",
        "The active agent model could not complete this message.",
        true,
        {
          bindingId: activeBinding.binding.id,
          modelId: activeBinding.model.id,
          executionTarget: activeBinding.executionTarget,
          runtimeErrorCode: modelRoute.trace.errorCode
        }
      );
    }
    assertResolvedRuntimeAvailable(nativeResolution, modelRoute.trace);
    appendTelemetry("intent.routed", "completed", null, null, {
      intent: parserResult.intent,
      confidence: parserResult.confidence,
      source:
        hashtagInvocation !== null
          ? "hashtag"
          : documentImportProposal !== null
            ? "document_import"
            : messagingProposal !== null
              ? "messaging"
              : networkProposal !== null
                ? "network"
                : commerceProposal !== null
                  ? "commerce"
                  : effectiveContextScriptMatch === null
                    ? modelRoute.proposal === null
                      ? "parser"
                      : "local_model"
                    : "context_script",
      scriptId: effectiveContextScriptMatch?.scriptId ?? null,
      matchedPhrase: effectiveContextScriptMatch?.matchedPhrase ?? null,
      canonicalIntent: effectiveContextScriptMatch?.intent ?? null,
      cardinality: contextScriptMatch?.cardinality ?? null,
      clarificationRequired: effectiveContextScriptMatch?.clarificationRequired ?? false,
      fallbackReason: effectiveContextScriptMatch === null ? "no_context_script_match" : null
    });
    const proposal =
      hashtagInvocation?.proposal ??
      documentImportProposal ??
      messagingProposal ??
      networkProposal ??
      commerceProposal ??
      (effectiveContextScriptMatch === null
        ? (modelRoute.proposal ?? createRuntimeToolProposal(parserResult))
        : receiptContextScriptMatch !== null
          ? receiptProposal!
          : createRuntimeToolProposalFromProductContextScript(contextScriptMatch!));
    const definition = runtimeToolRegistry[proposal.toolName];
    const roleAllowed = roleCan(context.role, definition.requiredPermission as BusinessPermission);
    const policyErrors = enforceAgentPolicy({
      runtime: shopRuntime,
      toolName: proposal.toolName,
      toolInput: proposal.input,
      intent: parserResult.intent
    });
    const skillBinding = shopRuntime.skills.find(
      (binding) => binding.skillId === proposal.toolName
    );
    const runtimeRequiresConfirmation =
      definition.requiresConfirmation ||
      shopRuntime.instructions.ownerApprovalRequiredFor.includes(proposal.toolName) ||
      (skillBinding !== undefined && skillBinding.requiredConfirmationLevel !== "none");
    const proposalAllowed = proposal.validation.ok && policyErrors.length === 0;
    const confirmationToken = proposalAllowed && runtimeRequiresConfirmation ? randomUUID() : null;
    const plan = createRuntimePlan({
      toolName: proposal.toolName,
      input: proposal.input,
      validationErrors: [...proposal.validation.errors, ...policyErrors],
      confirmationToken,
      status: proposalAllowed
        ? runtimeRequiresConfirmation
          ? "needs_confirmation"
          : "safe_to_execute"
        : "clarification_required"
    });
    const verificationErrors = [
      ...proposal.validation.errors,
      ...policyErrors,
      ...(roleAllowed ? [] : ["Actor role cannot use the proposed runtime tool."])
    ];
    const verification = createRuntimeVerification({
      requiresConfirmation: runtimeRequiresConfirmation,
      confirmationSatisfied: false,
      roleAllowed,
      rateLimited: false,
      errors: verificationErrors
    });
    appendTelemetry("plan.created", plan.status, plan.toolName, plan.risk, {
      requiresConfirmation: plan.requiresConfirmation,
      readOnly: definition.readOnly
    });
    appendTelemetry("verification.completed", plan.status, plan.toolName, plan.risk, {
      ok: verification.ok,
      roleAllowed: verification.roleAllowed
    });

    if (confirmationToken !== null) {
      this.pendingRuntimeActions.set(confirmationToken, {
        sessionId: runtimeSession.id,
        businessId: input.businessId,
        actorId: auth.user.id,
        action: plan
      });
      appendTelemetry("confirmation.required", "needs_confirmation", plan.toolName, plan.risk, {
        actionId: plan.id
      });
    }

    const canExecute = plan.status === "safe_to_execute" && verification.ok;
    const toolResult = canExecute
      ? await executeRuntimeCapability(this.deps, {
          sessionId: input.sessionId,
          businessId: input.businessId,
          ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
          action: plan,
          now
        })
      : null;

    if (canExecute) {
      appendTelemetry("tool.executed", "completed", plan.toolName, plan.risk, {
        actionId: plan.id
      });
      plan.executedAt = now.toISOString();
    }

    const status = runtimeStatusFromPlan(plan, verification);
    appendTelemetry("response.generated", status, plan.toolName, plan.risk, {
      actionId: plan.id
    });

    return this.storeRuntimeTurn({
      runtimeSession,
      turn: {
        id: turnId,
        sessionId: runtimeSession.id,
        businessId: input.businessId,
        actorId: auth.user.id,
        message: input.message,
        normalizedInput: parserResult.normalizedInput,
        parserIntent:
          documentImportProposal === null ? parserResult.intent : "confirm_document_import",
        parserConfidence: documentImportProposal === null ? parserResult.confidence : 1,
        status,
        context,
        plan,
        verification,
        model: modelRoute.trace,
        response: createRuntimeResponse({
          plan,
          proposalReason: proposal.reason,
          toolResult,
          verification
        }),
        toolResult,
        telemetry,
        runtimeVersion: shopRuntime.version,
        createdAt: startedAt
      },
      now
    });
  }

  private requireOwnedModelInstallation(
    accountId: string,
    userId: string,
    deviceId: string,
    installationId: string
  ): InstalledAgentModelSummary {
    const model = this.installedAgentModels.get(installationId);
    if (
      model === undefined ||
      model.accountId !== accountId ||
      model.userId !== userId ||
      model.deviceId !== deviceId
    ) {
      throw new Cp2Error(
        404,
        "model_installation_not_found",
        "The model installation was not found on this device."
      );
    }
    return model;
  }

  private async confirmRuntimeAction(input: {
    authUserId: string;
    businessId: string;
    context: RuntimeContextSummary;
    message: string;
    now: Date;
    signal?: AbortSignal;
    runtimeSession: RuntimeSessionSummary;
    telemetry: RuntimeTelemetryEvent[];
    turnId: string;
    token: string;
    runtimeVersion: number;
  }): Promise<RuntimeTurnResult> {
    const pending = this.pendingRuntimeActions.get(input.token);

    if (pending === undefined) {
      throw new Cp2Error(
        404,
        "runtime_confirmation_not_found",
        "Runtime confirmation was not found."
      );
    }

    if (
      pending.sessionId !== input.runtimeSession.id ||
      pending.businessId !== input.businessId ||
      pending.actorId !== input.authUserId
    ) {
      throw new Cp2Error(
        403,
        "runtime_confirmation_mismatch",
        "Runtime confirmation is not valid."
      );
    }

    const action: RuntimePlannedAction = {
      ...pending.action,
      status: "safe_to_execute",
      confirmationToken: input.token
    };
    const definition = runtimeToolRegistry[action.toolName as RuntimeToolName];
    const roleAllowed = roleCan(
      input.context.role,
      definition.requiredPermission as BusinessPermission
    );
    const verification = createRuntimeVerification({
      requiresConfirmation: action.requiresConfirmation,
      confirmationSatisfied: true,
      roleAllowed,
      rateLimited: false,
      errors: roleAllowed ? [] : ["Actor role cannot use the confirmed runtime tool."]
    });
    const appendTelemetry = (
      state: RuntimeTelemetryEvent["state"],
      status: RuntimeTelemetryEvent["status"],
      metadata: RuntimeTelemetryEvent["metadata"] = {}
    ) => {
      input.telemetry.push({
        id: randomUUID(),
        sessionId: input.runtimeSession.id,
        turnId: input.turnId,
        state,
        occurredAt: input.now.toISOString(),
        toolName: action.toolName,
        risk: action.risk,
        status,
        metadata
      });
    };

    appendTelemetry("intent.routed", "completed", {
      confirmation: true
    });
    appendTelemetry("plan.created", action.status, {
      actionId: action.id
    });
    appendTelemetry("verification.completed", action.status, {
      ok: verification.ok,
      roleAllowed: verification.roleAllowed
    });

    const toolResult = verification.ok
      ? await executeRuntimeCapability(this.deps, {
          sessionId: this.requireSessionIdForUser(input.authUserId),
          businessId: input.businessId,
          action,
          now: input.now
        })
      : null;

    if (verification.ok) {
      action.executedAt = input.now.toISOString();
      this.pendingRuntimeActions.delete(input.token);
      appendTelemetry("tool.executed", "completed", {
        actionId: action.id
      });
    }

    appendTelemetry("response.generated", verification.ok ? "completed" : "blocked", {
      actionId: action.id
    });

    return this.storeRuntimeTurn({
      runtimeSession: input.runtimeSession,
      turn: {
        id: input.turnId,
        sessionId: input.runtimeSession.id,
        businessId: input.businessId,
        actorId: input.authUserId,
        message: input.message,
        normalizedInput: input.message.trim().toLowerCase(),
        parserIntent:
          action.toolName === "document_import.confirm" ? "confirm_document_import" : "unknown",
        parserConfidence: 1,
        status: verification.ok ? "completed" : "blocked",
        context: input.context,
        plan: action,
        verification,
        model: null,
        response: verification.ok
          ? `Confirmed and executed ${action.toolName}.`
          : "I could not execute the confirmed action.",
        toolResult,
        telemetry: input.telemetry,
        runtimeVersion: input.runtimeVersion,
        createdAt: input.now.toISOString()
      },
      now: input.now
    });
  }

  runtimeTurnsForBusiness(businessId: string): RuntimeTurnSummary[] {
    return [...this.runtimeTurns.values()].filter((turn) => turn.businessId === businessId);
  }

  private requireBusinessAgent(
    businessId: string,
    agentId: string,
    now: Date
  ): BusinessAgentProfileSummary {
    const profile = this.currentAgentProfile(businessId, now);
    if (profile.agentId !== agentId || profile.businessId !== businessId) {
      throw new Cp2Error(404, "AGENT_NOT_FOUND", "The requested business agent was not found.");
    }
    return profile;
  }

  private requireCanonicalAiModel(modelId: string): AiModelSummary {
    const model = this.deps.resolveCatalogModel(modelId);
    if (model === undefined) {
      throw new Cp2Error(404, "MODEL_NOT_FOUND", "The requested model was not found.");
    }
    return model;
  }

  private requireModelRuntimeAdapter(input: {
    modelId: string;
    executionTarget: ModelExecutionTarget;
    agentId: string;
    businessId: string;
  }): ModelRuntimeAdapter {
    const adapter = this.deps.modelRuntimeAdapterResolver?.({
      modelId: input.modelId,
      executionTarget: input.executionTarget,
      agentId: input.agentId,
      shopId: input.businessId
    });
    if (adapter === undefined) {
      throw new Cp2Error(
        503,
        "RUNTIME_NOT_CONFIGURED",
        "The selected model runtime is not configured for this deployment.",
        false,
        { modelId: input.modelId, executionTarget: input.executionTarget }
      );
    }
    return adapter;
  }

  /** Shared by createRuntimeTurn and the public storefront agent reply path. */
  resolveActiveRuntimeModelId(
    businessId: string,
    storedAgentProfile: BusinessAgentProfileSummary,
    conversationId?: string
  ): {
    activeBinding: ActiveNativeAgentBinding | null;
    activeModelId: string;
    nativeResolution: ReturnType<AgentRuntimeDomainDeps["resolveNativeRuntimeBinding"]> | null;
  } {
    const activeBinding = this.deps.getActiveNativeRuntimeBinding(
      businessId,
      storedAgentProfile.agentId
    );
    const nativeResolution =
      conversationId === undefined
        ? null
        : this.deps.resolveNativeRuntimeBinding(conversationId, businessId);
    const selectedCloudFallbackModelId = resolveDefaultDeviceModelId(
      this.activeAiModels.get(businessId)?.modelId ?? defaultAiModelId,
      this.deps.resolveCatalogModel(
        this.activeAiModels.get(businessId)?.modelId ?? defaultAiModelId
      )
    );
    const requestedModelId = storedAgentProfile.modelId;
    const activeModelId =
      nativeResolution?.selected.model.id ??
      activeBinding?.model.id ??
      (this.deps.runtimeModelProviderResolver === undefined ||
      requestedModelId === selectedCloudFallbackModelId
        ? selectedCloudFallbackModelId
        : "sokoclaw-local");
    return { activeBinding, activeModelId, nativeResolution };
  }

  /**
   * Lazy, idempotent first-chat provisioning. Only server-reachable adapters participate here;
   * browser and installed-app runtimes are request-device capabilities and are resolved by the
   * client protocol instead of being guessed by the API. A configured adapter must affirm
   * availability before its host is persisted as usable.
   */
  private async ensureDefaultRuntimeForTurn(input: {
    conversationId: string;
    businessId: string;
    accountId: string;
    userId: string;
    profile: BusinessAgentProfileSummary;
    now: Date;
  }): Promise<void> {
    const nativeResolution = this.deps.resolveNativeRuntimeBinding(
      input.conversationId,
      input.businessId
    );
    const hasBackendRuntime =
      nativeResolution !== null &&
      [nativeResolution.primary, ...nativeResolution.fallbacks].some(
        (candidate) =>
          candidate.available &&
          (candidate.host?.type ?? candidate.model.configuration.executionTarget) === "backend"
      );
    if (hasBackendRuntime) return;
    if (this.deps.modelRuntimeAdapterResolver === undefined) return;

    const usesPlatformDefaultAgent = input.profile.agentDefinitionId === defaultAgentDefinitionId;
    const agentId = usesPlatformDefaultAgent
      ? this.deps.platformDefaultRuntime.agentId
      : input.profile.agentId;
    const agentName = usesPlatformDefaultAgent
      ? this.deps.platformDefaultRuntime.agentName
      : input.profile.name;
    const agentRuntimeAdapterId = usesPlatformDefaultAgent
      ? this.deps.platformDefaultRuntime.agentRuntimeAdapterId
      : "soko";
    const agentAdapter = this.deps.agentRuntimeAdapterResolver(agentRuntimeAdapterId);
    if (
      agentAdapter === undefined ||
      this.deps.platformDefaultRuntime.executionTarget !== "backend"
    ) {
      return;
    }
    const agent: NativeRuntimeAgentSummary = {
      id: agentId,
      businessId: input.businessId,
      accountId: input.accountId,
      name: agentName,
      provider: usesPlatformDefaultAgent ? "pi" : "soko-business-agent",
      packageRef: null,
      version: "1",
      runtimeContractVersion: "1",
      capabilities: ["tools", "mcp"],
      configuration: {
        runtimeAdapterId: agentRuntimeAdapterId,
        requiredModelCapabilities: ["chat"]
      },
      status: "active",
      createdAt: input.now.toISOString(),
      updatedAt: input.now.toISOString()
    };
    let agentAvailable = false;
    try {
      agentAvailable = (
        await agentAdapter.canRun({
          agent,
          modelId: this.deps.platformDefaultRuntime.modelId,
          conversationId: input.conversationId,
          shopId: input.businessId
        })
      ).available;
    } catch {
      return;
    }
    if (!agentAvailable) return;

    const preferredIds = uniqueModelIds([
      this.activeAiModels.get(input.businessId)?.modelId,
      usesPlatformDefaultAgent ? this.deps.platformDefaultRuntime.modelId : input.profile.modelId,
      input.profile.modelId,
      defaultAiModelId,
      ...this.deps
        .listModelCatalog()
        .filter((model) => model.available && model.capabilities.includes("chat"))
        .sort((left, right) => Number(right.recommended) - Number(left.recommended))
        .map((model) => model.id)
    ]);
    const candidates: Array<{
      model: AiModelSummary;
      executionTarget: "backend";
      checkedAt: string;
    }> = [];
    for (const modelId of preferredIds) {
      const model = this.deps.resolveCatalogModel(modelId);
      if (model === undefined || !model.available || !model.capabilities.includes("chat")) {
        continue;
      }
      const adapter = this.deps.modelRuntimeAdapterResolver({
        modelId,
        executionTarget: "backend",
        agentId,
        shopId: input.businessId
      });
      if (adapter === undefined) continue;
      try {
        const availability = await adapter.canRun({
          modelId,
          agentId,
          shopId: input.businessId
        });
        if (availability.available) {
          candidates.push({
            model,
            executionTarget: "backend",
            checkedAt: input.now.toISOString()
          });
        }
      } catch {
        // Availability probing is advisory and provider-neutral. Another compatible adapter may
        // still satisfy the request, and details are intentionally not exposed to the merchant.
      }
      if (candidates.length >= 2) break;
    }
    if (candidates.length === 0) return;
    this.deps.ensureDefaultRuntimeBinding({
      conversationId: input.conversationId,
      businessId: input.businessId,
      accountId: input.accountId,
      agentId,
      agentName,
      agentRuntimeAdapterId,
      candidates,
      updatedBy: input.userId,
      checkedAt: input.now.toISOString()
    });
  }

  private recordAgentModelBindingAudit(
    type: string,
    binding: AgentModelBindingAuditFields,
    actorId: string,
    extra: Record<string, string | number | boolean | null>
  ): void {
    this.deps.recordAuditEvent({
      type,
      aggregateType: "agent_model_binding",
      aggregateId: binding.id,
      actorId,
      occurredAt: binding.updatedAt,
      payload: {
        shopId: binding.shopId,
        agentId: binding.agentId,
        modelId: binding.modelId,
        executionTarget: binding.executionTarget,
        status: binding.status,
        ...extra
      }
    });
  }

  currentAgentProfile(businessId: string, now: Date): BusinessAgentProfileSummary {
    const stored = this.agentProfiles.get(businessId);
    if (stored !== undefined) return hydrateBusinessAgentProfile(stored);
    return createDefaultBusinessAgentProfile({
      business: this.deps.requireBusiness(businessId),
      modelId:
        this.activeAiModels.get(businessId)?.modelId ?? this.deps.platformDefaultRuntime.modelId,
      updatedAt: now.toISOString(),
      updatedBy: "00000000-0000-4000-8000-000000000000",
      agentDefinition: this.deps.resolveAgentCatalogEntry(defaultAgentDefinitionId)
    });
  }

  buildShopAgentRuntime(
    profile: BusinessAgentProfileSummary,
    now: Date,
    audience: AgentAudience,
    modelId = profile.modelId
  ): ShopAgentRuntime {
    const contextSources = this.contextSourcesForRuntime(profile);
    return buildShopAgentRuntimeModule(
      {
        deps: this.deps,
        activeBinding: this.deps.getActiveNativeRuntimeBinding(profile.businessId, profile.agentId),
        contextSources
      },
      profile,
      now,
      audience,
      modelId
    );
  }

  contextSourcesForRuntime(profile: BusinessAgentProfileSummary): AgentContextSource[] {
    return contextSourcesForRuntimeModule(
      {
        deps: this.deps,
        agentContextSources: this.agentContextSources,
        ownerCorrections: this.ownerCorrectionsForBusiness(profile.businessId)
      },
      profile
    );
  }
  private synchronizeProfileContextSources(profile: BusinessAgentProfileSummary, now: Date): void {
    for (const source of this.agentContextSources.values()) {
      if (source.shopId === profile.businessId && source.type === "context_script") {
        source.status = "archived";
        source.deletedAt = now.toISOString();
        source.updatedAt = now.toISOString();
      }
    }
    profile.contextScripts.forEach((content, index) => {
      const source = contextSourceRecord({
        id: randomUUID(),
        businessId: profile.businessId,
        type: "context_script",
        title: `Context script ${index + 1}`,
        content,
        sensitivity: "internal",
        customerVisible: false,
        sourceRecordId: null,
        now
      });
      this.agentContextSources.set(source.id, source);
    });
  }

  private runtimeVersionsForBusiness(businessId: string): AgentRuntimeVersion[] {
    return [...this.agentRuntimeVersions.values()]
      .filter((version) => version.shopId === businessId)
      .sort((left, right) => right.version - left.version);
  }

  private recordAgentRuntimeVersion(
    profile: BusinessAgentProfileSummary,
    actorId: string,
    changeSummary: string
  ): AgentRuntimeVersion {
    const runtime = this.buildShopAgentRuntime(profile, new Date(profile.updatedAt), "owner");
    const version: AgentRuntimeVersion = {
      id: randomUUID(),
      tenantId: profile.tenantId,
      shopId: profile.shopId,
      agentId: profile.agentId,
      version: profile.runtimeVersion,
      runtime: {
        ...runtime,
        context: {
          ...runtime.context,
          sources: runtime.context.sources.map((source) => ({
            ...cloneAgentContextSource(source),
            retrievalMetadata: { ...source.retrievalMetadata, content: null }
          }))
        }
      },
      createdBy: actorId,
      changeSummary: normalizeRequiredBoundedText(changeSummary, "runtime change summary", 500),
      createdAt: profile.updatedAt,
      previousVersion: profile.runtimeVersion > 1 ? profile.runtimeVersion - 1 : null
    };
    const existing = this.runtimeVersionsForBusiness(profile.businessId).find(
      (candidate) => candidate.version === version.version
    );
    if (existing !== undefined) this.agentRuntimeVersions.delete(existing.id);
    this.agentRuntimeVersions.set(version.id, version);
    return cloneAgentRuntimeVersion(version);
  }

  private ownerCorrectionsForBusiness(businessId: string): AgentOwnerCorrection[] {
    return [...this.agentOwnerCorrections.values()]
      .filter((correction) => correction.shopId === businessId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private evaluationEventsForBusiness(businessId: string): AgentEvaluationEvent[] {
    return [...this.agentEvaluationEvents.values()]
      .filter((event) => event.shopId === businessId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private recordAgentEvaluationEvent(input: {
    businessId: string;
    runtimeVersion: number;
    modelId: string | null;
    eventType: AgentEvaluationEventType;
    outcome: AgentEvaluationEvent["outcome"];
    score: number | null;
    reason: string | null;
    metadata: AgentEvaluationEvent["metadata"];
    sessionId: string | null;
    messageId: string | null;
    now: Date;
  }): AgentEvaluationEvent {
    const profile = this.currentAgentProfile(input.businessId, input.now);
    const event: AgentEvaluationEvent = {
      id: randomUUID(),
      tenantId: input.businessId,
      shopId: input.businessId,
      agentId: profile.agentId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      eventType: input.eventType,
      outcome: input.outcome,
      score: input.score,
      reason: input.reason,
      metadata: { ...input.metadata },
      runtimeVersion: input.runtimeVersion,
      modelId: input.modelId,
      createdAt: input.now.toISOString()
    };
    this.agentEvaluationEvents.set(event.id, event);
    return { ...event, metadata: { ...event.metadata } };
  }

  resolveRuntimeModelProvider(
    shopRuntime: ShopAgentRuntime,
    modelId: string,
    conversationId?: string,
    attemptedRuntimeKeys?: ReadonlySet<string>
  ): {
    provider: RuntimeModelProvider | undefined;
    executionTarget: ModelExecutionTarget | undefined;
    resolutionSource: ExecutionTargetResolutionSource | null;
    runtimeKey: string | null;
    runtimeBindingId: string | null;
    resolvedModelId: string;
    executionHostId: string | null;
    fallbackIndex: number;
  } {
    const nativeResolution =
      conversationId === undefined
        ? null
        : this.deps.resolveNativeRuntimeBinding(conversationId, shopRuntime.shopId);
    return resolveNativeRuntimeModelProvider({
      shopRuntime,
      requestedModelId: modelId,
      nativeResolution,
      requireAdapter: (adapterInput) => this.requireModelRuntimeAdapter(adapterInput),
      adapterResolverConfigured: this.deps.modelRuntimeAdapterResolver !== undefined,
      ...(this.deps.runtimeModelProvider === undefined
        ? {}
        : { runtimeModelProvider: this.deps.runtimeModelProvider }),
      ...(this.deps.runtimeModelProviderResolver === undefined
        ? {}
        : { runtimeModelProviderResolver: this.deps.runtimeModelProviderResolver }),
      ...(attemptedRuntimeKeys === undefined ? {} : { attemptedRuntimeKeys }),
      // Remote-shop-device execution is negotiated by the authenticated owner-node client
      // protocol. This in-process provider call can execute only server-reachable backend hosts.
      eligibleExecutionTargets: new Set<ModelExecutionTarget>(["backend"])
    });
  }

  private async createRuntimeModelRoute(input: {
    conversationHistory?: RuntimeModelConversationMessage[];
    conversationId?: string;
    message: string;
    modelId: string;
    context: RuntimeContextSummary;
    shopRuntime: ShopAgentRuntime;
    retrievedContext: ReturnType<typeof retrieveAgentContext>;
    memory: string[];
    intent: RuntimeTurnSummary["parserIntent"];
    now: Date;
    appendTelemetry: (
      state: RuntimeTelemetryEvent["state"],
      status: RuntimeTelemetryEvent["status"],
      toolName: RuntimeToolName | null,
      risk: RuntimePlannedAction["risk"] | null,
      metadata?: RuntimeTelemetryEvent["metadata"]
    ) => void;
  }): Promise<{
    proposal: ReturnType<typeof createRuntimeToolProposal> | null;
    trace: RuntimeModelTrace | null;
  }> {
    const resolvedAgent =
      input.conversationId === undefined
        ? null
        : this.deps.resolveNativeRuntimeBinding(input.conversationId, input.shopRuntime.shopId)
            ?.agent;
    const agent: NativeRuntimeAgentSummary = resolvedAgent ?? {
      id: input.shopRuntime.agentId,
      businessId: input.shopRuntime.shopId,
      accountId: null,
      name: input.shopRuntime.identity.agentName,
      provider: "soko-legacy-runtime",
      packageRef: null,
      version: String(input.shopRuntime.version),
      runtimeContractVersion: "1",
      capabilities: ["tools", "mcp"],
      configuration: { runtimeAdapterId: "soko" },
      status: "active",
      createdAt: input.now.toISOString(),
      updatedAt: input.now.toISOString()
    };
    return createRuntimeModelRoute(
      {
        resolveRuntimeModelProvider: (runtime, modelId, attemptedRuntimeKeys) =>
          this.resolveRuntimeModelProvider(
            runtime,
            modelId,
            input.conversationId,
            attemptedRuntimeKeys
          ),
        resolveAgentRuntimeAdapter: (adapterId) => this.deps.agentRuntimeAdapterResolver(adapterId)
      },
      { ...input, agent }
    );
  }
  private requireRuntimeSession(
    businessId: string,
    runtimeSessionId: string
  ): RuntimeSessionSummary {
    const runtimeSession = this.runtimeSessions.get(runtimeSessionId);

    if (runtimeSession === undefined || runtimeSession.businessId !== businessId) {
      throw new Cp2Error(404, "runtime_session_not_found", "Runtime session was not found.");
    }

    if (runtimeSession.status !== "active") {
      throw new Cp2Error(409, "runtime_session_closed", "Runtime session is closed.");
    }

    return runtimeSession;
  }

  private requireSessionIdForUser(userId: string): string | null {
    const session = [...this.deps.sessions.values()]
      .filter((candidate) => candidate.userId === userId && candidate.revokedAt === null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

    return session?.id ?? null;
  }

  private storeRuntimeTurn(input: {
    runtimeSession: RuntimeSessionSummary;
    turn: RuntimeTurnSummary;
    now: Date;
  }): RuntimeTurnResult {
    this.runtimeTurns.set(input.turn.id, input.turn);
    const updatedSession: RuntimeSessionSummary = {
      ...input.runtimeSession,
      turnCount: input.runtimeSession.turnCount + 1,
      updatedAt: input.now.toISOString()
    };
    this.runtimeSessions.set(updatedSession.id, updatedSession);
    this.deps.recordAuditEvent({
      type: "runtime.turn_recorded",
      aggregateType: "runtime_turn",
      aggregateId: input.turn.id,
      actorId: input.turn.actorId,
      occurredAt: input.now.toISOString(),
      payload: {
        businessId: input.turn.businessId,
        runtimeSessionId: input.turn.sessionId,
        parserIntent: input.turn.parserIntent,
        toolName: input.turn.plan.toolName,
        risk: input.turn.plan.risk,
        status: input.turn.status,
        messageLength: input.turn.message.length
      }
    });
    const profile = this.currentAgentProfile(input.turn.businessId, input.now);
    if (
      profile.evaluationPolicy.enabled &&
      runtimeEvaluationSampled(input.turn.id, profile.evaluationPolicy.sampleRate)
    ) {
      const outcome: AgentEvaluationEvent["outcome"] =
        input.turn.status === "completed"
          ? "success"
          : input.turn.status === "clarifying" || input.turn.status === "needs_confirmation"
            ? "partial"
            : "blocked";
      this.recordAgentEvaluationEvent({
        businessId: input.turn.businessId,
        runtimeVersion: input.turn.runtimeVersion,
        modelId: profile.modelId,
        eventType:
          input.turn.plan.executedAt !== null && profile.evaluationPolicy.recordToolOutcomes
            ? "tool_execution"
            : input.turn.verification.errors.length > 0 &&
                profile.evaluationPolicy.recordPolicyBlocks
              ? "policy_compliance"
              : "intent_classification",
        outcome,
        score: outcome === "success" ? 1 : outcome === "partial" ? 0.5 : 0,
        reason:
          input.turn.verification.errors[0] ??
          (input.turn.plan.executedAt !== null
            ? "Verified runtime action completed."
            : "Runtime turn recorded."),
        metadata: {
          intent: input.turn.parserIntent,
          toolName: input.turn.plan.toolName,
          status: input.turn.status
        },
        sessionId: input.turn.sessionId,
        messageId: null,
        now: input.now
      });
      if (
        profile.evaluationPolicy.recordLatency &&
        typeof input.turn.model?.durationMs === "number"
      ) {
        this.recordAgentEvaluationEvent({
          businessId: input.turn.businessId,
          runtimeVersion: input.turn.runtimeVersion,
          modelId: profile.modelId,
          eventType: "response_latency",
          outcome: input.turn.model?.status === "available" ? "success" : "partial",
          score: null,
          reason: "Provider-neutral model completion latency.",
          metadata: {
            durationMs: input.turn.model?.durationMs ?? 0,
            provider: input.turn.model?.provider ?? "none"
          },
          sessionId: input.turn.sessionId,
          messageId: null,
          now: input.now
        });
      }
    }

    return {
      session: updatedSession,
      turn: input.turn
    };
  }
}

/** The minimal shape recordAgentModelBindingAudit needs - satisfied by a full projected
 *  AgentModelBindingSummary (the success paths) or by failedActivationAuditFields below (the
 *  failure paths, which never persist a native binding so there is no real one to project). */
interface AgentModelBindingAuditFields {
  id: string;
  updatedAt: string;
  shopId: string;
  agentId: string;
  modelId: string;
  executionTarget: ModelExecutionTarget;
  status: string;
}

/** A failed activation attempt writes no runtime binding (native or otherwise) - this synthesizes
 *  just enough shape for the audit trail from the request that failed, keyed deterministically by
 *  agent+model so repeated failures for the same pair are easy to correlate in the audit log. */
function failedActivationAuditFields(
  input: { agentId: string; businessId: string; modelId: string; executionTarget: ModelExecutionTarget },
  occurredAt: string,
  errorCode: string | null
): AgentModelBindingAuditFields {
  return {
    id: `activation-attempt:${input.agentId}:${input.modelId}`,
    updatedAt: occurredAt,
    shopId: input.businessId,
    agentId: input.agentId,
    modelId: input.modelId,
    executionTarget: input.executionTarget,
    status: isUnavailableRuntimeCode(errorCode) ? "unavailable" : "failed"
  };
}

function uniqueModelIds(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized === undefined || normalized === "" || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
