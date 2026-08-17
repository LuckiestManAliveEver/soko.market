/**
 * Ninth slice of in-process domain modularization for the Cp2Store monolith (see
 * docs/architecture/domain-modularization-roadmap.md). The largest slice by method count and by
 * total line volume: owns `activeAiModels`, `agentProfiles`, `agentRuntimeVersions`,
 * `agentContextSources`, `agentEvaluationEvents`, `agentOwnerCorrections`,
 * `installedAgentModels`, `agentModelAssignments`, `browserInferenceAssignments`,
 * `agentModelBindings` (+ the ephemeral `agentModelActivationLocks` mutex Set), `runtimeSessions`,
 * `runtimeTurns`, and `pendingRuntimeActions` (never persisted - no `Cp2Snapshot` field) - plus
 * the entire `createRuntimeTurn` pipeline (context retrieval, tool proposal, confirmation,
 * execution, model routing, recall persistence) and every AI-model-catalog/activation/assignment
 * method.
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
 * sweeps `browserInferenceAssignments`/`runtimeSessions`/`runtimeTurns`/`pendingRuntimeActions`
 * - `activeAiModels`/`agentProfiles`/`agentRuntimeVersions`/`agentContextSources`/
 * `agentEvaluationEvents`/`agentOwnerCorrections`/`installedAgentModels`/
 * `agentModelAssignments`/`agentModelBindings` are never touched by shop-level deletion, only by
 * the account-level purge (`deleteAccountOwnedData`, which sweeps all of them completely). This
 * was true before this extraction; flagging it here rather than silently fixing it as a
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
  AgentAudience,
  AgentContextSource,
  AgentEvaluationEvent,
  AgentEvaluationEventType,
  AgentEvaluationSummary,
  AgentModelActivationResult,
  AgentModelAssignmentSummary,
  AgentModelBindingPermissions,
  AgentModelBindingRemovalResult,
  AgentModelBindingSummary,
  AgentModelFallbackPolicy,
  AgentModelReadinessStatus,
  AgentOwnerCorrection,
  AgentRuntimeReadiness,
  AgentRuntimeVersion,
  AiModelSummary,
  AuthSessionView,
  BrowserCheckpointCompatibilityContract,
  BrowserDeviceTier,
  BrowserInferenceAssignmentSummary,
  BrowserRuntimeContract,
  BusinessSummary,
  CatalogueQueryResult,
  ChannelProvider,
  ClientInferenceCompletion,
  CustomerSummary,
  DocumentImportJobSummary,
  InstalledAgentModelSummary,
  InvoiceSummary,
  MembershipSummary,
  ModelExecutionTarget,
  ModelRuntimeHealthSummary,
  PreferredExecutionMode,
  ProductSummary,
  PurchaseReceiptSummary,
  RuntimeContextSummary,
  RuntimeModelCompletionResult,
  RuntimeModelConversationMessage,
  RuntimeModelProvider,
  RuntimeModelTrace,
  RuntimePlannedAction,
  RuntimeRecallEscalation,
  RuntimeSessionSummary,
  RuntimeTelemetryEvent,
  RuntimeToolName,
  RuntimeTurnResult,
  RuntimeTurnSummary,
  ShopAgentRuntime,
  SupplierSummary,
  TrustedMessageAttachmentReference
} from "@soko/shared-types";
import {
  createRuntimeToolProposal,
  createRuntimeToolProposalFromProductContextScript,
  createRuntimeToolProposalFromReceiptContextScript,
  invalid,
  parseMerchantCommand,
  parseProductContextScriptCommand,
  parseReceiptContextScriptCommand,
  parseRuntimeModelOutput,
  productContextScriptMatchToParseResult,
  receiptContextScriptMatchToParseResult,
  runtimeToolRegistry,
  valid,
  type RuntimeToolProposal
} from "@soko/tool-core";
import { queryCatalogueProducts, roleCan, type BusinessPermission } from "@soko/business-core";
import { Cp2Error } from "../../cp2-error.js";
import {
  asModelRuntimeError,
  runtimeProviderFromAdapter,
  type ModelRuntimeAdapter
} from "../../../inference/model-runtime.js";
import { normalizeRequiredBoundedText } from "../../text-normalization.js";
import {
  agentAudienceForBusinessRole,
  assembleAgentInferenceMessage,
  enforceAgentPolicy,
  retrieveAgentContext
} from "../../agent-business-runtime.js";
import {
  decideRecallPersistence,
  parseRecallCandidateFromModelOutput,
  parseRecallEntry,
  recallSearchText,
  serializeRecallEntry,
  withRecallDistillationInstruction,
  type RecallCandidate,
  type RecallEntry,
  type RecallEscalationSignal
} from "../../recall-distillation.js";
import type { CustomerRuntimeCapabilityRecord } from "../messaging/shared.js";
import type { Cp2Snapshot, SessionRecord } from "../../store.js";

import {
  agentModelAssignmentKey,
  aiModelRegistry,
  assertModelCanBeAssigned,
  browserInferenceAssignmentKey,
  buildRuntimeModelPrompt,
  cloneAgentContextSource,
  cloneAgentInstructions,
  cloneAgentModelBinding,
  cloneAgentPersonality,
  cloneAgentRuntimeVersion,
  cloneAgentSkillBinding,
  cloneBrowserInferenceAssignment,
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
  isChannelProvider,
  isUnavailableRuntimeCode,
  maxRuntimeTurnsPerSession,
  modelHealthError,
  modelTraceFromCompletion,
  normalizeBrowserCheckpointContract,
  normalizeBrowserInferenceTimestamp,
  normalizeBrowserRuntimeContract,
  normalizeBusinessAgentProfile,
  normalizeExecutionMode,
  normalizeFallbackPolicy,
  normalizeInstalledAgentModel,
  normalizeModelCatalogSearch,
  normalizeRuntimeLookup,
  qualifiesForModelFallback,
  resolveDefaultDeviceModelId,
  runtimeAgentProfileFromStored,
  runtimeEvaluationSampled,
  runtimeStatusFromPlan,
  stableUuid,
  validateAgentModelBindingConfiguration,
  validateBrowserInferenceAssignment,
  type BusinessAgentProfileInput,
  type BusinessAgentProfileSummary,
  type PendingRuntimeAction,
  type RuntimeAgentProfile
} from "./shared.js";
export interface AgentRuntimeDomainDeps {
  requireAuthorizedSession: (
    sessionId: string | null,
    businessId: string,
    permission: BusinessPermission,
    now?: Date
  ) => AuthSessionView;
  requirePinVerifiedSession: (sessionId: string | null, now: Date) => AuthSessionView;
  recordAuditEvent: (input: {
    type: string;
    aggregateType: string;
    aggregateId: string;
    actorId: string;
    occurredAt: string;
    payload: Record<string, unknown>;
  }) => void;
  requireMembership: (businessId: string, userId: string) => MembershipSummary;
  requireBusiness: (businessId: string) => BusinessSummary;
  buildRuntimeContext: (businessId: string, userId: string) => RuntimeContextSummary;
  imageForProduct: (product: ProductSummary) => string | null;
  importsForBusiness: (businessId: string) => DocumentImportJobSummary[];
  requireDocumentImport: (businessId: string, importJobId: string) => DocumentImportJobSummary;
  suppliersForBusiness: (businessId: string) => SupplierSummary[];
  purchaseReceipts: Map<string, PurchaseReceiptSummary>;
  queryCatalogue: (input: {
    sessionId: string | null;
    businessId: string;
    query: string;
    now?: Date;
  }) => CatalogueQueryResult;
  listProducts: (input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }) => ProductSummary[];
  listInvoices: (input: { sessionId: string | null; businessId: string; now?: Date }) => unknown;
  createProduct: (input: {
    sessionId: string | null;
    businessId: string;
    product: {
      name: string;
      sku: string | null;
      unit: string;
      quantity: number;
    };
    now?: Date;
  }) => ProductSummary;
  deleteProduct: (input: {
    sessionId: string | null;
    businessId: string;
    productId: string;
    now?: Date;
  }) => unknown;
  createCustomer: (input: {
    sessionId: string | null;
    businessId: string;
    customer: {
      name: string;
      phone: string | null;
      email: string | null;
      notes: string | null;
    };
    now?: Date;
  }) => CustomerSummary;
  listPurchaseReceipts: (input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }) => PurchaseReceiptSummary[];
  confirmProductImport: (input: {
    sessionId: string | null;
    businessId: string;
    importJobId: string;
    now?: Date;
  }) => unknown;
  confirmSupplierImport: (input: {
    sessionId: string | null;
    businessId: string;
    importJobId: string;
    now?: Date;
  }) => unknown;
  sendChannelMessage: (input: {
    sessionId: string | null;
    businessId: string;
    customerId?: string;
    customerName?: string;
    conversationId?: string;
    provider?: ChannelProvider;
    mailboxId?: string;
    subject?: string;
    replyToMessageId?: string;
    attachments?: TrustedMessageAttachmentReference[];
    text: string;
    idempotencyKey: string;
    now?: Date;
  }) => Promise<unknown>;
  products: Map<string, ProductSummary>;
  customers: Map<string, CustomerSummary>;
  invoices: Map<string, InvoiceSummary>;
  sessions: Map<string, SessionRecord>;
  businesses: Map<string, BusinessSummary>;
  modelRuntimeAdapterResolver?: (input: {
    modelId: string;
    executionTarget: ModelExecutionTarget;
    agentId: string;
    shopId: string;
  }) => ModelRuntimeAdapter | undefined;
  runtimeModelProviderResolver?: (modelId: string) => RuntimeModelProvider | undefined;
  runtimeModelProvider?: RuntimeModelProvider;
}

export class AgentRuntimeDomain {
  private readonly activeAiModels = new Map<string, ActiveAiModelSummary>();
  private readonly agentProfiles = new Map<string, BusinessAgentProfileSummary>();
  private readonly agentRuntimeVersions = new Map<string, AgentRuntimeVersion>();
  private readonly agentContextSources = new Map<string, AgentContextSource>();
  private readonly agentEvaluationEvents = new Map<string, AgentEvaluationEvent>();
  private readonly agentOwnerCorrections = new Map<string, AgentOwnerCorrection>();
  private readonly installedAgentModels = new Map<string, InstalledAgentModelSummary>();
  private readonly agentModelAssignments = new Map<string, AgentModelAssignmentSummary>();
  private readonly browserInferenceAssignments = new Map<
    string,
    BrowserInferenceAssignmentSummary
  >();
  private readonly agentModelBindings = new Map<string, AgentModelBindingSummary>();
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

  get agentModelAssignmentsMap(): Map<string, AgentModelAssignmentSummary> {
    return this.agentModelAssignments;
  }

  get browserInferenceAssignmentsMap(): Map<string, BrowserInferenceAssignmentSummary> {
    return this.browserInferenceAssignments;
  }

  get agentModelBindingsMap(): Map<string, AgentModelBindingSummary> {
    return this.agentModelBindings;
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
    this.agentModelAssignments.clear();
    this.browserInferenceAssignments.clear();
    this.agentModelBindings.clear();
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

    for (const assignment of snapshot.agentModelAssignments ?? []) {
      this.agentModelAssignments.set(
        agentModelAssignmentKey(assignment.businessId, assignment.deviceId),
        { ...assignment }
      );
    }

    for (const assignment of snapshot.browserInferenceAssignments ?? []) {
      this.browserInferenceAssignments.set(
        browserInferenceAssignmentKey(assignment.businessId, assignment.deviceId),
        cloneBrowserInferenceAssignment(assignment)
      );
    }

    for (const binding of snapshot.agentModelBindings ?? []) {
      this.agentModelBindings.set(binding.id, cloneAgentModelBinding(binding));
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
    return aiModelRegistry
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
      .map((model) => ({ ...model, capabilities: [...model.capabilities] }));
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
    const modelId = resolveDefaultDeviceModelId(stored?.modelId ?? "sokoclaw-local");
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
    const model = aiModelRegistry.find((candidate) => candidate.id === input.modelId);
    if (
      model === undefined ||
      model.provider !== "openai" ||
      model.source !== "hosted" ||
      !model.available
    ) {
      throw new Cp2Error(
        400,
        "cloud_model_unavailable",
        "The selected cloud fallback model is unavailable."
      );
    }
    const hasReadyLocalModel = [...this.agentModelAssignments.values()].some(
      (assignment) =>
        assignment.businessId === input.businessId &&
        assignment.activeModelInstallationId !== null &&
        assignment.readinessStatus === "READY" &&
        assignment.lastSuccessfulInferenceAt !== null &&
        assignment.runtimeBackend !== "CLOUD"
    );
    if (!hasReadyLocalModel) {
      throw new Cp2Error(
        409,
        "local_model_required",
        "Connect and test a downloaded model before selecting an OpenAI fallback."
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
    this.deps.requireAuthorizedSession(input.sessionId, input.businessId, "business:read", now);
    this.requireBusinessAgent(input.businessId, input.agentId, now);
    const binding = this.activeAgentModelBinding(input.agentId);
    return binding === null ? null : cloneAgentModelBinding(binding);
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

    const active = this.activeAgentModelBinding(input.agentId);
    if (active === null) {
      return {
        agentId: input.agentId,
        shopId: input.businessId,
        binding: null,
        removedBindingId: null
      };
    }

    const removedAt = now.toISOString();
    const inactive: AgentModelBindingSummary = {
      ...active,
      status: "inactive",
      updatedAt: removedAt,
      updatedBy: session.user.id
    };
    this.agentModelBindings.set(inactive.id, inactive);

    const fallbackModelId = resolveDefaultDeviceModelId(
      this.activeAiModels.get(input.businessId)?.modelId ?? defaultAiModelId
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
    fallbackPolicy: AgentModelFallbackPolicy;
    permissions: AgentModelBindingPermissions;
    fallbackModelId: string | null;
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
    const model = this.requireCanonicalAiModel(input.modelId);
    validateAgentModelBindingConfiguration(input, model, aiModelRegistry);
    input.onStage?.("model_resolved", Date.now() - startedAt);
    const existingActive = this.activeAgentModelBinding(input.agentId);
    if (
      existingActive !== null &&
      existingActive.modelId === input.modelId &&
      existingActive.executionTarget === input.executionTarget &&
      existingActive.executionMode === normalizeExecutionMode(input.executionMode) &&
      existingActive.fallbackPolicy === normalizeFallbackPolicy(input.fallbackPolicy) &&
      existingActive.fallbackModelId === input.fallbackModelId &&
      existingActive.permissions.allowInstalledApp === input.permissions.allowInstalledApp &&
      existingActive.permissions.allowRemoteShopDevice ===
        input.permissions.allowRemoteShopDevice &&
      existingActive.permissions.allowOpenAIFallback === input.permissions.allowOpenAIFallback
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
      const verified = {
        ...existingActive,
        lastVerifiedAt: health.checkedAt,
        lastVerificationStatus: "passed" as const,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: health.checkedAt,
        updatedBy: session.user.id
      };
      this.agentModelBindings.set(verified.id, verified);
      this.recordAgentModelBindingAudit(
        "agent_model.activation_reverified",
        verified,
        session.user.id,
        { latencyMs: health.latencyMs }
      );
      input.onStage?.("binding_staged", Date.now() - startedAt);
      return { binding: cloneAgentModelBinding(verified), healthCheck: health };
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
    const createdAt = now.toISOString();
    const pending: AgentModelBindingSummary = {
      id: randomUUID(),
      agentId: input.agentId,
      shopId: input.businessId,
      accountId: session.account.id,
      modelId: input.modelId,
      status: "verifying",
      executionMode: normalizeExecutionMode(input.executionMode),
      fallbackPolicy: normalizeFallbackPolicy(input.fallbackPolicy),
      executionTarget: input.executionTarget,
      permissions: { ...input.permissions },
      fallbackModelId: input.fallbackModelId,
      activatedAt: null,
      lastVerifiedAt: null,
      lastVerificationStatus: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt,
      updatedAt: createdAt,
      updatedBy: session.user.id
    };
    this.agentModelBindings.set(pending.id, pending);

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
        const failed: AgentModelBindingSummary = {
          ...pending,
          status: isUnavailableRuntimeCode(health.errorCode) ? "unavailable" : "failed",
          lastVerifiedAt: health.checkedAt,
          lastVerificationStatus: "failed",
          lastErrorCode: health.errorCode,
          lastErrorMessage: health.errorMessage,
          updatedAt: health.checkedAt
        };
        this.agentModelBindings.set(failed.id, failed);
        this.recordAgentModelBindingAudit(
          "agent_model.activation_failed",
          failed,
          session.user.id,
          {
            errorCode: health.errorCode,
            latencyMs: health.latencyMs
          }
        );
        throw modelHealthError(health);
      }

      const activatedAt = health.checkedAt;
      for (const [bindingId, binding] of this.agentModelBindings) {
        if (
          binding.agentId === input.agentId &&
          binding.status === "active" &&
          binding.id !== pending.id
        ) {
          this.agentModelBindings.set(bindingId, {
            ...binding,
            status: "inactive",
            updatedAt: activatedAt,
            updatedBy: session.user.id
          });
        }
      }
      const active: AgentModelBindingSummary = {
        ...pending,
        status: "active",
        activatedAt,
        lastVerifiedAt: activatedAt,
        lastVerificationStatus: "passed",
        updatedAt: activatedAt
      };
      this.agentModelBindings.set(active.id, active);

      const profile = this.currentAgentProfile(input.businessId, now);
      const revised = {
        ...profile,
        modelId: input.modelId,
        runtimeVersion: profile.runtimeVersion + 1,
        updatedAt: activatedAt,
        updatedBy: session.user.id
      };
      this.agentProfiles.set(input.businessId, revised);
      this.recordAgentRuntimeVersion(revised, session.user.id, "Verified agent model activated");
      this.recordAgentModelBindingAudit(
        "agent_model.activation_succeeded",
        active,
        session.user.id,
        { latencyMs: health.latencyMs }
      );
      input.onStage?.("binding_staged", Date.now() - startedAt);
      return { binding: cloneAgentModelBinding(active), healthCheck: health };
    } catch (error) {
      if (error instanceof Cp2Error) {
        const current = this.agentModelBindings.get(pending.id);
        if (current?.status === "verifying") {
          const failedAt = new Date().toISOString();
          const failed: AgentModelBindingSummary = {
            ...current,
            status:
              isUnavailableRuntimeCode(error.code) ||
              error.code === "BRIDGE_UNAVAILABLE" ||
              error.code === "BROWSER_RUNTIME_DISABLED"
                ? "unavailable"
                : "failed",
            lastVerifiedAt: failedAt,
            lastVerificationStatus: "failed",
            lastErrorCode: error.code,
            lastErrorMessage: error.message,
            updatedAt: failedAt
          };
          this.agentModelBindings.set(failed.id, failed);
          this.recordAgentModelBindingAudit(
            "agent_model.activation_failed",
            failed,
            session.user.id,
            { errorCode: error.code }
          );
        }
        throw error;
      }
      const runtimeError = asModelRuntimeError(error);
      const failedAt = new Date().toISOString();
      const failed: AgentModelBindingSummary = {
        ...pending,
        status: "failed",
        lastVerifiedAt: failedAt,
        lastVerificationStatus: "failed",
        lastErrorCode: runtimeError.code,
        lastErrorMessage: runtimeError.message,
        updatedAt: failedAt
      };
      this.agentModelBindings.set(failed.id, failed);
      this.recordAgentModelBindingAudit("agent_model.activation_failed", failed, session.user.id, {
        errorCode: runtimeError.code
      });
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

  getAgentModelAssignment(input: {
    sessionId: string | null;
    businessId: string;
    deviceId: string;
    now?: Date;
  }): AgentModelAssignmentSummary {
    const now = input.now ?? new Date();
    const session = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "business:read",
      now
    );
    const existing = this.agentModelAssignments.get(
      agentModelAssignmentKey(input.businessId, input.deviceId)
    );
    if (
      existing !== undefined &&
      existing.activeModelInstallationId !== null &&
      existing.runtimeBackend !== "CLOUD"
    ) {
      return {
        ...existing,
        preferredExecutionMode:
          existing.preferredExecutionMode === "CLOUD_ONLY"
            ? "LOCAL_FIRST"
            : existing.preferredExecutionMode
      };
    }

    const preferredModelId = this.agentProfiles.get(input.businessId)?.modelId ?? defaultAiModelId;
    const preferredModel = aiModelRegistry.find((model) => model.id === preferredModelId);
    const modelId =
      preferredModel?.provider === "local" && preferredModel.available
        ? preferredModel.id
        : downloadableAiModelIdPattern.test(preferredModelId)
          ? preferredModelId
          : defaultAiModelId;
    return {
      agentId: input.businessId,
      businessId: input.businessId,
      accountId: session.account.id,
      userId: session.user.id,
      deviceId: input.deviceId,
      activeModelInstallationId: null,
      modelId,
      preferredExecutionMode: "LOCAL_FIRST",
      fallbackPolicy: "WHEN_LOCAL_UNAVAILABLE",
      readinessStatus: "ATTACHED",
      runtimeBackend: null,
      lastSuccessfulInferenceAt: null,
      lastErrorCode: "PREFERRED_MODEL_NOT_INSTALLED_ON_DEVICE",
      updatedAt: now.toISOString(),
      updatedBy: session.user.id
    };
  }

  assignAgentModel(input: {
    sessionId: string | null;
    businessId: string;
    deviceId: string;
    installationId: string;
    preferredExecutionMode: PreferredExecutionMode;
    fallbackPolicy: AgentModelFallbackPolicy;
    readinessStatus: AgentModelReadinessStatus;
    lastSuccessfulInferenceAt: string | null;
    lastErrorCode: string | null;
    now?: Date;
  }): AgentModelAssignmentSummary {
    const now = input.now ?? new Date();
    const session = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "membership:manage",
      now
    );
    const installation = this.requireOwnedModelInstallation(
      session.account.id,
      session.user.id,
      input.deviceId,
      input.installationId
    );
    assertModelCanBeAssigned(installation);
    if (input.readinessStatus === "READY" && input.lastSuccessfulInferenceAt === null) {
      throw new Cp2Error(
        409,
        "agent_model_not_ready",
        "Run a successful local test inference before activating this model."
      );
    }
    if (input.readinessStatus === "READY") {
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
    }
    const assignment: AgentModelAssignmentSummary = {
      agentId: input.businessId,
      businessId: input.businessId,
      accountId: session.account.id,
      userId: session.user.id,
      deviceId: input.deviceId,
      activeModelInstallationId: installation.id,
      modelId: installation.modelId,
      preferredExecutionMode: normalizeExecutionMode(input.preferredExecutionMode),
      fallbackPolicy: normalizeFallbackPolicy(input.fallbackPolicy),
      readinessStatus: input.readinessStatus,
      runtimeBackend: installation.runtimeBackend,
      lastSuccessfulInferenceAt:
        input.readinessStatus === "READY" ? input.lastSuccessfulInferenceAt : null,
      lastErrorCode:
        input.lastErrorCode === null
          ? null
          : normalizeRequiredBoundedText(input.lastErrorCode, "model error code", 120),
      updatedAt: now.toISOString(),
      updatedBy: session.user.id
    };
    this.agentModelAssignments.set(
      agentModelAssignmentKey(input.businessId, input.deviceId),
      assignment
    );
    this.deps.recordAuditEvent({
      type:
        assignment.readinessStatus === "READY" ? "agent_model.assigned" : "agent_model.attached",
      aggregateType: "business",
      aggregateId: input.businessId,
      actorId: session.user.id,
      occurredAt: assignment.updatedAt,
      payload: {
        installationId: installation.id,
        modelId: installation.modelId,
        deviceId: installation.deviceId,
        runtimeBackend: installation.runtimeBackend,
        readinessStatus: assignment.readinessStatus,
        preferredExecutionMode: assignment.preferredExecutionMode,
        fallbackPolicy: assignment.fallbackPolicy
      }
    });
    if (assignment.readinessStatus === "READY") {
      const profile = this.currentAgentProfile(input.businessId, now);
      const revised = {
        ...profile,
        modelId: installation.modelId,
        runtimeVersion: profile.runtimeVersion + 1,
        updatedAt: now.toISOString(),
        updatedBy: session.user.id
      };
      if (this.runtimeVersionsForBusiness(input.businessId).length === 0) {
        this.recordAgentRuntimeVersion(profile, session.user.id, "Initial business runtime");
      }
      this.agentProfiles.set(input.businessId, revised);
      this.recordAgentRuntimeVersion(revised, session.user.id, "Active model changed");
    }
    return { ...assignment };
  }

  removeAgentModelAssignment(input: {
    sessionId: string | null;
    businessId: string;
    deviceId: string;
    now?: Date;
  }): { removed: true } {
    const now = input.now ?? new Date();
    const session = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "membership:manage",
      now
    );
    const key = agentModelAssignmentKey(input.businessId, input.deviceId);
    const existing = this.agentModelAssignments.get(key);
    if (
      existing !== undefined &&
      (existing.accountId !== session.account.id || existing.userId !== session.user.id)
    ) {
      throw new Cp2Error(403, "agent_model_owner_mismatch", "Agent model access was denied.");
    }
    this.agentModelAssignments.delete(key);
    this.deps.recordAuditEvent({
      type: "agent_model.removed",
      aggregateType: "business",
      aggregateId: input.businessId,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {
        installationId: existing?.activeModelInstallationId ?? null,
        deviceId: input.deviceId
      }
    });
    if (existing !== undefined) {
      const profile = this.currentAgentProfile(input.businessId, now);
      const revised = {
        ...profile,
        runtimeVersion: profile.runtimeVersion + 1,
        updatedAt: now.toISOString(),
        updatedBy: session.user.id
      };
      this.agentProfiles.set(input.businessId, revised);
      this.recordAgentRuntimeVersion(revised, session.user.id, "Device model assignment removed");
    }
    return { removed: true };
  }

  getBrowserInferenceAssignment(input: {
    sessionId: string | null;
    businessId: string;
    deviceId: string;
    now?: Date;
  }): BrowserInferenceAssignmentSummary | null {
    const now = input.now ?? new Date();
    const session = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "business:read",
      now
    );
    const deviceId = normalizeRequiredBoundedText(input.deviceId, "device ID", 180);
    const assignment = this.browserInferenceAssignments.get(
      browserInferenceAssignmentKey(input.businessId, deviceId)
    );
    if (
      assignment === undefined ||
      assignment.accountId !== session.account.id ||
      assignment.userId !== session.user.id
    ) {
      return null;
    }
    return cloneBrowserInferenceAssignment(assignment);
  }

  upsertBrowserInferenceAssignment(input: {
    sessionId: string | null;
    businessId: string;
    deviceId: string;
    enabled: boolean;
    selectedModelId: string | null;
    modelFamilyId: string | null;
    modelRevision: string | null;
    runtimeContract: BrowserRuntimeContract | null;
    checkpointCompatibilityContract: BrowserCheckpointCompatibilityContract | null;
    deviceTier: BrowserDeviceTier | null;
    readinessStatus: AgentModelReadinessStatus;
    lastSuccessfulInferenceAt: string | null;
    lastErrorCode: string | null;
    now?: Date;
  }): BrowserInferenceAssignmentSummary {
    const now = input.now ?? new Date();
    const session = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "membership:manage",
      now
    );
    const deviceId = normalizeRequiredBoundedText(input.deviceId, "device ID", 180);
    const key = browserInferenceAssignmentKey(input.businessId, deviceId);
    const existing = this.browserInferenceAssignments.get(key);
    if (
      existing !== undefined &&
      (existing.accountId !== session.account.id || existing.userId !== session.user.id)
    ) {
      throw new Cp2Error(
        403,
        "browser_inference_owner_mismatch",
        "Browser inference access was denied."
      );
    }
    const runtimeContract =
      input.runtimeContract === null
        ? null
        : normalizeBrowserRuntimeContract(input.runtimeContract);
    const checkpointCompatibilityContract =
      input.checkpointCompatibilityContract === null
        ? null
        : normalizeBrowserCheckpointContract(input.checkpointCompatibilityContract);
    const selectedModelId =
      input.selectedModelId === null
        ? null
        : normalizeRequiredBoundedText(input.selectedModelId, "browser model ID", 180);
    const modelFamilyId =
      input.modelFamilyId === null
        ? null
        : normalizeRequiredBoundedText(input.modelFamilyId, "browser model family ID", 180);
    const modelRevision =
      input.modelRevision === null
        ? null
        : normalizeRequiredBoundedText(input.modelRevision, "browser model revision", 180);

    validateBrowserInferenceAssignment({
      enabled: input.enabled,
      selectedModelId,
      modelFamilyId,
      modelRevision,
      runtimeContract,
      checkpointCompatibilityContract,
      readinessStatus: input.readinessStatus,
      lastSuccessfulInferenceAt: input.lastSuccessfulInferenceAt
    });
    const occurredAt = now.toISOString();
    const profile = this.currentAgentProfile(input.businessId, now);
    const assignment: BrowserInferenceAssignmentSummary = {
      id: existing?.id ?? randomUUID(),
      agentId: profile.agentId,
      businessId: input.businessId,
      accountId: session.account.id,
      userId: session.user.id,
      deviceId,
      enabled: input.enabled,
      selectedModelId,
      modelFamilyId,
      modelRevision,
      runtimeContract,
      checkpointCompatibilityContract,
      deviceTier: input.deviceTier,
      readinessStatus: input.readinessStatus,
      lastSuccessfulInferenceAt:
        input.lastSuccessfulInferenceAt === null
          ? null
          : normalizeBrowserInferenceTimestamp(input.lastSuccessfulInferenceAt),
      lastErrorCode:
        input.lastErrorCode === null
          ? null
          : normalizeRequiredBoundedText(input.lastErrorCode, "browser inference error code", 120),
      createdAt: existing?.createdAt ?? occurredAt,
      updatedAt: occurredAt,
      updatedBy: session.user.id
    };
    this.browserInferenceAssignments.set(key, assignment);
    this.deps.recordAuditEvent({
      type: input.enabled
        ? assignment.readinessStatus === "READY"
          ? "browser_inference.ready"
          : "browser_inference.updated"
        : "browser_inference.disabled",
      aggregateType: "business",
      aggregateId: input.businessId,
      actorId: session.user.id,
      occurredAt,
      payload: {
        deviceId,
        modelId: selectedModelId,
        modelFamilyId,
        runtime: runtimeContract?.runtime ?? null,
        adapterId: runtimeContract?.adapterId ?? null,
        adapterVersion: runtimeContract?.adapterVersion ?? null,
        readinessStatus: assignment.readinessStatus,
        enabled: assignment.enabled
      }
    });
    return cloneBrowserInferenceAssignment(assignment);
  }

  recordBrowserInferenceExecution(input: {
    sessionId: string | null;
    businessId: string;
    deviceId: string;
    modelId: string;
    successful: boolean;
    errorCode: string | null;
    occurredAt: string;
    now?: Date;
  }): BrowserInferenceAssignmentSummary {
    const now = input.now ?? new Date();
    const session = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "business:read",
      now
    );
    const deviceId = normalizeRequiredBoundedText(input.deviceId, "device ID", 180);
    const modelId = normalizeRequiredBoundedText(input.modelId, "browser model ID", 180);
    const key = browserInferenceAssignmentKey(input.businessId, deviceId);
    const existing = this.browserInferenceAssignments.get(key);
    if (
      existing === undefined ||
      existing.accountId !== session.account.id ||
      existing.userId !== session.user.id ||
      existing.selectedModelId !== modelId
    ) {
      throw new Cp2Error(
        409,
        "browser_inference_assignment_mismatch",
        "The browser inference execution does not match the active device assignment."
      );
    }
    if (!existing.enabled) {
      throw new Cp2Error(
        409,
        "browser_inference_assignment_inactive",
        "The browser inference assignment is disabled."
      );
    }
    const occurredAt = normalizeBrowserInferenceTimestamp(input.occurredAt);
    const updated: BrowserInferenceAssignmentSummary = {
      ...existing,
      readinessStatus: input.successful ? "READY" : existing.readinessStatus,
      lastSuccessfulInferenceAt: input.successful ? occurredAt : existing.lastSuccessfulInferenceAt,
      lastErrorCode:
        input.successful || input.errorCode === null
          ? null
          : normalizeRequiredBoundedText(
              input.errorCode,
              "browser inference execution error code",
              120
            ),
      updatedAt: now.toISOString(),
      updatedBy: session.user.id
    };
    this.browserInferenceAssignments.set(key, updated);
    this.deps.recordAuditEvent({
      type: input.successful
        ? "browser_inference.execution_succeeded"
        : "browser_inference.execution_failed",
      aggregateType: "business",
      aggregateId: input.businessId,
      actorId: session.user.id,
      occurredAt: updated.updatedAt,
      payload: {
        deviceId,
        modelId,
        successful: input.successful,
        errorCode: updated.lastErrorCode
      }
    });
    return cloneBrowserInferenceAssignment(updated);
  }

  removeBrowserInferenceAssignment(input: {
    sessionId: string | null;
    businessId: string;
    deviceId: string;
    now?: Date;
  }): { removed: true } {
    const now = input.now ?? new Date();
    const session = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "membership:manage",
      now
    );
    const deviceId = normalizeRequiredBoundedText(input.deviceId, "device ID", 180);
    const key = browserInferenceAssignmentKey(input.businessId, deviceId);
    const existing = this.browserInferenceAssignments.get(key);
    if (
      existing !== undefined &&
      (existing.accountId !== session.account.id || existing.userId !== session.user.id)
    ) {
      throw new Cp2Error(
        403,
        "browser_inference_owner_mismatch",
        "Browser inference access was denied."
      );
    }
    this.browserInferenceAssignments.delete(key);
    this.deps.recordAuditEvent({
      type: "browser_inference.removed",
      aggregateType: "business",
      aggregateId: input.businessId,
      actorId: session.user.id,
      occurredAt: now.toISOString(),
      payload: {
        deviceId,
        modelId: existing?.selectedModelId ?? null
      }
    });
    return { removed: true };
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
      updatedBy: session.user.id
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
          updatedBy: session.user.id
        })
    );
    const model = aiModelRegistry.find((candidate) => candidate.id === profile.modelId);
    const deviceModel = downloadableAiModelIdPattern.test(profile.modelId);
    if ((!deviceModel && model === undefined) || model?.available === false) {
      throw new Cp2Error(400, "ai_model_unavailable", "The selected AI model is unavailable.");
    }
    if (model?.provider === "openai" || model?.source === "hosted") {
      throw new Cp2Error(
        400,
        "cloud_model_cannot_be_primary",
        "OpenAI can only be selected explicitly as a fallback after a local model is ready."
      );
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
        !aiModelRegistry.some(
          (model) => model.id === effectiveProfile.modelId && model.available
        ) &&
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

  private persistRecallCandidate(input: {
    businessId: string;
    candidate: RecallCandidate;
    profile: BusinessAgentProfileSummary;
    now: Date;
    appendTelemetry: (
      state: RuntimeTelemetryEvent["state"],
      status: RuntimeTelemetryEvent["status"],
      toolName: RuntimeToolName | null,
      risk: RuntimePlannedAction["risk"] | null,
      metadata?: RuntimeTelemetryEvent["metadata"]
    ) => void;
  }): void {
    if (!input.profile.memoryPolicy.reusableWorkflowMemoryEnabled) {
      input.appendTelemetry("recall.candidate_rejected", "completed", null, null, {
        reason: "reusable_workflow_memory_disabled"
      });
      return;
    }
    const nowIso = input.now.toISOString();
    const retentionBoundary =
      input.now.getTime() - input.profile.memoryPolicy.retentionDays * 24 * 60 * 60 * 1000;
    const activeSources = [...this.agentContextSources.values()].filter(
      (source) =>
        source.shopId === input.businessId &&
        source.type === "recall" &&
        source.status === "active" &&
        source.deletedAt === null
    );
    for (const source of activeSources) {
      if (Date.parse(source.updatedAt) < retentionBoundary) {
        this.agentContextSources.set(source.id, {
          ...source,
          status: "archived",
          updatedAt: nowIso,
          deletedAt: nowIso
        });
      }
    }
    const existing = activeSources
      .filter((source) => Date.parse(source.updatedAt) >= retentionBoundary)
      .map((source) => ({
        source,
        entry: parseRecallEntry(source.retrievalMetadata.content ?? "")
      }))
      .filter(
        (item): item is { source: AgentContextSource; entry: RecallEntry } => item.entry !== null
      );
    const decision = decideRecallPersistence({
      candidate: input.candidate,
      existing: existing.map((item) => item.entry),
      now: nowIso,
      createId: randomUUID
    });
    input.appendTelemetry("recall.deduplicated", "completed", null, null, {
      outcome: decision.outcome,
      existingCount: existing.length,
      replacedEntryId: decision.replacedEntryId
    });
    if (decision.outcome === "IGNORE" || decision.entry === null) return;

    if (decision.replacedEntryId !== null) {
      const replaced = existing.find((item) => item.entry.id === decision.replacedEntryId)?.source;
      if (replaced !== undefined) {
        this.agentContextSources.set(replaced.id, {
          ...replaced,
          status: "archived",
          updatedAt: nowIso,
          deletedAt: nowIso
        });
      }
    }
    const content = serializeRecallEntry(decision.entry);
    const source: AgentContextSource = {
      id: randomUUID(),
      tenantId: input.businessId,
      shopId: input.businessId,
      type: "recall",
      title: `recall.md — ${decision.entry.title}`,
      status: "active",
      sensitivity: "internal",
      accessRules: {
        audiences: ["owner", "staff"],
        requiredPermission: "business:read",
        customerVisible: false
      },
      freshnessTimestamp: nowIso,
      version: decision.entry.version,
      retrievalMetadata: {
        keywords: contextKeywords(recallSearchText(decision.entry)),
        sourceRecordId: decision.entry.id,
        content
      },
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null
    };
    this.agentContextSources.set(source.id, source);

    const retained = [...this.agentContextSources.values()]
      .filter(
        (candidate) =>
          candidate.shopId === input.businessId &&
          candidate.type === "recall" &&
          candidate.status === "active" &&
          candidate.deletedAt === null
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    for (const overflow of retained.slice(input.profile.memoryPolicy.maximumItemsPerScope)) {
      this.agentContextSources.set(overflow.id, {
        ...overflow,
        status: "archived",
        updatedAt: nowIso,
        deletedAt: nowIso
      });
    }
    input.appendTelemetry("recall.persisted", "completed", null, null, {
      outcome: decision.outcome,
      recallId: decision.entry.id,
      version: decision.entry.version,
      retainedCount: Math.min(retained.length, input.profile.memoryPolicy.maximumItemsPerScope)
    });
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

  recordRecallEffectiveness(input: {
    sessionId: string | null;
    businessId: string;
    sourceIds: string[];
    outcome: "local_success" | "cloud_fallback";
    localRuntime: RuntimeRecallEscalation["localRuntime"];
    modelId: string;
    now?: Date;
  }): AgentEvaluationEvent {
    const now = input.now ?? new Date();
    this.deps.requireAuthorizedSession(input.sessionId, input.businessId, "business:read", now);
    if (input.sourceIds.length === 0 || input.sourceIds.length > 3) {
      throw new Cp2Error(
        400,
        "recall_effectiveness_invalid",
        "Recall effectiveness requires between one and three source IDs."
      );
    }
    const sourceIds = [...new Set(input.sourceIds)];
    const validSourceIds = new Set(
      [...this.agentContextSources.values()]
        .filter(
          (source) =>
            source.shopId === input.businessId &&
            source.type === "recall" &&
            source.status === "active" &&
            source.deletedAt === null
        )
        .map((source) => source.id)
    );
    if (!sourceIds.every((sourceId) => validSourceIds.has(sourceId))) {
      throw new Cp2Error(
        400,
        "recall_effectiveness_invalid",
        "Recall effectiveness source IDs must identify active recall for this shop."
      );
    }
    const profile = this.currentAgentProfile(input.businessId, now);
    return this.recordAgentEvaluationEvent({
      businessId: input.businessId,
      runtimeVersion: profile.runtimeVersion,
      modelId: normalizeRequiredBoundedText(input.modelId, "recall model ID", 180),
      eventType: "recall_effectiveness",
      outcome: input.outcome === "local_success" ? "success" : "partial",
      score: input.outcome === "local_success" ? 1 : 0,
      reason:
        input.outcome === "local_success"
          ? "Relevant recall accompanied a successful local inference."
          : "Relevant recall was present but the request still required cloud fallback.",
      metadata: {
        recallCount: sourceIds.length,
        recallSourceIds: sourceIds.join(","),
        localRuntime: input.localRuntime,
        outcome: input.outcome
      },
      sessionId: null,
      messageId: null,
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
    const binding = profile === undefined ? null : this.activeAgentModelBinding(profile.agentId);
    if (binding === null) {
      return [
        "I can’t use a working model for this chat yet, but your message is saved.",
        "To continue:",
        "1. Open Agent settings → Model.",
        "2. Test an available model, then activate it for this agent.",
        "3. To keep chat available during model outages, select a hosted fallback, approve cloud fallback access, and activate the configuration.",
        "4. Return here and send your message again."
      ].join("\n");
    }

    const modelName =
      aiModelRegistry.find((model) => model.id === binding.modelId)?.label ?? binding.modelId;
    const approvedFallbackConfigured =
      binding.permissions.allowOpenAIFallback && binding.fallbackModelId !== null;
    return [
      `I couldn’t reach ${modelName}, but your message is saved.`,
      "To continue:",
      "1. Retry in a moment, or open Agent settings → Model and run the model test.",
      approvedFallbackConfigured
        ? "2. An approved fallback is configured but did not produce a reply. Test it or select another approved fallback, then reactivate the configuration."
        : "2. Configure an approved fallback by selecting an available hosted model, approving cloud fallback access, and reactivating the model configuration.",
      "3. Return here and send your message again.",
      `Reference: ${error.code}.`
    ].join("\n");
  }

  createRuntimeSession(input: {
    sessionId: string | null;
    businessId: string;
    now?: Date;
  }): RuntimeSessionSummary {
    const now = input.now ?? new Date();
    const session = this.deps.requireAuthorizedSession(
      input.sessionId,
      input.businessId,
      "business:read",
      now
    );
    const runtimeSession: RuntimeSessionSummary = {
      id: randomUUID(),
      businessId: input.businessId,
      userId: session.user.id,
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
      productCount: [...this.deps.products.values()].filter((product) => product.businessId === businessId).length,
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
    runtimeSessionId?: string;
    message: string;
    conversationHistory?: RuntimeModelConversationMessage[];
    agentProfile?: RuntimeAgentProfile;
    confirmationToken?: string;
    recallEscalation?: RuntimeRecallEscalation;
    clientInferenceCompletion?: ClientInferenceCompletion;
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
    const storedAgentProfile = this.currentAgentProfile(input.businessId, now);
    const { activeBinding, activeModelId } = this.resolveActiveRuntimeModelId(
      input.businessId,
      storedAgentProfile
    );
    const clientInferenceCompletion =
      input.clientInferenceCompletion === undefined
        ? null
        : this.requireReadyClientInferenceCompletion({
            completion: input.clientInferenceCompletion,
            businessId: input.businessId,
            accountId: auth.account.id,
            userId: auth.user.id
          });
    if (
      this.deps.modelRuntimeAdapterResolver !== undefined &&
      activeBinding === null &&
      clientInferenceCompletion === null &&
      input.confirmationToken === undefined
    ) {
      throw new Cp2Error(
        409,
        "AGENT_MODEL_NOT_CONFIGURED",
        "This agent does not have a working model yet. Open Agent model settings and activate one.",
        false,
        { agentId: storedAgentProfile.agentId, shopId: input.businessId }
      );
    }
    const runtimeModelId = clientInferenceCompletion?.modelId ?? activeModelId;
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
      hasConfirmationToken: input.confirmationToken !== undefined
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

    const documentImportProposal = this.createRuntimeDocumentImportProposal(
      input.businessId,
      input.message
    );
    const messagingProposal = this.createRuntimeMessagingProposal(input.businessId, input.message);
    const receiptContextScriptMatch = parseReceiptContextScriptCommand({
      message: input.message,
      tenantId: input.businessId,
      contextScripts: agentProfile?.contextScripts ?? []
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
      characterBudget: contextCharacterBudgetForModel(runtimeModelId)
    });
    const retrievedRecallCount = retrievedContext.filter((item) => item.type === "recall").length;
    if (retrievedRecallCount > 0) {
      appendTelemetry("recall.retrieved", "completed", null, null, {
        count: retrievedRecallCount,
        intent: parserResult.intent
      });
    }
    const runtimeMemory = shopRuntime.memory.ownerCorrectionsEnabled
      ? this.ownerCorrectionsForBusiness(input.businessId)
          .filter((correction) => correction.status === "active")
          .slice(0, shopRuntime.memory.maximumItemsPerScope)
          .map((correction) => correction.correction)
      : [];
    const modelRoute =
      documentImportProposal === null &&
      messagingProposal === null &&
      effectiveContextScriptMatch === null
        ? clientInferenceCompletion === null
          ? await this.createRuntimeModelRoute({
              message: input.message,
              ...(input.conversationHistory === undefined
                ? {}
                : { conversationHistory: input.conversationHistory }),
              modelId: runtimeModelId,
              context,
              now,
              appendTelemetry,
              shopRuntime,
              retrievedContext,
              memory: runtimeMemory,
              intent: parserResult.intent,
              ...(input.recallEscalation === undefined
                ? {}
                : { recallEscalation: input.recallEscalation })
            })
          : this.createClientInferenceModelRoute(clientInferenceCompletion, appendTelemetry)
        : {
            proposal: null,
            trace: null,
            recallCandidate: null
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
          bindingId: activeBinding.id,
          modelId: activeBinding.modelId,
          executionTarget: activeBinding.executionTarget,
          runtimeErrorCode: modelRoute.trace.errorCode
        }
      );
    }
    appendTelemetry("intent.routed", "completed", null, null, {
      intent: parserResult.intent,
      confidence: parserResult.confidence,
      source:
        documentImportProposal !== null
          ? "document_import"
          : messagingProposal !== null
            ? "messaging"
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
      documentImportProposal ??
      messagingProposal ??
      (effectiveContextScriptMatch === null
        ? (modelRoute.proposal ?? createRuntimeToolProposal(parserResult))
        : receiptContextScriptMatch !== null
          ? createRuntimeToolProposalFromReceiptContextScript(receiptContextScriptMatch)
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
      ? await this.executeRuntimeAction({
          sessionId: input.sessionId,
          businessId: input.businessId,
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
    if (retrievedRecallCount > 0 && modelRoute.trace?.status === "available") {
      appendTelemetry("recall.applied", status, plan.toolName, plan.risk, {
        count: retrievedRecallCount,
        advisoryOnly: true,
        cloudFallbackUsed: modelRoute.trace.fallbackUsed
      });
    }
    if (modelRoute.recallCandidate !== null) {
      if (status === "completed" && verification.ok) {
        try {
          this.persistRecallCandidate({
            businessId: input.businessId,
            candidate: modelRoute.recallCandidate,
            profile: storedAgentProfile,
            now,
            appendTelemetry
          });
        } catch {
          appendTelemetry("recall.persistence_failed", "completed", plan.toolName, plan.risk, {
            isolated: true
          });
        }
      } else {
        appendTelemetry("recall.candidate_rejected", status, plan.toolName, plan.risk, {
          reason: "cloud_result_not_successful"
        });
      }
    }
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
      ? await this.executeRuntimeAction({
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

  private async executeRuntimeAction(input: {
    sessionId: string | null;
    businessId: string;
    action: RuntimePlannedAction;
    now: Date;
  }): Promise<unknown> {
    switch (input.action.toolName) {
      case "products.list":
        return typeof input.action.input.query === "string" &&
          input.action.input.query.trim() !== ""
          ? this.deps.queryCatalogue({
              sessionId: input.sessionId,
              businessId: input.businessId,
              query: input.action.input.query,
              now: input.now
            })
          : this.deps.listProducts({
              sessionId: input.sessionId,
              businessId: input.businessId,
              now: input.now
            });

      case "invoices.list":
        return this.deps.listInvoices({
          sessionId: input.sessionId,
          businessId: input.businessId,
          now: input.now
        });

      case "product.create":
        return this.deps.createProduct({
          sessionId: input.sessionId,
          businessId: input.businessId,
          product: {
            name: String(input.action.input.name ?? ""),
            sku: null,
            unit: String(input.action.input.unit ?? "unit"),
            quantity: Number(input.action.input.quantity ?? 0)
          },
          now: input.now
        });

      case "product.update":
      case "product.stock_adjust":
        return null;

      case "product.delete": {
        const product = this.findRuntimeProductByName(
          input.businessId,
          String(input.action.input.productName ?? "")
        );

        if (product === null) {
          throw new Cp2Error(
            404,
            "runtime_product_not_found",
            "The product selected by the context script was not found."
          );
        }

        return this.deps.deleteProduct({
          sessionId: input.sessionId,
          businessId: input.businessId,
          productId: product.id,
          now: input.now
        });
      }

      case "product.field.add":
        return {
          fieldName: String(input.action.input.fieldName ?? ""),
          status: "planned"
        };

      case "product.field.remove":
        return {
          fieldName: String(input.action.input.fieldName ?? ""),
          status: "planned"
        };

      case "customer.create":
        return this.deps.createCustomer({
          sessionId: input.sessionId,
          businessId: input.businessId,
          customer: {
            name: String(input.action.input.name ?? ""),
            phone: null,
            email: null,
            notes: null
          },
          now: input.now
        });

      case "invoice.draft":
      case "payment.record":
      case "receipt.scan":
      case "receipt.confirm":
      case "receipt.correct":
      case "receipt.cancel":
      case "unknown.clarify":
        return null;

      case "receipt.review":
      case "receipt.list":
        return this.deps.listPurchaseReceipts({
          sessionId: input.sessionId,
          businessId: input.businessId,
          now: input.now
        });

      case "receipt.lookup":
        return this.deps.listPurchaseReceipts({
          sessionId: input.sessionId,
          businessId: input.businessId,
          now: input.now
        }).filter((receipt) => {
          const supplierName = String(input.action.input.supplierName ?? "").toLowerCase();
          const itemName = String(input.action.input.itemName ?? "").toLowerCase();
          const supplierMatches =
            supplierName.length === 0 || receipt.supplierName.toLowerCase().includes(supplierName);
          const itemMatches =
            itemName.length === 0 ||
            receipt.lineItems.some((item) => item.name.toLowerCase().includes(itemName));

          return supplierMatches && itemMatches;
        });

      case "document_import.confirm": {
        const importJobId = String(input.action.input.importJobId ?? "");
        const job = this.deps.requireDocumentImport(input.businessId, importJobId);

        return job.target === "product"
          ? this.deps.confirmProductImport({
              sessionId: input.sessionId,
              businessId: input.businessId,
              importJobId,
              now: input.now
            })
          : this.deps.confirmSupplierImport({
              sessionId: input.sessionId,
              businessId: input.businessId,
              importJobId,
              now: input.now
            });
      }

      case "messaging.send":
        return await this.deps.sendChannelMessage({
          sessionId: input.sessionId,
          businessId: input.businessId,
          ...(typeof input.action.input.customerId === "string"
            ? { customerId: input.action.input.customerId }
            : {}),
          ...(typeof input.action.input.customerName === "string"
            ? { customerName: input.action.input.customerName }
            : {}),
          ...(typeof input.action.input.conversationId === "string"
            ? { conversationId: input.action.input.conversationId }
            : {}),
          ...(isChannelProvider(input.action.input.provider)
            ? { provider: input.action.input.provider }
            : {}),
          ...(typeof input.action.input.mailboxId === "string"
            ? { mailboxId: input.action.input.mailboxId }
            : {}),
          ...(typeof input.action.input.subject === "string"
            ? { subject: input.action.input.subject }
            : {}),
          ...(typeof input.action.input.replyToMessageId === "string"
            ? { replyToMessageId: input.action.input.replyToMessageId }
            : {}),
          ...(Array.isArray(input.action.input.attachments)
            ? {
                attachments: input.action.input.attachments.flatMap((attachment) => {
                  if (attachment === null || typeof attachment !== "object") return [];
                  const record = attachment as Record<string, unknown>;
                  return record.resourceType === "invoice" && typeof record.resourceId === "string"
                    ? [
                        {
                          resourceType: "invoice" as const,
                          resourceId: record.resourceId
                        }
                      ]
                    : [];
                })
              }
            : {}),
          text: String(input.action.input.text ?? ""),
          idempotencyKey: `runtime-message:${input.action.id}`,
          now: input.now
        });
    }
  }

  private createRuntimeMessagingProposal(
    businessId: string,
    message: string
  ): RuntimeToolProposal | null {
    const invoiceEmail =
      /^(?:please\s+)?(?:email|send)\s+(.+?)\s+(?:the\s+|their\s+)?(?:latest\s+)?invoice(?:\s+by\s+email)?[.!]?$/iu.exec(
        message.trim()
      );
    if (invoiceEmail?.[1] !== undefined) {
      const requestedName = invoiceEmail[1].trim();
      const customers = [...this.deps.customers.values()].filter(
        (customer) =>
          customer.businessId === businessId &&
          customer.name.localeCompare(requestedName, undefined, { sensitivity: "accent" }) === 0
      );
      const customer = customers.length === 1 ? customers[0] : undefined;
      const invoice =
        customer === undefined
          ? undefined
          : [...this.deps.invoices.values()]
              .filter(
                (candidate) =>
                  candidate.businessId === businessId &&
                  candidate.customerId === customer.id &&
                  candidate.status === "confirmed"
              )
              .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      return {
        toolName: "messaging.send",
        input:
          customer === undefined || invoice === undefined
            ? {}
            : {
                customerId: customer.id,
                provider: "email",
                subject: `Invoice ${invoice.invoiceNumber}`,
                text: "Please find your invoice attached.",
                attachments: [{ resourceType: "invoice", resourceId: invoice.id }]
              },
        reason: `Prepared the latest confirmed invoice email for ${requestedName}.`,
        validation:
          customer === undefined
            ? invalid("Choose one canonical customer before sending an invoice.")
            : invoice === undefined
              ? invalid("Confirm an invoice for this customer before sending it.")
              : valid()
      };
    }
    const email = /^(?:please\s+)?email\s+(.+?)\s+(?:that|saying|:)\s+(.+)$/iu.exec(message.trim());
    const direct =
      /^(?:please\s+)?(?:message|tell)\s+(.+?)(?:\s+on\s+(telegram|whatsapp|messenger|instagram|tiktok|x|native[_ ]?sms|sms|email|soko))?\s+(?:that|saying|:)\s+(.+)$/iu.exec(
        message.trim()
      );
    const send =
      /^(?:please\s+)?send\s+["“]?(.+?)["”]?\s+to\s+(.+?)(?:\s+on\s+(telegram|whatsapp|messenger|instagram|tiktok|x|native[_ ]?sms|sms|email|soko))?$/iu.exec(
        message.trim()
      );
    const customerName = (email?.[1] ?? direct?.[1] ?? send?.[2])?.trim();
    const text = (email?.[2] ?? direct?.[3] ?? send?.[1])?.trim();
    const providerInput = (email === null ? (direct?.[2] ?? send?.[3]) : "email")
      ?.toLowerCase()
      .replace(" ", "_");
    const provider = providerInput === "sms" ? "native_sms" : providerInput;
    if (!customerName || !text) return null;
    return {
      toolName: "messaging.send",
      input: {
        customerName,
        text,
        ...(provider === "email" ? { subject: "Update from Soko" } : {}),
        ...(isChannelProvider(provider) ? { provider } : {})
      },
      reason: `Prepared a message to ${customerName}${provider ? ` on ${provider}` : ""}.`,
      validation:
        text.length <= 4000 ? valid() : invalid("The message is longer than 4000 characters.")
    };
  }

  private createRuntimeDocumentImportProposal(
    businessId: string,
    message: string
  ): RuntimeToolProposal | null {
    const normalized = normalizeRuntimeLookup(message);
    const hasAction = /\b(add|apply|confirm|import|save|store)\b/u.test(normalized);
    const referencesDocument =
      /\b(catalogue|catalog|document|excel|extracted|import|pdf|spreadsheet|uploaded|word|workbook)\b/u.test(
        normalized
      );
    const businessImports = this.deps.importsForBusiness(businessId);
    const referencedJob = businessImports.find((job) => message.includes(job.id));

    if (!hasAction || (!referencesDocument && referencedJob === undefined)) {
      return null;
    }

    const latestPreview = businessImports
      .filter((job) => job.status === "previewed")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const job = referencedJob ?? latestPreview;

    if (job === undefined) {
      return {
        toolName: "document_import.confirm",
        input: {},
        reason: "No previewed document import is available.",
        validation: invalid("Upload and preview a document before asking me to add its records.")
      };
    }

    if (job.status !== "previewed") {
      return {
        toolName: "document_import.confirm",
        input: { importJobId: job.id, target: job.target },
        reason: "The referenced document import is not awaiting confirmation.",
        validation: invalid("Only a previewed document import can be added.")
      };
    }

    const selectedRows = job.rows.filter((row) => row.selected && row.errors.length === 0);

    return {
      toolName: "document_import.confirm",
      input: {
        importJobId: job.id,
        target: job.target,
        selectedRowCount: selectedRows.length
      },
      reason: `Prepared ${selectedRows.length} extracted ${job.target} record${
        selectedRows.length === 1 ? "" : "s"
      } from ${job.source.fileName}.`,
      validation:
        selectedRows.length === 0
          ? invalid("The document preview has no valid selected rows to add.")
          : valid()
    };
  }

  private findRuntimeProductByName(businessId: string, productName: string): ProductSummary | null {
    const normalizedName = normalizeRuntimeLookup(productName);

    if (normalizedName.length === 0) {
      return null;
    }

    const products = [...this.deps.products.values()].filter(
      (product) => product.businessId === businessId
    );

    return (
      products.find((product) => normalizeRuntimeLookup(product.name) === normalizedName) ??
      products.find((product) => normalizeRuntimeLookup(product.name).includes(normalizedName)) ??
      null
    );
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
    const model = aiModelRegistry.find((candidate) => candidate.id === modelId);
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
    if (input.executionTarget === "browser-local") {
      throw new Cp2Error(
        409,
        "BROWSER_RUNTIME_DISABLED",
        "Browser-local activation must be verified on a deployment where browser inference is enabled.",
        false,
        { modelId: input.modelId, executionTarget: input.executionTarget }
      );
    }
    if (input.executionTarget === "installed-app") {
      throw new Cp2Error(
        503,
        "BRIDGE_UNAVAILABLE",
        "A trusted installed Soko app bridge is required for this model.",
        true,
        { modelId: input.modelId, executionTarget: input.executionTarget }
      );
    }
    const adapter = this.deps.modelRuntimeAdapterResolver?.({
      modelId: input.modelId,
      executionTarget: input.executionTarget,
      agentId: input.agentId,
      shopId: input.businessId
    });
    if (adapter === undefined) {
      throw new Cp2Error(
        503,
        "RUNTIME_UNAVAILABLE",
        "The selected model runtime is not configured or currently available.",
        true,
        { modelId: input.modelId, executionTarget: input.executionTarget }
      );
    }
    return adapter;
  }

  private activeAgentModelBinding(agentId: string): AgentModelBindingSummary | null {
    return (
      [...this.agentModelBindings.values()]
        .filter(
          (binding) =>
            binding.agentId === agentId &&
            binding.status === "active" &&
            binding.lastVerificationStatus === "passed"
        )
        .sort((left, right) => right.activatedAt!.localeCompare(left.activatedAt!))[0] ?? null
    );
  }

  /** Shared by createRuntimeTurn and the public storefront agent reply path. */
  resolveActiveRuntimeModelId(
    businessId: string,
    storedAgentProfile: BusinessAgentProfileSummary
  ): { activeBinding: AgentModelBindingSummary | null; activeModelId: string } {
    const activeBinding = this.activeAgentModelBinding(storedAgentProfile.agentId);
    const selectedCloudFallbackModelId = resolveDefaultDeviceModelId(
      this.activeAiModels.get(businessId)?.modelId ?? defaultAiModelId
    );
    const requestedModelId = storedAgentProfile.modelId;
    const activeModelId =
      activeBinding?.modelId ??
      (this.deps.runtimeModelProviderResolver === undefined ||
      requestedModelId === selectedCloudFallbackModelId
        ? selectedCloudFallbackModelId
        : "sokoclaw-local");
    return { activeBinding, activeModelId };
  }

  private recordAgentModelBindingAudit(
    type: string,
    binding: AgentModelBindingSummary,
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
      modelId: this.activeAiModels.get(businessId)?.modelId ?? defaultAiModelId,
      updatedAt: now.toISOString(),
      updatedBy: "00000000-0000-4000-8000-000000000000"
    });
  }

  buildShopAgentRuntime(
    profile: BusinessAgentProfileSummary,
    now: Date,
    audience: AgentAudience,
    modelId = profile.modelId
  ): ShopAgentRuntime {
    const business = this.deps.requireBusiness(profile.businessId);
    const assignment = [...this.agentModelAssignments.values()]
      .filter(
        (candidate) =>
          candidate.businessId === profile.businessId && candidate.readinessStatus === "READY"
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const activeBinding = this.activeAgentModelBinding(profile.agentId);
    const model = aiModelRegistry.find((candidate) => candidate.id === modelId);
    const sources = this.contextSourcesForRuntime(profile).filter((source) =>
      source.accessRules.audiences.includes(audience)
    );
    return {
      agentId: profile.agentId,
      shopId: profile.shopId,
      tenantId: profile.tenantId,
      identity: {
        agentName: profile.name,
        shopName: business.name,
        shopIdentifier: business.sokoId,
        role: profile.role,
        supportedLanguages: [...profile.supportedLanguages],
        shopDescription: profile.description,
        businessCategory: profile.businessCategory,
        publicIntroduction: profile.publicIntroduction
      },
      personality: cloneAgentPersonality(profile.personalityConfig),
      instructions: cloneAgentInstructions(profile.instructionPolicy),
      context: {
        tenantId: profile.tenantId,
        shopId: profile.shopId,
        generatedAt: now.toISOString(),
        sources: sources.map(cloneAgentContextSource)
      },
      skills: profile.skillBindings.map(cloneAgentSkillBinding),
      memory: { ...profile.memoryPolicy },
      evaluations: { ...profile.evaluationPolicy },
      model: {
        modelId: activeBinding?.modelId ?? modelId,
        provider:
          activeBinding?.executionTarget ??
          assignment?.runtimeBackend ??
          model?.provider ??
          (downloadableAiModelIdPattern.test(modelId) ? "device" : "deterministic"),
        executionMode:
          activeBinding?.executionMode ?? assignment?.preferredExecutionMode ?? "LOCAL_FIRST",
        fallbackPolicy:
          activeBinding?.fallbackPolicy ?? assignment?.fallbackPolicy ?? "WHEN_LOCAL_UNAVAILABLE",
        deviceAssignmentId: assignment?.activeModelInstallationId ?? null
      },
      version: profile.runtimeVersion,
      status: profile.status,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt
    };
  }

  contextSourcesForRuntime(profile: BusinessAgentProfileSummary): AgentContextSource[] {
    const businessId = profile.businessId;
    const recallRetentionBoundary =
      Date.now() - profile.memoryPolicy.retentionDays * 24 * 60 * 60 * 1000;
    const sources = [...this.agentContextSources.values()]
      .filter(
        (source) =>
          source.shopId === businessId &&
          source.deletedAt === null &&
          (source.type !== "recall" ||
            (profile.memoryPolicy.reusableWorkflowMemoryEnabled &&
              Date.parse(source.updatedAt) >= recallRetentionBoundary))
      )
      .map(cloneAgentContextSource);
    if (!sources.some((source) => source.type === "context_script")) {
      sources.push(
        ...profile.contextScripts.map((content, index) =>
          contextSourceRecord({
            id: stableUuid(`${businessId}:context-script:${index}`),
            businessId,
            type: "context_script",
            title: `Context script ${index + 1}`,
            content,
            sensitivity: "internal",
            customerVisible: false,
            sourceRecordId: null,
            now: new Date(profile.updatedAt)
          })
        )
      );
    }
    sources.push(
      contextSourceRecord({
        id: stableUuid(`${businessId}:policy`),
        businessId,
        type: "policy",
        title: "Structured business policy",
        content: [
          ...profile.instructionPolicy.generalOperatingRules,
          ...profile.instructionPolicy.salesRules,
          ...profile.instructionPolicy.pricingRules
        ].join("\n"),
        sensitivity: "internal",
        customerVisible: false,
        sourceRecordId: profile.agentId,
        now: new Date(profile.updatedAt)
      })
    );
    for (const product of [...this.deps.products.values()].filter((product) => product.businessId === businessId)) {
      sources.push(
        contextSourceRecord({
          id: stableUuid(`${businessId}:catalogue:${product.id}`),
          businessId,
          type: "catalogue",
          title: product.name,
          content: `${product.name}; unit=${product.unit}; price=${product.sellingPrice ?? "not set"}`,
          sensitivity: "public",
          customerVisible: true,
          sourceRecordId: product.id,
          now: new Date(product.updatedAt)
        }),
        contextSourceRecord({
          id: stableUuid(`${businessId}:inventory:${product.id}`),
          businessId,
          type: "inventory",
          title: `${product.name} inventory`,
          content: `${product.name}; quantity=${product.quantity}`,
          sensitivity: "internal",
          customerVisible: false,
          sourceRecordId: product.id,
          now: new Date(product.updatedAt)
        })
      );
    }
    const references: Array<{
      type: AgentContextSource["type"];
      title: string;
      id: string;
      updatedAt: string;
      sensitivity: AgentContextSource["sensitivity"];
    }> = [
      ...[...this.deps.customers.values()].filter((customer) => customer.businessId === businessId).map((item) => ({
        type: "customer" as const,
        title: item.name,
        id: item.id,
        updatedAt: item.updatedAt,
        sensitivity: "confidential" as const
      })),
      ...this.deps.suppliersForBusiness(businessId).map((item) => ({
        type: "supplier" as const,
        title: item.name,
        id: item.id,
        updatedAt: item.updatedAt,
        sensitivity: "confidential" as const
      })),
      ...[...this.deps.purchaseReceipts.values()]
        .filter((item) => item.businessId === businessId)
        .map((item) => ({
          type: "receipt" as const,
          title: `Receipt ${item.id}`,
          id: item.id,
          updatedAt: item.createdAt,
          sensitivity: "restricted" as const
        })),
      ...[...this.deps.invoices.values()].filter((invoice) => invoice.businessId === businessId).map((item) => ({
        type: "order" as const,
        title: item.invoiceNumber,
        id: item.id,
        updatedAt: item.updatedAt,
        sensitivity: "confidential" as const
      }))
    ];
    for (const reference of references) {
      sources.push(
        contextSourceRecord({
          id: stableUuid(`${businessId}:${reference.type}:${reference.id}`),
          businessId,
          type: reference.type,
          title: reference.title,
          content: null,
          sensitivity: reference.sensitivity,
          customerVisible: false,
          sourceRecordId: reference.id,
          now: new Date(reference.updatedAt)
        })
      );
    }
    for (const correction of this.ownerCorrectionsForBusiness(businessId).filter(
      (item) => item.status === "active"
    )) {
      sources.push(
        contextSourceRecord({
          id: correction.id,
          businessId,
          type: "owner_note",
          title: `Owner correction: ${correction.category}`,
          content: correction.correction,
          sensitivity: "internal",
          customerVisible: false,
          sourceRecordId: correction.id,
          now: new Date(correction.createdAt)
        })
      );
    }
    return sources
      .filter(
        (source, index, all) => all.findIndex((candidate) => candidate.id === source.id) === index
      )
      .sort(
        (left, right) =>
          left.type.localeCompare(right.type) || left.title.localeCompare(right.title)
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

  /** Shared by createRuntimeModelRoute and the public storefront agent reply path. */
  private requireReadyClientInferenceCompletion(input: {
    completion: ClientInferenceCompletion;
    businessId: string;
    accountId: string;
    userId: string;
  }): ClientInferenceCompletion {
    const completion = input.completion;
    if (completion.installationId !== undefined) {
      const assignment = this.agentModelAssignments.get(
        agentModelAssignmentKey(input.businessId, completion.deviceId)
      );
      if (
        assignment === undefined ||
        assignment.accountId !== input.accountId ||
        assignment.userId !== input.userId ||
        assignment.readinessStatus !== "READY" ||
        assignment.lastSuccessfulInferenceAt === null ||
        assignment.activeModelInstallationId !== completion.installationId ||
        assignment.modelId !== completion.modelId ||
        (assignment.runtimeBackend === "LLAMA_CPP_BROWSER"
          ? completion.runtime !== "browser-wasm"
          : assignment.runtimeBackend === "LLAMA_CPP_ANDROID"
            ? completion.runtime !== "native-llama-cpp"
            : true)
      ) {
        throw new Cp2Error(
          409,
          "CLIENT_MODEL_ASSIGNMENT_NOT_READY",
          "The client model completion does not match a ready device assignment."
        );
      }
      return completion;
    }

    const assignment = this.browserInferenceAssignments.get(
      browserInferenceAssignmentKey(input.businessId, completion.deviceId)
    );
    if (
      assignment === undefined ||
      assignment.accountId !== input.accountId ||
      assignment.userId !== input.userId ||
      assignment.enabled !== true ||
      assignment.readinessStatus !== "READY" ||
      assignment.lastSuccessfulInferenceAt === null ||
      assignment.selectedModelId !== completion.modelId ||
      assignment.runtimeContract?.runtime !== completion.runtime
    ) {
      throw new Cp2Error(
        409,
        "CLIENT_MODEL_ASSIGNMENT_NOT_READY",
        "The browser model completion does not match a ready browser assignment."
      );
    }
    return completion;
  }

  private createClientInferenceModelRoute(
    completion: ClientInferenceCompletion,
    appendTelemetry: (
      state: RuntimeTelemetryEvent["state"],
      status: RuntimeTelemetryEvent["status"],
      toolName: RuntimeToolName | null,
      risk: RuntimePlannedAction["risk"] | null,
      metadata?: RuntimeTelemetryEvent["metadata"]
    ) => void
  ): {
    proposal: RuntimeToolProposal;
    trace: RuntimeModelTrace;
    recallCandidate: null;
  } {
    appendTelemetry("model.inference_started", "completed", null, null, {
      provider: completion.runtime,
      modelId: completion.modelId,
      requestId: completion.requestId,
      executionTarget: completion.runtime === "native-llama-cpp" ? "installed-app" : "browser-local"
    });
    const parsed = parseRuntimeModelOutput(completion.outputText);
    if (!parsed.ok || parsed.output === null) {
      appendTelemetry("model.completed", "blocked", null, null, {
        provider: completion.runtime,
        adapterStatus: "malformed",
        durationMs: completion.durationMs,
        errorCode: "MODEL_RESPONSE_PARSE_FAILED"
      });
      throw new Cp2Error(
        422,
        "MODEL_RESPONSE_PARSE_FAILED",
        "The local model returned an invalid structured response.",
        true
      );
    }
    appendTelemetry("model.completed", "completed", null, null, {
      provider: completion.runtime,
      adapterStatus: "available",
      durationMs: completion.durationMs,
      errorCode: null
    });
    return {
      proposal: parsed.output.proposal,
      recallCandidate: null,
      trace: {
        provider: completion.runtime === "native-llama-cpp" ? "llama.cpp" : "browser",
        status: "available",
        durationMs: completion.durationMs,
        fallbackUsed: false,
        outputKind: parsed.output.kind,
        errorCode: null,
        modelId: completion.modelId,
        ...(completion.promptTokens === undefined ? {} : { promptTokens: completion.promptTokens }),
        ...(completion.completionTokens === undefined
          ? {}
          : { completionTokens: completion.completionTokens }),
        executionTarget:
          completion.runtime === "native-llama-cpp" ? "installed-app" : "browser-local"
      }
    };
  }

  /** Shared by createRuntimeModelRoute and the public storefront agent reply path. */
  resolveRuntimeModelProvider(
    shopRuntime: ShopAgentRuntime,
    modelId: string
  ): { provider: RuntimeModelProvider | undefined; binding: AgentModelBindingSummary | null } {
    const binding = this.activeAgentModelBinding(shopRuntime.agentId);
    const adapter =
      binding === null || this.deps.modelRuntimeAdapterResolver === undefined
        ? undefined
        : this.requireModelRuntimeAdapter({
            modelId: binding.modelId,
            executionTarget: binding.executionTarget,
            agentId: binding.agentId,
            businessId: binding.shopId
          });
    const provider =
      adapter !== undefined && binding !== null
        ? runtimeProviderFromAdapter({
            adapter,
            context: {
              modelId: binding.modelId,
              agentId: binding.agentId,
              shopId: binding.shopId
            }
          })
        : this.deps.runtimeModelProviderResolver === undefined
          ? this.deps.runtimeModelProvider
          : this.deps.runtimeModelProviderResolver(modelId);
    return { provider, binding };
  }

  private async createRuntimeModelRoute(input: {
    conversationHistory?: RuntimeModelConversationMessage[];
    message: string;
    modelId: string;
    context: RuntimeContextSummary;
    shopRuntime: ShopAgentRuntime;
    retrievedContext: ReturnType<typeof retrieveAgentContext>;
    memory: string[];
    intent: RuntimeTurnSummary["parserIntent"];
    recallEscalation?: RuntimeRecallEscalation;
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
    recallCandidate: RecallCandidate | null;
  }> {
    const { provider, binding } = this.resolveRuntimeModelProvider(
      input.shopRuntime,
      input.modelId
    );

    if (provider === undefined) {
      if (binding !== null) {
        throw new Cp2Error(
          503,
          "AGENT_MODEL_UNAVAILABLE",
          "The active agent model runtime is unavailable.",
          true,
          {
            bindingId: binding.id,
            modelId: binding.modelId,
            executionTarget: binding.executionTarget
          }
        );
      }
      return {
        proposal: null,
        recallCandidate: null,
        trace: {
          provider: null,
          status: "disabled",
          durationMs: null,
          fallbackUsed: true,
          outputKind: null,
          errorCode: "model_provider_unconfigured"
        }
      };
    }

    const allowedTools = input.shopRuntime.skills
      .filter(
        (binding) =>
          binding.enabled &&
          !input.shopRuntime.instructions.restrictedActions.includes(binding.skillId)
      )
      .map((binding) => binding.skillId);
    const assembled = assembleAgentInferenceMessage({
      runtime: input.shopRuntime,
      intent: input.intent,
      message: input.message,
      context: input.retrievedContext,
      allowedTools,
      memory: input.memory
    });
    const clientCloudEscalation =
      input.recallEscalation !== undefined &&
      (binding?.executionTarget === "openai" || provider.name === "openai")
        ? input.recallEscalation
        : null;
    const prompt = buildRuntimeModelPrompt(
      clientCloudEscalation === null
        ? assembled.message
        : withRecallDistillationInstruction(assembled.message, {
            intent: input.intent,
            escalation: clientCloudEscalation
          }),
      input.context,
      input.conversationHistory,
      {
        runtimeVersion: input.shopRuntime.version,
        compiledInstructions: assembled.compiled,
        retrievedContext: input.retrievedContext,
        allowedTools
      }
    );
    input.appendTelemetry("model.prompt_built", "completed", null, null, {
      provider: provider.name,
      bindingId: binding?.id ?? null,
      executionTarget: binding?.executionTarget ?? null,
      allowedToolCount: prompt.allowedTools.length,
      modelProfile: input.modelId,
      messageLength: input.message.trim().length,
      productCount: input.context.productCount,
      invoiceCount: input.context.invoiceCount,
      runtimeVersion: input.shopRuntime.version,
      retrievedContextCount: input.retrievedContext.length,
      retrievedContextTypes: [...new Set(input.retrievedContext.map((item) => item.type))].join(
        ","
      ),
      intent: input.intent
    });

    let completion: RuntimeModelCompletionResult;
    let fallbackUsed = false;
    let fallbackReason: string | null = null;
    let resolvedModelId = binding?.modelId ?? input.modelId;
    let resolvedExecutionTarget = binding?.executionTarget;
    let recallEscalation: RecallEscalationSignal | null = clientCloudEscalation;

    try {
      input.appendTelemetry("model.inference_started", "completed", null, null, {
        provider: provider.name,
        bindingId: binding?.id ?? null,
        modelId: input.modelId,
        executionTarget: binding?.executionTarget ?? null
      });
      completion = await provider.complete(prompt);
    } catch {
      input.appendTelemetry("model.completed", "blocked", null, null, {
        provider: provider.name,
        adapterStatus: "error",
        durationMs: 0,
        errorCode: "provider_exception"
      });
      input.appendTelemetry("model.fallback", "completed", null, null, {
        provider: provider.name,
        adapterStatus: "error",
        errorCode: "provider_exception"
      });

      return {
        proposal: null,
        recallCandidate: null,
        trace: {
          provider: provider.name,
          status: "error",
          durationMs: 0,
          fallbackUsed: true,
          outputKind: null,
          errorCode: "provider_exception",
          ...(binding === null
            ? {}
            : {
                bindingId: binding.id,
                modelId: binding.modelId,
                executionTarget: binding.executionTarget
              })
        }
      };
    }

    input.appendTelemetry(
      "model.completed",
      completion.status === "available" ? "completed" : "blocked",
      null,
      null,
      {
        provider: completion.provider,
        adapterStatus: completion.status,
        durationMs: completion.durationMs,
        errorCode: completion.errorCode
      }
    );

    if (
      binding !== null &&
      completion.status !== "available" &&
      binding.permissions.allowOpenAIFallback &&
      binding.fallbackModelId !== null &&
      qualifiesForModelFallback(binding.fallbackPolicy, completion.errorCode)
    ) {
      const fallbackAdapter = this.deps.modelRuntimeAdapterResolver?.({
        modelId: binding.fallbackModelId,
        executionTarget: "openai",
        agentId: binding.agentId,
        shopId: binding.shopId
      });
      if (fallbackAdapter !== undefined) {
        fallbackReason = completion.errorCode ?? "RUNTIME_UNAVAILABLE";
        input.appendTelemetry("model.fallback", "completed", null, null, {
          provider: fallbackAdapter.provider,
          bindingId: binding.id,
          fallbackReason,
          modelId: binding.fallbackModelId,
          executionTarget: "openai"
        });
        const fallbackProvider = runtimeProviderFromAdapter({
          adapter: fallbackAdapter,
          context: {
            modelId: binding.fallbackModelId,
            agentId: binding.agentId,
            shopId: binding.shopId
          }
        });
        const serverFallbackEscalation: RecallEscalationSignal = {
          reason: fallbackReason,
          localRuntime: "server-local",
          localModelId: binding.modelId
        };
        const fallbackCompletion = await fallbackProvider.complete({
          ...prompt,
          message: withRecallDistillationInstruction(assembled.message, {
            intent: input.intent,
            escalation: serverFallbackEscalation
          })
        });
        input.appendTelemetry(
          "model.fallback_completed",
          fallbackCompletion.status === "available" ? "completed" : "blocked",
          null,
          null,
          {
            provider: fallbackCompletion.provider,
            bindingId: binding.id,
            fallbackReason,
            adapterStatus: fallbackCompletion.status,
            errorCode: fallbackCompletion.errorCode
          }
        );
        if (fallbackCompletion.status === "available") {
          completion = fallbackCompletion;
          fallbackUsed = true;
          resolvedModelId = binding.fallbackModelId;
          resolvedExecutionTarget = "openai";
          recallEscalation = serverFallbackEscalation;
        }
      }
    }

    if (completion.status !== "available" || completion.outputText === null) {
      input.appendTelemetry("model.fallback", "completed", null, null, {
        provider: completion.provider,
        adapterStatus: completion.status,
        errorCode: completion.errorCode
      });

      return {
        proposal: null,
        recallCandidate: null,
        trace: {
          ...modelTraceFromCompletion(completion, true, null),
          ...(binding === null
            ? {}
            : {
                bindingId: binding.id,
                modelId: resolvedModelId,
                executionTarget: resolvedExecutionTarget ?? binding.executionTarget,
                fallbackReason
              }),
          fallbackUsed: binding === null ? true : fallbackUsed
        }
      };
    }

    const parsed = parseRuntimeModelOutput(completion.outputText);

    if (!parsed.ok || parsed.output === null) {
      input.appendTelemetry("model.fallback", "completed", null, null, {
        provider: completion.provider,
        adapterStatus: "malformed",
        errorCode: "MODEL_RESPONSE_PARSE_FAILED"
      });

      return {
        proposal: null,
        recallCandidate: null,
        trace: {
          provider: completion.provider,
          status: "malformed",
          durationMs: completion.durationMs,
          fallbackUsed: binding === null ? true : fallbackUsed,
          outputKind: null,
          errorCode: "MODEL_RESPONSE_PARSE_FAILED",
          ...(binding === null
            ? {}
            : {
                bindingId: binding.id,
                modelId: resolvedModelId,
                executionTarget: resolvedExecutionTarget ?? binding.executionTarget,
                fallbackReason
              })
        }
      };
    }

    const recallResult =
      recallEscalation === null
        ? null
        : parseRecallCandidateFromModelOutput(completion.outputText, {
            intent: input.intent,
            fallbackReason: recallEscalation.reason
          });
    if (recallResult?.candidate !== null && recallResult?.candidate !== undefined) {
      input.appendTelemetry("recall.candidate_generated", "completed", null, null, {
        taskType: recallResult.candidate.taskType,
        confidence: recallResult.candidate.confidence,
        localRuntime: recallEscalation?.localRuntime ?? null
      });
    } else if (recallResult !== null && recallResult.reason !== "candidate_omitted") {
      input.appendTelemetry("recall.candidate_rejected", "completed", null, null, {
        reason: recallResult.reason,
        localRuntime: recallEscalation?.localRuntime ?? null
      });
    }
    return {
      proposal: parsed.output.proposal,
      recallCandidate: recallResult?.candidate ?? null,
      trace: {
        ...modelTraceFromCompletion(completion, fallbackUsed, parsed.output.kind),
        ...(binding === null
          ? {}
          : {
              bindingId: binding.id,
              modelId: resolvedModelId,
              executionTarget: resolvedExecutionTarget ?? binding.executionTarget,
              fallbackReason
            })
      }
    };
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
          status: input.turn.status,
          modelFallback: input.turn.model?.fallbackUsed ?? false
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
