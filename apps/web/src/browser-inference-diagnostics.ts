import type {
  BrowserDeviceTier,
  BrowserInferenceBackend,
  BrowserInferenceErrorCode
} from "./browser-inference-types";

export const browserInferenceDiagnosticEventName = "soko:browser-inference-diagnostic";

export type BrowserInferenceDiagnostic =
  | {
      type: "capability";
      backend: BrowserInferenceBackend;
      deviceTier: BrowserDeviceTier;
      supported: boolean;
      crossOriginIsolated: boolean;
      availableStorageBytes: number | null;
    }
  | {
      type: "model-load";
      backend: Exclude<BrowserInferenceBackend, "none">;
      modelId: string;
      durationMs: number;
      outcome: "ready" | "cancelled" | "error";
      errorCode: BrowserInferenceErrorCode | null;
    }
  | {
      type: "generation";
      backend: Exclude<BrowserInferenceBackend, "none">;
      modelId: string;
      promptTokenCount: number | null;
      generatedTokenCount: number | null;
      durationMs: number;
      timeToFirstTokenMs: number | null;
      tokensPerSecond: number | null;
    }
  | {
      type: "fallback";
      route: "server" | "native";
      reasonCode: string;
    }
  | {
      type: "cancellation";
      target: "download" | "generation";
    };

const recentDiagnostics: BrowserInferenceDiagnostic[] = [];

export function recordBrowserInferenceDiagnostic(diagnostic: BrowserInferenceDiagnostic): void {
  recentDiagnostics.push({ ...diagnostic });
  if (recentDiagnostics.length > 100) recentDiagnostics.shift();
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<BrowserInferenceDiagnostic>(browserInferenceDiagnosticEventName, {
        detail: { ...diagnostic }
      })
    );
  }
}

export function readBrowserInferenceDiagnostics(): BrowserInferenceDiagnostic[] {
  return recentDiagnostics.map((diagnostic) => ({ ...diagnostic }));
}
