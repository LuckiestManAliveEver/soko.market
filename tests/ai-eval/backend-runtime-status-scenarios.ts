export interface BackendRuntimeStatusScenario {
  errorCode: string | null;
  expected: string;
  forbidden?: string;
}

export const backendRuntimeStatusScenarios: BackendRuntimeStatusScenario[] = [
  {
    errorCode: "RUNTIME_NOT_CONFIGURED",
    expected: "not configured for this deployment",
    forbidden: "cannot currently be reached"
  },
  {
    errorCode: "RUNTIME_UNAVAILABLE",
    expected: "runtime is currently unavailable",
    forbidden: "not configured"
  },
  {
    errorCode: "INFERENCE_DISABLED",
    expected: "disabled for this deployment",
    forbidden: "cannot currently be reached"
  },
  { errorCode: "MODEL_NOT_INSTALLED", expected: "not installed" },
  { errorCode: "MODEL_LOADING", expected: "still loading" },
  {
    errorCode: "MODEL_NOT_LOADED",
    expected: "not loaded",
    forbidden: "still loading"
  },
  {
    errorCode: "MODEL_STORAGE_NOT_DURABLE",
    expected: "durable model storage",
    forbidden: "not configured"
  },
  { errorCode: "INFERENCE_TIMEOUT", expected: "timed out" },
  { errorCode: "INFERENCE_AUTHENTICATION_FAILED", expected: "authenticate" },
  { errorCode: "INFERENCE_ENGINE_UNREACHABLE", expected: "model engine cannot be reached" },
  {
    errorCode: "INFERENCE_SERVICE_UNREACHABLE",
    expected: "inference service cannot currently be reached"
  },
  { errorCode: "INVALID_INFERENCE_RESPONSE", expected: "invalid response" },
  {
    errorCode: "MODEL_PROBE_FAILED",
    expected: "failed its inference test",
    forbidden: "health check"
  },
  {
    errorCode: "MODEL_HEALTH_CHECK_FAILED",
    expected: "failed its health check",
    forbidden: "inference test"
  },
  { errorCode: null, expected: "before the service returned a diagnosis" }
];
