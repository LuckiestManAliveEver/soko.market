# Data pipeline infrastructure

This document defines the deployment boundary for cross-instance realtime hints, durable message
notifications, malware scanning, and retained upload storage.

## Database migration

Apply `infra/db/migrations/028_data_pipeline_infrastructure.sql` before starting the API. It adds the
normalized `cp2_message_notification_deliveries` collection and indexes due delivery records by
status and next-attempt time. The matching rollback is
`infra/db/rollbacks/028_data_pipeline_infrastructure.down.sql`.

## Cross-instance realtime

Each PostgreSQL-backed API instance:

1. Persists the account sync cursor journal.
2. Publishes the newest changed cursor per account through PostgreSQL `pg_notify`.
3. Listens on a dedicated connection and forwards notifications into its authenticated local
   WebSocket listeners.
4. Ignores its own notification using a random instance ID.
5. Reconnects the listener after connection loss and reports degraded fan-out health while the
   listener or publisher is failing.

Notifications are only low-latency hints. The cursor journal and catch-up endpoint remain the
authoritative source, so dropped PostgreSQL notifications do not lose business data.

## Durable message notifications

Creating a conversation message persists one delivery record per eligible push subscription or
email recipient. The API attempts those records immediately, and the notification runner checks
remaining due records every 60 seconds by default.

Failed attempts use exponential delays of 1, 2, 4, 8, and up to 60 minutes. A delivery becomes
`dead_letter` after five failed attempts. Expired push subscriptions are removed and their delivery
record is terminal. Set `ENABLE_NOTIFICATION_DELIVERY_RUNNER=false` only when another process calls
the same durable delivery method.

Conversation messages and the sync journal remain authoritative even if a secondary notification
provider is unavailable.

## Malware scanner adapter

Configure:

- `MALWARE_SCANNER_URL`
- `MALWARE_SCANNER_SECRET` with at least 32 characters
- `REQUIRE_BINARY_UPLOAD_SECURITY=true` outside production when fail-closed scanning is desired

Production defaults to fail closed. Setting `REQUIRE_BINARY_UPLOAD_SECURITY=false` is an explicit
operational bypass. Non-local endpoints must use HTTPS.

The API sends a JSON `POST` containing schema version, business ID, file name, content type, byte
length, SHA-256 checksum, and base64 content. Requests include:

- `idempotency-key`: the SHA-256 checksum
- `x-soko-upload-timestamp`: an ISO timestamp
- `x-soko-upload-signature`: `sha256=` plus the hex HMAC-SHA256 of
  `<timestamp>.<exact JSON body>`

The scanner must return JSON with `{"status":"clean"}` or `{"status":"infected"}`. Unknown
responses fail closed. Requests time out after 30 seconds.

## Object-storage adapter

Configure:

- `OBJECT_STORAGE_URL`
- `OBJECT_STORAGE_SECRET` with at least 32 characters
- `REQUIRE_OBJECT_STORAGE=true` when retained source storage is mandatory

The request body and signing protocol match the malware scanner. Object storage cannot be enabled
without malware scanning. The adapter must return `{"storageKey":"..."}` after durable storage.
That key is saved in document-import provenance as `originalStorageKey`.

Supplier and product source imports request retention. Receipt OCR and one-off extraction requests
do not, so their original binary content remains ephemeral.
