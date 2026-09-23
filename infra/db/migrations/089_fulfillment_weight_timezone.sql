-- Corridor fulfillment Phase 1a (docs/architecture/corridor-fulfillment.md A4, A11).
-- Authoritative weight is whole grams in BIGINT. Every new column is nullable and nothing is
-- backfilled: historical products have unknown weight, historical invoice lines were never
-- snapshotted, and no business has a configured timezone until its owner sets one. Unknown is
-- never zero.

alter table products
  add column if not exists unit_weight_grams bigint,
  add constraint products_unit_weight_grams_positive
    check (unit_weight_grams is null or unit_weight_grams > 0);

alter table invoice_items
  add column if not exists unit_weight_grams_snapshot bigint,
  add column if not exists total_weight_grams bigint,
  add column if not exists weight_status text,
  add column if not exists weight_unresolved_reason text,
  add constraint invoice_items_unit_weight_snapshot_positive
    check (unit_weight_grams_snapshot is null or unit_weight_grams_snapshot > 0),
  add constraint invoice_items_total_weight_grams_nonnegative
    check (total_weight_grams is null or total_weight_grams >= 0),
  add constraint invoice_items_weight_status_valid
    check (weight_status is null or weight_status in ('RESOLVED', 'UNRESOLVED')),
  add constraint invoice_items_weight_unresolved_reason_valid
    check (
      weight_unresolved_reason is null
      or weight_unresolved_reason in ('MISSING_UNIT_WEIGHT', 'NON_INTEGRAL_WEIGHT', 'NOT_SNAPSHOTTED')
    ),
  -- A resolved line always carries its total; an unresolved line never carries one.
  add constraint invoice_items_weight_status_consistent
    check (
      (weight_status is null and total_weight_grams is null)
      or (weight_status = 'RESOLVED' and total_weight_grams is not null)
      or (weight_status = 'UNRESOLVED' and total_weight_grams is null)
    );

-- IANA timezone name (for example Africa/Nairobi). Validated by the application against ICU data.
alter table businesses
  add column if not exists timezone text,
  add constraint businesses_timezone_length
    check (timezone is null or (char_length(timezone) between 1 and 64));
