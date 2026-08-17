create table if not exists buy_orders (
  entity_id text primary key,
  business_id text,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now()
);

create table if not exists status_orders (
  entity_id text primary key,
  business_id text,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now()
);

create table if not exists unified_checkouts (
  entity_id text primary key,
  business_id text,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now()
);

create index if not exists buy_orders_business_updated_idx
  on buy_orders (business_id, updated_at desc)
  where business_id is not null;

create index if not exists buy_orders_account_updated_idx
  on buy_orders (account_id, updated_at desc)
  where account_id is not null;

create index if not exists status_orders_account_updated_idx
  on status_orders (account_id, updated_at desc)
  where account_id is not null;

create index if not exists unified_checkouts_account_updated_idx
  on unified_checkouts (account_id, updated_at desc)
  where account_id is not null;

comment on table buy_orders is
  'Authenticated-buyer catalogue orders created by the unified checkout flow - the buyer-session equivalent of a public storefront order, one per distinct catalogue source in a checkout.';
comment on table status_orders is
  'Pickup requests against a contact status broadcast, created by the unified checkout flow. No invoice/payment fields - settlement between buyer and seller-contact happens out of band.';
comment on table unified_checkouts is
  'Correlates every buy_order/status_order a single checkout action fanned out into, plus any per-item failures surfaced rather than silently dropped.';
