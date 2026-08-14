export type ModelActivationState =
  | "idle"
  | "validating"
  | "creating_runtime"
  | "loading_model"
  | "binding_agent"
  | "active"
  | "failed"
  | "offline_blocked";

export function modelActivationMessage(state: ModelActivationState): string {
  const messages: Record<ModelActivationState, string> = {
    idle: "Activate on this device",
    validating: "Checking model…",
    creating_runtime: "Starting runtime…",
    loading_model: "Loading model…",
    binding_agent: "Connecting model to agent…",
    active: "Active on this device",
    failed: "Retry device activation",
    offline_blocked: "Connect to activate"
  };
  return messages[state];
}

export type ModelActivationFailureCode =
  | "ACTIVATION_ABORTED"
  | "ACTIVATION_TIMEOUT"
  | "API_UNREACHABLE"
  | "MODEL_FILES_MISSING"
  | "MODEL_RUNTIME_FAILED"
  | "RUNTIME_SESSION_INVALID";

export interface ModelActivationRequest {
  id: string;
  modelId: string;
  signal: AbortSignal;
}

export class ModelActivationError extends Error {
  constructor(
    readonly code: ModelActivationFailureCode,
    message: string
  ) {
    super(message);
    this.name = "ModelActivationError";
  }
}

export class ModelActivationCoordinator {
  private active: (ModelActivationRequest & { controller: AbortController }) | null = null;

  begin(modelId: string): ModelActivationRequest | null {
    if (this.active?.modelId === modelId && !this.active.signal.aborted) return null;
    this.active?.controller.abort("superseded");
    const controller = new AbortController();
    this.active = {
      id: createActivationRequestId(),
      modelId,
      signal: controller.signal,
      controller
    };
    return this.active;
  }

  isCurrent(request: Pick<ModelActivationRequest, "id">): boolean {
    return this.active?.id === request.id;
  }

  finish(request: Pick<ModelActivationRequest, "id">): void {
    if (this.active?.id === request.id) this.active = null;
  }

  cancel(): void {
    this.active?.controller.abort("cancelled");
  }
}

export async function withActivationTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(parentSignal?.reason);
  let rejectAborted: ((reason: DOMException) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAborted = reject;
  });
  const onOperationAbort = () =>
    rejectAborted?.(new DOMException("The operation was aborted.", "AbortError"));
  controller.signal.addEventListener("abort", onOperationAbort, { once: true });
  if (parentSignal?.aborted) onAbort();
  else parentSignal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort("timeout");
  }, timeoutMs);
  try {
    return await Promise.race([operation(controller.signal), aborted]);
  } catch (error) {
    if (timedOut) {
      throw new ModelActivationError(
        "ACTIVATION_TIMEOUT",
        "Model activation timed out. Check the connection or runtime, then retry."
      );
    }
    if (controller.signal.aborted) {
      throw new ModelActivationError("ACTIVATION_ABORTED", "Model activation was cancelled.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    controller.signal.removeEventListener("abort", onOperationAbort);
    parentSignal?.removeEventListener("abort", onAbort);
  }
}

function createActivationRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `model-activation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}
