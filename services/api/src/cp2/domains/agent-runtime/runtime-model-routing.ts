import type {
  AgentModelAssignmentSummary,
  AgentModelBindingSummary,
  BrowserInferenceAssignmentSummary,
  ClientInferenceCompletion,
  RuntimeContextSummary,
  RuntimeModelCompletionResult,
  RuntimeModelConversationMessage,
  RuntimeModelProvider,
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

import { Cp2Error } from "../../cp2-error.js";
import { runtimeProviderFromAdapter } from "../../../inference/model-runtime.js";
import {
  assembleAgentInferenceMessage,
  type retrieveAgentContext
} from "../../agent-business-runtime.js";
import {
  parseRecallCandidateFromModelOutput,
  withRecallDistillationInstruction,
  type RecallCandidate,
  type RecallEscalationSignal
} from "../../recall-distillation.js";
import type { AgentRuntimeDomainDeps } from "./domain-deps.js";
import {
  agentModelAssignmentKey,
  browserInferenceAssignmentKey,
  buildRuntimeModelPrompt,
  modelTraceFromCompletion,
  qualifiesForModelFallback
} from "./shared.js";

interface ClientInferenceAssignmentState {
  agentModelAssignments: Map<string, AgentModelAssignmentSummary>;
  browserInferenceAssignments: Map<string, BrowserInferenceAssignmentSummary>;
}

interface RuntimeModelRouteState {
  resolveRuntimeModelProvider: (
    runtime: ShopAgentRuntime,
    modelId: string
  ) => { provider: RuntimeModelProvider | undefined; binding: AgentModelBindingSummary | null };
  modelRuntimeAdapterResolver: AgentRuntimeDomainDeps["modelRuntimeAdapterResolver"];
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
  const { provider, binding } = state.resolveRuntimeModelProvider(input.shopRuntime, input.modelId);

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
    retrievedContextTypes: [...new Set(input.retrievedContext.map((item) => item.type))].join(","),
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
    binding.permissions.allowBackendFallback &&
    binding.fallbackModelId !== null &&
    qualifiesForModelFallback(binding.fallbackPolicy, completion.errorCode)
  ) {
    const fallbackAdapter = state.modelRuntimeAdapterResolver?.({
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
