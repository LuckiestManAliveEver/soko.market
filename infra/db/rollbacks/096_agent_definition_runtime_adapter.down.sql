-- Restores the pre-migration constraint (runtimeAdapterId no longer required) and removes the
-- Pi engine's built-in agent definition row. The backfilled runtimeAdapterId left on
-- builtin:shopkeeper is harmless and left in place rather than stripped back out.

delete from cp2_agent_catalog where entity_id = 'builtin:pi-assistant';

alter table cp2_agent_catalog
  drop constraint cp2_agent_catalog_record_check;

alter table cp2_agent_catalog
  add constraint cp2_agent_catalog_record_check check (
    jsonb_typeof(record) = 'object'
    and record ?& array['id', 'displayName', 'instructions', 'tools', 'skillIds']
    and record ->> 'id' = entity_id
    and char_length(record ->> 'id') between 1 and 220
    and char_length(record ->> 'displayName') between 1 and 200
    and char_length(record ->> 'instructions') between 1 and 20000
    and jsonb_typeof(record -> 'tools') = 'array'
    and jsonb_typeof(record -> 'skillIds') = 'array'
  );
