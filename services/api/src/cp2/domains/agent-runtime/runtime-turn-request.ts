import type { ClientInferenceCompletion, RuntimeRecallEscalation } from "@soko/shared-types";

import { Cp2Error } from "../../cp2-error.js";
import { parseNumber, parseRequestBody, parseString } from "../../route-helpers.js";
import type { RuntimeTurnBody } from "./routes.js";

export function parseRuntimeTurnBody(body: RuntimeTurnBody | null | undefined): {
  runtimeSessionId?: string;
  message: string;
  confirmationToken?: string;
  recallEscalation?: RuntimeRecallEscalation;
  clientInferenceCompletion?: ClientInferenceCompletion;
} {
  const record = parseRequestBody(body);
  const runtimeSessionId =
    record.runtimeSessionId === undefined || record.runtimeSessionId === null
      ? undefined
      : parseString(record.runtimeSessionId, "runtimeSessionId");
  const confirmationToken =
    record.confirmationToken === undefined || record.confirmationToken === null
      ? undefined
      : parseString(record.confirmationToken, "confirmationToken");
  const recallEscalation =
    record.recallEscalation === undefined || record.recallEscalation === null
      ? undefined
      : parseRuntimeRecallEscalation(record.recallEscalation);
  const clientInferenceCompletion =
    record.clientInferenceCompletion === undefined || record.clientInferenceCompletion === null
      ? undefined
      : parseClientInferenceCompletion(record.clientInferenceCompletion);
  const parsed = {
    message: parseString(record.message, "message")
  };
  return {
    ...parsed,
    ...(runtimeSessionId === undefined ? {} : { runtimeSessionId }),
    ...(confirmationToken === undefined ? {} : { confirmationToken }),
    ...(recallEscalation === undefined ? {} : { recallEscalation }),
    ...(clientInferenceCompletion === undefined ? {} : { clientInferenceCompletion })
  };
}

function parseClientInferenceCompletion(value: unknown): ClientInferenceCompletion {
  const record = parseRequestBody(value);
  const runtime = parseString(record.runtime, "clientInferenceCompletion.runtime");
  if (
    runtime !== "browser-webgpu" &&
    runtime !== "browser-wasm" &&
    runtime !== "native-llama-cpp"
  ) {
    throw new Cp2Error(
      400,
      "client_inference_runtime_invalid",
      "The client inference runtime is not supported."
    );
  }
  const outputText = parseString(record.outputText, "clientInferenceCompletion.outputText");
  if (outputText.length > 20_000) {
    throw new Cp2Error(
      400,
      "client_inference_output_too_large",
      "The client inference output is too large."
    );
  }
  const durationMs = parseNumber(record.durationMs, "clientInferenceCompletion.durationMs");
  if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 120_000) {
    throw new Cp2Error(
      400,
      "client_inference_duration_invalid",
      "The client inference duration is invalid."
    );
  }
  const installationId =
    record.installationId === undefined || record.installationId === null
      ? undefined
      : parseString(record.installationId, "clientInferenceCompletion.installationId");
  const promptTokens = parseOptionalClientTokenCount(
    record.promptTokens,
    "clientInferenceCompletion.promptTokens"
  );
  const completionTokens = parseOptionalClientTokenCount(
    record.completionTokens,
    "clientInferenceCompletion.completionTokens"
  );
  return {
    requestId: parseString(record.requestId, "clientInferenceCompletion.requestId"),
    runtime,
    modelId: parseString(record.modelId, "clientInferenceCompletion.modelId"),
    deviceId: parseString(record.deviceId, "clientInferenceCompletion.deviceId"),
    ...(installationId === undefined ? {} : { installationId }),
    outputText,
    durationMs,
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens })
  };
}

function parseOptionalClientTokenCount(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const count = parseNumber(value, field);
  if (!Number.isInteger(count) || count < 0 || count > 1_000_000) {
    throw new Cp2Error(400, "client_inference_usage_invalid", `${field} is invalid.`);
  }
  return count;
}

export function parseRuntimeRecallEscalation(value: unknown): RuntimeRecallEscalation {
  const record = parseRequestBody(value);
  const localRuntime = parseString(record.localRuntime, "recallEscalation.localRuntime");
  if (
    localRuntime !== "browser-webgpu" &&
    localRuntime !== "browser-wasm" &&
    localRuntime !== "native-llama-cpp" &&
    localRuntime !== "owner-node" &&
    localRuntime !== "server-local"
  ) {
    throw new Cp2Error(
      400,
      "recall_escalation_invalid",
      "recallEscalation.localRuntime is not supported."
    );
  }
  const reason = parseString(record.reason, "recallEscalation.reason");
  if (reason.length > 80 || !/^[A-Za-z0-9_.-]+$/u.test(reason)) {
    throw new Cp2Error(
      400,
      "recall_escalation_invalid",
      "recallEscalation.reason must be a bounded reason code."
    );
  }
  const localModelId =
    record.localModelId === undefined || record.localModelId === null
      ? undefined
      : parseString(record.localModelId, "recallEscalation.localModelId").slice(0, 120);
  return { localRuntime, reason, ...(localModelId === undefined ? {} : { localModelId }) };
}
