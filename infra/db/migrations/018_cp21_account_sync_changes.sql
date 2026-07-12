create table if not exists account_sync_changes (
  account_id uuid not null references accounts (id) on delete cascade,
  sequence bigint not null check (sequence > 0),
  cursor uuid not null unique,
  collection text not null check (
    collection in ('session_context', 'shops', 'conversations', 'conversation_messages')
  ),
  entity_id text not null,
  operation text not null check (operation in ('upsert', 'delete')),
  shop_id uuid,
  entity jsonb,
  changed_at timestamp with time zone not null,
  tombstone_expires_at timestamp with time zone,
  primary key (account_id, sequence),
  check (
    (operation = 'upsert' and entity is not null and tombstone_expires_at is null)
    or
    (operation = 'delete' and entity is null and tombstone_expires_at is not null)
  )
);

create index if not exists account_sync_changes_account_sequence_idx
  on account_sync_changes (account_id, sequence);

create index if not exists account_sync_changes_tombstone_expiry_idx
  on account_sync_changes (tombstone_expires_at)
  where operation = 'delete';
