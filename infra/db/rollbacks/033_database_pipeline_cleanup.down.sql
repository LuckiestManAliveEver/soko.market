create index if not exists account_sync_changes_account_sequence_idx
  on account_sync_changes (account_id, sequence);
