-- Best-effort rollback of 068_remove_cloud_fallback.sql. The forward migration deletes JSON keys
-- and archives rows rather than overwriting values, so the exact prior fallbackPolicy/
-- fallbackModelId/allowBackendFallback values (and which specific recall sources were active) are
-- not recoverable - only the application's row snapshot taken before 068 ran has that. This
-- restores the feature to its default-off shape (present again, disabled) and reactivates the
-- recall sources this migration archived, which is what "rolling back a feature removal" means
-- when the removal itself was non-destructive at the row level (archive, not delete).

update cp2_agent_model_bindings
set record = jsonb_set(
    jsonb_set(record, '{fallbackPolicy}', '"NEVER"'::jsonb, true),
    '{fallbackModelId}',
    'null'::jsonb,
    true
  ),
  updated_at = now()
where record ->> 'status' <> 'unavailable';

update cp2_agent_model_bindings
set record = jsonb_set(record, '{permissions,allowBackendFallback}', 'false'::jsonb, true),
  updated_at = now()
where record -> 'permissions' is not null
  and not (record -> 'permissions' ? 'allowBackendFallback');

update cp2_agent_model_assignments
set record = jsonb_set(record, '{fallbackPolicy}', '"NEVER"'::jsonb, true),
  updated_at = now()
where not (record ? 'fallbackPolicy');

update cp2_agent_context_sources
set record = jsonb_set(
    jsonb_set(record, '{status}', '"active"'::jsonb, true),
    '{deletedAt}',
    'null'::jsonb,
    true
  ),
  updated_at = now()
where record ->> 'type' = 'recall'
  and record ->> 'status' = 'archived';
