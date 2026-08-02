-- Restore the legacy schema shape only. Removed recovery hashes cannot be reconstructed.

alter table account_pin_hashes
  add column if not exists recovery_code_hash text;

alter table account_pin_hashes
  drop constraint if exists account_pin_hashes_recovery_code_hash_check,
  add constraint account_pin_hashes_recovery_code_hash_check
    check (
      recovery_code_hash is null
      or recovery_code_hash ~ '^[a-f0-9]{64}$'
    );
