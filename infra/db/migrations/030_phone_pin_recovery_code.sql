alter table account_pin_hashes
  add column if not exists recovery_code_hash text;

alter table account_pin_hashes
  drop constraint if exists account_pin_hashes_recovery_code_hash_check,
  add constraint account_pin_hashes_recovery_code_hash_check
    check (
      recovery_code_hash is null
      or recovery_code_hash ~ '^[a-f0-9]{64}$'
    );

comment on column account_pin_hashes.recovery_code_hash is
  'SHA-256 hash of the rotating phone-account recovery code. The plaintext code is shown only after signup or successful recovery.';
