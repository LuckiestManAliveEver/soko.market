import type { OfflineAssistantReply } from "../webllm-runtime";

/**
 * Client-side mirror of the server's canonical InferenceResponse
 * (services/api/src/inference/providers/contract.ts), so a reply produced on this device by the
 * opt-in offline runtime reads the same as a reply from a remote provider. Local inference never
 * goes through the server router - the router refuses browser-local models outright - and nothing
 * here sends the prompt or the reply anywhere.
 */
export interface LocalInferenceResponse {
  requestId: string;
  providerId: "local";
  modelId: string;
  output: { text: string; toolCalls: [] };
  finishReason: "stop";
  latency: { totalMs: number };
  executionTarget: "browser-local";
}

export function normalizeLocalInferenceReply(input: {
  requestId: string;
  reply: OfflineAssistantReply;
  totalMs: number;
}): LocalInferenceResponse {
  return {
    requestId: input.requestId,
    providerId: "local",
    modelId: input.reply.modelId,
    output: { text: input.reply.reply, toolCalls: [] },
    finishReason: "stop",
    latency: { totalMs: Math.max(0, Math.round(input.totalMs)) },
    executionTarget: "browser-local"
  };
}
