-- Removes the automatic local-to-cloud model escalation feature ("cloud fallback") and its
-- companion recall-distillation loop end to end. The application no longer reads, writes, or
-- acts on any of the keys this migration strips - see docs/architecture/provider-neutral-runtime.md
-- and the removal of AgentModelFallbackPolicy / AgentModelBindingPermissions.allowBackendFallback /
-- AgentModelBindingSummary.fallbackModelId / AgentModelAssignmentSummary.fallbackPolicy from
-- packages/shared-types/src/index.ts.
--
-- These are JSONB-blob-per-row tables (a `record` column, not per-field SQL columns), so "dropping
-- a column" means removing the corresponding key from every existing row's JSON instead of an
-- ALTER TABLE. Leaving the stale keys in place would not break anything at runtime (the store
-- deserializes `record` structurally and no longer reads these keys), but they would sit in the
-- database as dead, confusing data forever if not cleaned up here.
--
-- Deliberately NOT touched: cp2_native_runtime_binding_models rows with role = 'fallback', and the
-- cp2_native_runtime_binding_models_fallback_priority_idx index. That is a different feature - a
-- runtime binding's own declared secondary model, used when its primary model's host becomes
-- unavailable, which can point at any execution target (not necessarily cloud) and is configured
-- explicitly ahead of time rather than triggered automatically on an inference failure. It is
-- native-runtime redundancy, not "cloud fallback", and stays.

update cp2_agent_model_bindings
set record = (record #- '{fallbackPolicy}' #- '{fallbackModelId}')
  #- '{permissions,allowBackendFallback}',
  updated_at = now()
where record ? 'fallbackPolicy'
  or record ? 'fallbackModelId'
  or record -> 'permissions' ? 'allowBackendFallback';

update cp2_agent_model_assignments
set record = record #- '{fallbackPolicy}',
  updated_at = now()
where record ? 'fallbackPolicy';

-- Recall context sources were exclusively produced by the now-removed recall-distillation loop
-- (a cloud completion following a failed local attempt, distilled into a reusable "lesson"). None
-- can ever be created again, but existing ones would otherwise keep silently influencing future
-- prompts indefinitely with no UI to review or remove them. Archive rather than hard-delete, the
-- same reversible pattern this table already uses for its own retention/dedup logic.
update cp2_agent_context_sources
set record = jsonb_set(
    jsonb_set(
      jsonb_set(record, '{status}', '"archived"'::jsonb, true),
      '{deletedAt}',
      to_jsonb(now()::text),
      true
    ),
    '{updatedAt}',
    to_jsonb(now()::text),
    true
  ),
  updated_at = now()
where record ->> 'type' = 'recall'
  and record ->> 'status' = 'active';
