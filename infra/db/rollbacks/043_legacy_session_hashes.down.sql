-- Repaired data and safe trigger defaults are intentionally retained because the original empty
-- values cannot be recovered and reintroducing them would break PostgreSQL snapshot persistence.
alter table sessions drop constraint if exists sessions_refresh_token_hash_nonempty_check;
alter table sessions drop constraint if exists sessions_user_agent_hash_nonempty_check;
