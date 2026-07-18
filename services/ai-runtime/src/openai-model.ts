import type {
  RuntimeModelCompletionResult,
  RuntimeModelPrompt,
  RuntimeModelProvider
} from "@soko/shared-types";
import { buildLlamaPrompt } from "./local-model.js";

export interface OpenAiRuntimeModelOptions {
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  timeoutMs?: number;
}

interface OpenAiResponseBody {
  error?: {
    code?: unknown;
    message?: unknown;
    type?: unknown;
  };
  output?: unknown;
  output_text?: unknown;
}

export function createOpenAiRuntimeModelProvider(
  options: OpenAiRuntimeModelOptions
): RuntimeModelProvider {
  const apiKey = options.apiKey.trim();
  const model = options.model.trim();
  const timeoutMs = options.timeoutMs ?? 15_000;

  if (apiKey.length === 0) {
    throw new Error("OpenAI API key is required.");
  }
  if (model.length === 0) {
    throw new Error("OpenAI model is required.");
  }

  return {
    name: "openai",
    async complete(prompt: RuntimeModelPrompt): Promise<RuntimeModelCompletionResult> {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model,
            input: buildLlamaPrompt(prompt),
            max_output_tokens: options.maxOutputTokens ?? 256,
            store: false,
            ...(options.reasoningEffort === undefined
              ? {}
              : { reasoning: { effort: options.reasoningEffort } })
          }),
          signal: controller.signal
        });
        const body = (await readResponseBody(response)) as OpenAiResponseBody;

        if (!response.ok) {
          return completionResult({
            status: "unavailable",
            outputText: null,
            startedAt,
            errorCode: normalizeOpenAiError(body, response.status),
            model
          });
        }

        const outputText = readOutputText(body);
        return completionResult({
          status: outputText.length > 0 ? "available" : "error",
          outputText: outputText.length > 0 ? outputText : null,
          startedAt,
          errorCode: outputText.length > 0 ? null : "empty_completion",
          model
        });
      } catch (error) {
        const aborted =
          error instanceof DOMException
            ? error.name === "AbortError"
            : error instanceof Error && error.name === "AbortError";
        return completionResult({
          status: aborted ? "timeout" : "error",
          outputText: null,
          startedAt,
          errorCode: aborted ? "timeout" : "completion_failed",
          model
        });
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

function readOutputText(body: OpenAiResponseBody): string {
  if (typeof body.output_text === "string") {
    return body.output_text.trim();
  }
  if (!Array.isArray(body.output)) {
    return "";
  }

  const text: string[] = [];
  for (const item of body.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      continue;
    }
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

async function readResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function normalizeOpenAiError(body: OpenAiResponseBody, status: number): string {
  const code = body.error?.code;
  if (typeof code === "string" && code.trim().length > 0) {
    return `openai_${code
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")}`;
  }
  return `http_${status}`;
}

function completionResult(input: {
  status: RuntimeModelCompletionResult["status"];
  outputText: string | null;
  startedAt: number;
  errorCode: string | null;
  model: string;
}): RuntimeModelCompletionResult {
  return {
    provider: "openai",
    status: input.status,
    outputText: input.outputText,
    durationMs: Date.now() - input.startedAt,
    errorCode: input.errorCode,
    metadata: {
      endpointHost: "api.openai.com",
      model: input.model
    }
  };
}
