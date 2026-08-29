import type {
  RuntimeModelCompletionResult,
  RuntimeModelPrompt,
  RuntimeModelProvider
} from "@soko/shared-types";

export interface OpenAiProviderOptions {
  enabled: boolean;
  apiKey: string;
  model: string;
  modelId: string;
  modelAllowlist: string[];
  maxOutputTokens: number;
  monthlyTokenBudget: number;
  timeoutMs: number;
  retryLimit?: number;
  circuitFailureThreshold?: number;
  circuitResetMs?: number;
}

/**
 * Adapter for explicit, deliberately configured OpenAI model bindings. The generic provider
 * registry selects this implementation by model/provider identity after the provider-neutral
 * execution path has resolved; OpenAI is never an execution target or automatic fallback.
 */
export function createOpenAiProvider(
  options: OpenAiProviderOptions
): RuntimeModelProvider | undefined {
  const apiKey = options.apiKey.trim();
  const model = options.model.trim();
  const allowed = new Set(options.modelAllowlist);
  if (
    !options.enabled ||
    apiKey.length === 0 ||
    model.length === 0 ||
    (!allowed.has(options.modelId) && !allowed.has(model))
  ) {
    return undefined;
  }

  let consumedTokenEstimate = 0;
  let consecutiveFailures = 0;
  let circuitOpenedAt = 0;
  const failureThreshold = options.circuitFailureThreshold ?? 3;
  const circuitResetMs = options.circuitResetMs ?? 60_000;

  return {
    name: "openai",
    async complete(prompt): Promise<RuntimeModelCompletionResult> {
      const startedAt = Date.now();
      const promptText = buildCloudPrompt(prompt);
      const estimatedTokens = Math.ceil(promptText.length / 4) + options.maxOutputTokens;
      if (consumedTokenEstimate + estimatedTokens > options.monthlyTokenBudget) {
        return result("unavailable", null, startedAt, "CLOUD_SPENDING_LIMIT_REACHED", model);
      }
      if (circuitOpenedAt > 0 && Date.now() - circuitOpenedAt < circuitResetMs) {
        return result("unavailable", null, startedAt, "CLOUD_CIRCUIT_OPEN", model);
      }

      const attempts = Math.max(1, Math.min(2, (options.retryLimit ?? 1) + 1));
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const completion = await requestOpenAi({
          apiKey,
          model,
          prompt: promptText,
          maxOutputTokens: options.maxOutputTokens,
          timeoutMs: options.timeoutMs,
          startedAt
        });
        if (completion.status === "available") {
          consecutiveFailures = 0;
          circuitOpenedAt = 0;
          consumedTokenEstimate += estimatedTokens;
          return completion;
        }
        consecutiveFailures += 1;
        if (consecutiveFailures >= failureThreshold) circuitOpenedAt = Date.now();
        if (!isRetryable(completion.errorCode) || attempt === attempts - 1) return completion;
      }
      return result("error", null, startedAt, "CLOUD_REQUEST_FAILED", model);
    },
    async diagnose() {
      return {
        provider: "openai",
        status: "ready",
        model,
        modelAvailable: true,
        inferenceAvailable: null,
        errorCode: null,
        checkedAt: new Date().toISOString()
      };
    }
  };
}

async function requestOpenAi(input: {
  apiKey: string;
  model: string;
  prompt: string;
  maxOutputTokens: number;
  timeoutMs: number;
  startedAt: number;
}): Promise<RuntimeModelCompletionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: input.model,
        input: input.prompt,
        max_output_tokens: input.maxOutputTokens,
        store: false
      }),
      signal: controller.signal
    });
    const body = (await response.json().catch(() => ({}))) as {
      output_text?: unknown;
      output?: unknown;
      error?: { code?: unknown };
    };
    if (!response.ok) {
      const providerCode =
        typeof body.error?.code === "string" ? body.error.code : `HTTP_${response.status}`;
      return result(
        "unavailable",
        null,
        input.startedAt,
        `CLOUD_${providerCode}`.toUpperCase(),
        input.model
      );
    }
    const text = readOutputText(body);
    return result(
      text.length > 0 ? "available" : "error",
      text.length > 0 ? text : null,
      input.startedAt,
      text.length > 0 ? null : "CLOUD_EMPTY_COMPLETION",
      input.model
    );
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return result(
      aborted ? "timeout" : "error",
      null,
      input.startedAt,
      aborted ? "CLOUD_TIMEOUT" : "CLOUD_REQUEST_FAILED",
      input.model
    );
  } finally {
    clearTimeout(timeout);
  }
}

function readOutputText(body: { output_text?: unknown; output?: unknown }): string {
  if (typeof body.output_text === "string") return body.output_text.trim();
  if (!Array.isArray(body.output)) return "";

  const text: string[] = [];
  for (const item of body.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") {
        text.push(content.text);
      }
    }
  }
  return text.join("").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function buildCloudPrompt(prompt: RuntimeModelPrompt): string {
  const history = (prompt.conversationHistory ?? [])
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
  return [
    "Return only a Soko runtime JSON action. Do not include markdown.",
    `Allowed tools: ${prompt.allowedTools.join(", ")}.`,
    ...(history.length === 0 ? [] : [`Recent conversation:\n${history}`]),
    `User message: ${JSON.stringify(prompt.message)}`
  ].join("\n");
}

function result(
  status: RuntimeModelCompletionResult["status"],
  outputText: string | null,
  startedAt: number,
  errorCode: string | null,
  model: string
): RuntimeModelCompletionResult {
  return {
    provider: "openai",
    status,
    outputText,
    durationMs: Date.now() - startedAt,
    errorCode,
    metadata: { endpointHost: "api.openai.com", model, runtime: "openai" }
  };
}

function isRetryable(errorCode: string | null): boolean {
  return (
    errorCode === "CLOUD_TIMEOUT" ||
    errorCode === "CLOUD_REQUEST_FAILED" ||
    errorCode === "CLOUD_HTTP_429" ||
    errorCode?.startsWith("CLOUD_HTTP_5") === true
  );
}
