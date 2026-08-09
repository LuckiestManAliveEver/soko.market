drop table if exists product_capture_jobs;
drop table if exists product_media;
drop table if exists customer_runtime_capabilities;
drop table if exists provider_update_receipts;
drop table if exists conversation_channels;
drop table if exists platform_identities;

alter table products
  drop column if exists primary_media_id;

alter table conversation_participants
  drop column if exists external_identity_id;
