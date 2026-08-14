import { describe, expect, it } from "vitest";
import { normalizeInferenceErrorCode } from "../packages/shared-types/src/index";

describe("provider-neutral inference error taxonomy", () => {
  it("normalizes every known server model-runtime code", () => {
    expect(normalizeInferenceErrorCode("MODEL_PROVIDER_TIMEOUT")).toBe("TIMEOUT");
    expect(normalizeInferenceErrorCode("INFERENCE_TIMEOUT")).toBe("TIMEOUT");
    expect(normalizeInferenceErrorCode("MODEL_PROVIDER_UNREACHABLE")).toBe("ENGINE_UNREACHABLE");
    expect(normalizeInferenceErrorCode("INFERENCE_SERVICE_UNREACHABLE")).toBe("ENGINE_UNREACHABLE");
    expect(normalizeInferenceErrorCode("INFERENCE_ENGINE_UNREACHABLE")).toBe("ENGINE_UNREACHABLE");
    expect(normalizeInferenceErrorCode("RUNTIME_UNAVAILABLE")).toBe("ENGINE_UNREACHABLE");
    expect(normalizeInferenceErrorCode("MODEL_NOT_INSTALLED")).toBe("MODEL_NOT_INSTALLED");
    expect(normalizeInferenceErrorCode("MODEL_LOADING")).toBe("MODEL_LOADING");
    expect(normalizeInferenceErrorCode("MODEL_NOT_CONFIGURED")).toBe("MODEL_UNAVAILABLE");
    expect(normalizeInferenceErrorCode("AGENT_MODEL_NOT_CONFIGURED")).toBe("MODEL_UNAVAILABLE");
    expect(normalizeInferenceErrorCode("AGENT_MODEL_UNAVAILABLE")).toBe("MODEL_UNAVAILABLE");
    expect(normalizeInferenceErrorCode("MODEL_IDENTITY_MISMATCH")).toBe("MODEL_UNAVAILABLE");
    expect(normalizeInferenceErrorCode("MODEL_GENERATION_FAILED")).toBe("PROVIDER_ERROR");
    expect(normalizeInferenceErrorCode("MODEL_PROBE_FAILED")).toBe("PROVIDER_ERROR");
    expect(normalizeInferenceErrorCode("MODEL_HEALTH_CHECK_FAILED")).toBe("PROVIDER_ERROR");
    expect(normalizeInferenceErrorCode("INVALID_INFERENCE_RESPONSE")).toBe("INVALID_RESPONSE");
  });

  it("normalizes every known cloud-fallback code", () => {
    expect(normalizeInferenceErrorCode("CLOUD_TIMEOUT")).toBe("TIMEOUT");
    expect(normalizeInferenceErrorCode("CLOUD_SPENDING_LIMIT_REACHED")).toBe("RATE_LIMITED");
    expect(normalizeInferenceErrorCode("CLOUD_CIRCUIT_OPEN")).toBe("ENGINE_UNREACHABLE");
    expect(normalizeInferenceErrorCode("CLOUD_REQUEST_FAILED")).toBe("PROVIDER_ERROR");
  });

  it("normalizes every known browser-inference code", () => {
    expect(normalizeInferenceErrorCode("WEBGPU_UNAVAILABLE")).toBe("ENGINE_UNREACHABLE");
    expect(normalizeInferenceErrorCode("WASM_UNAVAILABLE")).toBe("ENGINE_UNREACHABLE");
    expect(normalizeInferenceErrorCode("MODEL_DOWNLOAD_FAILED")).toBe("MODEL_NOT_INSTALLED");
    expect(normalizeInferenceErrorCode("MODEL_CACHE_CORRUPT")).toBe("MODEL_NOT_INSTALLED");
    expect(normalizeInferenceErrorCode("MODEL_LOAD_FAILED")).toBe("MODEL_LOADING");
    expect(normalizeInferenceErrorCode("CONTEXT_LIMIT_EXCEEDED")).toBe("CONTEXT_WINDOW_EXCEEDED");
    expect(normalizeInferenceErrorCode("TASK_BUDGET_EXCEEDED")).toBe("RATE_LIMITED");
    expect(normalizeInferenceErrorCode("GENERATION_CANCELLED")).toBe("ABORTED");
    expect(normalizeInferenceErrorCode("UNSUPPORTED_BROWSER")).toBe("ENGINE_UNREACHABLE");
  });

  it("falls back to UNKNOWN for a code from a provider that does not exist yet, without throwing", () => {
    expect(normalizeInferenceErrorCode("SOME_FUTURE_PROVIDERS_NEW_CODE")).toBe("UNKNOWN");
    expect(normalizeInferenceErrorCode("")).toBe("UNKNOWN");
  });
});
