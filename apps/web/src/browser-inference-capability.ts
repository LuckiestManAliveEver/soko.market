import type { BrowserDeviceTier, BrowserInferenceCapability } from "./browser-inference-types";
import { browserRuntimeContract } from "./browser-inference-contracts";

export interface BrowserCapabilitySignals {
  webGpu: boolean;
  wasm: boolean;
  indexedDb: boolean;
  worker: boolean;
  workerInitialized: boolean;
  crossOriginIsolated: boolean;
  deviceMemoryGb?: number;
  logicalProcessors: number;
  availableStorageBytes?: number;
  persistentStorage: boolean;
  installedPwa: boolean;
  userAgent: string;
}

let modelWorkerProbe: Promise<boolean> | null = null;
const minimumBrowserStorageBytes = 225_000_000;

export function classifyBrowserInferenceCapability(
  signals: BrowserCapabilitySignals
): BrowserInferenceCapability {
  const reasons: string[] = [];
  const browser = parseBrowser(signals.userAgent);
  const memory = finitePositive(signals.deviceMemoryGb);
  const processors = Math.max(1, Math.floor(signals.logicalProcessors));
  const storage = finitePositive(signals.availableStorageBytes);

  if (!signals.wasm) reasons.push("WebAssembly is unavailable.");
  if (!signals.indexedDb) reasons.push("Private browser database storage is unavailable.");
  if (!signals.worker || !signals.workerInitialized) {
    reasons.push("The dedicated model worker could not initialize.");
  }
  if (storage !== undefined && storage < minimumBrowserStorageBytes) {
    reasons.push("Less than 225 MB of browser storage is available.");
  }

  const deviceTier: BrowserDeviceTier =
    (memory ?? 4) >= 8 && processors >= 8
      ? "high"
      : (memory ?? 4) >= 4 && processors >= 4
        ? "medium"
        : "low";
  const basicSupport =
    signals.wasm &&
    signals.indexedDb &&
    signals.worker &&
    signals.workerInitialized &&
    (storage === undefined || storage >= minimumBrowserStorageBytes);
  const backend = basicSupport ? (signals.webGpu ? "webgpu" : "wasm") : "none";

  if (!signals.webGpu && basicSupport) {
    reasons.push("WebGPU is unavailable; the slower WebAssembly backend will be used.");
  }
  if (!signals.crossOriginIsolated && backend === "wasm") {
    reasons.push("Cross-origin isolation is off, so WASM threading may be limited.");
  }
  if (deviceTier === "low") {
    reasons.push("Conservative context and output limits are required on this device.");
  }

  return {
    supported: backend !== "none",
    backend,
    deviceTier,
    ...(memory === undefined ? {} : { estimatedMemoryGb: memory }),
    ...(backend === "none"
      ? {}
      : {
          recommendedModelId:
            deviceTier === "low"
              ? "smollm2-135m-instruct-browser"
              : deviceTier === "medium"
                ? "smollm2-360m-instruct-browser"
                : "qwen2.5-0.5b-instruct-browser"
        }),
    maxRecommendedContextTokens: deviceTier === "low" ? 1_024 : 2_048,
    reasons,
    browser,
    crossOriginIsolated: signals.crossOriginIsolated,
    logicalProcessors: processors,
    ...(storage === undefined ? {} : { availableStorageBytes: storage }),
    indexedDbAvailable: signals.indexedDb,
    persistentStorage: signals.persistentStorage,
    installedPwa: signals.installedPwa,
    workerAvailable: signals.worker && signals.workerInitialized
  };
}

