drop table if exists cp2_recovery_codes;
drop table if exists cp2_mfa_factors;
drop table if exists cp2_auth_transactions;
drop table if exists cp2_password_credentials;
drop table if exists cp2_account_identities;
drop table if exists recovery_codes;
drop table if exists mfa_factors;
drop table if exists auth_transactions;
drop table if exists password_credentials;
drop table if exists account_identities;
alter table accounts drop constraint if exists accounts_status_check;
alter table accounts drop column if exists deleted_at;
alter table accounts drop column if exists status;
alter table users drop constraint if exists users_phone_verification_status_check;
alter table users add constraint users_phone_verification_status_check
  check (phone_verification_status is null or phone_verification_status = 'unverified');
