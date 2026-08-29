import type {
  AgentAudience,
  AgentContextSource,
  AgentModelAssignmentSummary,
  AgentModelBindingSummary,
  AgentOwnerCorrection,
  ShopAgentRuntime
} from "@soko/shared-types";

import type { AgentRuntimeDomainDeps } from "./domain-deps.js";
import {
  cloneAgentContextSource,
  cloneAgentInstructions,
  cloneAgentPersonality,
  cloneAgentSkillBinding,
  contextSourceRecord,
  downloadableAiModelIdPattern,
  stableUuid,
  type BusinessAgentProfileSummary
} from "./shared.js";

interface ShopRuntimeState {
  deps: AgentRuntimeDomainDeps;
  agentModelAssignments: Map<string, AgentModelAssignmentSummary>;
  activeBinding: AgentModelBindingSummary | null;
  contextSources: AgentContextSource[];
}

interface RuntimeContextSourcesState {
  deps: AgentRuntimeDomainDeps;
  agentContextSources: Map<string, AgentContextSource>;
  ownerCorrections: AgentOwnerCorrection[];
}

export function buildShopAgentRuntime(
  state: ShopRuntimeState,
  profile: BusinessAgentProfileSummary,
  now: Date,
  audience: AgentAudience,
  modelId = profile.modelId
): ShopAgentRuntime {
  const business = state.deps.requireBusiness(profile.businessId);
  const assignment = [...state.agentModelAssignments.values()]
    .filter(
      (candidate) =>
        candidate.businessId === profile.businessId && candidate.readinessStatus === "READY"
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const activeBinding = state.activeBinding;
  const model = state.deps.resolveCatalogModel(modelId);
  const sources = state.contextSources.filter((source) =>
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
      deviceAssignmentId: assignment?.activeModelInstallationId ?? null
    },
    version: profile.runtimeVersion,
    status: profile.status,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  };
}

export function contextSourcesForRuntime(
  state: RuntimeContextSourcesState,
  profile: BusinessAgentProfileSummary
): AgentContextSource[] {
  const businessId = profile.businessId;
  const recallRetentionBoundary =
    Date.now() - profile.memoryPolicy.retentionDays * 24 * 60 * 60 * 1000;
  const sources = [...state.agentContextSources.values()]
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
  for (const product of [...state.deps.products.values()].filter(
    (product) => product.businessId === businessId
  )) {
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
    ...[...state.deps.customers.values()]
      .filter((customer) => customer.businessId === businessId)
      .map((item) => ({
        type: "customer" as const,
        title: item.name,
        id: item.id,
        updatedAt: item.updatedAt,
        sensitivity: "confidential" as const
      })),
    ...state.deps.suppliersForBusiness(businessId).map((item) => ({
      type: "supplier" as const,
      title: item.name,
      id: item.id,
      updatedAt: item.updatedAt,
      sensitivity: "confidential" as const
    })),
    ...[...state.deps.purchaseReceipts.values()]
      .filter((item) => item.businessId === businessId)
      .map((item) => ({
        type: "receipt" as const,
        title: `Receipt ${item.id}`,
        id: item.id,
        updatedAt: item.createdAt,
        sensitivity: "restricted" as const
      })),
    ...[...state.deps.invoices.values()]
      .filter((invoice) => invoice.businessId === businessId)
      .map((item) => ({
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
  for (const correction of state.ownerCorrections.filter((item) => item.status === "active")) {
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
      (left, right) => left.type.localeCompare(right.type) || left.title.localeCompare(right.title)
    );
}
