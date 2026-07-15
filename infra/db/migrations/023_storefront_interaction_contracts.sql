do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'cp2_shop_presences',
    'cp2_network_invites',
    'cp2_public_customer_care_requests',
    'cp2_public_storefront_messages',
    'cp2_public_orders'
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
      'create index if not exists %I on %I (user_id) where user_id is not null',
      table_name || '_user_idx',
      table_name
    );
  end loop;
end $$;

comment on table cp2_shop_presences is 'Persisted Business Agent storefront availability.';
comment on table cp2_network_invites is 'Auditable invite delivery outbox records.';
comment on table cp2_public_customer_care_requests is 'Public storefront callback, quote, support, and registration requests.';
comment on table cp2_public_storefront_messages is 'Public customer messages submitted to Business Agent storefronts.';
comment on table cp2_public_orders is 'Public storefront order requests awaiting merchant acceptance.';
