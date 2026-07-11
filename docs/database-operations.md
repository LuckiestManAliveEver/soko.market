# Database operations

Soko.market uses Postgres with Drizzle-managed SQL migrations. Production runtime must not create or mutate schema at API startup; schema changes are applied through the migration command before the API starts.

## Required environment variables

Use a pooled database URL for application runtime:

```bash
DATABASE_URL=postgresql://...
```

Use a direct/admin URL for migrations and maintenance when the provider gives one:

```bash
DIRECT_DATABASE_URL=postgresql://...
```

If `DIRECT_DATABASE_URL` is not set, migration, backup, and restore commands fall back to `DATABASE_URL`.

## Run migrations

```bash
pnpm db:migrate
```

The migration runner:

- reads SQL files from `infra/db/migrations`;
- records applied files in `soko_schema_migrations`;
- verifies checksums on already-applied migrations;
- uses an advisory lock so two deploys do not apply migrations concurrently.

Render runs this during the API build before the compiled API starts.

## Create a backup

Install PostgreSQL client tools locally so `pg_dump` is available, then run:

```bash
DIRECT_DATABASE_URL=postgresql://... pnpm db:backup
```

Backups are written to `backups/` and ignored by Git.

For production, create a backup before every migration that changes tables, constraints, indexes, or data shape.

## Restore a backup

Restores are destructive. Use only against the intended target database.

```bash
DIRECT_DATABASE_URL=postgresql://... DB_RESTORE_FILE=backups/soko-market-YYYY-MM-DD.dump pnpm db:restore
```

The restore command uses `pg_restore --clean --if-exists --no-owner`.

## Rollback procedure

Forward-only migrations are the default.

If a deployment fails after a migration:

1. Stop or roll back the API deploy.
2. Decide whether the failed app version can run against the migrated schema.
3. If not, restore the latest pre-migration backup into a replacement database or branch.
4. Point `DATABASE_URL` and `DIRECT_DATABASE_URL` at the restored database.
5. Redeploy the last known-good API commit.
6. Preserve the failed database until the incident review is complete.

Do not manually delete rows from `soko_schema_migrations` in production unless you are restoring the whole database to a known snapshot.

## Runtime persistence policy

The API must fail fast when migrations are missing. It should not create tables from application startup code. This keeps deploys deterministic and makes schema changes auditable.
