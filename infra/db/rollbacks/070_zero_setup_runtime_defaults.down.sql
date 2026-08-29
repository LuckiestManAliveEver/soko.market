drop index if exists cp2_native_runtime_bindings_one_tenant_default_idx;

update cp2_native_execution_hosts
set record = jsonb_set(record, '{status}', '"available"'::jsonb, true),
  updated_at = now()
where record ->> 'status' in ('online', 'healthy');

update cp2_native_execution_hosts
set record = jsonb_set(record, '{status}', '"unavailable"'::jsonb, true),
  updated_at = now()
where record ->> 'status' in (
  'registered', 'temporarily-unavailable', 'disabled', 'incompatible'
);

alter table cp2_native_execution_hosts
  drop constraint if exists cp2_native_execution_hosts_record_check;

alter table cp2_native_execution_hosts
  add constraint cp2_native_execution_hosts_record_check check (
    record ->> 'status' in ('available', 'unavailable')
    and not (coalesce(record ->> 'endpoint', '') ~* '://[^/@:]+:[^/@]+@')
    and not (coalesce(record ->> 'endpoint', '') ~* '[?&](api_key|apikey|token|password|secret)=')
  );

update cp2_native_runtime_bindings
set record = jsonb_set(record, '{isDefault}', 'false'::jsonb, true),
  updated_at = now()
where business_id is not null
  and record ->> 'isDefault' = 'true';

alter table cp2_native_runtime_bindings
  drop constraint if exists cp2_native_runtime_bindings_default_scope_check;

alter table cp2_native_runtime_bindings
  add constraint cp2_native_runtime_bindings_default_scope_check check (
    record ->> 'isDefault' <> 'true' or (business_id is null and account_id is null)
  );
