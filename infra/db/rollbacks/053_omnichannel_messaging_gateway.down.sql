drop index if exists platform_identities_customer_idx;
drop index if exists channel_identity_link_grants_customer_idx;
drop index if exists channel_identity_link_grants_token_hash_unique_idx;
drop index if exists channel_identity_link_grants_business_idx;
drop table if exists channel_identity_link_grants;

drop index if exists conversation_messages_provider_thread_idx;
alter table conversation_messages
  drop constraint if exists conversation_messages_provider_check,
  drop constraint if exists conversation_messages_direction_check,
  drop column if exists channel_identity_id,
  drop column if exists external_conversation_id,
  drop column if exists direction,
  drop column if exists provider;

drop index if exists customers_linked_account_idx;
alter table customers drop column if exists linked_account_id;
