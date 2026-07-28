# Cloudflare R2

R2 stores private binary objects and encrypted logical backups. It is not the relational database,
a PostgreSQL replica, or an automatic failover mechanism.

## Setup

Create a private bucket. Create separate least-privilege credentials:

1. API/worker credentials limited to application object prefixes.
2. Backup credentials limited to `BACKUP_R2_PREFIX`.
3. Operator restore credentials with read access to backups, issued only where needed.

Configure:

```text
R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
R2_REGION=auto
R2_BUCKET_NAME=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
```

Cloudflare documents the account endpoint and S3 credentials here:
[R2 S3 authentication](https://developers.cloudflare.com/r2/api/tokens/).

Objects are private by default. The backend supports time-limited signed GET URLs; secrets are
never sent to the frontend. Cloudflare notes that presigned URLs are bearer tokens and work on the
S3 API domain, not a custom domain:
[R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

## Object layout and upload policy

Application keys follow:

```text
uploads/<class>/<tenant>/<year>/<month>/<uuid>-<sanitized-name>
```

Supported classes are product images, catalogue media, receipt images, context documents, general
user uploads, model artifacts, and generated exports. The API:

- authorizes the business action before processing bytes
- limits uploads to 10 MiB
- validates allowlisted MIME types and common magic bytes
- computes SHA-256 metadata
- uses collision-resistant keys
- stores only keys/provenance in PostgreSQL
- never uses durable container-local storage

The existing signed HTTP scanner/storage provider remains available. Set
`REQUIRE_OBJECT_STORAGE=true` in production so missing R2/provider configuration fails startup.

For OCR, `OCR_RETAIN_SOURCE_OBJECTS=false` preserves the current source-retention behavior. Set it
to `true` only after confirming the product/privacy retention requirement and implementing any
required object deletion lifecycle.

## Backup operations

The scheduler accepts a daily UTC expression of the form `minute hour * * *`. Manual backup:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml \
  run --rm postgres-backup node backup-r2.mjs
```

The service runs `pg_dump -Fc`, encrypts with GnuPG AES-256/OpenPGP integrity protection, uploads
to the private backup prefix, verifies remote size, prunes expired encrypted dumps, and removes its
temporary directory.

Verify an archive without restoring:

```bash
RESTORE_OBJECT_KEY='database-backups/YYYY/MM/FILE.dump.gpg' \
docker compose --env-file .env.production -f docker-compose.production.yml \
  run --rm -e RESTORE_OBJECT_KEY postgres-backup node verify-r2.mjs
```

Restore requires a target URL and an exact confirmation:

```bash
export RESTORE_OBJECT_KEY='database-backups/YYYY/MM/FILE.dump.gpg'
export RESTORE_DATABASE_URL='postgresql://USER:ENCODED_PASSWORD@TARGET:5432/validation_db'
export RESTORE_CONFIRM='RESTORE validation_db'
docker compose --env-file .env.production -f docker-compose.production.yml run --rm \
  -e RESTORE_OBJECT_KEY -e RESTORE_DATABASE_URL -e RESTORE_CONFIRM \
  postgres-backup node restore-r2.mjs
```

This restores into an empty database by default. Overwriting an existing target additionally
requires `RESTORE_OVERWRITE=true`; use it only on a confirmed target after taking a fresh backup.
Never run the restore service automatically.

Rotate backup credentials and the encryption password under a documented key-retention plan.
Losing the old password makes old backups unrecoverable. Changing it does not re-encrypt existing
archives.
