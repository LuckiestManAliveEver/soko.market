-- Canonical contacts and immutable commercial history. These tables use the repository's
-- normalized record contract, so the existing snapshot writer persists all changed collections
-- in the same PostgreSQL transaction. Historical rows are never updated by application flows;
-- validity windows close a current relationship/price while preserving its original row.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'cp2_contacts',
    'cp2_supplier_contact_relationships',
    'cp2_purchase_price_history',
    'cp2_purchase_records',
    'cp2_sale_records',
    'cp2_locations',
    'cp2_delivery_routes',
    'cp2_delivery_route_stops'
  ]
  loop
    execute format(
      'create table if not exists %I (
        entity_id text primary key,
        business_id text,
        account_id text,
        user_id text,
        parent_id text,
        record jsonb not null,
        updated_at timestamp with time zone not null default now()
      )',
      table_name
    );
    execute format(
      'create index if not exists %I on %I (business_id) where business_id is not null',
      table_name || '_business_idx',
      table_name
    );
    execute format(
      'create index if not exists %I on %I (parent_id) where parent_id is not null',
      table_name || '_parent_idx',
      table_name
    );
  end loop;
end $$;

create index if not exists cp2_contacts_normalized_phone_idx
  on cp2_contacts (business_id, (record ->> 'normalizedPhone'))
  where record ->> 'normalizedPhone' is not null;
create index if not exists cp2_contacts_normalized_email_idx
  on cp2_contacts (business_id, (record ->> 'normalizedEmail'))
  where record ->> 'normalizedEmail' is not null;
create unique index if not exists cp2_contacts_source_identity_unique_idx
  on cp2_contacts (business_id, (record ->> 'source'), (record ->> 'sourceExternalId'))
  where record ->> 'sourceExternalId' is not null;

create index if not exists cp2_supplier_contacts_supplier_idx
  on cp2_supplier_contact_relationships (business_id, (record ->> 'supplierId'));
create index if not exists cp2_supplier_contacts_contact_idx
  on cp2_supplier_contact_relationships (business_id, (record ->> 'contactId'));

create index if not exists cp2_purchase_price_product_effective_idx
  on cp2_purchase_price_history (business_id, (record ->> 'productId'), (record ->> 'effectiveFrom') desc);
create index if not exists cp2_purchase_price_supplier_effective_idx
  on cp2_purchase_price_history (business_id, (record ->> 'supplierId'), (record ->> 'effectiveFrom') desc);
create unique index if not exists cp2_purchase_price_one_current_idx
  on cp2_purchase_price_history (business_id, (record ->> 'productId'))
  where record ->> 'effectiveTo' is null;

create index if not exists cp2_purchase_records_supplier_date_idx
  on cp2_purchase_records (business_id, (record ->> 'supplierId'), (record ->> 'effectiveAt') desc);
create unique index if not exists cp2_purchase_records_external_source_idx
  on cp2_purchase_records (business_id, (record ->> 'externalSourceId'))
  where record ->> 'externalSourceId' is not null;
create index if not exists cp2_sale_records_customer_date_idx
  on cp2_sale_records (business_id, (record ->> 'customerId'), (record ->> 'soldAt') desc);
create unique index if not exists cp2_sale_records_external_source_idx
  on cp2_sale_records (business_id, (record ->> 'externalSourceId'))
  where record ->> 'externalSourceId' is not null;
create index if not exists cp2_delivery_routes_destination_idx
  on cp2_delivery_routes (business_id, (record ->> 'destinationLocationId'));
create index if not exists cp2_delivery_routes_created_idx
  on cp2_delivery_routes (business_id, (record ->> 'createdAt') desc);

-- Existing products carry the compatibility cache. Backfill one initial immutable truth row.
insert into cp2_purchase_price_history
  (entity_id, business_id, parent_id, record, updated_at)
select
  gen_random_uuid()::text,
  product.business_id,
  product.entity_id,
  jsonb_build_object(
    'id', gen_random_uuid()::text,
    'businessId', product.business_id,
    'productId', product.entity_id,
    'productNameSnapshot', product.record ->> 'name',
    'supplierId', null,
    'supplierNameSnapshot', null,
    'supplierContactId', null,
    'contactNameSnapshot', null,
    'price', (product.record ->> 'buyingPrice')::numeric,
    'currency', 'KES',
    'effectiveFrom', coalesce(
      product.record ->> 'createdAt',
      to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    'effectiveTo', null,
    'deliveredAt', null,
    'purchaseRecordId', null,
    'createdBy', 'system',
    'source', 'LEGACY_BACKFILL',
    'createdAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'supersedesId', null
  ),
  now()
from cp2_products product
where product.record ->> 'buyingPrice' is not null
  and not exists (
    select 1 from cp2_purchase_price_history history
    where history.business_id = product.business_id
      and history.record ->> 'productId' = product.entity_id
  );

-- The id inside a normalized record must match entity_id. Correct the generated JSON id without
-- changing any commercial value from the legacy product cache.
update cp2_purchase_price_history
set record = jsonb_set(record, '{id}', to_jsonb(entity_id))
where record ->> 'source' = 'LEGACY_BACKFILL' and record ->> 'id' <> entity_id;

comment on table cp2_purchase_price_history is
  'Append-only buying-price history. Current product.buyingPrice is a compatibility cache only.';
comment on table cp2_purchase_records is
  'Immutable supplier/product/contact snapshots for purchases; corrections require a new record.';
comment on table cp2_sale_records is
  'Immutable completed-sale snapshots linked to confirmed invoices.';
