import type {
  BrowserEngineCapabilities,
  BrowserGenerationRequest,
  BrowserGenerationResult,
  BrowserInferenceErrorCode,
  BrowserModelConfig,
  BrowserModelDescriptor,
  BrowserModelProgress
} from "./browser-inference-types";

export type BrowserModelWorkerRequest =
  | { type: "INITIALIZE"; requestId: string; config: BrowserModelConfig }
  | { type: "LOAD_MODEL"; requestId: string; model: BrowserModelDescriptor }
  | { type: "COUNT_TOKENS"; requestId: string; messages: BrowserGenerationRequest["messages"] }
  | { type: "GENERATE"; requestId: string; request: BrowserGenerationRequest }
  | { type: "CANCEL"; requestId: string; targetRequestId: string }
  | { type: "UNLOAD"; requestId: string }
  | { type: "HEALTH"; requestId: string };

export type BrowserModelWorkerResponse =
  | { type: "READY"; requestId: string; capabilities: BrowserEngineCapabilities }
  | { type: "MODEL_PROGRESS"; requestId: string; progress: BrowserModelProgress }
  | { type: "MODEL_LOADED"; requestId: string; modelId: string }
  | { type: "TOKEN_COUNT"; requestId: string; tokenCount: number }
  | { type: "TOKEN"; requestId: string; token: string; tokenCount: number }
  | { type: "GENERATION_COMPLETE"; requestId: string; result: BrowserGenerationResult }
  | { type: "CANCELLED"; requestId: string; targetRequestId: string }
  | { type: "UNLOADED"; requestId: string }
  | {
      type: "HEALTH";
      requestId: string;
      status: "idle" | "ready" | "generating" | "error";
    }
  | {
      type: "ERROR";
      requestId: string;
      code: BrowserInferenceErrorCode;
      message: string;
    };

export function isBrowserModelWorkerRequest(value: unknown): value is BrowserModelWorkerRequest {
  if (typeof value !== "object" || value === null) return false;
  const message = value as { type?: unknown; requestId?: unknown };
  if (typeof message.requestId !== "string" || message.requestId.length === 0) return false;
  return (
    message.type === "INITIALIZE" ||
    message.type === "LOAD_MODEL" ||
    message.type === "COUNT_TOKENS" ||
    message.type === "GENERATE" ||
    message.type === "CANCEL" ||
    message.type === "UNLOAD" ||
    message.type === "HEALTH"
  );
}

export function isBrowserModelWorkerResponse(value: unknown): value is BrowserModelWorkerResponse {
  if (typeof value !== "object" || value === null) return false;
  const message = value as { type?: unknown; requestId?: unknown };
  if (typeof message.requestId !== "string") return false;
  return [
    "READY",
    "MODEL_PROGRESS",
    "MODEL_LOADED",
    "TOKEN_COUNT",
    "TOKEN",
    "GENERATION_COMPLETE",
    "CANCELLED",
    "UNLOADED",
    "HEALTH",
    "ERROR"
  ].includes(String(message.type));
}
