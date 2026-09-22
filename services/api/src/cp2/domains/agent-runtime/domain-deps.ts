import type {
  RuntimeHandoff,
  RuntimeTurnSummary,
  RuntimeExecutionEvent,
  RuntimeExecutionEventType
} from "@soko/shared-types";
import type {
  ActiveNativeAgentBinding,
  AgentDefinition,
  AgentRouteSummary,
  AiModelSummary,
  AuthenticatedActorView,
  BuyCheckoutItemInput,
  BuyFeedSummary,
  BusinessSummary,
  MembershipSummary,
  ModelExecutionTarget,
  PlatformDefaultRuntimePolicy,
  NativeRuntimeBindingSummary,
  NativeRuntimeActivationInput,
  NativeDefaultRuntimeProvisioningInput,
  NativeDefaultRuntimeProvisioningResult,
  NativeRuntimeResolutionInput,
  ResolvedNativeRuntimeBinding,
  RuntimeContextSummary,
  RuntimeModelProvider,
  UnifiedCheckoutSummary
} from "@soko/shared-types";
import type { BusinessPermission } from "@soko/business-core";
import type { ComputerActionResult, ComputerSession } from "@soko/computer-runtime";

import type { ModelRuntimeAdapter } from "../../../inference/model-runtime.js";
import type { AgentRuntimeAdapter } from "../../../agent-harness/agent-runtime-adapter.js";
import type { SessionRecord } from "../../store.js";
import type { AgentRuntimeCommerceDeps } from "./domain-deps-commerce.js";

export interface AgentRuntimeDomainDeps extends AgentRuntimeCommerceDeps {
  acquireRuntimeTurn?: (
    taskId: string,
    accountId: string,
    businessId: string
  ) => { release: () => void; fenceToken: number | null };
  checkpointRuntimeTurn?: (
    taskId: string,
    turn: RuntimeTurnSummary,
    expectedFenceToken?: number | null
  ) => void;
  activeRuntimeCheckpoint?: (taskId: string) => RuntimeHandoff | undefined;
  /** Durable execution event log (docs/architecture/durable-execution-plane.md). Optional so every
   *  existing test double for `AgentRuntimeDomainDeps` keeps compiling unchanged - a turn simply
   *  produces no durable event trail when omitted, exactly like `checkpointRuntimeTurn` already
   *  degrades to "no checkpoint" when absent. */
  appendRuntimeExecutionEvent?: (input: {
    taskId: string;
    eventType: RuntimeExecutionEventType;
    executionId: string | null;
    runtimeInstanceId: string | null;
    executionHostId: string | null;
    payload: Record<string, unknown>;
    now: Date;
  }) => RuntimeExecutionEvent;
  platformDefaultRuntime: PlatformDefaultRuntimePolicy;
  // DB-hosted model catalog (see infra/db/migrations/071_platform_catalog.sql,
  // Cp2Store.modelCatalog) - the source of truth every aiModelRegistry.find()/.filter() call in
  // this domain used to read directly now goes through these instead, so a platform operator's
  // catalog edit is visible without a redeploy.
  listModelCatalog: () => AiModelSummary[];
  resolveCatalogModel: (modelId: string) => AiModelSummary | undefined;
  // Same for the built-in agent template catalog (Cp2Store.agentCatalog) - always resolves to
  // something usable (falls back to the hardcoded defaultAgentDefinition), since a business must
  // always be able to bootstrap a default agent profile even if the catalog row was deleted.
  resolveAgentCatalogEntry: (agentDefinitionId: string) => AgentDefinition;
  requireAuthorizedSession: (
    sessionId: string | null,
    businessId: string,
    permission: BusinessPermission,
    now?: Date
  ) => AuthenticatedActorView;
  requirePinVerifiedSession: (sessionId: string | null, now: Date) => AuthenticatedActorView;
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
  createAgentRoute: (input: {
    sessionId: string | null;
    requestText: string;
    targetNodeId?: string | null;
    now?: Date;
  }) => AgentRouteSummary;
  searchBuyFeed: (input: { sessionId: string | null; query: string; now?: Date }) => BuyFeedSummary;
  createUnifiedCheckout: (input: {
    sessionId: string | null;
    items: BuyCheckoutItemInput[];
    sellerConversationId?: string | null;
    idempotencyKey?: string;
    now?: Date;
  }) => UnifiedCheckoutSummary;
  sessions: Map<string, SessionRecord>;
  businesses: Map<string, BusinessSummary>;
  // null means the native runtime graph has nothing usable for this conversation right now (no
  // model configured, nothing currently available, etc.) - callers fall back to the legacy
  // agent-model-binding path rather than treating it as an error. See resolveNativeRuntimeBinding
  // in store.ts and docs/architecture/provider-neutral-runtime.md §5.
  //
  // businessId is the caller's already-authorized shop (from the request path/session, never the
  // client body) - the implementation must reject a conversationId that belongs to another shop
  // rather than silently resolving that shop's binding/model/host for this request.
  resolveNativeRuntimeBinding: (
    input: NativeRuntimeResolutionInput
  ) => ResolvedNativeRuntimeBinding | null;
  // The sole "which model is this agent using" read path - replaces the retired legacy
  // agentModelBindings map/table entirely (see native-runtime/store.ts getActiveBindingForAgent,
  // and infra/db/migrations/076_drop_legacy_agent_model_bindings.sql for the table drop). null
  // means no model has ever been activated for this shop's agent.
  getActiveNativeRuntimeBinding: (
    businessId: string,
    agentId: string,
    accountId?: string
  ) => ActiveNativeAgentBinding | null;
  activateVerifiedRuntimeBinding: (
    input: NativeRuntimeActivationInput
  ) => NativeRuntimeBindingSummary;
  // undefined means no native runtime agent record has been materialized for this id yet (the shop
  // has never explicitly activated a model or received the platform default) - callers fall back to
  // platformDefaultRuntime.agentRuntimeAdapterId rather than treating that as an error.
  resolveAgentRuntimeAdapterId: (agentId: string) => string | undefined;
  resolveProductionModelTemplate?: (
    businessId: string,
    agentId: string,
    modelId: string,
    task?: string
  ) => {
    templateId: string;
    templateVersionId: string;
    version: string;
    compiledInstructions: string[];
    nativeRuntimeBindingId: string | null;
    baseModelId: string;
    task: string | null;
    allowedTools: string[];
    contextRequirements: string[];
    outputSchema?: Record<string, unknown>;
    constraints: Record<string, unknown>;
    templateVocabularySnapshot: string;
    currentVocabularySnapshot: string;
  } | null;
  ensureDefaultRuntimeBinding: (
    input: NativeDefaultRuntimeProvisioningInput
  ) => NativeDefaultRuntimeProvisioningResult;
  deactivateRuntimeBinding: (input: {
    businessId: string;
    accountId: string;
    agentId: string;
    updatedBy: string;
    now: Date;
  }) => string | null;
  modelRuntimeAdapterResolver?: (input: {
    modelId: string;
    executionTarget: ModelExecutionTarget;
    agentId: string;
    shopId: string;
  }) => ModelRuntimeAdapter | undefined;
  agentRuntimeAdapterResolver: (adapterId: string) => AgentRuntimeAdapter | undefined;
  runtimeModelProviderResolver?: (modelId: string) => RuntimeModelProvider | undefined;
  runtimeModelProvider?: RuntimeModelProvider;

