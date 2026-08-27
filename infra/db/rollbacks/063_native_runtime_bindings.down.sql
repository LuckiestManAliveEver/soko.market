alter table conversations drop constraint if exists conversations_runtime_binding_fk;
alter table conversations drop column if exists runtime_binding_id;
alter table cp2_conversations drop constraint if exists cp2_conversations_runtime_binding_fk;
alter table cp2_conversations drop column if exists runtime_binding_id;
-- The dropped column above only removes the generated projection. Strip the underlying JSON key
-- too, or a later re-application of 063 recomputes it from stale data before the referenced
-- binding rows exist again and the new foreign key fails immediately.
update cp2_conversations set record = record - 'runtimeBindingId' where record ? 'runtimeBindingId';
drop function if exists check_native_runtime_binding_primary() cascade;
drop table if exists cp2_native_runtime_binding_models;
drop table if exists cp2_native_runtime_bindings;
drop table if exists cp2_native_model_installations;
drop table if exists cp2_native_execution_hosts;
drop table if exists cp2_native_runtime_models;
drop table if exists cp2_native_runtime_agents;
