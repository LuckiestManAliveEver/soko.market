-- Phone-account PIN recovery now requires a verified passkey ceremony.
-- Remove the retired recovery-code hashes so this credential cannot be used or restored.

alter table account_pin_hashes
  drop constraint if exists account_pin_hashes_recovery_code_hash_check;

alter table account_pin_hashes
  drop column if exists recovery_code_hash;