  // ComputerRuntime (docs/architecture/computer-runtime.md) - delegates to
  // services/api/src/cp2/domains/computer-runtime/store.ts, matching this interface's existing
  // "flat delegate closure per capability" shape (createAgentRoute, searchBuyFeed, ...) rather
  // than a nested sub-object, so it composes into executeComputerCapability's dispatch the same
  // way every other domain here does.
  computerSessionCreate: (input: {
    sessionId: string | null;
    businessId: string;
    conversationId?: string;
    profileId?: string | null;
    startUrl?: string | null;
    now: Date;
  }) => Promise<ComputerSession>;
  computerSessionResume: (input: {
    sessionId: string | null;
    businessId: string;
    computerSessionId: string;
    now: Date;
  }) => Promise<ComputerSession>;
  computerNavigate: (input: {
    sessionId: string | null;
    businessId: string;
    computerSessionId: string;
    url: string;
    now: Date;
  }) => Promise<ComputerActionResult>;
  computerObserve: (input: {
    sessionId: string | null;
    businessId: string;
    computerSessionId: string;
    now: Date;
  }) => Promise<ComputerActionResult>;
  computerClick: (input: {
    sessionId: string | null;
    businessId: string;
    computerSessionId: string;
    targetDescription: string;
    targetRef?: string;
    now: Date;
  }) => Promise<ComputerActionResult>;
  computerType: (input: {
    sessionId: string | null;
    businessId: string;
    computerSessionId: string;
    targetDescription: string;
    targetRef?: string;
    text: string;
    submit?: boolean;
    now: Date;
  }) => Promise<ComputerActionResult>;
  computerScroll: (input: {
    sessionId: string | null;
    businessId: string;
    computerSessionId: string;
    direction: "up" | "down";
    amountPx?: number;
    now: Date;
  }) => Promise<ComputerActionResult>;
  computerUpload: (input: {
    sessionId: string | null;
    businessId: string;
    conversationId?: string;
    computerSessionId: string;
    targetDescription: string;
    attachmentId: string;
    now: Date;
  }) => Promise<ComputerActionResult>;
  computerControlTake: (input: {
    sessionId: string | null;
    businessId: string;
    computerSessionId: string;
    now: Date;
  }) => ComputerSession;
  computerControlRelease: (input: {
    sessionId: string | null;
    businessId: string;
    computerSessionId: string;
    now: Date;
  }) => Promise<ComputerSession>;
  computerCheckpoint: (input: {
    sessionId: string | null;
    businessId: string;
    computerSessionId: string;
    now: Date;
  }) => Promise<{ checkpointId: string }>;
  computerSuspend: (input: {
    sessionId: string | null;
    businessId: string;
    computerSessionId: string;
    now: Date;
  }) => Promise<void>;
  computerClose: (input: {
    sessionId: string | null;
    businessId: string;
    computerSessionId: string;
    now: Date;
  }) => Promise<void>;
}
