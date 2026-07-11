alter table receipt_ocr_jobs
  drop constraint if exists receipt_ocr_jobs_confidence_range_check;

alter table receipt_line_items
  drop constraint if exists receipt_line_items_amounts_positive_check;

alter table invoice_items
  drop constraint if exists invoice_items_amounts_positive_check;

alter table invoices
  drop constraint if exists invoices_amounts_nonnegative_check;

alter table sales_agents
  drop constraint if exists sales_agents_name_nonempty_check;

alter table suppliers
  drop constraint if exists suppliers_name_nonempty_check;

alter table customers
  drop constraint if exists customers_name_nonempty_check;

alter table products
  drop constraint if exists products_unit_nonempty_check;

alter table products
  drop constraint if exists products_name_nonempty_check;

alter table businesses
  drop constraint if exists businesses_name_nonempty_check;

alter table users
  drop constraint if exists users_display_name_nonempty_check;

alter table accounts
  drop constraint if exists accounts_primary_auth_destination_nonempty_check;

drop index if exists database_health_checks_checked_idx;
drop table if exists database_health_checks;
drop index if exists database_restore_drills_checked_idx;
drop table if exists database_restore_drills;
drop index if exists database_backup_runs_status_started_idx;
drop table if exists database_backup_runs;
