-- Enables deterministic shop-scoped default bindings for zero-setup first chat. The global draft
-- binding remains the safe bootstrap slot; a tenant default is created lazily only after a
-- configured execution adapter reports a compatible model as available.

alter table cp2_native_runtime_bindings
  drop constraint if exists cp2_native_runtime_bindings_default_scope_check;

alter table cp2_native_runtime_bindings
  add constraint cp2_native_runtime_bindings_default_scope_check check (
    record ->> 'isDefault' <> 'true'
    or (business_id is null and account_id is null)
    or (business_id is not null and account_id is not null)
  );

create unique index if not exists cp2_native_runtime_bindings_one_tenant_default_idx
  on cp2_native_runtime_bindings (business_id, account_id)
  where record ->> 'isDefault' = 'true'
    and record ->> 'status' = 'active'
    and business_id is not null
    and account_id is not null;

comment on index cp2_native_runtime_bindings_one_tenant_default_idx is
  'Concurrency guard for idempotent zero-setup runtime provisioning per shop/account.';

alter table cp2_native_execution_hosts
  drop constraint if exists cp2_native_execution_hosts_record_check;

alter table cp2_native_execution_hosts
  add constraint cp2_native_execution_hosts_record_check check (
    record ->> 'status' in (
      'registered',
      'online',
      'healthy',
      'temporarily-unavailable',
      'disabled',
      'incompatible',
      'available',
      'unavailable'
    )
    and not (coalesce(record ->> 'endpoint', '') ~* '://[^/@:]+:[^/@]+@')
    and not (coalesce(record ->> 'endpoint', '') ~* '[?&](api_key|apikey|token|password|secret)=')
  );
