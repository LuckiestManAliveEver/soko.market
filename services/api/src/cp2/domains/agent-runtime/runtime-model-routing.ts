import type {
  AgentModelAssignmentSummary,
  AgentModelBindingSummary,
  BrowserInferenceAssignmentSummary,
  ClientInferenceCompletion,
  ModelExecutionTarget,
  RuntimeContextSummary,
  RuntimeModelCompletionResult,
  RuntimeModelConversationMessage,
  RuntimeModelProvider,
  RuntimeModelTrace,
  RuntimePlannedAction,
  RuntimeTelemetryEvent,
  RuntimeToolName,
  RuntimeTurnSummary,
  ShopAgentRuntime,
  NativeRuntimeAgentSummary
} from "@soko/shared-types";
import { isRetryableInferenceCategory, normalizeInferenceErrorCode } from "@soko/shared-types";
import {
  parseRuntimeModelOutput,
  type createRuntimeToolProposal,
  type RuntimeToolProposal
} from "@soko/tool-core";

import { Cp2Error } from "../../cp2-error.js";
import {
  assembleAgentInferenceMessage,
  type retrieveAgentContext
} from "../../agent-business-runtime.js";
import type { ExecutionTargetResolutionSource } from "./native-runtime-routing.js";
import {
  agentModelAssignmentKey,
  browserInferenceAssignmentKey,
  buildRuntimeModelPrompt,
  modelTraceFromCompletion
} from "./shared.js";
import {
  runtimeAdapterIdForAgent,
  type AgentRuntimeAdapter
} from "../../../agent-runtime/agent-runtime-adapter.js";

interface ClientInferenceAssignmentState {
  agentModelAssignments: Map<string, AgentModelAssignmentSummary>;
  browserInferenceAssignments: Map<string, BrowserInferenceAssignmentSummary>;
}

interface RuntimeModelRouteState {
  resolveRuntimeModelProvider: (
    runtime: ShopAgentRuntime,
    modelId: string,
    attemptedRuntimeKeys?: ReadonlySet<string>
  ) => {
    provider: RuntimeModelProvider | undefined;
    binding: AgentModelBindingSummary | null;
    executionTarget: ModelExecutionTarget | undefined;
    resolutionSource: ExecutionTargetResolutionSource | null;
    runtimeKey: string | null;
    runtimeBindingId: string | null;
    resolvedModelId: string;
    executionHostId: string | null;
    fallbackIndex: number;
  };
  resolveAgentRuntimeAdapter: (adapterId: string) => AgentRuntimeAdapter | undefined;
}

