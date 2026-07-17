# Data pipeline audit

Audit date: 2026-07-17

## Implemented pipelines

| Pipeline              | Ingestion                                          | Processing                                                                                                | Durable boundary                                              | Delivery/consumer                                                               | Result                                                |
| --------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Document import       | Text or base64 PDF, Word, and spreadsheet uploads  | Signature validation, extraction, preview mapping, row validation                                         | Import source/job tables and business records                 | Product and supplier UI                                                         | Working                                               |
| Receipt OCR           | Browser binary upload                              | Bounded HTTP worker, PaddleOCR with Tesseract fallback, response validation, parsing and contact matching | OCR jobs, receipts, and line items                            | Supplier receipt review UI                                                      | Working when `OCR_WORKER_URL` is configured           |
| Offline mutations     | IndexedDB local mutation store                     | Ordered transfer with stable idempotency keys and retry-aware server replay                               | IndexedDB until acceptance; PostgreSQL server queue afterward | Product, customer, supplier, inventory, invoice, payment, and logistics actions | Working                                               |
| Account catch-up      | Account-scoped cursor API                          | Page validation, tombstones, expired-cursor reset                                                         | PostgreSQL journal and atomic IndexedDB page commit           | Web cache                                                                       | Working                                               |
| Realtime hints        | Authenticated WebSocket                            | Account isolation, catch-up coalescing, reconnect and error containment                                   | Cursor journal remains authoritative                          | Web catch-up client                                                             | Working per API instance                              |
| PostgreSQL state      | Store mutations and durable defaults               | Serialized normalized snapshot transaction                                                                | Normalized and relational tables                              | API restart hydration                                                           | Working; flush and health expose persistence failures |
| Account/shop deletion | Scheduled runner or cron                           | Quarantine, processor receipts, purge and retry                                                           | Deletion requests/proofs and relational cleanup               | Operations jobs                                                                 | Working; external processors run when configured      |
| Data export/backup    | Authenticated export and scheduled database backup | Scoped bundle generation or `pg_dump`                                                                     | Export records and configured backup destination              | Owner/operations                                                                | Working                                               |
| Messaging outbox      | Failed browser message send                        | Account-scoped retry with HTTP failure classification                                                     | Account-scoped browser storage until server acceptance        | Conversation message API                                                        | Working                                               |
| Network invites       | Selected phone or email contacts                   | Signed, idempotent delivery webhook                                                                       | Invite delivery status and audit event                        | Configured invite delivery service                                              | Working when webhook is configured                    |

## Fixed in this audit

- Replaced the receipt worker health-only loop with an HTTP scan consumer.
- Sent actual image/PDF bytes from the frontend instead of empty extracted text.
- Added OCR response validation, retries, timeout, concurrency, upload-size, image-edge, and PDF-page enforcement.
- Connected IndexedDB mutations to the server queue and automatic reconnect replay.
- Prevented bulk replay from repeatedly executing non-retryable conflicts or ignoring retry backoff.
- Recovered interrupted `processing` queue items after hydration and converted unexpected replay
  failures into retryable failed items.
- Pruned expired sync tombstones and synchronized removals to PostgreSQL on the next durable save.
- Stopped swallowing PostgreSQL save failures: `flush()` now rejects and health reports `degraded`.
- Added an HTTP response barrier so successful mutation responses wait for queued PostgreSQL
  persistence.
- Scoped queued chat messages to the authenticated account, removed unsafe legacy entries, and
  stopped retrying permanent client/conflict errors.
- Included quarantined shop records in the scheduled deletion purge runner.
- Connected queued network invites to a signed delivery webhook and persisted `sent` or `failed`
  delivery state.

## Deployment dependencies

- OCR requires the worker container and `OCR_WORKER_URL`; PaddleOCR model startup can be slow on the
  first request.
- Cross-instance realtime fan-out needs a shared broker or PostgreSQL notification channel if the
  API is horizontally scaled. Cursor catch-up remains correct without it.
- Network invite delivery requires `NETWORK_INVITE_WEBHOOK_URL` and
  `NETWORK_INVITE_WEBHOOK_SECRET`. Without them, invites remain queued.
- Push and email notifications are best-effort secondary delivery hints. The conversation journal
  remains authoritative, but a durable notification retry/dead-letter queue is still an operations
  integration boundary.
- Binary malware scanning and external object storage are infrastructure integrations, not embedded
  in the repository. Receipt bytes are processed ephemerally and worker temporary files are deleted
  after each request.
