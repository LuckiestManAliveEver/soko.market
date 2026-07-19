import type {
  RuntimeModelCompletionResult,
  RuntimeModelDiagnostic,
  RuntimeModelPrompt,
  RuntimeModelProvider
} from "@soko/shared-types";
import { buildLlamaPrompt } from "./local-model.js";

export interface OllamaRuntimeModelOptions {
  endpoint: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

interface OllamaChatResponse {
  error?: unknown;
  message?: {
    content?: unknown;
  };
  model?: unknown;
}

interface OllamaTagsResponse {
  models?: Array<{
    model?: unknown;
    name?: unknown;
  }>;
}

export function createOllamaRuntimeModelProvider(
  options: OllamaRuntimeModelOptions
): RuntimeModelProvider {
  const endpoint = normalizeBaseEndpoint(options.endpoint);
  const model = options.model.trim();
  const timeoutMs = options.timeoutMs ?? 30_000;

  if (model.length === 0) {
    throw new Error("LOCAL_MODEL_MODEL is required when LOCAL_MODEL_PROVIDER=ollama.");
  }

  const complete = async (prompt: RuntimeModelPrompt): Promise<RuntimeModelCompletionResult> => {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${endpoint}/api/chat`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: buildLlamaPrompt(prompt)
            }
          ],
          format: "json",
          stream: false,
          options: {
            temperature: options.temperature ?? 0,
            num_predict: options.maxTokens ?? 256
          }
        }),
        signal: controller.signal
      });
      const body = (await readJson(response)) as OllamaChatResponse;

      if (!response.ok) {
        return completionResult({
          status: "unavailable",
          startedAt,
          errorCode: normalizeOllamaError(body, response.status),
          endpoint,
          model
        });
      }

      const content = typeof body.message?.content === "string" ? body.message.content.trim() : "";
      return completionResult({
        status: content.length > 0 ? "available" : "error",
        outputText: content.length > 0 ? normalizeOllamaModelText(content) : null,
        startedAt,
        errorCode: content.length > 0 ? null : "MODEL_EMPTY_RESPONSE",
        endpoint,
        model
      });
    } catch (error) {
      const aborted =
        error instanceof DOMException
          ? error.name === "AbortError"
          : error instanceof Error && error.name === "AbortError";
      return completionResult({
        status: aborted ? "timeout" : "error",
        startedAt,
        errorCode: aborted ? "MODEL_PROVIDER_TIMEOUT" : "MODEL_PROVIDER_UNREACHABLE",
        endpoint,
        model
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    name: "ollama",
    complete,
    async diagnose(runInference = false): Promise<RuntimeModelDiagnostic> {
      const checkedAt = new Date().toISOString();
      try {
        const response = await fetchWithTimeout(`${endpoint}/api/tags`, timeoutMs);
        const body = (await readJson(response)) as OllamaTagsResponse;
        if (!response.ok) {
          return diagnostic("unavailable", false, null, `http_${response.status}`, checkedAt);
        }
        const installedModels = (body.models ?? []).flatMap((candidate) =>
          [candidate.model, candidate.name].filter(
            (value): value is string => typeof value === "string"
          )
        );
        const modelAvailable = installedModels.some(
          (candidate) => candidate === model || candidate === `${model}:latest`
        );
        if (!modelAvailable) {
          return diagnostic("unavailable", false, null, "MODEL_NOT_INSTALLED", checkedAt);
        }
        if (!runInference) {
          return diagnostic("ready", true, null, null, checkedAt);
        }
        const result = await complete(diagnosticPrompt());
        return diagnostic(
          result.status === "available" ? "ready" : "unavailable",
          true,
          result.status === "available",
          result.errorCode,
          checkedAt
        );
      } catch (error) {
        const aborted =
          error instanceof DOMException
            ? error.name === "AbortError"
            : error instanceof Error && error.name === "AbortError";
        return diagnostic(
          "unavailable",
          null,
          null,
          aborted ? "MODEL_PROVIDER_TIMEOUT" : "MODEL_PROVIDER_UNREACHABLE",
          checkedAt
        );
      }
    }
  };

  function diagnostic(
    status: RuntimeModelDiagnostic["status"],
    modelAvailable: boolean | null,
    inferenceAvailable: boolean | null,
    errorCode: string | null,
    checkedAt: string
  ): RuntimeModelDiagnostic {
    return {
      provider: "ollama",
      status,
      model,
      modelAvailable,
      inferenceAvailable,
      errorCode,
      checkedAt
    };
  }
}

function normalizeBaseEndpoint(endpoint: string): string {
  const value = endpoint.trim().replace(/\/+$/, "");
  if (value.length === 0) {
    throw new Error("LOCAL_MODEL_ENDPOINT is required when local inference is enabled.");
  }
  return value.endsWith("/api") ? value.slice(0, -4) : value;
}

export function normalizeOllamaModelText(content: string): string {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) return content;
    if (parsed.type === "tool" || parsed.type === "clarification" || parsed.type === "response") {
      if (
        (parsed.type === "response" || parsed.type === "clarification") &&
        typeof parsed.message !== "string"
      ) {
        const message = firstString(parsed, ["response", "content", "text", "answer"]);
        return message === null ? content : JSON.stringify({ ...parsed, message });
      }
      return content;
    }
    if (typeof parsed.toolName === "string") {
      return JSON.stringify({
        ...parsed,
        type: "tool",
        input: isRecord(parsed.input) ? parsed.input : {},
        reason:
          firstString(parsed, ["reason", "message", "response"]) ??
          "The local model selected this tool."
      });
    }
    const message = firstString(parsed, ["message", "response", "content", "text", "answer"]);
    return message === null
      ? content
      : JSON.stringify({
          type: "response",
          message
        });
  } catch {
    return JSON.stringify({
      type: "response",
      message: content
    });
  }
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOllamaError(body: OllamaChatResponse, status: number): string {
  if (
    status === 404 &&
    typeof body.error === "string" &&
    body.error.toLowerCase().includes("model")
  ) {
    return "MODEL_NOT_INSTALLED";
  }
  return `http_${status}`;
}

function completionResult(input: {
  status: RuntimeModelCompletionResult["status"];
  startedAt: number;
  outputText?: string | null;
  errorCode: string | null;
  endpoint: string;
  model: string;
}): RuntimeModelCompletionResult {
  return {
    provider: "ollama",
    status: input.status,
    outputText: input.outputText ?? null,
    durationMs: Date.now() - input.startedAt,
    errorCode: input.errorCode,
    metadata: {
      endpointHost: safeHost(input.endpoint),
      model: input.model
    }
  };
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "invalid";
  }
}

function diagnosticPrompt(): RuntimeModelPrompt {
  return {
    allowedTools: [],
    context: {
      activeLogisticsCount: 0,
      betaAccessStatus: "not_invited",
      betaReadinessStatus: "blocked",
      businessId: "00000000-0000-0000-0000-000000000000",
      complianceExportCount: 0,
      crashFreeSessionRate: 1,
      customerCount: 0,
      deviceTrustLevel: "unknown",
      importJobCount: 0,
      invoiceCount: 0,
      knowledgeFactCount: 0,
      launchReadinessStatus: "blocked",
      logisticsCount: 0,
      lowStockCount: 0,
      openInvoiceCount: 0,
      openLaunchIncidentCount: 0,
      openSupportTicketCount: 0,
      outstandingDebtTotal: 0,
      paymentCount: 0,
      productCount: 0,
      publicLaunchStatus: "closed",
      role: "owner",
      scheduledDeletionCount: 0,
      supplierCount: 0,
      unreadNotificationCount: 0,
      userId: "00000000-0000-0000-0000-000000000000",
      verificationTier: "unverified"
    },
    message: "Reply with a short greeting.",
    schemaVersion: "cp11-runtime-model-v1"
  };
}
