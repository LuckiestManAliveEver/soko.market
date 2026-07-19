# Browser inference architecture

## Runtime path

```text
ChatSurface
  → OwnerApp route resolution
  → browser-inference-session
  → capability + settings + context budget
  → BrowserModelEngine
  → browser-model.worker
  → Transformers.js
  → ONNX Runtime Web (WebGPU or WASM)
  → streamed tokens in the existing agent message
```

Only one page-session worker and one generation may be active. The browser route is evaluated
before a server agent request is issued, so Soko never sends the same turn to browser and cloud
simultaneously. Native GGUF and server routing remain in the existing `AgentModelRuntime` and CP2
paths.

## Engine boundary

Only `browser-model.worker.ts` imports `@huggingface/transformers`. The rest of Soko uses
`BrowserModelEngine`, typed generation requests, progress handlers, and error codes. The worker:

- validates the model against Soko's approved Hugging Face origin;
- uses q4 weights and WebGPU or WASM;
- owns tokenizer, live generation state and in-session caches;
- streams decoded token text;
- uses an interruptible stopping criterion for cancellation;
- reports timing and counts without prompt text.

The selected engine and model are Apache-2.0. Dependency and model upgrades require licence,
bundle, model-card and browser-compatibility review.

## Context and retrieval

`browser-context-manager.ts` preserves protected system instructions, the current user message, and
agent/shop identity. It adds complete optional records in priority order until the model budget is
full, then rechecks the assembled prompt with the loaded model tokenizer and drops additional whole
low-priority records if necessary. The stable prefix receives a deterministic cache key. The
initial adapter does not claim durable KV-cache persistence; reload reconstructs context from
messages, summaries and structured state.

Catalogue retrieval is bounded lexical matching over current structured product records. Intent
matching chooses only relevant Soko context scripts. Write operations, server tools, complex
reasoning and background work route to the authenticated server.

## Persistence and offline behavior

`soko-browser-inference` is a versioned IndexedDB database with account-scoped settings, model
metadata, summaries, chat cache, retrieval metadata and offline queue stores. Transformers.js owns
the binary asset cache, avoiding an extra model copy. The application service worker does not run
inference and does not delete inference storage during shell upgrades.

Logout terminates the worker and clears account-scoped inference records. Model cache deletion is
an explicit settings action and does not delete chat data.

## Deployment

Set `VITE_BROWSER_LOCAL_INFERENCE_ENABLED=true` at frontend build time to expose the opt-in control.
The default and production Blueprint remain false. `soko-market-web-staging` enables the flag and
adds a strict CSP plus `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: credentialless`, allowing memory measurements and threaded WASM
without changing production authentication or integrations.

The staging CSP permits only same-origin application assets and workers, the configured Soko API,
and HTTPS downloads under the Hugging Face `huggingface.co`/`hf.co` host families. The latter is
required because Hub downloads redirect to separate CDN/storage subdomains. Staging may force the
WASM route with `?browserInferenceBackend=wasm`; production ignores this diagnostic override.
