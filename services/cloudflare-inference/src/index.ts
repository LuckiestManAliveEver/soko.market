import { isAuthorized } from "./auth.js";
import {
  errorResponse,
  jsonResponse,
  InferenceServiceError,
  classifyProviderError
} from "./errors.js";
import {
  generateCompletion,
  listCloudflareModels,
  parseCompletionRequest,
  probeModel
} from "./inference.js";
import type { Env, ReadyResponseBody } from "./types.js";

const PROBE_PATH = /^\/v1\/models\/([^/]+)\/probe$/u;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (env.INFERENCE_SERVICE_TOKEN === undefined || env.INFERENCE_SERVICE_TOKEN.length < 32) {
      return errorResponse(
        500,
        "MODEL_NOT_CONFIGURED",
        "INFERENCE_SERVICE_TOKEN is not configured on this Worker.",
        false
      );
    }

    const authorized = await isAuthorized(
      request.headers.get("authorization"),
      env.INFERENCE_SERVICE_TOKEN
    );
    if (!authorized) {
      return errorResponse(401, "INFERENCE_AUTHENTICATION_FAILED", "Authentication failed.", false);
    }

    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/health/ready") {
        return jsonResponse(readyBody(env), 200);
      }

      if (request.method === "GET" && url.pathname === "/v1/models") {
        const body: ReadyResponseBody = readyBody(env);
        return jsonResponse({ ok: true, engine: body.engine, models: body.models }, 200);
      }

      const probeMatch = request.method === "POST" ? PROBE_PATH.exec(url.pathname) : null;
      if (probeMatch !== null) {
        const modelId = decodeURIComponent(probeMatch[1] ?? "");
        const result = await probeModel(env, modelId);
        return jsonResponse(result, 200);
      }

      if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
        const payload = await request.json().catch(() => null);
        const parsed = parseCompletionRequest(payload);
        const result = await generateCompletion(env, parsed);
        return jsonResponse(result, 200);
      }

      return errorResponse(404, "MODEL_NOT_CONFIGURED", "Unknown inference route.", false);
    } catch (error) {
      const serviceError =
        error instanceof InferenceServiceError ? error : classifyProviderError(error);
      return errorResponse(
        serviceError.status,
        serviceError.code,
        serviceError.message,
        serviceError.retryable
      );
    }
  }
} satisfies ExportedHandler<Env>;

function readyBody(env: Env): ReadyResponseBody {
  const bindingConfigured = typeof env.AI === "object" && env.AI !== null;
  const models = listCloudflareModels().map((model) => ({
    ...model,
    available: model.available && bindingConfigured
  }));
  return { ok: true, engine: "cloudflare-workers-ai", models };
}
