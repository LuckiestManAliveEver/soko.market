alter table sessions add column if not exists device_id text;
alter table sessions add column if not exists device_name text;
alter table sessions add column if not exists platform text;
alter table sessions add column if not exists browser_or_app text;
alter table sessions add column if not exists user_agent_hash text;
alter table sessions add column if not exists refresh_token_hash text;
alter table sessions add column if not exists session_family_id uuid;
alter table sessions add column if not exists refresh_expires_at timestamp with time zone;
alter table sessions add column if not exists last_used_at timestamp with time zone;
alter table sessions add column if not exists rotated_at timestamp with time zone;
alter table sessions add column if not exists revocation_reason text;

update sessions
set device_id = coalesce(device_id, 'legacy-' || id::text),
    device_name = coalesce(device_name, 'Previously signed-in device'),
    platform = coalesce(platform, 'unknown'),
    browser_or_app = coalesce(browser_or_app, 'web'),
    user_agent_hash = coalesce(user_agent_hash, ''),
    refresh_token_hash = coalesce(refresh_token_hash, ''),
    session_family_id = coalesce(session_family_id, id),
    refresh_expires_at = coalesce(refresh_expires_at, expires_at),
    last_used_at = coalesce(last_used_at, created_at);

alter table sessions alter column device_id set not null;
alter table sessions alter column device_name set not null;
alter table sessions alter column platform set not null;
alter table sessions alter column browser_or_app set not null;
alter table sessions alter column user_agent_hash set not null;
alter table sessions alter column refresh_token_hash set not null;
alter table sessions alter column session_family_id set not null;
alter table sessions alter column refresh_expires_at set not null;
alter table sessions alter column last_used_at set not null;

create index if not exists sessions_family_active_idx
  on sessions (session_family_id, refresh_expires_at)
  where revoked_at is null;

create index if not exists sessions_account_device_active_idx
  on sessions (account_id, device_id, last_used_at desc)
  where revoked_at is null;
