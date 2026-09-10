# Soko Offline Runtime

This implementation adapts the supplied plan to the current monorepo. It provides a working, explicitly installed offline business-data path from Settings through the API adapter and local transactions to authenticated, durable server sync. The original plan is retained unchanged alongside these implementation documents.

- `packages/offline-runtime`: typed IndexedDB/SQLite storage, operation writer, provider resolver, runtime pin/install interfaces, integrity-checked artifact caching, sync/conflicts and peer prototype.
- `services/api/src/cp2/offline-runtime*.ts` and Cp2Store integration: operation receipts, business change feed, snapshot and authenticated push/pull in the existing API.
- `apps/web/src/OfflineRuntimeSettings.tsx`: consent, storage check, shell/snapshot progress, manual sync/return-online, offline receipt-scanner enrollment and conflict review.
- `apps/web/src/offline-ocr.ts` + `apps/web/vite.config.ts`'s `tesseractOfflineAssets` plugin: on-device receipt OCR (tesseract.js/WASM), self-hosted and cache-verified so it needs no CDN.
- `apps/web/src/webllm-runtime.ts` + `apps/web/src/webllm-model-manifest.ts`: the `InstalledRuntimeAdapter` for on-device agent inference, backed by WebLLM/WebGPU. See "On-device AI" below.
- `infra/db/migrations/082_offline_runtime.sql`: generated migration; not applied automatically.

## What is usable now

With enrollment enabled in a test environment, install business data from Settings. Products, customers, invoices, order snapshots and field definitions are available offline. Create/update products, create customers and adjust stock with atomic local logging. Reconnect, explicitly sync, review conflicts and return online. The app shell and lazy chunks are downloaded before activation. While the offline feature is enrolled, new mutations are never silently queued after an ambiguous cloud failure. Existing legacy sync data remains compatible.

Receipt photos can be scanned entirely on-device once "Enable offline receipt scanning" is opted into from Settings (about 14 MB, separate from the business-data snapshot): tesseract.js extracts the receipt's text locally and queues a `receiptOcrJobs` capture the same way a product or customer write queues. Supplier/sales-agent matching and confirming the scan into a purchase record still need the server's full contact directory, so those steps wait for the next sync.

## On-device AI

Unchecking "Install business data only" pins and downloads a single small on-device model
(`Qwen2.5-0.5B-Instruct-q4f16_1-MLC`, WebGPU via `@mlc-ai/web-llm`) as this build's
`InstalledRuntimeAdapter`. See `docs/adr/ADR-device-independent-runtime-and-registry-discovery.md`'s
"Update" section for why this is a narrow, disclosed exception to that ADR's rejection of on-device
inference, not a reversal of it. In short:

- **Explicit, not silent.** It only installs on the same deliberate "Go Offline" confirmation as
  business data, on a device with WebGPU; unsupported devices fall back to business-data-only with
  a clear message, exactly like every other unsupported-AI path in this runtime.
- **Labeled, not ambiguous.** Every reply carries `answeredOffline: true` and the exact pinned
  `modelId`; `OfflineRuntimeSettings.tsx` renders it as "Answered offline by <model>" so a merchant
  can never mistake it for a normal, data-connected agent turn.
- **Pinned, not silently swapped.** `RuntimeBinding.artifacts` contains one self-hosted,
  real-hashed manifest (`apps/web/public/webllm-runtime/manifest.json`) identifying the pinned
  model; pinning that hash freezes it, so a later deploy that changes the pinned model fails
  integrity re-verification on an already-offline device's frozen pin instead of switching models
  underneath the user.
- **Real, not fabricated, integrity.** The manifest's hash is computed from whatever bytes are
  actually served, not hand-typed. The model weights themselves are fetched from WebLLM's approved
  Hugging Face origin and are not additionally hash-pinned by this adapter - this repo's sandboxed
  dev environment cannot reach that origin to precompute a real hash, and WebLLM's own prebuilt
  catalogue does not ship one either, so the honest choice is TLS-plus-origin-restriction (the
  adapter only ever loads this one filtered `model_id` from WebLLM's real shipped list) rather than
  a hash that would just be invented.
- **Answers from the prompt alone.** No catalogue, order, customer or account data reaches the
  model; it cannot serve `catalogue.lookup`-style questions and is told so in its own system
  prompt.

This is one narrow model/engine choice proven end to end (`tests/webllm-runtime.test.ts`,
`tests/webllm-model-manifest.test.ts`), not the original plan's full multi-engine/model registry -
see that ADR update for the scoping reasoning.

## Explicit limits

The source plan assumes Prisma, a retired execution resolver and private browser inference that the repository no longer has. This implementation does not fabricate those systems. Runtime pinning, verified artifact cache and provider inference use the `InstalledRuntimeAdapter` interface; the WebLLM adapter above is the only registered implementation. An incompatible AI installation is blocked before it changes state. A registered adapter must verify/install all artifacts before returning success and must execute the pinned manifest without consulting cloud defaults.

BLE discovery/links need a native authenticated transport; only the researched framing/queue/relay prototype is supplied. The PWA exposes no pretend radio. Public checkout, payment settlement, auth, cloud tools and arbitrary agent execution remain unavailable offline. Receipt-OCR text extraction now runs on-device, but confirming a scan into a supplier and purchase record does not - that step, like invoice/order confirmation, changes stock and needs live authorization. These are material limits on the original plan's full AI-runtime objective, not completed production capabilities.

Read contract-inventory.md, local-schema-scope.md, conflict-policies.md, p2p-transport-research.md, test-matrix.md and rollout-plan.md before enrollment.
