import { toInferenceError } from "./errors.js";

/**
 * Runs one provider call under a deadline that also honors the caller's AbortSignal. A timeout
 * surfaces as REQUEST_TIMEOUT and a caller abort as REQUEST_CANCELLED - both normalized, both
 * redacted - so adapters never hand-roll their own AbortController plumbing.
 */
export async function withProviderDeadline<T>(
  options: {
    timeoutMs: number;
    signal?: AbortSignal;
    providerId: string;
    modelId?: string;
    secrets: readonly string[];
  },
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const deadline = createDeadline(options.timeoutMs, options.signal);
  try {
    return await run(deadline.signal);
  } catch (error) {
    throw toInferenceError(error, {
      providerId: options.providerId,
      ...(options.modelId === undefined ? {} : { modelId: options.modelId }),
      secrets: options.secrets,
      timedOut: deadline.timedOut()
    });
  } finally {
    deadline.dispose();
  }
}

export interface Deadline {
  signal: AbortSignal;
  timedOut(): boolean;
  dispose(): void;
}

export function createDeadline(timeoutMs: number, external?: AbortSignal): Deadline {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(external?.reason);
  if (external?.aborted === true) controller.abort(external.reason);
  external?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("Provider deadline exceeded."));
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose() {
      clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    }
  };
}

export async function readBodyText(response: Response, limitBytes = 64_000): Promise<string> {
  try {
    const text = await response.text();
    return text.length > limitBytes ? text.slice(0, limitBytes) : text;
  } catch {
    return "";
  }
}
