import { randomUUID } from "node:crypto";

import { createCircuitBreaker, type CircuitBreaker } from "@soko/resource-control";

import type {
  CredentialScope,
  InferenceChunk,
  InferenceExecutionTarget,
  InferenceProvider,
  InferenceRequest,
  InferenceResponse,
  ModelDefinition,
  ProviderHealth,
  ResolvedCredential
} from "./contract.js";
import { isClientExecutedTarget, requiredCapabilities } from "./contract.js";
import type { CredentialResolver } from "./credentials.js";
import { InferenceError, isInferenceError, toInferenceError } from "./errors.js";
import { nativeExecutionTargetFor } from "./model-definitions.js";
import type { InferenceProviderConfig } from "./provider-config.js";
import type { InferenceProviderRegistry } from "./provider-registry.js";
import { redactRecord } from "./redaction.js";
import type {
  InferenceRunRecord,
  InferenceRunRepository,
  InferenceRunStatus
} from "./repositories.js";
import {
  estimateCost,
  type EffectiveUsagePolicy,
  type InferenceUsageGuard
} from "./usage-policy.js";

/** Who is asking. Carried from the agent turn; never forwarded to a provider. */
export interface InferenceCallContext {
  agentId: string;
  tenantId: string | null;
  userId: string | null;
  conversationId?: string | null;
  runtimeBindingId?: string | null;
  /** Narrows credential resolution to exactly one source (brief §11 "explicit request scope"). */
  explicitCredentialScope?: Exclude<CredentialScope, "explicit">;
  signal?: AbortSignal;
}

export interface ResolvedInferenceTarget {
  model: ModelDefinition;
  providerConfig: InferenceProviderConfig;
  provider: InferenceProvider;
  credential: ResolvedCredential | null;
  executionTarget: InferenceExecutionTarget;
}

/** Low-cardinality observation for metrics. No user ids, prompts, or keys - by construction. */
export interface InferenceObservation {
  provider: string;
  model: string;
  executionTarget: InferenceExecutionTarget;
  status: InferenceRunStatus;
  errorCode: string | null;
  latencyMs: number | null;
  firstTokenMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: number | null;
  currency: string | null;
  fallback: boolean;
}

export interface InferenceMetricsSink {
  recordInference(observation: InferenceObservation): void;
}

export type InferenceLogger = (event: string, fields: Record<string, unknown>) => void;

export interface InferenceRouterDeps {
  registry: InferenceProviderRegistry;
  /** Catalog lookup (cp2_model_catalog projection). */
  resolveModel: (modelId: string) => ModelDefinition | null;
  credentials: CredentialResolver;
  usage: InferenceUsageGuard;
  runs: InferenceRunRepository;
  defaults: {
    timeoutMs: number;
    maxOutputTokens: number;
    defaultModelId: string | null;
    currency: string;
  };
  metrics?: InferenceMetricsSink;
  log?: InferenceLogger;
  now?: () => number;
}

/**
 * The canonical inference router (brief §15). One deterministic resolution sequence for every
 * provider; no branch anywhere in this class names a vendor.
 *
 *   1 validate agent        6 verify provider enabled      11 execute
 *   2 binding's model id    7 verify required capability   12 normalize (adapter's job)
 *   3 resolve model         8 resolve credential           13 record usage
 *   4 verify model enabled  9 resolve execution target
 *   5 resolve provider     10 verify runtime availability
 *
 * The model is never changed silently. The only way a request moves to a different model is an
 * explicit fallback policy (NONE by default), and every such move is recorded.
 */
