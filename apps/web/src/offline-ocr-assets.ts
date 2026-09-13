/** Shared by the asset publisher and on-device installer. Bump with pinned OCR packages. */
export const ocrEngineVersion = "7.0.0";
export const ocrModelVersion = "eng-4.0.0_best_int";
export const ocrManifestVersion = `${ocrEngineVersion}/${ocrModelVersion}`;
export const ocrAssetFiles = [
  "worker.min.js",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
  "lang/eng.traineddata.gz"
] as const;
