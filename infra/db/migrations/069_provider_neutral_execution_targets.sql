-- Removes the legacy provider-specific `openai` execution target without changing model/provider
-- identity. OpenAI-backed model rows keep their existing `provider` and `providerModelId`; only
-- the independently resolved execution path becomes the provider-neutral backend path.

-- Retain exact pre-migration envelopes so a coordinated rollback to the older application can
-- restore the rows without guessing at provider identity, host metadata, or later JSON fields.
create table migration_069_execution_target_backup (
  source_table text not null,
  entity_id text not null,
  record jsonb not null,
  updated_at timestamp with time zone not null,
  primary key (source_table, entity_id),
  constraint migration_069_execution_target_backup_source_check
    check (
      source_table in (
        'cp2_native_runtime_models',
        'cp2_native_execution_hosts',
        'cp2_agent_model_bindings'
      )
    )
);

insert into migration_069_execution_target_backup (source_table, entity_id, record, updated_at)
select 'cp2_native_runtime_models', model.entity_id, model.record, model.updated_at
from cp2_native_runtime_models model
where model.record #>> '{configuration,executionTarget}' = 'openai'
  or model.entity_id in (
    select installation.record ->> 'modelId'
    from cp2_native_model_installations installation
    join cp2_native_execution_hosts host
      on host.entity_id = installation.record ->> 'executionHostId'
    where host.record ->> 'type' = 'openai'
      and nullif(host.record ->> 'credentialReference', '') is not null
  );

insert into migration_069_execution_target_backup (source_table, entity_id, record, updated_at)
select 'cp2_native_execution_hosts', host.entity_id, host.record, host.updated_at
from cp2_native_execution_hosts host
where host.record ->> 'type' = 'openai'
  or host.record #>> '{configuration,executionTarget}' = 'openai';

insert into migration_069_execution_target_backup (source_table, entity_id, record, updated_at)
select 'cp2_agent_model_bindings', binding.entity_id, binding.record, binding.updated_at
from cp2_agent_model_bindings binding
where binding.record ->> 'executionTarget' = 'openai';

-- Preserve provider credential references on the model/provider side before execution hosts are
-- neutralized. The runtime reads provider credentials from operator configuration today, but this
-- keeps the persisted control-plane identity intact for future provider registries.
with model_credentials as (
  select
    installation.record ->> 'modelId' as model_id,
    min(host.record ->> 'credentialReference') as credential_reference
  from cp2_native_model_installations installation
  join cp2_native_execution_hosts host
    on host.entity_id = installation.record ->> 'executionHostId'
  where host.record ->> 'type' = 'openai'
    and nullif(host.record ->> 'credentialReference', '') is not null
  group by installation.record ->> 'modelId'
)
update cp2_native_runtime_models model
set record = jsonb_set(
    model.record,
    '{configuration,providerCredentialReference}',
    to_jsonb(model_credentials.credential_reference),
    true
  ),
  updated_at = now()
from model_credentials
where model.entity_id = model_credentials.model_id;

update cp2_native_runtime_models
set record = jsonb_set(
    jsonb_set(record, '{configuration,legacyExecutionTarget}', '"openai"'::jsonb, true),
    '{configuration,executionTarget}',
    '"backend"'::jsonb,
    true
  ),
  updated_at = now()
where record #>> '{configuration,executionTarget}' = 'openai';

update cp2_native_execution_hosts
set record = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(record, '{type}', '"backend"'::jsonb, true),
        '{name}',
        '"Backend execution runtime"'::jsonb,
        true
      ),
      '{capabilities}',
      ((coalesce(record -> 'capabilities', '[]'::jsonb) - 'openai' - 'backend') || '["backend"]'::jsonb),
      true
    ),
    '{configuration}',
    coalesce(record -> 'configuration', '{}'::jsonb)
      || '{"executionTarget":"backend","legacyExecutionTarget":"openai"}'::jsonb,
    true
  ) || jsonb_build_object('credentialReference', null),
  updated_at = now()
where record ->> 'type' = 'openai'
  or record #>> '{configuration,executionTarget}' = 'openai';

update cp2_agent_model_bindings
set record = jsonb_set(record, '{executionTarget}', '"backend"'::jsonb, true),
  updated_at = now()
where record ->> 'executionTarget' = 'openai';

alter table cp2_agent_model_bindings
  drop constraint if exists cp2_agent_model_bindings_target_check;

alter table cp2_agent_model_bindings
  add constraint cp2_agent_model_bindings_target_check
  check (
    record ->> 'executionTarget' in (
      'backend',
      'browser-local',
      'installed-app',
      'remote-shop-device'
    )
  );
