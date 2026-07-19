import { recordRuntimeInitialization } from "./performance";

export type RuntimeManagerState =
  "idle" | "initializing" | "ready" | "switching-model" | "failed" | "stopped";

export class RuntimeManager {
  private key: string | null = null;
  private runtimeSessionId: string | null = null;
  private initialization: Promise<string> | null = null;
  private state: RuntimeManagerState = "idle";

  getState(): RuntimeManagerState {
    return this.state;
  }

  getSessionId(key: string): string | null {
    return this.key === key ? this.runtimeSessionId : null;
  }

  async ensureSession(key: string, createSession: () => Promise<string>): Promise<string> {
    if (this.key !== key) this.resetForKey(key);
    if (this.runtimeSessionId !== null) {
      recordRuntimeInitialization("reused");
      return this.runtimeSessionId;
    }
    if (this.initialization !== null) return this.initialization;

    const startedAt = performance.now();
    this.state = "initializing";
    recordRuntimeInitialization("initializing");
    this.initialization = createSession()
      .then((runtimeSessionId) => {
        this.runtimeSessionId = runtimeSessionId;
        this.state = "ready";
        recordRuntimeInitialization("ready", performance.now() - startedAt);
        return runtimeSessionId;
      })
      .catch((error) => {
        this.state = "failed";
        recordRuntimeInitialization("failed", performance.now() - startedAt);
        throw error;
      })
      .finally(() => {
        this.initialization = null;
      });
    return this.initialization;
  }

  adoptSession(key: string, runtimeSessionId: string): void {
    if (this.key !== key) this.resetForKey(key);
    this.runtimeSessionId = runtimeSessionId;
    this.state = "ready";
  }

  async runWithSession<TResult>(
    key: string,
    createSession: () => Promise<string>,
    action: (runtimeSessionId: string) => Promise<TResult>
  ): Promise<TResult> {
    const runtimeSessionId = await this.ensureSession(key, createSession);
    try {
      return await action(runtimeSessionId);
    } catch (error) {
      if (!isExpiredRuntimeSessionError(error)) throw error;
      this.runtimeSessionId = null;
      this.state = "idle";
      const replacement = await this.ensureSession(key, createSession);
      return action(replacement);
    }
  }

  stop(): void {
    this.runtimeSessionId = null;
    this.initialization = null;
    this.state = "stopped";
  }

  private resetForKey(key: string): void {
    this.key = key;
    this.runtimeSessionId = null;
    this.initialization = null;
    this.state = "idle";
  }
}

export function isExpiredRuntimeSessionError(error: unknown): boolean {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status)
      : null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    status === 404 || status === 410 || /runtime session.*(?:expired|not found)/i.test(message)
  );
}
