create table if not exists database_backup_runs (
  id uuid primary key,
  status text not null,
  backup_file text not null,
  upload_configured boolean not null,
  retention_days integer not null,
  size_bytes bigint,
  started_at timestamp with time zone not null,
  finished_at timestamp with time zone,
  error_message text,
  constraint database_backup_runs_status_check
    check (status in ('started', 'succeeded', 'failed')),
  constraint database_backup_runs_retention_positive_check
    check (retention_days > 0)
);

create index if not exists database_backup_runs_status_started_idx
  on database_backup_runs (status, started_at desc);

create table if not exists database_restore_drills (
  id uuid primary key,
  backup_file text not null,
  status text not null,
  checked_at timestamp with time zone not null,
  notes text,
  constraint database_restore_drills_status_check
    check (status in ('verified', 'failed'))
);

create index if not exists database_restore_drills_checked_idx
  on database_restore_drills (checked_at desc);

create table if not exists database_health_checks (
  id bigserial primary key,
  status text not null,
  latency_ms integer not null,
  latest_migration text,
  checked_at timestamp with time zone not null,
  error_message text,
  constraint database_health_checks_status_check
    check (status in ('ok', 'failed')),
  constraint database_health_checks_latency_nonnegative_check
    check (latency_ms >= 0)
);

create index if not exists database_health_checks_checked_idx
  on database_health_checks (checked_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'accounts_primary_auth_destination_nonempty_check'
  ) then
    alter table accounts
      add constraint accounts_primary_auth_destination_nonempty_check
      check (btrim(primary_auth_destination) <> '') not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_display_name_nonempty_check'
  ) then
    alter table users
      add constraint users_display_name_nonempty_check
      check (btrim(display_name) <> '') not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'businesses_name_nonempty_check'
  ) then
    alter table businesses
      add constraint businesses_name_nonempty_check
      check (btrim(name) <> '') not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_name_nonempty_check'
  ) then
    alter table products
      add constraint products_name_nonempty_check
      check (btrim(name) <> '') not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_unit_nonempty_check'
  ) then
    alter table products
      add constraint products_unit_nonempty_check
      check (btrim(unit) <> '') not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'customers_name_nonempty_check'
  ) then
    alter table customers
      add constraint customers_name_nonempty_check
      check (btrim(name) <> '') not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'suppliers_name_nonempty_check'
  ) then
    alter table suppliers
      add constraint suppliers_name_nonempty_check
      check (btrim(name) <> '') not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'sales_agents_name_nonempty_check'
  ) then
    alter table sales_agents
      add constraint sales_agents_name_nonempty_check
      check (btrim(name) <> '') not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'invoices_amounts_nonnegative_check'
  ) then
    alter table invoices
      add constraint invoices_amounts_nonnegative_check
      check (subtotal >= 0 and tax_rate >= 0 and tax_total >= 0 and total >= 0) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'invoice_items_amounts_positive_check'
  ) then
    alter table invoice_items
      add constraint invoice_items_amounts_positive_check
      check (quantity > 0 and unit_price >= 0 and line_total >= 0) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'receipt_line_items_amounts_positive_check'
  ) then
    alter table receipt_line_items
      add constraint receipt_line_items_amounts_positive_check
      check (quantity > 0 and unit_price >= 0 and total >= 0) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'receipt_ocr_jobs_confidence_range_check'
  ) then
    alter table receipt_ocr_jobs
      add constraint receipt_ocr_jobs_confidence_range_check
      check (average_confidence >= 0 and average_confidence <= 1) not valid;
  end if;
end $$;
