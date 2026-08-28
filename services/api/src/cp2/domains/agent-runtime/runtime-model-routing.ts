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
    modelId: string
  ) => {
    provider: RuntimeModelProvider | undefined;
    binding: AgentModelBindingSummary | null;
    executionTarget: ModelExecutionTarget | undefined;
    resolutionSource: ExecutionTargetResolutionSource | null;
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
  }
): Promise<{
  proposal: ReturnType<typeof createRuntimeToolProposal> | null;
  trace: RuntimeModelTrace | null;
}> {
  const {
    provider,
    binding,
    executionTarget: nativeExecutionTarget,
    resolutionSource
  } = state.resolveRuntimeModelProvider(input.shopRuntime, input.modelId);

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
      modelId: input.modelId,
      executionTarget: nativeExecutionTarget ?? null,
      resolutionSource
    });
    completion = await provider.complete(prompt);
  } catch {
    input.appendTelemetry("model.completed", "blocked", null, null, {
      provider: provider.name,
      adapterStatus: "error",
      durationMs: 0,
      errorCode: "provider_exception"
    });

    return {
      proposal: null,
      trace: {
        provider: provider.name,
        status: "error",
        durationMs: 0,
        outputKind: null,
        errorCode: "provider_exception",
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
      errorCode: completion.errorCode
    }
  );

  if (completion.status !== "available" || completion.outputText === null) {
    return {
      proposal: null,
      trace: {
        ...modelTraceFromCompletion(completion, null),
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
