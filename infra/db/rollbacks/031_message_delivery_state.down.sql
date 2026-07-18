drop table if exists cp2_message_delivery_attempts;
drop table if exists message_delivery_attempts;

drop index if exists conversation_messages_imported_source_idx;
drop index if exists conversation_messages_idempotency_idx;

alter table conversation_messages
  drop constraint if exists conversation_messages_actual_channel_check,
  drop constraint if exists conversation_messages_selected_channel_check,
  drop constraint if exists conversation_messages_retry_count_check,
  drop constraint if exists conversation_messages_status_check,
  drop column if exists consent_record_id,
  drop column if exists imported_external_id,
  drop column if exists imported_source,
  drop column if exists provider_message_id,
  drop column if exists actual_channel,
  drop column if exists selected_channel,
  drop column if exists next_retry_at,
  drop column if exists retry_count,
  drop column if exists failure_code,
  drop column if exists read_at,
  drop column if exists delivered_at,
  drop column if exists sent_at,
  drop column if exists queued_at,
  drop column if exists status,
  drop column if exists idempotency_key;
