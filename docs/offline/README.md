# Soko Offline Runtime

This implementation adapts the supplied plan to the current monorepo. It provides a working, explicitly installed offline business-data path from Settings through the API adapter and local transactions to authenticated, durable server sync. The original plan is retained unchanged alongside these implementation documents.

- `packages/offline-runtime`: typed IndexedDB/SQLite storage, operation writer, provider resolver, runtime pin/install interfaces, integrity-checked artifact caching, sync/conflicts and peer prototype.
- `services/api/src/cp2/offline-runtime*.ts` and Cp2Store integration: operation receipts, business change feed, snapshot and authenticated push/pull in the existing API.
- `apps/web/src/OfflineRuntimeSettings.tsx`: consent, storage check, shell/snapshot progress, manual sync/return-online and conflict review.
- `infra/db/migrations/082_offline_runtime.sql`: generated migration; not applied automatically.

## What is usable now

With enrollment enabled in a test environment, install business data from Settings. Products, customers, invoices, order snapshots and field definitions are available offline. Create/update products, create customers and adjust stock with atomic local logging. Reconnect, explicitly sync, review conflicts and return online. The app shell and lazy chunks are downloaded before activation. While the offline feature is enrolled, new mutations are never silently queued after an ambiguous cloud failure. Existing legacy sync data remains compatible.

## Explicit limits

The source plan assumes Prisma, a retired execution resolver and private browser inference that the repository no longer has. This implementation does not fabricate those systems. The PWA currently offers business-data-only installation; offline AI requires an executable `InstalledRuntimeAdapter` plus an immutable, checksummed `RuntimeBinding`. Runtime pinning, verified artifact cache and provider inference use that interface, but no browser model engine or native bridge is supplied or represented as installed. An incompatible AI installation is blocked before it changes state. A registered adapter must verify/install all artifacts before returning success and must execute the pinned manifest without consulting cloud defaults.

BLE discovery/links need a native authenticated transport; only the researched framing/queue/relay prototype is supplied. The PWA exposes no pretend radio. Public checkout, payment settlement, OCR, auth, cloud tools and arbitrary agent execution remain unavailable offline. These are material limits on the original plan's full AI-runtime objective, not completed production capabilities.

Read contract-inventory.md, local-schema-scope.md, conflict-policies.md, p2p-transport-research.md, test-matrix.md and rollout-plan.md before enrollment.