export async function inspectBrowserInferenceCapability(input?: {
  workerProbe?: () => Promise<boolean>;
}): Promise<BrowserInferenceCapability> {
  try {
    const estimate = await navigator.storage?.estimate().catch(() => undefined);
    const persistentStorage = await navigator.storage?.persisted?.().catch(() => false);
    const nav = navigator as Navigator & { deviceMemory?: number; gpu?: unknown };
    const forceWasm =
      __DEPLOYMENT_ENV__ === "staging" &&
      new URLSearchParams(window.location.search).get("browserInferenceBackend") === "wasm";
    const backend = nav.gpu !== undefined && !forceWasm ? "webgpu" : "wasm";
    const workerInitialized = await (input?.workerProbe?.() ?? probeBrowserModelWorker(backend));
    const report = classifyBrowserInferenceCapability({
      webGpu: backend === "webgpu",
      wasm: typeof WebAssembly === "object",
      indexedDb: globalThis.indexedDB !== undefined,
      worker: "Worker" in window,
      workerInitialized,
      crossOriginIsolated: globalThis.crossOriginIsolated === true,
      ...(nav.deviceMemory === undefined ? {} : { deviceMemoryGb: nav.deviceMemory }),
      logicalProcessors: navigator.hardwareConcurrency || 1,
      ...(estimate?.quota === undefined
        ? {}
        : { availableStorageBytes: Math.max(0, estimate.quota - (estimate.usage ?? 0)) }),
      persistentStorage: persistentStorage === true,
      installedPwa:
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
      userAgent: navigator.userAgent
    });
    return forceWasm
      ? {
          ...report,
          reasons: [...report.reasons, "Staging diagnostics forced the WebAssembly backend."]
        }
      : report;
  } catch {
    return classifyBrowserInferenceCapability({
      webGpu: false,
      wasm: typeof WebAssembly === "object",
      indexedDb: false,
      worker: false,
      workerInitialized: false,
      crossOriginIsolated: false,
      logicalProcessors: 1,
      persistentStorage: false,
      installedPwa: false,
      userAgent: navigator.userAgent
    });
  }
}

function probeBrowserModelWorker(backend: "webgpu" | "wasm"): Promise<boolean> {
  if (!("Worker" in window)) return Promise.resolve(false);
  modelWorkerProbe ??= new Promise<boolean>((resolve) => {
    const requestId = `capability-${Date.now().toString(36)}`;
    const probe = new Worker(new URL("./workers/browser-model.worker.ts", import.meta.url), {
      type: "module",
      name: "soko-browser-model-capability-probe"
    });
    const finish = (supported: boolean) => {
      window.clearTimeout(timeout);
      probe.terminate();
      if (!supported) modelWorkerProbe = null;
      resolve(supported);
    };
    const timeout = window.setTimeout(() => finish(false), 15_000);
    probe.addEventListener(
      "message",
      (event: MessageEvent<unknown>) => {
        const response = event.data as { type?: unknown; requestId?: unknown };
        if (response.type === "READY" && response.requestId === requestId) finish(true);
      },
      { once: true }
    );
    probe.addEventListener("error", () => finish(false), { once: true });
    probe.postMessage({
      type: "INITIALIZE",
      requestId,
      config: {
        backend,
        approvedModelOrigins: ["https://huggingface.co"],
        maxContextTokens: 1_024,
        runtimeContract: browserRuntimeContract({
          adapterId: "transformers-js",
          adapterVersion: "3.8.1",
          backend
        })
      }
    });
  });
  return modelWorkerProbe;
}

function parseBrowser(userAgent: string): BrowserInferenceCapability["browser"] {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(userAgent);
  const match =
    userAgent.match(/Edg\/([\d.]+)/) ??
    userAgent.match(/Chrome\/([\d.]+)/) ??
    userAgent.match(/Firefox\/([\d.]+)/) ??
    userAgent.match(/Version\/([\d.]+).*Safari/);
  const name = userAgent.includes("Edg/")
    ? "Edge"
    : userAgent.includes("Chrome/")
      ? "Chrome"
      : userAgent.includes("Firefox/")
        ? "Firefox"
        : userAgent.includes("Safari/")
          ? "Safari"
          : "Unknown";
  return { name, version: match?.[1] ?? null, mobile };
}

function finitePositive(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}
