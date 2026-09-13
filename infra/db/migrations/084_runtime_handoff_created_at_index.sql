-- Runtime Handoff created-at index and integrity constraint.
--
-- 083_runtime_handoff_protocol.sql originally shipped with an index on a plain `created_at`
-- column that cp2_runtime_handoffs never had (the table only ever generated task_id/updated_at -
-- see 083's table definition), which crashed the Render deploy with Postgres error 42703. Commit
-- 5cfe0ed removed the broken index to stop the crash, but never replaced it: checkpoints for a
-- task have had no created_at-ordered index since. 083 is already applied in production, so per
-- this repository's migration rules it is never edited after the fact - the real fix (the correct
-- expression index, plus the not-null guarantee it depends on) belongs in its own migration
-- instead. See tests/runtime-handoff-protocol-migration.test.ts for the regression coverage.
--
-- The index expression reads the JSON field directly - `(record ->> 'createdAt') desc` - rather
-- than casting to `timestamp with time zone` inside a generated column, since a text-to-timestamptz
-- cast is STABLE, not IMMUTABLE, in Postgres and a generated column requires an immutable
-- expression (078_commercial_history.sql already avoids this same trap).

alter table cp2_runtime_handoffs
  add constraint cp2_runtime_handoffs_created_at_check check (record ->> 'createdAt' is not null);

create index if not exists cp2_runtime_handoffs_task_created_idx
  on cp2_runtime_handoffs (task_id, (record ->> 'createdAt') desc);
