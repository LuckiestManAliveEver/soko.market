-- Migration 034 repairs the canonical definition already established by 032.
-- Rolling it back removes only the migration ledger entry; the valid constraint remains.
select 1;
