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
  ShopAgentRuntime
} from "@soko/shared-types";
import { normalizeInferenceErrorCode } from "@soko/shared-types";
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
    fallbackIndex: input.fallbackIndex ?? resolvedFallbackIndex,
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
    input.appendTelemetry("model.inference_started", "completed", null, null, {
      provider: provider.name,
      bindingId: binding?.id ?? null,
      executionTarget: nativeExecutionTarget ?? null,
      resolutionSource,
      fallbackIndex: input.fallbackIndex ?? resolvedFallbackIndex,
      runtimeBindingId,
      modelId: resolvedModelId,
      executionHostId
    });
    completion = await provider.complete(prompt);
  } catch {
    input.appendTelemetry("model.completed", "blocked", null, null, {
      provider: provider.name,
      adapterStatus: "error",
      durationMs: 0,
      errorCode: "provider_exception",
      failureCategory: "provider_exception",
      runtimeBindingId,
      modelId: resolvedModelId,
      executionHostId,
      executionTarget: nativeExecutionTarget ?? null,
      resolutionReason: resolutionSource,
      fallbackIndex: input.fallbackIndex ?? resolvedFallbackIndex
    });

    return {
      proposal: null,
      trace: {
        provider: provider.name,
        status: "error",
        durationMs: 0,
        outputKind: null,
        errorCode: "provider_exception",
        ...(runtimeBindingId === null ? {} : { bindingId: runtimeBindingId }),
        modelId: resolvedModelId,
        executionHostId,
        fallbackIndex: input.fallbackIndex ?? resolvedFallbackIndex,
        ...(resolutionSource === null ? {} : { resolutionReason: resolutionSource }),
        ...(nativeExecutionTarget === undefined ? {} : { executionTarget: nativeExecutionTarget }),
        ...(binding === null
          ? {}
          : {
              bindingId: binding.id,
              modelId: binding.modelId,
              executionTarget: nativeExecutionTarget ?? binding.executionTarget
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
      fallbackIndex: input.fallbackIndex ?? resolvedFallbackIndex
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
        ...(runtimeBindingId === null ? {} : { bindingId: runtimeBindingId }),
        modelId: resolvedModelId,
        executionHostId,
        fallbackIndex: input.fallbackIndex ?? resolvedFallbackIndex,
        fallbackUsed: (input.fallbackIndex ?? resolvedFallbackIndex) > 0,
        fallbackReason:
          (input.fallbackIndex ?? resolvedFallbackIndex) > 0 ? "retryable-execution-failure" : null,
        ...(resolutionSource === null ? {} : { resolutionReason: resolutionSource }),
        ...(nativeExecutionTarget === undefined ? {} : { executionTarget: nativeExecutionTarget }),
        ...(binding === null
          ? {}
          : {
              bindingId: binding.id,
              modelId: binding.modelId,
              executionTarget: nativeExecutionTarget ?? binding.executionTarget
            })
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
        ...(runtimeBindingId === null ? {} : { bindingId: runtimeBindingId }),
        modelId: resolvedModelId,
        executionHostId,
        fallbackIndex: input.fallbackIndex ?? resolvedFallbackIndex,
        fallbackUsed: (input.fallbackIndex ?? resolvedFallbackIndex) > 0,
        fallbackReason:
          (input.fallbackIndex ?? resolvedFallbackIndex) > 0 ? "retryable-execution-failure" : null,
        ...(resolutionSource === null ? {} : { resolutionReason: resolutionSource }),
        ...(nativeExecutionTarget === undefined ? {} : { executionTarget: nativeExecutionTarget }),
        ...(binding === null
          ? {}
          : {
              bindingId: binding.id,
              modelId: binding.modelId,
              executionTarget: nativeExecutionTarget ?? binding.executionTarget
            })
      }
    };
  }

  return {
    proposal: parsed.output.proposal,
    trace: {
      ...modelTraceFromCompletion(completion, parsed.output.kind),
      ...(runtimeBindingId === null ? {} : { bindingId: runtimeBindingId }),
      modelId: resolvedModelId,
      executionHostId,
      fallbackIndex: input.fallbackIndex ?? resolvedFallbackIndex,
      fallbackUsed: (input.fallbackIndex ?? resolvedFallbackIndex) > 0,
      fallbackReason:
        (input.fallbackIndex ?? resolvedFallbackIndex) > 0 ? "retryable-execution-failure" : null,
      ...(resolutionSource === null ? {} : { resolutionReason: resolutionSource }),
      ...(nativeExecutionTarget === undefined ? {} : { executionTarget: nativeExecutionTarget }),
      ...(binding === null
        ? {}
        : {
            bindingId: binding.id,
            modelId: binding.modelId,
            executionTarget: nativeExecutionTarget ?? binding.executionTarget
          })
    }
  };
}

function isRetryableRuntimeCompletion(status: string, errorCode: string | null): boolean {
  if (status === "timeout") return true;
  if (status !== "unavailable" || errorCode === null) return false;
  return [
    "TIMEOUT",
    "ENGINE_UNREACHABLE",
    "MODEL_NOT_INSTALLED",
    "MODEL_LOADING",
    "MODEL_UNAVAILABLE",
    "RATE_LIMITED",
    "PROVIDER_ERROR"
  ].includes(normalizeInferenceErrorCode(errorCode));
}
