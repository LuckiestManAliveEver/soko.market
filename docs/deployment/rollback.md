# Production rollback

Rollback is split into application, infrastructure, and database decisions. Never automatically
reverse SQL migrations; the migration set is forward-only unless a migration has an explicitly
tested reverse procedure.

## Application image rollback

Images use immutable commit SHA tags. Keep the previous known-good SHA:

```bash
export IMAGE_TAG=PREVIOUS_COMMIT_SHA
docker compose --env-file .env.production -f docker-compose.production.yml pull api worker ai-runtime receipt-ocr postgres-backup
docker compose --env-file .env.production -f docker-compose.production.yml \
  up -d --no-deps api worker ai-runtime receipt-ocr postgres-backup
curl --fail https://api.soko.market/health/ready
```

This does not roll back PostgreSQL. Confirm the previous code is forward-compatible with migrations
already applied. If not, keep the new code path disabled/configured safely and fix forward.

## Backend rollback to Render

Render configuration remains in `render.yaml`. Keep its services and secrets available during the
rollback window. Point the frontend `VITE_API_BASE_URL` back to the Render API hostname, restore the
matching exact CORS/OAuth/WebAuthn settings, deploy Vercel, and validate authentication and
WebSockets before directing all users back.

DNS TTLs should be lowered before cutover and restored afterward. Do not delete Caddy certificates,
Docker volumes, Hetzner data, R2 objects, or the new database while investigating.

## Database rollback to Neon

- Before Hetzner accepts writes: restore the saved Neon URLs and restart the previous backend.
- After Hetzner accepts writes: freeze writes and reconcile/export the new data before switching.
  Never point two active write-capable backends at divergent databases.
- Keep a fresh encrypted Hetzner backup even when returning to Neon.

## R2 rollback

The signed HTTP storage adapter remains supported. Changing providers does not automatically copy
or delete objects. Preserve R2 credentials and objects until database keys/provenance have been
audited and any provider migration has been verified.

Record the incident timeline, image SHAs, migration state, row-count checks, DNS/Vercel changes,
and operator approvals. A rollback is complete only after health, login, writes, realtime, uploads,
workers, and backup monitoring are green.
