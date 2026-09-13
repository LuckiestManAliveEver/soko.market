import { Cp2Error } from "./cp2-error.js";

/** Bounds readiness I/O; a late probe cannot commit runtime state. */
export async function withRuntimeDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 5_000
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new Cp2Error(
              503,
              "TARGET_ACTIVATION_TIMEOUT",
              "The execution host stopped responding. The current runtime is still active.",
              true
            )
          );
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
