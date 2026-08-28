export type InferenceUserState =
  | "model-not-downloaded"
  | "device-not-supported"
  | "not-enough-storage"
  | "shop-device-offline"
  | "network-unavailable"
  | "request-timed-out"
  | "inference-unavailable";

export function mapInferenceError(error: unknown): InferenceUserState {
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  if (/MODEL_NOT_(DOWNLOADED|LOADED|INSTALLED)/i.test(code + message)) {
    return "model-not-downloaded";
  }
  if (/UNSUPPORTED|WEBGPU_UNAVAILABLE|WASM_UNAVAILABLE/i.test(code + message)) {
    return "device-not-supported";
  }
  if (/STORAGE|QUOTA|OUT_OF_MEMORY/i.test(code + message)) return "not-enough-storage";
  if (/OWNER_NODE|SHOP DEVICE/i.test(code + message)) return "shop-device-offline";
  if (/OFFLINE|NETWORK/i.test(code + message)) return "network-unavailable";
  if (/TIMEOUT|TIMED OUT/i.test(code + message)) return "request-timed-out";
  return "inference-unavailable";
}
