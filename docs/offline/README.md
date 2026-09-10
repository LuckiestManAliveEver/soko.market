# Soko Offline Runtime

This implementation adapts the supplied plan to the current monorepo. It provides a working, explicitly installed offline business-data path from Settings through the API adapter and local transactions to authenticated, durable server sync. The original plan is retained unchanged alongside these implementation documents.

- `packages/offline-runtime`: typed IndexedDB/SQLite storage, operation writer, provider resolver, runtime pin/install interfaces, integrity-checked artifact caching, sync/conflicts and peer prototype.
- `services/api/src/cp2/offline-runtime*.ts` and Cp2Store integration: operation receipts, business change feed, snapshot and authenticated push/pull in the existing API.
- `apps/web/src/OfflineRuntimeSettings.tsx`: consent, storage check, shell/snapshot progress, manual sync/return-online, offline receipt-scanner enrollment and conflict review.
- `apps/web/src/offline-ocr.ts` + `apps/web/vite.config.ts`'s `tesseractOfflineAssets` plugin: on-device receipt OCR (tesseract.js/WASM), self-hosted and cache-verified so it needs no CDN.
- `infra/db/migrations/082_offline_runtime.sql`: generated migration; not applied automatically.

## What is usable now

With enrollment enabled in a test environment, install business data from Settings. Products, customers, invoices, order snapshots and field definitions are available offline. Create/update products, create customers and adjust stock with atomic local logging. Reconnect, explicitly sync, review conflicts and return online. The app shell and lazy chunks are downloaded before activation. While the offline feature is enrolled, new mutations are never silently queued after an ambiguous cloud failure. Existing legacy sync data remains compatible.

Receipt photos can be scanned entirely on-device once "Enable offline receipt scanning" is opted into from Settings (about 14 MB, separate from the business-data snapshot): tesseract.js extracts the receipt's text locally and queues a `receiptOcrJobs` capture the same way a product or customer write queues. Supplier/sales-agent matching and confirming the scan into a purchase record still need the server's full contact directory, so those steps wait for the next sync.

## Explicit limits

The source plan assumes Prisma, a retired execution resolver and private browser inference that the repository no longer has. This implementation does not fabricate those systems. The PWA currently offers business-data-only installation; offline AI requires an executable `InstalledRuntimeAdapter` plus an immutable, checksummed `RuntimeBinding`. Runtime pinning, verified artifact cache and provider inference use that interface, but no browser model engine or native bridge is supplied or represented as installed. An incompatible AI installation is blocked before it changes state. A registered adapter must verify/install all artifacts before returning success and must execute the pinned manifest without consulting cloud defaults.

BLE discovery/links need a native authenticated transport; only the researched framing/queue/relay prototype is supplied. The PWA exposes no pretend radio. Public checkout, payment settlement, auth, cloud tools and arbitrary agent execution remain unavailable offline. Receipt-OCR text extraction now runs on-device, but confirming a scan into a supplier and purchase record does not - that step, like invoice/order confirmation, changes stock and needs live authorization. These are material limits on the original plan's full AI-runtime objective, not completed production capabilities.

Read contract-inventory.md, local-schema-scope.md, conflict-policies.md, p2p-transport-research.md, test-matrix.md and rollout-plan.md before enrollment.
