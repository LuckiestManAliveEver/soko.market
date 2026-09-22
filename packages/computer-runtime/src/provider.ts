/**
 * The ComputerRuntime provider contract. This is the one interface a browser-automation
 * implementation (Playwright, Stagehand, Browser Use, a future Soko-native driver, ...) must
 * satisfy to be usable from services/api/src/cp2/domains/computer-runtime. No caller outside this
 * package's consumers is permitted to import a concrete provider directly - the CP2 domain only
 * ever depends on this interface (dependency injection, matching every other CP2 domain's
 * `...Deps` pattern).
 *
 * This is deliberately the low-level session/action surface described in the task brief. Policy
 * (READ/MUTATE/CONSEQUENTIAL classification, approval gating, control-mode enforcement) lives one
 * layer up in the CP2 domain, not here - a provider only ever executes what it is told once the
 * domain has authorized it.
 */
import type {
  ComputerActionResult,
  ComputerObservation,
  ComputerSession,
  ClickInput,
  CreateSessionInput,
  NavigateInput,
  ObserveInput,
  ScrollInput,
  TypeInput,
  UploadInput
} from "./types.js";

export interface ComputerRuntimeProvider {
  readonly kind: string;

  createSession(input: CreateSessionInput): Promise<ComputerSession>;
  resumeSession(sessionId: string): Promise<ComputerSession>;

  navigate(input: NavigateInput): Promise<ComputerObservation>;
  observe(input: ObserveInput): Promise<ComputerObservation>;
  click(input: ClickInput): Promise<ComputerActionResult>;
  type(input: TypeInput): Promise<ComputerActionResult>;
  scroll(input: ScrollInput): Promise<ComputerActionResult>;
  upload(input: UploadInput): Promise<ComputerActionResult>;

  /** Persists the provider's own resumable state (e.g. storage state / cookies) and returns it for
   *  the CP2 domain to encrypt and store - the provider never persists secrets itself. */
  checkpoint(sessionId: string): Promise<ComputerProviderCheckpoint>;
  suspend(sessionId: string): Promise<void>;
  resume(sessionId: string, checkpoint: ComputerProviderCheckpoint | null): Promise<void>;
  close(sessionId: string): Promise<void>;
}

export interface ComputerProviderCheckpoint {
  sessionId: string;
  /** Opaque to every caller except the provider that produced it (e.g. a Playwright storageState
   *  JSON string). Encrypted at rest by the CP2 domain via the existing
   *  encryptOAuthToken/decryptOAuthToken helpers - never logged, never returned to the model. */
  opaqueState: string;
  capturedAt: string;
}
