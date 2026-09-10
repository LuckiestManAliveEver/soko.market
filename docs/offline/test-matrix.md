# Validation matrix

| Scenario           | Automated coverage                                                               | Device/release verification                                                             |
| ------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Fresh install      | Scoped snapshot, driver initialization, activation only after completion         | Confirm disclaimer, install progress and reopen app in airplane mode                    |
| Mid-session outage | Resolver refuses unapproved local writes and ambiguous cloud fallback            | Unsaved cloud request shows a recoverable error; choose Go Offline before disconnecting |
| Reconnect          | Create/update log, stable IDs, idempotent push, server change pull               | Reconnect banner offers sync; no automatic upload of deliberate-offline operations      |
| Two devices        | Conflicting absolute stock counts, manual server choice, field policy tests      | Review local/server versions and retry after another merchant edit                      |
| Low storage        | Insufficient quota and unknown estimate rejected before snapshot                 | Verify on minimum-memory Android device; browser quota is not OS free-space telemetry   |
| Runtime pins       | Default-binding changes ignored, business pull cannot mutate pins, explicit swap | Compatible executable native adapter required; PWA has no model engine                  |
| SQLite             | Real initial SQL, foreign keys, required fields, booleans, transaction rollback  | Native host must bundle its driver and measure file size                                |
| Browser routing    | Persisted consent, account isolation, unsupported/auth calls blocked             | Sign out/in to same account and verify pending data; another account sees none          |
| Interrupted upload | Ordered replay and persisted receipts across hydrateSnapshot                     | Kill API after commit/before response; retry same operation                             |
| Rollback flag      | Enrollment disabled while sync remains available                                 | Disable client and server enrollment; installed users retain Sync/Go Online             |
| Peer prototype     | Fragmentation, Unicode, duplicates, store-and-forward acknowledgement            | Two real native devices without internet; not a shipped PWA feature                     |

Run with the repository-required Node 22.19.x: `pnpm test -- tests/offline-runtime.test.ts tests/offline-runtime-web.test.ts tests/offline-runtime-peer.test.ts tests/offline-runtime-sqlite.test.ts`. SQLite tests use Node's built-in SQLite solely as the test driver; production can inject better-sqlite3. Also run existing cp7/cp21 sync tests, package/API/web typechecks, the Vite build, formatting/lint and architectural boundary checks. See verification.md for actual results; this matrix does not claim physical-device tests have run.
