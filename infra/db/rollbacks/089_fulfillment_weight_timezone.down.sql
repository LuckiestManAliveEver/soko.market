alter table businesses
  drop constraint if exists businesses_timezone_length,
  drop column if exists timezone;

alter table invoice_items
  drop constraint if exists invoice_items_weight_status_consistent,
  drop constraint if exists invoice_items_weight_unresolved_reason_valid,
  drop constraint if exists invoice_items_weight_status_valid,
  drop constraint if exists invoice_items_total_weight_grams_nonnegative,
  drop constraint if exists invoice_items_unit_weight_snapshot_positive,
  drop column if exists weight_unresolved_reason,
  drop column if exists weight_status,
  drop column if exists total_weight_grams,
  drop column if exists unit_weight_grams_snapshot;

alter table products
  drop constraint if exists products_unit_weight_grams_positive,
  drop column if exists unit_weight_grams;
