/**
 * Wire contract mirrored from services/api/src/inference/model-runtime.ts
 * (BackendInferenceClient) and services/ai-runtime/src/app.ts. Keep these two
 * services and this Worker in agreement — the API client validates every one
 * of these shapes and rejects anything else as INVALID_INFERENCE_RESPONSE.
 */

export interface Env {
  AI: Ai;
  INFERENCE_SERVICE_TOKEN: string;
  CLOUDFLARE_AI_MODEL?: string;
}

export interface InferenceErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface ModelListEntry {
  id: string;
  providerModelId: string;
  available: boolean;
  digest: string | null;
}

export interface ReadyResponseBody {
  ok: true;
  engine: "cloudflare-workers-ai";
  models: ModelListEntry[];
}

export interface ProbeResponseBody {
  ok: true;
  modelId: string;
  providerModelId: string;
  engine: "cloudflare-workers-ai";
  latencyMs: number;
}

export interface ChatCompletionRequestBody {
  modelId: string;
  prompt: string;
  maxTokens: number;
  temperature: number;
  jsonOutput: boolean;
}

export interface ChatCompletionResponseBody {
  ok: true;
  id: string;
  modelId: string;
  providerModelId: string;
  engine: "cloudflare-workers-ai";
  text: string;
  latencyMs: number;
  usage: { promptTokens: number | null; completionTokens: number | null };
  finishReason: string | null;
}
