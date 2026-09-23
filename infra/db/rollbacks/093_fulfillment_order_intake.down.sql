drop index if exists fulfillment_orders_business_state_idx;

alter table fulfillment_orders
  drop constraint if exists fulfillment_orders_cancel_reason_length,
  drop constraint if exists fulfillment_orders_state_valid,
  drop constraint if exists fulfillment_orders_weight_consistent,
  drop constraint if exists fulfillment_orders_total_weight_nonnegative,
  drop constraint if exists fulfillment_orders_weight_status_valid,
  drop column if exists updated_at,
  drop column if exists delivered_at,
  drop column if exists cancel_reason,
  drop column if exists cancelled_at,
  drop column if exists taken_in_at,
  drop column if exists source,
  drop column if exists state,
  drop column if exists unresolved_line_ids,
  drop column if exists total_weight_grams,
  drop column if exists weight_status;

alter table invoices
  drop constraint if exists invoices_source_valid,
  drop column if exists created_by_user_id,
  drop column if exists source_message_channel,
  drop column if exists source;
