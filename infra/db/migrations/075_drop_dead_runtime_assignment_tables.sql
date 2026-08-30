-- Drops cp2_agent_model_assignments (created 035_agent_model_assignments.sql) and
-- cp2_browser_inference_assignments (created 041_browser_inference_assignments.sql). Both are dead
-- in application code today: services/api/src/cp2/postgres-store.ts's normalizedCollections table
-- registry has never listed either (confirmed by grep across the whole services/api/src tree), the
-- Cp2Snapshot type has no corresponding field, and neither AgentRuntimeDomain nor any other domain
-- store holds a backing Map for them - they were superseded by cp2_agent_model_bindings (040) and
-- the (now also retired, see 076) native/legacy runtime binding graph before this consolidation
-- ever started. tests/agent-model-migration.test.ts and
-- tests/browser-inference-assignment-migration.test.ts already document and assert this dead state
-- directly against migration history, not live schema, so they need no change.
--
-- Only application-reachable references matter here (see scripts/check-retired-runtime-references.mjs,
-- extended by this consolidation to cover these two tables): the one-time backfill read in
-- 040_agent_model_runtime_bindings.sql and the one-time archival write in
-- 068_remove_cloud_fallback.sql are historical migration statements, replayed only against the
-- schema state that existed when they originally ran - dropping the table now does not rewrite or
-- invalidate that history.

drop table cp2_agent_model_assignments;
drop table cp2_browser_inference_assignments;
