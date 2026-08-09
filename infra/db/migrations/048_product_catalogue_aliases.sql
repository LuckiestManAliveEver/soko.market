alter table products
  add column if not exists aliases text[] not null default array[]::text[];

create index if not exists products_business_name_lower_idx
  on products (business_id, lower(name));
