# Rollout plan

Enrollment defaults off: `OFFLINE_RUNTIME_ENABLED=false` on the API and `VITE_OFFLINE_RUNTIME_ENABLED=false` in the web build. Do not enable either in a shared environment as part of implementation.

1. Internal dogfood: Kiarie on one test shop, one laptop browser and one low-spec Android device. Use disposable commercial records first. Apply migration 082 through the existing database migration procedure only when the operator explicitly schedules deployment.
2. Enable both enrollment flags in the test environment. Install the business-data-only mode, confirm every disclaimer and test airplane-mode startup, lazy screens, stock changes, customer creation and sync. The model option must fail clearly when no compatible adapter is registered.
3. Add one second internal tester/device to the same test shop. Exercise conflicting stock counts, nonoverlapping catalogue changes, failed uploads, revoked sessions and the manual-resolution choices.
4. Wider beta requires measured results on actual Android hardware and a working native runtime before claiming offline AI. BLE remains a separately gated prototype.

Watch: installation bytes/time, estimate quota and usage, persistent-storage availability, cold offline startup, peak memory, write latency, sync pending count/age, rejection/conflict count, acknowledgement latency, retry count, API persistence failures and journal size. Do not send customer/product contents as telemetry. Current progress and pending counts are visible locally; aggregate remote telemetry is not silently enabled.

## Rollback

Disable new installations using the flags. Do not remove the package, migrations, existing IndexedDB databases, cached shell or `/sync/push` and `/sync/pull`. Existing installations keep their Settings recovery actions regardless of enrollment. An offline device retains its snapshot, pending changes and pin until it reconnects and explicitly syncs. Switching online is blocked while unresolved changes remain. A disabled central flag must not force an offline model update or delete the local log.

The server uses this repository's existing single-authoritative-process CP2 persistence design. Do not enable multiple independent replicas; the process-local sequence generator assumes the same constraint as all other CP2 business mutations. Do not prune server receipts during the pilot, since historical device retries require durable deduplication. Journal compaction and large-store row-level storage are prerequisites for a broad, long-running rollout.
