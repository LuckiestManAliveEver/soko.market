create table if not exists cp2_message_notification_deliveries (
  entity_id text primary key,
  business_id text,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now()
);

create index if not exists cp2_message_notification_deliveries_account_idx
  on cp2_message_notification_deliveries (account_id)
  where account_id is not null;

create index if not exists cp2_message_notification_deliveries_status_idx
  on cp2_message_notification_deliveries ((record ->> 'status'), (record ->> 'nextAttemptAt'));
