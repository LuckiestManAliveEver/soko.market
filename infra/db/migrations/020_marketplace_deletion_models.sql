do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'cp2_marketplace_intro_states',
    'cp2_active_ai_models'
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
      'create index if not exists %I on %I (account_id) where account_id is not null',
      table_name || '_account_idx',
      table_name
    );
  end loop;
end $$;

create table if not exists shop_deletion_archives (
  request_id uuid primary key,
  business_id uuid not null,
  account_id uuid not null,
  status text not null check (status in ('QUARANTINED', 'RESTORED', 'PURGED', 'FAILED')),
  restore_until timestamp with time zone not null,
  archive_key text,
  checksum text,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null,
  check (restore_until > created_at)
);

create index if not exists shop_deletion_archives_restore_idx
  on shop_deletion_archives (status, restore_until);
