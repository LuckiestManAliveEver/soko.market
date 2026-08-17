create table if not exists status_broadcasts (
  entity_id text primary key,
  business_id text,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now()
);

create index if not exists status_broadcasts_business_updated_idx
  on status_broadcasts (business_id, updated_at desc)
  where business_id is not null;

create index if not exists status_broadcasts_state_idx
  on status_broadcasts (business_id, (record ->> 'state'))
  where business_id is not null;

comment on table status_broadcasts is
  'Trackable seller status posts broadcast from a confirmed product capture to chosen contacts - distinct from a plain conversation message, with recipient delivery channel and view/reply/order counters in the record payload.';
