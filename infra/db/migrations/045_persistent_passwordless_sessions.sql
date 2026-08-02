-- Add independent inactivity and absolute limits to rotating refresh-session families.
-- Existing sessions retain at least their current refresh lifetime during the backfill.

alter table sessions add column if not exists inactivity_expires_at timestamp with time zone;
alter table sessions add column if not exists absolute_expires_at timestamp with time zone;
alter table sessions add column if not exists rotated_from_session_id uuid;
alter table sessions add column if not exists authenticated_at timestamp with time zone;

update sessions
set inactivity_expires_at = coalesce(inactivity_expires_at, refresh_expires_at, expires_at),
    absolute_expires_at = coalesce(
      absolute_expires_at,
      greatest(coalesce(refresh_expires_at, expires_at), created_at + interval '180 days')
    ),
    authenticated_at = coalesce(authenticated_at, pin_verified_at, created_at);

alter table sessions alter column inactivity_expires_at set not null;
alter table sessions alter column absolute_expires_at set not null;
alter table sessions alter column authenticated_at set not null;

alter table sessions drop constraint if exists sessions_inactivity_before_absolute_check;
alter table sessions add constraint sessions_inactivity_before_absolute_check
  check (inactivity_expires_at <= absolute_expires_at);

alter table sessions drop constraint if exists sessions_absolute_after_creation_check;
alter table sessions add constraint sessions_absolute_after_creation_check
  check (absolute_expires_at > created_at);

alter table sessions drop constraint if exists sessions_rotated_from_session_fk;
alter table sessions add constraint sessions_rotated_from_session_fk
  foreign key (rotated_from_session_id) references sessions(id)
  deferrable initially deferred;

create index if not exists sessions_account_inactivity_active_idx
  on sessions (account_id, inactivity_expires_at)
  where revoked_at is null;

create index if not exists sessions_family_absolute_active_idx
  on sessions (session_family_id, absolute_expires_at)
  where revoked_at is null;

create or replace function populate_native_session_defaults()
returns trigger
language plpgsql
as $$
begin
  new.device_id := coalesce(nullif(btrim(new.device_id), ''), 'legacy-' || new.id::text);
  new.device_name := coalesce(nullif(btrim(new.device_name), ''), 'Previously signed-in device');
  new.platform := coalesce(nullif(btrim(new.platform), ''), 'unknown');
  new.browser_or_app := coalesce(nullif(btrim(new.browser_or_app), ''), 'web');
  new.user_agent_hash := coalesce(
    nullif(btrim(new.user_agent_hash), ''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
  new.refresh_token_hash := coalesce(
    nullif(btrim(new.refresh_token_hash), ''),
    'legacy-unavailable:' || new.id::text
  );
  new.session_family_id := coalesce(new.session_family_id, new.id);
  new.refresh_expires_at := coalesce(new.refresh_expires_at, new.expires_at);
  new.last_used_at := coalesce(new.last_used_at, new.created_at);
  new.inactivity_expires_at := coalesce(new.inactivity_expires_at, new.refresh_expires_at);
  new.absolute_expires_at := coalesce(
    new.absolute_expires_at,
    greatest(new.inactivity_expires_at, new.created_at + interval '180 days')
  );
  new.inactivity_expires_at := least(new.inactivity_expires_at, new.absolute_expires_at);
  new.refresh_expires_at := new.inactivity_expires_at;
  new.authenticated_at := coalesce(new.authenticated_at, new.pin_verified_at, new.created_at);
  return new;
end;
$$;

comment on function populate_native_session_defaults() is
  'Keeps legacy session writers compatible while enforcing rotating inactivity and absolute session limits.';
