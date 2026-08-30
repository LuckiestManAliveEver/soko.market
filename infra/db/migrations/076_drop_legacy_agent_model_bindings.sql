-- Drops cp2_agent_model_bindings (created 040_agent_model_runtime_bindings.sql), the last
-- remaining legacy runtime-binding representation. Before this consolidation,
-- AgentRuntimeDomain.activateAgentModel dual-wrote every successful activation into both this
-- table and the native runtime graph (cp2_native_runtime_bindings/_binding_models), but only
-- READ from this table - native-runtime-routing.ts also kept a "legacy binding" fallback tier that
-- could disagree with the native graph. That dual-write/dual-read is now gone:
-- NativeRuntimeBindingStore (services/api/src/cp2/domains/native-runtime/store.ts) is the sole
-- runtime-binding source of truth end to end. See docs/adr/ADR-default-runtime-pi-smollm.md.
--
-- SAFETY: this migration does not itself backfill anything. Any environment where
-- services/api/scripts/backfill-native-runtime-bindings.mjs (`pnpm db:backfill-native-runtime`)
-- has not already run against this database MUST run it first - it is idempotent (upsert
-- semantics) and safe to re-run. The guard below fails loudly instead of silently dropping an
-- active legacy binding nothing else has a record of, rather than trusting deploy-order alone.
do $$
declare
  orphaned_binding_count integer;
begin
  select count(*) into orphaned_binding_count
  from cp2_agent_model_bindings legacy
  where legacy.record ->> 'status' = 'active'
    and legacy.record ->> 'lastVerificationStatus' = 'passed'
    and not exists (
      select 1
      from cp2_native_runtime_bindings native
      where native.business_id is not distinct from legacy.business_id
        and native.account_id is not distinct from legacy.account_id
        and native.record ->> 'agentId' = legacy.record ->> 'agentId'
        and native.record ->> 'status' = 'active'
    );

  if orphaned_binding_count > 0 then
    raise exception
      '% active legacy agent-model binding(s) have no corresponding active native runtime '
      'binding. Run `pnpm db:backfill-native-runtime` (services/api/scripts/'
      'backfill-native-runtime-bindings.mjs) against this database before applying this '
      'migration.', orphaned_binding_count;
  end if;
end;
$$;

drop table cp2_agent_model_bindings;
