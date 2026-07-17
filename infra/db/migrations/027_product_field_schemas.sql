create table if not exists cp2_product_field_schemas (
  entity_id text primary key,
  business_id text,
  account_id text,
  user_id text,
  parent_id text,
  record jsonb not null,
  updated_at timestamp with time zone not null default now()
);

create index if not exists cp2_product_field_schemas_business_idx
  on cp2_product_field_schemas (business_id)
  where business_id is not null;
