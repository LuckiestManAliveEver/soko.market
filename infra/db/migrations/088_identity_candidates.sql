do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'cp2_identity_candidates'
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
    execute format(
      'create index if not exists %I on %I (user_id) where user_id is not null',
      table_name || '_user_idx',
      table_name
    );
    execute format(
      'create index if not exists %I on %I (parent_id) where parent_id is not null',
      table_name || '_parent_idx',
      table_name
    );
  end loop;
end $$;

comment on table cp2_identity_candidates is
  'Pending, unconfirmed identity facts proposed by an external observation (e.g. a ComputerRuntime browsing session) - never attached to the phonebook until the owner explicitly confirms them. See docs/architecture/phonebook-identity-resolution.md.';
