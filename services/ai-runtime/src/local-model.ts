import type {
  RuntimeModelCompletionResult,
  RuntimeModelPrompt,
  RuntimeModelProvider
} from "@soko/shared-types";

export interface LlamaCppRuntimeModelOptions {
  endpoint: string;
  maxTokens?: number;
  modelProfile?: string;
  temperature?: number;
  timeoutMs?: number;
}

interface LlamaCompletionResponse {
  content?: unknown;
  generation_settings?: unknown;
  timings?: unknown;
}

export function createLlamaCppRuntimeModelProvider(
  options: LlamaCppRuntimeModelOptions
): RuntimeModelProvider {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const endpoint = normalizeEndpoint(options.endpoint);

  return {
    name: "llama.cpp",
    async complete(prompt: RuntimeModelPrompt): Promise<RuntimeModelCompletionResult> {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            prompt: buildLlamaPrompt(prompt),
            temperature: options.temperature ?? 0,
            n_predict: options.maxTokens ?? 256,
            stream: false
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          return completionResult({
            status: "unavailable",
            startedAt,
            errorCode: `http_${response.status}`,
            metadata: {
              endpointHost: safeHost(endpoint),
              modelProfile: options.modelProfile ?? null
            }
          });
        }

        const body = (await response.json()) as LlamaCompletionResponse;
        const content = typeof body.content === "string" ? body.content.trim() : "";

        return completionResult({
          status: content.length > 0 ? "available" : "error",
          outputText: content.length > 0 ? content : null,
          startedAt,
          errorCode: content.length > 0 ? null : "empty_completion",
          metadata: {
            endpointHost: safeHost(endpoint),
            modelProfile: options.modelProfile ?? null
          }
        });
      } catch (error) {
        const aborted =
          error instanceof DOMException
            ? error.name === "AbortError"
            : error instanceof Error && error.name === "AbortError";

        return completionResult({
          status: aborted ? "timeout" : "error",
          startedAt,
          errorCode: aborted ? "timeout" : "completion_failed",
          metadata: {
            endpointHost: safeHost(endpoint),
            modelProfile: options.modelProfile ?? null
          }
        });
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

export function buildLlamaPrompt(prompt: RuntimeModelPrompt): string {
  const tools = prompt.allowedTools.join(", ");
  const history = (prompt.conversationHistory ?? [])
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${message.content}`)
    .join("\n");

  return [
    "You are the local model behind the Soko runtime.",
    "Return only JSON. Do not include markdown.",
    'Allowed shapes: {"type":"tool","toolName":"products.list","input":{},"reason":"..."}',
    'or {"type":"clarification","message":"..."}',
    'or {"type":"response","message":"..."}.',
    `Allowed tools: ${tools}.`,
    ...(prompt.context === undefined
      ? []
      : [
          `Context: role=${prompt.context.role}; products=${prompt.context.productCount}; customers=${prompt.context.customerCount}; invoices=${prompt.context.invoiceCount}; openInvoices=${prompt.context.openInvoiceCount}; imports=${prompt.context.importJobCount}; logistics=${prompt.context.logisticsCount}; activeLogistics=${prompt.context.activeLogisticsCount}; lowStock=${prompt.context.lowStockCount}; outstandingDebt=${prompt.context.outstandingDebtTotal}; unreadNotifications=${prompt.context.unreadNotificationCount}; knowledgeFacts=${prompt.context.knowledgeFactCount}.`
        ]),
    ...(history.length === 0 ? [] : [`Recent conversation (oldest first):\n${history}`]),
    `User message: ${JSON.stringify(prompt.message)}`
  ].join("\n");
}

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();

  if (trimmed.endsWith("/completion")) {
    return trimmed;
  }

  return `${trimmed.replace(/\/+$/, "")}/completion`;
}

function completionResult(input: {
  status: RuntimeModelCompletionResult["status"];
  startedAt: number;
  outputText?: string | null;
  errorCode: string | null;
  metadata: RuntimeModelCompletionResult["metadata"];
}): RuntimeModelCompletionResult {
  return {
    provider: "llama.cpp",
    status: input.status,
    outputText: input.outputText ?? null,
    durationMs: Date.now() - input.startedAt,
    errorCode: input.errorCode,
    metadata: input.metadata
  };
}

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "invalid";
  }
}
