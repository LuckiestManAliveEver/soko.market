create or replace function populate_native_session_defaults()
returns trigger
language plpgsql
as $$
begin
  new.device_id := coalesce(new.device_id, 'legacy-' || new.id::text);
  new.device_name := coalesce(new.device_name, 'Previously signed-in device');
  new.platform := coalesce(new.platform, 'unknown');
  new.browser_or_app := coalesce(new.browser_or_app, 'web');
  new.user_agent_hash := coalesce(new.user_agent_hash, '');
  new.refresh_token_hash := coalesce(new.refresh_token_hash, '');
  new.session_family_id := coalesce(new.session_family_id, new.id);
  new.refresh_expires_at := coalesce(new.refresh_expires_at, new.expires_at);
  new.last_used_at := coalesce(new.last_used_at, new.created_at);
  return new;
end;
$$;

drop trigger if exists sessions_native_defaults_trigger on sessions;

create trigger sessions_native_defaults_trigger
before insert or update on sessions
for each row
execute function populate_native_session_defaults();

comment on function populate_native_session_defaults() is
  'Keeps migration 036 compatible with API instances using the pre-native-session write shape during rolling deploys.';
