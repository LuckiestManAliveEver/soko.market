import type { ClientInferenceCompletion, ClientWorkspaceFileTransfer } from "@soko/shared-types";

import { Cp2Error } from "../../cp2-error.js";
import { parseNumber, parseRequestBody, parseString } from "../../route-helpers.js";
import type { RuntimeTurnBody } from "./routes.js";

export function parseRuntimeTurnBody(body: RuntimeTurnBody | null | undefined): {
  runtimeSessionId?: string;
  conversationId?: string;
  message: string;
  confirmationToken?: string;
  clientInferenceCompletion?: ClientInferenceCompletion;
} {
  const record = parseRequestBody(body);
  const runtimeSessionId =
    record.runtimeSessionId === undefined || record.runtimeSessionId === null
      ? undefined
      : parseString(record.runtimeSessionId, "runtimeSessionId");
  const conversationId =
    record.conversationId === undefined || record.conversationId === null
      ? undefined
      : parseString(record.conversationId, "conversationId");
  const confirmationToken =
    record.confirmationToken === undefined || record.confirmationToken === null
      ? undefined
      : parseString(record.confirmationToken, "confirmationToken");
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
    ...(conversationId === undefined ? {} : { conversationId }),
    ...(confirmationToken === undefined ? {} : { confirmationToken }),
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
  const workspaceFiles = parseClientWorkspaceFiles(record.workspaceFiles);
  return {
    requestId: parseString(record.requestId, "clientInferenceCompletion.requestId"),
    runtime,
    modelId: parseString(record.modelId, "clientInferenceCompletion.modelId"),
    deviceId: parseString(record.deviceId, "clientInferenceCompletion.deviceId"),
    ...(installationId === undefined ? {} : { installationId }),
    outputText,
    durationMs,
    ...(workspaceFiles.length === 0 ? {} : { workspaceFiles }),
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens })
  };
}

function parseClientWorkspaceFiles(value: unknown): ClientWorkspaceFileTransfer[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 10) {
    throw new Cp2Error(
      400,
      "client_workspace_files_invalid",
      "Client workspace files must contain at most ten files."
    );
  }
  return value.map((candidate) => {
    const record = parseRequestBody(candidate);
    const path = parseString(record.path, "clientInferenceCompletion.workspaceFiles.path");
    const contentBase64 = parseString(
      record.contentBase64,
      "clientInferenceCompletion.workspaceFiles.contentBase64"
    );
    const checksum = parseString(
      record.checksum,
      "clientInferenceCompletion.workspaceFiles.checksum"
    ).toLowerCase();
    if (path.length > 1_000 || !/^[a-f0-9]{64}$/u.test(checksum)) {
      throw new Cp2Error(
        400,
        "client_workspace_file_invalid",
        "A client workspace file transfer is invalid."
      );
    }
    return { path, contentBase64, checksum };
  });
}

function parseOptionalClientTokenCount(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const count = parseNumber(value, field);
  if (!Number.isInteger(count) || count < 0 || count > 1_000_000) {
    throw new Cp2Error(400, "client_inference_usage_invalid", `${field} is invalid.`);
  }
  return count;
}
