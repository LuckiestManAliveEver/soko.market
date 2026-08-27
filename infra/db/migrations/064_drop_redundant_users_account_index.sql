-- users_account_idx (migration 001) and users_account_id_unique_idx (migration 051) are both
-- plain, unexpressioned, unpredicated indexes on users(account_id). The unique index from 051
-- already serves every lookup/join the older plain index from 001 could serve, so the older one
-- is pure write-amplification and storage bloat with no remaining purpose.
drop index if exists users_account_idx;
