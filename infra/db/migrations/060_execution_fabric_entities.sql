-- Phase 1 Execution Fabric (docs/architecture/agent-execution-fabric-phase1.md). Purely additive:
-- three new tables, no changes to any existing table, no data migrated from any existing table
-- (there is nothing to migrate from - the Phase 0 audit confirmed no `devices` table or
-- equivalent RuntimeHost concept exists in the model-execution domain today). Not yet referenced
-- by services/api/src/cp2/store.ts or postgres-store.ts - services/api/src/cp2/domains/
-- execution-fabric/store.ts is in-memory only in this phase; wiring these tables into that store
-- is Phase 2 work, done alongside cutover.

create table if not exists cp2_model_preferences (
  entity_id text primary key check (
    entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  business_id text not null references cp2_businesses(entity_id) on delete cascade,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint cp2_model_preferences_scope_check
    check (
      record ? 'scope'
      and record ->> 'scope' in ('system', 'user', 'agent', 'conversation', 'request')
      and record ? 'scopeId'
      and char_length(record ->> 'scopeId') between 1 and 120
    )
);

-- At most one preference record per (tenant, scope, scopeId) - matches how the planner resolves
-- exactly one candidate per precedence level.
create unique index if not exists cp2_model_preferences_scope_idx
  on cp2_model_preferences (business_id, (record ->> 'scope'), (record ->> 'scopeId'));

create table if not exists cp2_runtime_hosts (
  entity_id text primary key check (
    entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  business_id text,
  account_id text not null references cp2_accounts(entity_id) on delete cascade,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint cp2_runtime_hosts_identity_check
    check (
      record ? 'name'
      and char_length(record ->> 'name') between 1 and 120
      and record ? 'trustLevel'
      and record ->> 'trustLevel' in ('owner-verified', 'unverified')
    )
);

-- RuntimeHost is deliberately account-scoped, not business-scoped: one owner's registered host can
-- serve any of their shops (Phase 0 audit §1 found no existing "agent belongs to a device"
-- coupling to preserve, so this does not need to mirror agent/business scoping).
create index if not exists cp2_runtime_hosts_account_idx on cp2_runtime_hosts (account_id);

-- No liveness/heartbeat column, and none should ever be added here - per
-- docs/inference/owner-node.md:32, online/offline state is derived at read time from
-- OwnerNodeBroker's in-memory presence, keyed by the record's own brokerNodeId field.
create index if not exists cp2_runtime_hosts_broker_node_idx
  on cp2_runtime_hosts ((record ->> 'brokerNodeId'))
  where record ->> 'brokerNodeId' is not null;

create table if not exists cp2_runtime_model_installations (
  entity_id text primary key check (
    entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  business_id text,
  account_id text not null references cp2_accounts(entity_id) on delete cascade,
  user_id text,
  parent_id text references cp2_runtime_hosts(entity_id) on delete cascade,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  constraint cp2_runtime_model_installations_identity_check
    check (
      record ? 'modelId'
      and char_length(record ->> 'modelId') between 1 and 180
      and record ? 'status'
      and record ->> 'status' in ('installed', 'removed')
    )
);

create index if not exists cp2_runtime_model_installations_host_idx
  on cp2_runtime_model_installations (parent_id);

create index if not exists cp2_runtime_model_installations_model_idx
  on cp2_runtime_model_installations ((record ->> 'modelId'));
