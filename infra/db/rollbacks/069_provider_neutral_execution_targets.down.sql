-- Roll back only as part of a coordinated downgrade to the pre-069 application. The forward
-- migration snapshots every envelope it transforms, so this restores exact row contents instead
-- of trying to infer provider identity or host metadata from the neutralized representation.

alter table cp2_agent_model_bindings
  drop constraint if exists cp2_agent_model_bindings_target_check;

update cp2_native_runtime_models model
set record = backup.record,
  updated_at = backup.updated_at
from migration_069_execution_target_backup backup
where backup.source_table = 'cp2_native_runtime_models'
  and model.entity_id = backup.entity_id;

update cp2_native_execution_hosts host
set record = backup.record,
  updated_at = backup.updated_at
from migration_069_execution_target_backup backup
where backup.source_table = 'cp2_native_execution_hosts'
  and host.entity_id = backup.entity_id;

update cp2_agent_model_bindings binding
set record = backup.record,
  updated_at = backup.updated_at
from migration_069_execution_target_backup backup
where backup.source_table = 'cp2_agent_model_bindings'
  and binding.entity_id = backup.entity_id;

alter table cp2_agent_model_bindings
  add constraint cp2_agent_model_bindings_target_check
  check (
    record ->> 'executionTarget' in (
      'backend',
      'browser-local',
      'installed-app',
      'remote-shop-device',
      'openai'
    )
  );

drop table migration_069_execution_target_backup;
