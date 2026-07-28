# Neon to Hetzner PostgreSQL cutover

Use a maintenance window. This repository intentionally does not automate write freezing, final
production export, destructive restore, DNS changes, or Neon deletion.

## Rehearsal

1. Deploy the Hetzner stack against Neon first by setting both database URLs to the existing Neon
   direct connection. Validate authentication, WebSockets, workers, OCR, AI, and R2.
2. Create a staging database in the Hetzner PostgreSQL container.
3. Export Neon from a secured operator host:

   ```bash
   umask 077
   pg_dump --dbname='NEON_DIRECT_URL' --format=custom --no-owner --no-acl \
     --file=neon-rehearsal.dump
   sha256sum neon-rehearsal.dump
   ```

4. Transfer with `scp`/SFTP over the restricted SSH path. Do not commit or place the dump in the
   repository.
5. Restore to the staging database:

   ```bash
   docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres \
     createdb -U "$POSTGRES_USER" soko_rehearsal
   docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres \
     pg_restore -U "$POSTGRES_USER" -d soko_rehearsal --no-owner --no-acl --exit-on-error \
     < neon-rehearsal.dump
   ```

6. Compare table row counts, latest `soko_schema_migrations` filename/checksum, constraints, and
   representative application records. Run the API against the rehearsal database on a staging
   hostname.
7. Delete the transferred plaintext dump securely according to the host's storage capabilities and
   retention policy.

## Controlled cutover

1. Confirm a tested Render/Neon application image and record current environment values.
2. Enable application maintenance/read-only mode using the operational mechanism selected for the
   launch. If no write-freeze mechanism exists, stop all write-capable API/worker instances for the
   short window.
3. Confirm Neon active connections have drained. Take a final custom-format dump and checksum it.
4. Restore into a new empty Hetzner database. Do not restore over the rehearsal database.
5. Validate migration history and row counts before accepting traffic.
6. Set Hetzner `DATABASE_URL` and `DIRECT_DATABASE_URL` to the internal
   `postgresql://...@postgres:5432/...` URL.
7. Run the one-shot migration service, then start API/worker services.
8. Run `scripts/production-diagnostics.sh`, authentication, mutation/persistence, WebSocket,
   upload/OCR, and worker smoke tests.
9. Re-enable writes and monitor error rate, database connections, disk, and backup results.

There is no generic live delta replication in this implementation. The controlled write freeze and
final dump are what prevent lost writes.

## Rollback during the window

If validation fails before writes resume, stop Hetzner API/worker services, restore the saved Neon
URLs to Render/Hetzner as applicable, start the prior application, validate it, and re-enable
writes.

If writes have already resumed on Hetzner, switching back to the old Neon snapshot would lose those
writes. Freeze writes again, export the Hetzner delta/full database, reconcile it deliberately, and
only then restore service on Neon. Keep both databases isolated from concurrent writes to prevent
split-brain.

Retain Neon unchanged and access-restricted for the agreed rollback period. Deactivation is a
separate explicit operator decision after restore tests and business sign-off.
