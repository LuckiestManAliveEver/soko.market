# Production migration audit

This audit was completed before implementing the Hetzner path. Render and Neon remain configured
as the rollback deployment; none of their resources are deleted or disabled by this repository.

## Repository and runtimes

- The repository is a pnpm workspace using Node.js 20.19.0 and pnpm 10.28.2.
- `apps/web` is a React 19/Vite PWA. Its production build is
  `pnpm --filter @soko/web... build`, producing `apps/web/dist`.
- `services/api/src/index.ts` is the Fastify API entry point. Production executes the compiled
  `services/api/dist/index.js`.
- `services/api/src/worker.ts` now owns notification delivery and account/shop deletion runners in
  the Hetzner deployment. The API disables its in-process copies there.
- `services/ai-runtime` is a Fastify gateway plus Ollama. Its existing image runs compiled
  JavaScript and stores Ollama data below `/var/lib/soko-models`.
- `services/receipt-ocr-service` is a Python PaddleOCR/Tesseract worker.
- `services/sync` is a separate Fastify scaffold, but current production sync and WebSocket routes
  are implemented by the API. It is therefore not a required production container.

## Data and migrations

- PostgreSQL is authoritative. The schema is defined by ordered SQL files under
  `infra/db/migrations`; Drizzle is development tooling and not the production migration runner.
- `services/api/scripts/migrate-db.mjs` records checksums, applies each new migration in a
  transaction, fails loudly, and uses a PostgreSQL advisory lock.
- Production migration commands intentionally require `DIRECT_DATABASE_URL`. For the internal
  database, it is the same host/database as `DATABASE_URL`; this keeps the existing convention and
  avoids a conflicting `DATABASE_DIRECT_URL` alias.
- Database URL normalization only forces TLS for recognized Neon hosts. The internal
  `postgres:5432` URL therefore does not inherit provider-specific TLS assumptions.
- The PostgreSQL store uses a normal pool plus LISTEN/NOTIFY for realtime fan-out.
- `REDIS_URL` existed in configuration but no Redis client path existed. The Hetzner path now
  requires password-protected Redis and includes it in readiness and worker startup checks.

## Uploads, realtime, and health

- Document/catalogue imports and receipt/document OCR accept base64 bodies through API routes.
  Import provenance already persists an object key, not the binary body, in PostgreSQL.
- A signed HTTP malware/object-storage adapter already existed. It is retained as a compatibility
  provider. Previously, disabling malware scanning returned early and unintentionally disabled
  durable storage too; that coupling has been removed.
- Direct private R2 storage now implements the same upload pipeline interface. Uploads are limited
  to 10 MiB, checked using declared MIME type plus magic bytes where applicable, and stored under
  tenant-scoped random keys.
- Receipt OCR does not write temporary source files. R2 retention is explicit through
  `OCR_RETAIN_SOURCE_OBJECTS`; extracted structured data remains in PostgreSQL.
- `/v1/realtime` is a WebSocket endpoint. The frontend derives `ws:`/`wss:` from
  `VITE_API_BASE_URL`, and Caddy supports the upgrade transparently.
- `/health`, `/health/live`, `/health/ready`, and `/health/ai` already existed. Readiness now also
  checks Redis when `REDIS_REQUIRED=true`.

## Provider-specific and persistence assumptions

- `render.yaml` controls the existing API, AI runtime, static frontend, OCR worker, cron jobs,
  Render disks, and Neon URLs. It remains intact for rollback.
- Vite build metadata had Render-only commit/deployment fallbacks; Vercel equivalents are now
  accepted while preserving Render fallbacks.
- The API's production loopback-inference guard referred only to Render. It is now
  provider-neutral. Compose uses the internal `http://ai-runtime:4002` address.
- The old backup script supported a shell-interpolated upload command and unencrypted local dump.
  It remains for Render rollback, while the Hetzner service uses the isolated encrypted R2 backup
  implementation.
- PostgreSQL, Redis, Caddy state, AI models, and OCR models require durable named Docker volumes.
  Application uploads and backups must not depend on the container filesystem.

## Deployment blockers and assumptions

- Hetzner, DNS, Cloudflare R2, Vercel, OAuth, WebAuthn, and email/push credentials are operator
  actions; the repository cannot live-test them.
- A single-server deployment has a server-level failure domain. R2 logical backups are not a live
  replica and do not provide automatic failover.
- Initial model and OCR assets require adequate disk, RAM, and possibly outbound network access.
- Cross-site auth depends on keeping the frontend and API under the same registrable domain
  (`soko.market`) with exact CORS origins, secure HttpOnly cookies, and matching OAuth/WebAuthn
  settings.
