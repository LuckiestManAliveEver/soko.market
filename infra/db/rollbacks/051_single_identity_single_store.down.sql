drop index if exists business_memberships_owner_user_unique_idx;
drop index if exists users_account_id_unique_idx;

alter table user_identities
  drop constraint if exists user_identities_email_canonical_check;

alter table account_identities
  drop constraint if exists account_identities_value_canonical_check;

alter table users
  drop constraint if exists users_phone_number_e164_canonical_check;

alter table accounts
  drop constraint if exists accounts_primary_auth_destination_canonical_check;
