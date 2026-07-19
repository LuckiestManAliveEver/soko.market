# Browser model troubleshooting

## Supported baseline

- Current Chromium-based browser with WebGPU, or WebAssembly for the conservative fallback.
- IndexedDB, Web Workers and at least 350 MB available browser storage.
- About 850 MB working memory for the SmolLM2 360M q4 starter model.
- `VITE_BROWSER_LOCAL_INFERENCE_ENABLED=true` in the frontend build.

WebGPU support and mobile memory reporting vary. An unsupported device must continue on Soko's
native or Cloud route.

## Diagnosis

1. Open **Agent model → Browser-local inference** and record the browser, backend, device tier and
   safe status/error code.
2. Confirm the deployment flag was present when Vite built the frontend.
3. Confirm IndexedDB and Workers are allowed and browser storage has not been disabled.
4. Inspect browser network requests to `huggingface.co/onnx-community/` and verify no credential is
   attached.
5. Check worker errors for the typed code only. Do not add raw prompts or output to logs.
6. For a corrupt or interrupted cache, use **Delete browser model**, then explicitly opt in again.
7. For `OUT_OF_MEMORY`, close other tabs, retry on WebGPU, or leave browser inference disabled.
8. For `CONTEXT_LIMIT_EXCEEDED` or a server-tool request, confirm the compact status changes to
   Cloud and that the original user message remains present.

## Clear model data

**Delete browser model** unloads the worker and clears engine model cache plus Soko model metadata.
It intentionally leaves chat history and the normal Soko sync database unchanged. Signing out
terminates generation and removes account-scoped settings, summaries, and offline inference queue
records.

## Add a model

Add only one reviewed descriptor at a time to `browser-model-registry.ts`. Require:

- HTTPS under an approved model origin;
- Transformers.js-compatible ONNX text generation assets;
- verified commercial licence and licence URL;
- q4/q8 size and runtime-memory measurements;
- context limit, backend and device-tier metadata;
- capability, worker, context, routing and production-build tests.

Never enable or download a newly added model by default.

## Known limitations

- WASM generation on low-end Android may be too slow for comfortable chat.
- Browser quota eviction can remove model assets between sessions.
- Cancellation may wait for the current WebGPU/WASM kernel to return.
- The initial 360M model is for short assistance, not complex reasoning or authorized tools.
- Stable prefix keys are implemented, but evaluated KV caches are only reused when the active engine
  session supports it; they are not persisted across reloads.
