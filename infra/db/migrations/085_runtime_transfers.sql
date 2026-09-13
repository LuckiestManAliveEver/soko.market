-- Mutable transfer progress alongside immutable RuntimeHandoff checkpoints. Non-destructive.
create table if not exists cp2_runtime_transfers (
  entity_id text primary key,
  business_id text,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now(),
  task_id text generated always as (record ->> 'taskId') stored not null,
  status text generated always as (record ->> 'status') stored not null,
  source_handoff_id text generated always as (record ->> 'sourceHandoffId') stored not null,
  checkpoint_id text generated always as (record ->> 'checkpointId') stored,
  source_host_id text generated always as (record ->> 'sourceHostId') stored not null,
  target_host_id text generated always as (record ->> 'targetHostId') stored not null,
  constraint cp2_runtime_transfers_state_check check (status in (
    'PENDING', 'CHECKPOINTING', 'CHECKPOINTED', 'TARGET_ACTIVATING', 'RESTORING', 'VERIFYING', 'COMPLETED', 'FAILED')),
  constraint cp2_runtime_transfers_identity_check check (
    record ->> 'accountId' is not null and record ->> 'deviceId' is not null and record ->> 'idempotencyKey' is not null
    and record ->> 'expiresAt' is not null),
  foreign key (source_handoff_id) references cp2_runtime_handoffs(entity_id),
  foreign key (checkpoint_id) references cp2_runtime_handoffs(entity_id),
  foreign key (source_host_id) references cp2_native_execution_hosts(entity_id),
  foreign key (target_host_id) references cp2_native_execution_hosts(entity_id)
);
create unique index if not exists cp2_runtime_transfers_active_idx on cp2_runtime_transfers(task_id)
  where status not in ('COMPLETED', 'FAILED');
create unique index if not exists cp2_runtime_transfers_retry_idx on cp2_runtime_transfers(
  (record ->> 'accountId'), task_id, (record ->> 'idempotencyKey'));
