create table if not exists cp2_account_deletion_proofs (
  entity_id text primary key,
  business_id text,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now()
);

create index if not exists cp2_account_deletion_proofs_updated_idx
  on cp2_account_deletion_proofs (updated_at desc);

comment on table cp2_account_deletion_proofs is
  'Non-identifying completion evidence and external processor receipts for expired account purges.';
