import {
  defaultPlannerWeights,
  describePlannerOutcome,
  planExecution,
  type AcceptedExecutionCandidate,
  type ModelPreferenceCandidate,
  type PlannerInput
} from "@soko/execution-planner";
import type {
  AgentModelBindingSummary,
  ExecutionHistoryOutcome,
  ModelExecutionTarget,
  ModelPreferenceSummary,
  RuntimeContextSummary,
  RuntimeModelConversationMessage,
  RuntimeModelCompletionResult,
  RuntimeModelTrace,
  RuntimePlannedAction,
  RuntimeRecallEscalation,
  RuntimeTelemetryEvent,
  RuntimeToolName,
  RuntimeTurnSummary,
  ShopAgentRuntime
} from "@soko/shared-types";
import {
  parseRuntimeModelOutput,
  type createRuntimeToolProposal,
  type RuntimeToolProposal
} from "@soko/tool-core";

import { runtimeProviderFromAdapter, type ModelRuntimeAdapter } from "../../../inference/model-runtime.js";
import { assembleAgentInferenceMessage, type retrieveAgentContext } from "../../agent-business-runtime.js";
import {
  parseRecallCandidateFromModelOutput,
  withRecallDistillationInstruction,
  type RecallCandidate,
  type RecallEscalationSignal
} from "../../recall-distillation.js";
import { defaultAiModelId } from "../agent-runtime/model-catalog.js";
import { buildRuntimeModelPrompt, modelTraceFromCompletion } from "../agent-runtime/shared.js";
import { reconcileLiveModelRegistries } from "./registry-adapter.js";
import type { ExecutionFabricStore } from "./store.js";

interface ExecutionFabricRouteState {
  modelRuntimeAdapterResolver:
    | ((input: {
        modelId: string;
        executionTarget: ModelExecutionTarget;
        agentId: string;
        shopId: string;
      }) => ModelRuntimeAdapter | undefined)
    | undefined;
  executionFabricStore: ExecutionFabricStore;
  /** The legacy active binding, if any - read once by the caller (which already has private
   *  access to it) purely to seed a sane system-default preference when no agent-scoped
   *  ModelPreference has been created yet; never mutated by this function. */
  activeBinding: AgentModelBindingSummary | null;
}

function modelPreferenceFromSummary(summary: ModelPreferenceSummary): ModelPreferenceCandidate {
  return {
    scope: summary.scope,
    preferredModelIds: summary.preferredModelIds,
    fallbackModelIds: summary.fallbackModelIds,
    requiredCapabilities: summary.requiredCapabilities,
    executionPreference: summary.executionPreference,
    qualityPreference: summary.qualityPreference,
    allowCloudFallback: summary.allowCloudFallback,
    maxCostPerRequest: summary.maxCostPerRequest,
    maxLatencyMs: summary.maxLatencyMs,
    minimumContextWindow: summary.minimumContextWindow
  };
}

/** Mirrors the legacy default this same call site used before Phase 2 (§1): prefer the model the
 *  legacy active binding already points at (so an existing shop's behavior does not change the
 *  moment the flag flips on with no ModelPreference created yet), else the catalog default. Cloud
 *  fallback is only allowed by default when the legacy binding already explicitly permitted it -
 *  the flag must never grant a permission the shop had not already opted into. */
function systemDefaultPreference(activeBinding: AgentModelBindingSummary | null): ModelPreferenceCandidate {
  return {
    scope: "system",
    preferredModelIds: [activeBinding?.modelId ?? defaultAiModelId],
    fallbackModelIds: activeBinding?.fallbackModelId === null || activeBinding?.fallbackModelId === undefined
      ? []
      : [activeBinding.fallbackModelId],
    requiredCapabilities: [],
    executionPreference: "balanced",
    qualityPreference: "balanced",
    allowCloudFallback: activeBinding?.permissions.allowOpenAIFallback ?? false,
    maxCostPerRequest: null,
    maxLatencyMs: null,
    minimumContextWindow: null
  };
}

function executionTargetForAdapterLookup(
  target: AcceptedExecutionCandidate["executionTarget"]
): ModelExecutionTarget | null {
  if (target === "backend") return "backend";
  if (target === "cloud") return "openai";
  return null; // "local": never produced server-side (hosts is always [] here, see planExecution call below)
}

