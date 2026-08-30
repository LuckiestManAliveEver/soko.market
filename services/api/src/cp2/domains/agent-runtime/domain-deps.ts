import type {
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
  ResolvedNativeRuntimeBinding,
  RuntimeContextSummary,
  RuntimeModelProvider,
  UnifiedCheckoutSummary
} from "@soko/shared-types";
import type { BusinessPermission } from "@soko/business-core";

import type { ModelRuntimeAdapter } from "../../../inference/model-runtime.js";
import type { AgentRuntimeAdapter } from "../../../agent-runtime/agent-runtime-adapter.js";
import type { SessionRecord } from "../../store.js";
import type { AgentRuntimeCommerceDeps } from "./domain-deps-commerce.js";

export interface AgentRuntimeDomainDeps extends AgentRuntimeCommerceDeps {
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
    conversationId: string,
    businessId: string
  ) => ResolvedNativeRuntimeBinding | null;
  activateVerifiedRuntimeBinding: (
    input: NativeRuntimeActivationInput
  ) => NativeRuntimeBindingSummary;
  // undefined means no native runtime agent record has been materialized for this id yet (the shop
  // has never explicitly activated a model or received the platform default) - callers fall back to
  // platformDefaultRuntime.agentRuntimeAdapterId rather than treating that as an error.
  resolveAgentRuntimeAdapterId: (agentId: string) => string | undefined;
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
}