export function requireReadyClientInferenceCompletion(
  state: ClientInferenceAssignmentState,
  input: {
    completion: ClientInferenceCompletion;
    businessId: string;
    accountId: string;
    userId: string;
  }
): ClientInferenceCompletion {
  const completion = input.completion;
  if (completion.installationId !== undefined) {
    const assignment = state.agentModelAssignments.get(
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

  const assignment = state.browserInferenceAssignments.get(
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

export function createClientInferenceModelRoute(
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
    trace: {
      provider: completion.runtime === "native-llama-cpp" ? "llama.cpp" : "browser",
      status: "available",
      durationMs: completion.durationMs,
      outputKind: parsed.output.kind,
      errorCode: null,
      modelId: completion.modelId,
      ...(completion.promptTokens === undefined ? {} : { promptTokens: completion.promptTokens }),
      ...(completion.completionTokens === undefined
        ? {}
        : { completionTokens: completion.completionTokens }),
      executionTarget: completion.runtime === "native-llama-cpp" ? "installed-app" : "browser-local"
    }
  };
}

/** Shared by createRuntimeModelRoute and the public storefront agent reply path. */

export async function createRuntimeModelRoute(
  state: RuntimeModelRouteState,
  input: {
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
    agent: NativeRuntimeAgentSummary;
    signal?: AbortSignal;
    appendTelemetry: (
      state: RuntimeTelemetryEvent["state"],
      status: RuntimeTelemetryEvent["status"],
      toolName: RuntimeToolName | null,
      risk: RuntimePlannedAction["risk"] | null,
      metadata?: RuntimeTelemetryEvent["metadata"]
    ) => void;
    attemptedRuntimeKeys?: ReadonlySet<string>;
    fallbackIndex?: number;
  }
): Promise<{
  proposal: ReturnType<typeof createRuntimeToolProposal> | null;
  trace: RuntimeModelTrace | null;
}> {
  const {
    provider,
    binding,
    executionTarget: nativeExecutionTarget,
    resolutionSource,
    runtimeKey,
    runtimeBindingId,
    resolvedModelId,
    executionHostId,
    fallbackIndex: resolvedFallbackIndex
  } = state.resolveRuntimeModelProvider(
    input.shopRuntime,
    input.modelId,
    input.attemptedRuntimeKeys
  );
  // Identical across every telemetry/trace call site below this point in the function - computed
  // once so a future field addition doesn't have to be applied at N near-duplicate call sites.
  const fallbackIndex = input.fallbackIndex ?? resolvedFallbackIndex;
  const fallbackUsed = fallbackIndex > 0;
  const fallbackReason = fallbackUsed ? ("retryable-execution-failure" as const) : null;
  const agentAdapterId = runtimeAdapterIdForAgent(input.agent);
  const agentAdapter = state.resolveAgentRuntimeAdapter(agentAdapterId);
  if (agentAdapter === undefined) {
    throw new Cp2Error(
      503,
      "AGENT_RUNTIME_ADAPTER_UNAVAILABLE",
      "The selected agent runtime adapter is not registered.",
      false,
      { agentId: input.agent.id, agentAdapterId }
    );
  }
  const sharedTraceFields = (): Pick<
    RuntimeModelTrace,
    | "modelId"
    | "executionHostId"
    | "fallbackIndex"
    | "fallbackUsed"
    | "fallbackReason"
    | "bindingId"
    | "resolutionReason"
    | "executionTarget"
    | "agentId"
    | "agentAdapterId"
  > => ({
    ...(runtimeBindingId === null ? {} : { bindingId: runtimeBindingId }),
    modelId: resolvedModelId,
    executionHostId,
    fallbackIndex,
    fallbackUsed,
    fallbackReason,
    agentId: input.agent.id,
    agentAdapterId,
    ...(resolutionSource === null ? {} : { resolutionReason: resolutionSource }),
    ...(nativeExecutionTarget === undefined ? {} : { executionTarget: nativeExecutionTarget }),
    ...(binding === null
      ? {}
      : {
          bindingId: binding.id,
          modelId: binding.modelId,
          executionTarget: nativeExecutionTarget ?? binding.executionTarget
        })
  });

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
          executionTarget: nativeExecutionTarget ?? null,
          resolutionSource
        }
      );
    }
    return {
      proposal: null,
      trace: {
        provider: null,
        status: "disabled",
        durationMs: null,
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
  const prompt = buildRuntimeModelPrompt(
    assembled.message,
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
    executionTarget: nativeExecutionTarget ?? null,
    resolutionSource,
    fallbackIndex,
    allowedToolCount: prompt.allowedTools.length,
    modelProfile: input.modelId,
    messageLength: input.message.trim().length,
    productCount: input.context.productCount,
    invoiceCount: input.context.invoiceCount,
    runtimeVersion: input.shopRuntime.version,
    retrievedContextCount: input.retrievedContext.length,
    retrievedContextTypes: [...new Set(input.retrievedContext.map((item) => item.type))].join(","),
    intent: input.intent
  });

  let completion: RuntimeModelCompletionResult;

  try {
    input.appendTelemetry("agent.started", "completed", null, null, {
      agentId: input.agent.id,
      agentAdapterId,
      modelId: resolvedModelId
    });
    input.appendTelemetry("model.inference_started", "completed", null, null, {
      provider: provider.name,
      bindingId: binding?.id ?? null,
      executionTarget: nativeExecutionTarget ?? null,
      resolutionSource,
      fallbackIndex,
      runtimeBindingId,
      modelId: resolvedModelId,
      executionHostId,
      agentId: input.agent.id,
      agentAdapterId
    });
    const agentAvailability = await agentAdapter.canRun({
      agent: input.agent,
      modelId: resolvedModelId,
      conversationId: input.conversationId ?? "runtime-unbound",
      shopId: input.shopRuntime.shopId
    });
    if (!agentAvailability.available) {
      throw new Cp2Error(
        503,
        agentAvailability.errorCode ?? "AGENT_RUNTIME_UNAVAILABLE",
        agentAvailability.message ?? "The selected agent runtime is unavailable.",
        true
      );
    }
    const agentResult = await agentAdapter.execute({
      agent: input.agent,
      bindingId: runtimeBindingId ?? binding?.id ?? "runtime-unbound",
      executionHostId,
      modelId: resolvedModelId,
      conversationId: input.conversationId ?? "runtime-unbound",
      shopId: input.shopRuntime.shopId,
      userMessage: input.message,
      prompt,
      model: provider,
      allowedTools,
      ...(input.signal === undefined ? {} : { signal: input.signal })
    });
    completion = agentResult.completion;
    input.appendTelemetry("agent.completed", "completed", null, null, {
      agentId: input.agent.id,
      agentAdapterId,
      agentEventCount: agentResult.eventTypes.length
    });
  } catch (error) {
    const errorCode = error instanceof Cp2Error ? error.code : "provider_exception";
    input.appendTelemetry("model.completed", "blocked", null, null, {
      provider: provider.name,
      adapterStatus: "error",
      durationMs: 0,
      errorCode,
      failureCategory: errorCode,
      runtimeBindingId,
      modelId: resolvedModelId,
      executionHostId,
      executionTarget: nativeExecutionTarget ?? null,
      resolutionReason: resolutionSource,
      fallbackIndex,
      agentId: input.agent.id,
      agentAdapterId
    });

    return {
      proposal: null,
      trace: {
        provider: provider.name,
        status: "error",
        durationMs: 0,
        outputKind: null,
        errorCode,
        ...sharedTraceFields()
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
      errorCode: completion.errorCode,
      failureCategory:
        completion.status === "available" || completion.errorCode === null
          ? null
          : normalizeInferenceErrorCode(completion.errorCode),
      runtimeBindingId,
      modelId: resolvedModelId,
      executionHostId,
      executionTarget: nativeExecutionTarget ?? null,
      resolutionReason: resolutionSource,
      fallbackIndex
    }
  );

  if (completion.status !== "available" || completion.outputText === null) {
    if (
      runtimeKey !== null &&
      isRetryableRuntimeCompletion(completion.status, completion.errorCode)
    ) {
      const attemptedRuntimeKeys = new Set(input.attemptedRuntimeKeys);
      attemptedRuntimeKeys.add(runtimeKey);
      try {
        return await createRuntimeModelRoute(state, {
          ...input,
          attemptedRuntimeKeys,
          // Deliberately not `fallbackIndex + 1`: this counts retry attempts within this recursion
          // chain (0 on the first call regardless of which native role resolvedFallbackIndex
          // happened to select), not "the resolved role's fallback position + 1".
          fallbackIndex: (input.fallbackIndex ?? 0) + 1
        });
      } catch (error) {
        if (!(error instanceof Cp2Error) || error.code !== "RUNTIME_MODELS_UNAVAILABLE") {
          throw error;
        }
      }
    }
    return {
      proposal: null,
      trace: {
        ...modelTraceFromCompletion(completion, null),
        ...sharedTraceFields()
      }
    };
  }

  const parsed = parseRuntimeModelOutput(completion.outputText);

  if (!parsed.ok || parsed.output === null) {
    return {
      proposal: null,
      trace: {
        provider: completion.provider,
        status: "malformed",
        durationMs: completion.durationMs,
        outputKind: null,
        errorCode: "MODEL_RESPONSE_PARSE_FAILED",
        ...sharedTraceFields()
      }
    };
  }

  return {
    proposal: parsed.output.proposal,
    trace: {
      ...modelTraceFromCompletion(completion, parsed.output.kind),
      ...sharedTraceFields()
    }
  };
}

function isRetryableRuntimeCompletion(status: string, errorCode: string | null): boolean {
  if (status === "timeout") return true;
  if (status !== "unavailable" || errorCode === null) return false;
  return isRetryableInferenceCategory(normalizeInferenceErrorCode(errorCode));
}