/**
 * Phase 2 (docs/architecture/agent-execution-fabric-phase2.md §1/§2). The flagged replacement for
 * `createRuntimeModelRoute` (../agent-runtime/runtime-model-routing.ts), driven by the Execution
 * Planner instead of the legacy single active-binding lookup + hardcoded OpenAI-fallback branch.
 * Only ever called when `AgentRuntimeDomainDeps.executionFabricEnabled` is true - the legacy
 * function is untouched and remains the flag-off path (see agent-runtime/store.ts's
 * `createRuntimeModelRoute` wrapper for the branch).
 *
 * Server-side, `hosts` is always `[]`: this route only ever produces "backend"/"cloud" candidates
 * (host-independent per the planner's own `generateCandidates`, packages/execution-planner/src/
 * planner.ts) - there is no RuntimeHost/broker integration in this phase for the browser-local
 * case, which never reaches this server route at all (it executes fully client-side; see the
 * Phase 2 report for where the client-side integration point is instead).
 */
export async function createExecutionFabricRuntimeModelRoute(
  state: ExecutionFabricRouteState,
  input: {
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
  }
): Promise<{
  proposal: ReturnType<typeof createRuntimeToolProposal> | null;
  trace: RuntimeModelTrace | null;
  recallCandidate: RecallCandidate | null;
}> {
  const agentId = input.shopRuntime.agentId;
  const businessId = input.shopRuntime.shopId;

  const agentPreferenceSummary = state.executionFabricStore.getModelPreference(
    businessId,
    "agent",
    businessId
  );
  const modelPreferenceId = agentPreferenceSummary?.id ?? null;

  const plannerInput: PlannerInput = {
    precedence: {
      request: null,
      conversation: null,
      agent: agentPreferenceSummary === null ? null : modelPreferenceFromSummary(agentPreferenceSummary),
      user: null,
      system: systemDefaultPreference(state.activeBinding)
    },
    hosts: [],
    registry: reconcileLiveModelRegistries().models,
    constraints: {},
    weights: defaultPlannerWeights
  };

  const history = state.executionFabricStore.startExecution({
    conversationId: null,
    messageId: null,
    agentId,
    modelPreferenceId,
    now: input.now
  });

  const plan = planExecution(plannerInput);

  input.appendTelemetry("model.prompt_built", "completed", null, null, {
    executionFabric: true,
    resolvedPrecedenceLevel: plan.resolvedPrecedenceLevel,
    candidateCount: plan.alternatives.length + (plan.selected === null ? 0 : 1),
    rejectedCount: plan.rejected.length
  });

  if (plan.selected === null) {
    const outcome = describePlannerOutcome(plan);
    state.executionFabricStore.completeExecution({
      executionId: history.executionId,
      resolvedModelId: null,
      runtimeHostId: null,
      outcome: "no_compatible_model",
      fallbackDepth: 0,
      now: input.now
    });
    input.appendTelemetry("model.completed", "blocked", null, null, {
      provider: null,
      adapterStatus: "disabled",
      errorCode: outcome?.code ?? "NO_COMPATIBLE_MODEL"
    });
    return {
      proposal: null,
      recallCandidate: null,
      trace: {
        provider: null,
        status: "disabled",
        durationMs: null,
        fallbackUsed: true,
        outputKind: null,
        errorCode: outcome?.code ?? "NO_COMPATIBLE_MODEL"
      }
    };
  }

  const allowedTools = input.shopRuntime.skills
    .filter(
      (binding) =>
        binding.enabled && !input.shopRuntime.instructions.restrictedActions.includes(binding.skillId)
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
  const prompt = buildRuntimeModelPrompt(assembled.message, input.context, input.conversationHistory, {
    runtimeVersion: input.shopRuntime.version,
    compiledInstructions: assembled.compiled,
    retrievedContext: input.retrievedContext,
    allowedTools
  });

  const orderedCandidates = [plan.selected, ...plan.alternatives].sort(
    (left, right) => right.score - left.score
  );

  let completion: RuntimeModelCompletionResult | null = null;
  let resolvedModelId: string | null = null;
  let fallbackDepth = 0;

  for (const [index, candidate] of orderedCandidates.entries()) {
    const executionTarget = executionTargetForAdapterLookup(candidate.executionTarget);
    if (executionTarget === null) continue; // "local" - never executable from this server route

    const adapter = state.modelRuntimeAdapterResolver?.({
      modelId: candidate.modelId,
      executionTarget,
      agentId,
      shopId: businessId
    });
    if (adapter === undefined) continue;

    const provider = runtimeProviderFromAdapter({
      adapter,
      context: { modelId: candidate.modelId, agentId, shopId: businessId }
    });

    input.appendTelemetry("model.inference_started", "completed", null, null, {
      provider: provider.name,
      modelId: candidate.modelId,
      executionTarget: candidate.executionTarget,
      fallbackDepth: index
    });

    const recallEscalation: RecallEscalationSignal | null =
      index > 0 && input.recallEscalation !== undefined
        ? { reason: "RUNTIME_UNAVAILABLE", localRuntime: "server-local", localModelId: orderedCandidates[0]!.modelId }
        : candidate.executionTarget === "cloud" && input.recallEscalation !== undefined
          ? input.recallEscalation
          : null;

    let attempt: RuntimeModelCompletionResult;
    try {
      attempt = await provider.complete(
        recallEscalation === null
          ? prompt
          : {
              ...prompt,
              message: withRecallDistillationInstruction(assembled.message, {
                intent: input.intent,
                escalation: recallEscalation
              })
            }
      );
    } catch {
      input.appendTelemetry("model.completed", "blocked", null, null, {
        provider: provider.name,
        adapterStatus: "error",
        errorCode: "provider_exception"
      });
      continue;
    }

    input.appendTelemetry(
      "model.completed",
      attempt.status === "available" ? "completed" : "blocked",
      null,
      null,
      {
        provider: attempt.provider,
        adapterStatus: attempt.status,
        durationMs: attempt.durationMs,
        errorCode: attempt.errorCode
      }
    );

    if (attempt.status === "available") {
      completion = attempt;
      resolvedModelId = candidate.modelId;
      fallbackDepth = index;
      if (index > 0) {
        input.appendTelemetry("model.fallback", "completed", null, null, {
          provider: attempt.provider,
          modelId: candidate.modelId,
          fallbackDepth: index
        });
      }
      break;
    }
  }

  if (completion === null || completion.outputText === null) {
    const outcome: ExecutionHistoryOutcome = "failed";
    state.executionFabricStore.completeExecution({
      executionId: history.executionId,
      resolvedModelId,
      runtimeHostId: null,
      outcome,
      fallbackDepth,
      now: input.now
    });
    return {
      proposal: null,
      recallCandidate: null,
      trace: {
        provider: completion?.provider ?? null,
        status: completion?.status ?? "unavailable",
        durationMs: completion?.durationMs ?? null,
        fallbackUsed: fallbackDepth > 0,
        outputKind: null,
        errorCode: completion?.errorCode ?? "EXECUTION_HOST_LOST"
      }
    };
  }

  const parsed = parseRuntimeModelOutput(completion.outputText);
  if (!parsed.ok || parsed.output === null) {
    state.executionFabricStore.completeExecution({
      executionId: history.executionId,
      resolvedModelId,
      runtimeHostId: null,
      outcome: "failed",
      fallbackDepth,
      now: input.now
    });
    return {
      proposal: null,
      recallCandidate: null,
      trace: {
        provider: completion.provider,
        status: "malformed",
        durationMs: completion.durationMs,
        fallbackUsed: fallbackDepth > 0,
        outputKind: null,
        errorCode: "MODEL_RESPONSE_PARSE_FAILED"
      }
    };
  }

  state.executionFabricStore.completeExecution({
    executionId: history.executionId,
    resolvedModelId,
    runtimeHostId: null,
    outcome: "completed",
    fallbackDepth,
    now: input.now
  });

  const recallResult =
    input.recallEscalation === undefined
      ? null
      : parseRecallCandidateFromModelOutput(completion.outputText, {
          intent: input.intent,
          fallbackReason: input.recallEscalation.reason
        });

  const proposal: RuntimeToolProposal = parsed.output.proposal;
  return {
    proposal,
    recallCandidate: recallResult?.candidate ?? null,
    trace: modelTraceFromCompletion(completion, fallbackDepth > 0, parsed.output.kind)
  };
}
