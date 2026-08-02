drop index if exists sessions_family_absolute_active_idx;
drop index if exists sessions_account_inactivity_active_idx;

alter table sessions drop constraint if exists sessions_rotated_from_session_fk;
alter table sessions drop constraint if exists sessions_absolute_after_creation_check;
alter table sessions drop constraint if exists sessions_inactivity_before_absolute_check;

alter table sessions drop column if exists authenticated_at;
alter table sessions drop column if exists rotated_from_session_id;
alter table sessions drop column if exists absolute_expires_at;
alter table sessions drop column if exists inactivity_expires_at;

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
  return new;
end;
$$;

comment on function populate_native_session_defaults() is
  'Keeps legacy session writers compatible while preventing empty native-session security fields.';
