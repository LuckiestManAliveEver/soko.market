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

Render runs this as the API `preDeployCommand`. This keeps schema changes in a release phase instead of coupling them to TypeScript compilation.

The API will fail startup if the latest required migration has not been applied.

## Verify schema without writing application data

When only one managed database branch is available, verify the deployed schema with:

```bash
DIRECT_DATABASE_URL=postgresql://... pnpm db:verify-schema
```

This opens a read-only transaction and verifies the migration 018 and 019 checksums, sync and MCP
token table columns, and required constraint types. It does not create test accounts, shops,
products, sync records, or access tokens.

## Create a backup

Install PostgreSQL client tools locally so `pg_dump` is available, then run:

```bash
DIRECT_DATABASE_URL=postgresql://... pnpm db:backup
```

Backups are written to `backups/` and ignored by Git. Production backups must leave ephemeral runtime storage. Set:

```bash
BACKUP_UPLOAD_COMMAND='aws s3 cp {file} s3://your-private-bucket/soko-market/'
BACKUP_RETENTION_DAYS=14
```

`{file}` is replaced with the generated dump path. The backup command records each run in `database_backup_runs`.

For production, create a backup before every migration that changes tables, constraints, indexes, or data shape.

Render also defines a daily `soko-market-db-backup` cron service. It intentionally fails in production unless `BACKUP_UPLOAD_COMMAND` is configured.

## Verify a backup

```bash
DB_BACKUP_FILE=backups/soko-market-YYYY-MM-DD.dump pnpm db:backup:verify
```

This runs `pg_restore --list` and records the operational path for restore drills. A production restore drill should be performed against a disposable database branch at least monthly.

## Restore a backup

Restores are destructive. Use only against the intended target database.

```bash
DIRECT_DATABASE_URL=postgresql://... DB_RESTORE_FILE=backups/soko-market-YYYY-MM-DD.dump pnpm db:restore
```

The restore command uses `pg_restore --clean --if-exists --no-owner`.

## Rollback procedure

Forward-only migrations are the default, but paired rollback SQL lives in `infra/db/rollbacks` for migrations where rollback is technically possible.

To roll back the latest migration:

```bash
ALLOW_DB_ROLLBACK=true DB_ROLLBACK_STEPS=1 DIRECT_DATABASE_URL=postgresql://... pnpm db:rollback
```

Rollback deletes the corresponding row from `soko_schema_migrations` and records the rollback in `soko_schema_rollbacks`.

If a deployment fails after a migration:

1. Stop or roll back the API deploy.
2. Decide whether the failed app version can run against the migrated schema.
3. If not, restore the latest pre-migration backup into a replacement database or branch.
4. Point `DATABASE_URL` and `DIRECT_DATABASE_URL` at the restored database.
5. Redeploy the last known-good API commit.
6. Preserve the failed database until the incident review is complete.

Do not manually delete rows from `soko_schema_migrations` in production unless you are restoring the whole database to a known snapshot.

## Runtime persistence policy

The API must fail fast when migrations are missing. It must not create tables from application startup code. This keeps deploys deterministic and makes schema changes auditable.

Core business records hydrate from relational tables. The `cp2_*` tables remain as compatibility tables for non-core CP2 collections while the API surface is incrementally moved to direct relational access.

## Monitoring and pool settings

Use:

```bash
DIRECT_DATABASE_URL=postgresql://... pnpm db:health
```

This checks connectivity, records the result in `database_health_checks`, and prints the latest applied migration.

Runtime pool controls:

```bash
DB_POOL_MAX=5
DB_CONNECTION_TIMEOUT_MS=5000
DB_IDLE_TIMEOUT_MS=30000
DB_QUERY_TIMEOUT_MS=15000
DB_STATEMENT_TIMEOUT_MS=15000
DB_SLOW_QUERY_MS=500
```

Slow persistence operations are logged by the API when they exceed `DB_SLOW_QUERY_MS`.

## Failover

For managed Postgres providers such as Neon:

1. Use a pooled `DATABASE_URL` for runtime traffic.
2. Use a direct `DIRECT_DATABASE_URL` for migrations, backups, restores, and health checks.
3. Keep a documented fallback database branch or restored database URL available.
4. During an incident, update both database URLs together and redeploy the API.
5. Run `pnpm db:health` after failover before sending traffic back to the API.
