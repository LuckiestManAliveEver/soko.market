drop table if exists cp2_device_recovery_credentials;

drop table if exists cp2_device_account_bootstraps;

alter table accounts
  drop constraint if exists accounts_identity_level_check,
  drop column if exists identity_level;