export class InferenceRouter {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly deps: InferenceRouterDeps) {}

  /** Step 2 fallback: the configured default model, when the binding did not name one. */
  resolveModelId(modelId: string | null | undefined): string {
    const resolved = modelId ?? this.deps.defaults.defaultModelId;
    if (resolved === null || resolved === undefined || resolved.trim() === "") {
      throw new InferenceError("MODEL_UNAVAILABLE", {
        diagnostic: "No model on the binding and INFERENCE_DEFAULT_MODEL is not configured."
      });
    }
    return resolved;
  }

  /**
   * Steps 1-10. Pure configuration/credential work - no network call. Throws a normalized
   * InferenceError naming the first step that failed.
   */
  async resolveInferenceTarget(input: {
    agentId: string;
    modelId?: string | null;
    tenantId: string | null;
    userId: string | null;
    request?: InferenceRequest;
    explicitCredentialScope?: Exclude<CredentialScope, "explicit">;
  }): Promise<ResolvedInferenceTarget> {
    if (input.agentId.trim() === "") {
      throw new InferenceError(
        "INFERENCE_FAILED",
        { diagnostic: "Inference requires an agent." },
        "An agent is required for inference."
      );
    }
    const modelId = this.resolveModelId(input.modelId);
    const model = this.deps.resolveModel(modelId);
    if (model === null) throw new InferenceError("MODEL_UNAVAILABLE", { modelId });
    if (!model.enabled)
      throw new InferenceError("MODEL_UNAVAILABLE", { modelId, diagnostic: "Model disabled." });

    const registered = this.deps.registry.get(model.providerId);
    if (registered === undefined) {
      throw new InferenceError("PROVIDER_MISCONFIGURED", {
        providerId: model.providerId,
        modelId,
        diagnostic: "Model references an unknown provider."
      });
    }
    const { config, provider } = registered;
    if (!config.enabled) {
      throw new InferenceError("PROVIDER_UNAVAILABLE", {
        providerId: config.id,
        modelId,
        diagnostic: "Provider disabled."
      });
    }

    const probeRequest = input.request ?? {
      requestId: "capability-probe",
      modelId,
      messages: [{ role: "user" as const, content: "" }]
    };
    if (!(await provider.supports(model, probeRequest))) {
      throw new InferenceError("CAPABILITY_UNSUPPORTED", {
        providerId: config.id,
        modelId,
        diagnostic: `Required: ${requiredCapabilities(probeRequest).join(", ")}`
      });
    }

    // Step 9 before step 8: a client-executed model never needs (or gets) a server credential.
    if (
      isClientExecutedTarget(model.executionTarget) ||
      nativeExecutionTargetFor(model.executionTarget) === null
    ) {
      throw new InferenceError("LOCAL_EXECUTION_REQUIRED", { providerId: config.id, modelId });
    }

    const credential = await this.deps.credentials.resolve({
      provider: config,
      tenantId: input.tenantId,
      userId: input.userId,
      ...(input.explicitCredentialScope === undefined
        ? {}
        : { explicitScope: input.explicitCredentialScope })
    });
    if (credential === null && config.type !== "openai-compatible") {
      throw new InferenceError("CREDENTIAL_MISSING", { providerId: config.id, modelId });
    }

    if (this.breakerFor(config.id).state() === "open") {
      throw new InferenceError("PROVIDER_UNAVAILABLE", {
        providerId: config.id,
        modelId,
        diagnostic: "Provider circuit is open after repeated failures."
      });
    }

    return {
      model,
      providerConfig: config,
      provider,
      credential,
      executionTarget: model.executionTarget
    };
  }

  /** Steps 1-13 for a non-streaming request, including explicit-policy fallback. */
  async generate(
    request: InferenceRequest,
    context: InferenceCallContext
  ): Promise<InferenceResponse> {
    const policy = await this.deps.usage.effectivePolicy({
      tenantId: context.tenantId,
      userId: context.userId
    });
    const primaryModelId = this.resolveModelId(request.modelId);
    const attempts = [primaryModelId, ...this.fallbackCandidates(primaryModelId, policy)];
    let lastError: InferenceError | undefined;
    let fallbackFrom: string | undefined;

    for (const [index, modelId] of attempts.entries()) {
      const attemptRequest: InferenceRequest = { ...request, modelId };
      const startedAt = this.now();
      let target: ResolvedInferenceTarget | undefined;
      try {
        target = await this.resolveInferenceTarget({
          agentId: context.agentId,
          modelId,
          tenantId: context.tenantId,
          userId: context.userId,
          request: attemptRequest,
          ...(context.explicitCredentialScope === undefined
            ? {}
            : { explicitCredentialScope: context.explicitCredentialScope })
        });
        if (index > 0 && !this.fallbackAllowed(attempts[0] as string, target, policy)) {
          continue;
        }
        await this.deps.usage.admit({
          tenantId: context.tenantId,
          userId: context.userId,
          providerId: target.providerConfig.id,
          policy
        });
        const resolvedTarget = target;
        const response = await this.runWithBreaker(resolvedTarget.providerConfig.id, () =>
          resolvedTarget.provider.generate(
            this.applyLimits(attemptRequest, resolvedTarget.model, policy),
            {
              model: resolvedTarget.model,
              credential: resolvedTarget.credential,
              timeoutMs: this.deps.defaults.timeoutMs,
              ...(context.signal === undefined ? {} : { signal: context.signal })
            }
          )
        );
        const finalized = this.finalize(
          response,
          resolvedTarget,
          request.requestId,
          policy,
          fallbackFrom
        );
        await this.record(
          finalized,
          resolvedTarget,
          context,
          "succeeded",
          null,
          startedAt,
          fallbackFrom
        );
        return finalized;
      } catch (error) {
        const normalized = toInferenceError(error, {
          providerId: target?.providerConfig.id ?? "unresolved",
          modelId,
          secrets: secretsOf(target)
        });
        lastError = normalized;
        await this.recordFailure(
          normalized,
          target,
          modelId,
          context,
          startedAt,
          fallbackFrom,
          request.requestId
        );
        // Only provider-side, retryable failures may move to a fallback. Policy rejections
        // (budget, capability, local-only, credential) never do.
        if (!normalized.retryable || context.signal?.aborted === true) throw normalized;
        fallbackFrom ??= target?.providerConfig.id ?? normalized.providerId;
      }
    }
    throw lastError ?? new InferenceError("MODEL_UNAVAILABLE", { modelId: primaryModelId });
  }

  /**
   * Streaming variant. Same resolution, admission, and recording; no mid-stream fallback (once
   * tokens have reached the client, switching models would splice two models' output together).
   * Native streaming is used only when the catalog declares the model streaming-capable; anything
   * else is adapted from generate() so callers always get the same chunk sequence.
   */
  async *stream(
    request: InferenceRequest,
    context: InferenceCallContext
  ): AsyncIterable<InferenceChunk> {
    const policy = await this.deps.usage.effectivePolicy({
      tenantId: context.tenantId,
      userId: context.userId
    });
    const startedAt = this.now();
    const modelId = this.resolveModelId(request.modelId);
    const attemptRequest: InferenceRequest = { ...request, modelId };
    let target: ResolvedInferenceTarget | undefined;
    try {
      target = await this.resolveInferenceTarget({
        agentId: context.agentId,
        modelId,
        tenantId: context.tenantId,
        userId: context.userId,
        request: attemptRequest,
        ...(context.explicitCredentialScope === undefined
          ? {}
          : { explicitCredentialScope: context.explicitCredentialScope })
      });
      await this.deps.usage.admit({
        tenantId: context.tenantId,
        userId: context.userId,
        providerId: target.providerConfig.id,
        policy
      });
      const executionContext = {
        model: target.model,
        credential: target.credential,
        timeoutMs: this.deps.defaults.timeoutMs,
        ...(context.signal === undefined ? {} : { signal: context.signal })
      };
      const limited = this.applyLimits(attemptRequest, target.model, policy);
      const chunks =
        target.provider.stream === undefined || target.model.capabilities.streaming !== true
          ? synthesizeStream(target.provider.generate(limited, executionContext))
          : target.provider.stream(limited, executionContext);
      for await (const chunk of chunks) {
        if (chunk.type === "completed") {
          const finalized = this.finalize(
            chunk.response,
            target,
            request.requestId,
            policy,
            undefined
          );
          await this.record(finalized, target, context, "succeeded", null, startedAt, undefined);
          yield { type: "completed", response: finalized };
          return;
        }
        yield chunk;
      }
      throw new InferenceError("INVALID_PROVIDER_RESPONSE", {
        providerId: target.providerConfig.id,
        modelId,
        diagnostic: "Stream ended without completion."
      });
    } catch (error) {
      const normalized = toInferenceError(error, {
        providerId: target?.providerConfig.id ?? "unresolved",
        modelId,
        secrets: secretsOf(target)
      });
      await this.recordFailure(
        normalized,
        target,
        modelId,
        context,
        startedAt,
        undefined,
        request.requestId
      );
      yield {
        type: "error",
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable
      };
    }
  }

  /** Provider health for one caller's effective credential - independent of every other provider. */
  async checkHealth(input: {
    providerId: string;
    tenantId: string | null;
    userId: string | null;
    explicitCredentialScope?: Exclude<CredentialScope, "explicit">;
    credential?: ResolvedCredential | null;
    probeModelId?: string;
    signal?: AbortSignal;
  }): Promise<ProviderHealth> {
    const registered = this.deps.registry.get(input.providerId);
    const checkedAt = new Date(this.now()).toISOString();
    if (registered === undefined) {
      return {
        providerId: input.providerId,
        status: "MISCONFIGURED",
        checkedAt,
        errorCode: "PROVIDER_MISCONFIGURED"
      };
    }
    const credential =
      input.credential !== undefined
        ? input.credential
        : await this.deps.credentials.resolve({
            provider: registered.config,
            tenantId: input.tenantId,
            userId: input.userId,
            ...(input.explicitCredentialScope === undefined
              ? {}
              : { explicitScope: input.explicitCredentialScope })
          });
    return registered.provider.health({
      credential,
      timeoutMs: Math.min(this.deps.defaults.timeoutMs, 15_000),
      ...(input.probeModelId === undefined ? {} : { probeModelId: input.probeModelId }),
      ...(input.signal === undefined ? {} : { signal: input.signal })
    });
  }

  private fallbackCandidates(primaryModelId: string, policy: EffectiveUsagePolicy): string[] {
    if (policy.fallbackPolicy === "NONE") return [];
    return policy.fallbackModelIds.filter(
      (id, index, all) => id !== primaryModelId && all.indexOf(id) === index
    );
  }

  private fallbackAllowed(
    primaryModelId: string,
    candidate: ResolvedInferenceTarget,
    policy: EffectiveUsagePolicy
  ): boolean {
    const primary = this.deps.resolveModel(primaryModelId);
    if (primary === null) return false;
    const sameProvider = primary.providerId === candidate.providerConfig.id;
    if (policy.fallbackPolicy === "SAME_PROVIDER") return sameProvider;
    if (policy.fallbackPolicy === "APPROVED_PROVIDERS") {
      return sameProvider || policy.approvedProviderIds.includes(candidate.providerConfig.id);
    }
    return false;
  }

  private applyLimits(
    request: InferenceRequest,
    model: ModelDefinition,
    policy: EffectiveUsagePolicy
  ): InferenceRequest {
    const ceilings = [
      request.generation?.maxOutputTokens,
      model.maxOutputTokens,
      policy.maxTokensPerRequest ?? undefined,
      this.deps.defaults.maxOutputTokens
    ].filter((value): value is number => typeof value === "number" && value > 0);
    const { metadata: _metadata, ...forwarded } = request;
    void _metadata;
    return {
      ...forwarded,
      generation: { ...request.generation, maxOutputTokens: Math.min(...ceilings) }
    };
  }

  private finalize(
    response: InferenceResponse,
    target: ResolvedInferenceTarget,
    requestId: string,
    policy: EffectiveUsagePolicy,
    fallbackFrom: string | undefined
  ): InferenceResponse {
    const cost = estimateCost(response.usage, target.model.pricing, policy.currency);
    return {
      ...response,
      requestId,
      providerId: target.providerConfig.id,
      modelId: target.model.id,
      ...(cost === undefined ? {} : { cost }),
      ...(fallbackFrom === undefined ? {} : { fallbackFromProviderId: fallbackFrom })
    };
  }

  private async runWithBreaker<T>(providerId: string, call: () => Promise<T>): Promise<T> {
    // Only provider-side faults count toward opening the circuit. A rejected key, a budget stop,
    // or an oversized prompt is the caller's problem and must not take the provider offline for
    // everyone else.
    const outcome = await this.breakerFor(providerId).run(async () => {
      try {
        return { ok: true as const, value: await call() };
      } catch (error) {
        if (isInferenceError(error) && error.retryable && error.inferenceCode !== "RATE_LIMITED")
          throw error;
        return { ok: false as const, error };
      }
    });
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }

  private breakerFor(providerId: string): CircuitBreaker {
    let breaker = this.breakers.get(providerId);
    if (breaker === undefined) {
      breaker = createCircuitBreaker({
        name: `inference-provider:${providerId}`,
        failureThreshold: 5,
        resetTimeoutMs: 30_000
      });
      this.breakers.set(providerId, breaker);
    }
    return breaker;
  }

  private async record(
    response: InferenceResponse,
    target: ResolvedInferenceTarget,
    context: InferenceCallContext,
    status: InferenceRunStatus,
    errorCode: string | null,
    startedAt: number,
    fallbackFrom: string | undefined
  ): Promise<void> {
    const latencyMs = response.latency?.totalMs ?? this.now() - startedAt;
    const run: InferenceRunRecord = {
      id: randomUUID(),
      requestId: response.requestId,
      conversationId: context.conversationId ?? null,
      agentId: context.agentId,
      tenantId: context.tenantId,
      userId: context.userId,
      modelId: target.model.id,
      providerId: target.providerConfig.id,
      credentialScope: target.credential?.scope ?? null,
      executionTarget: target.executionTarget,
      inputTokens: response.usage?.inputTokens ?? null,
      outputTokens: response.usage?.outputTokens ?? null,
      cachedInputTokens: response.usage?.cachedInputTokens ?? null,
      estimatedCost: response.cost?.estimatedAmount ?? null,
      currency: response.cost?.currency ?? null,
      latencyMs,
      firstTokenMs: response.latency?.firstTokenMs ?? null,
      status,
      errorCode,
      fallbackFromProviderId: fallbackFrom ?? null,
      createdAt: new Date(this.now()).toISOString()
    };
    await this.persist(run);
  }

  private async recordFailure(
    error: InferenceError,
    target: ResolvedInferenceTarget | undefined,
    modelId: string,
    context: InferenceCallContext,
    startedAt: number,
    fallbackFrom: string | undefined,
    requestId: string
  ): Promise<void> {
    const rejected =
      error.inferenceCode === "BUDGET_EXCEEDED" ||
      error.inferenceCode === "CAPABILITY_UNSUPPORTED" ||
      error.inferenceCode === "LOCAL_EXECUTION_REQUIRED" ||
      error.inferenceCode === "CREDENTIAL_MISSING" ||
      error.inferenceCode === "ENDPOINT_FORBIDDEN" ||
      (error.inferenceCode === "RATE_LIMITED" && error.status === undefined);
    await this.persist({
      id: randomUUID(),
      requestId,
      conversationId: context.conversationId ?? null,
      agentId: context.agentId,
      tenantId: context.tenantId,
      userId: context.userId,
      modelId: target?.model.id ?? modelId,
      providerId: target?.providerConfig.id ?? error.providerId ?? "unresolved",
      credentialScope: target?.credential?.scope ?? null,
      executionTarget:
        target?.executionTarget ??
        this.deps.resolveModel(modelId)?.executionTarget ??
        "remote-inference",
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      estimatedCost: null,
      currency: null,
      latencyMs: this.now() - startedAt,
      firstTokenMs: null,
      status: rejected ? "rejected" : "failed",
      errorCode: error.code,
      fallbackFromProviderId: fallbackFrom ?? null,
      createdAt: new Date(this.now()).toISOString()
    });
    this.deps.log?.(
      "inference.request_failed",
      redactRecord(
        {
          providerId: target?.providerConfig.id ?? error.providerId ?? null,
          modelId,
          code: error.code,
          status: error.status ?? null,
          diagnostic: error.diagnostic ?? null
        },
        secretsOf(target)
      )
    );
  }

  private async persist(run: InferenceRunRecord): Promise<void> {
    this.deps.metrics?.recordInference({
      provider: run.providerId,
      model: run.modelId,
      executionTarget: run.executionTarget,
      status: run.status,
      errorCode: run.errorCode,
      latencyMs: run.latencyMs,
      firstTokenMs: run.firstTokenMs,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      estimatedCost: run.estimatedCost,
      currency: run.currency,
      fallback: run.fallbackFromProviderId !== null
    });
    try {
      await this.deps.runs.insert(run);
    } catch (error) {
      // Telemetry must never fail the user's request; the failure itself is logged (redacted).
      this.deps.log?.("inference.run_record_failed", {
        requestId: run.requestId,
        reason: error instanceof Error ? error.name : "unknown"
      });
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}

function secretsOf(target: ResolvedInferenceTarget | undefined): string[] {
  const credential = target?.credential ?? null;
  return credential === null ? [] : [credential.secret.reveal()];
}

async function* synthesizeStream(
  response: Promise<InferenceResponse>
): AsyncIterable<InferenceChunk> {
  const resolved = await response;
  if (resolved.output.text !== "") yield { type: "text-delta", text: resolved.output.text };
  for (const [index, call] of resolved.output.toolCalls.entries()) {
    yield {
      type: "tool-call-delta",
      index,
      id: call.id,
      name: call.name,
      argumentsDelta: JSON.stringify(call.arguments)
    };
  }
  if (resolved.usage !== undefined) yield { type: "usage", usage: resolved.usage };
  yield { type: "completed", response: resolved };
}
