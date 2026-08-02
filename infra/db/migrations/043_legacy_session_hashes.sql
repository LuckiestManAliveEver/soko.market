-- Repair legacy native-session defaults that used empty strings for required security fields.
-- Empty refresh hashes are replaced with an intentionally invalid token hash so those legacy
-- sessions cannot gain refresh capability that they did not originally possess.

update sessions
set user_agent_hash = case
      when user_agent_hash is null or btrim(user_agent_hash) = ''
        then 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      else user_agent_hash
    end,
    refresh_token_hash = case
      when refresh_token_hash is null or btrim(refresh_token_hash) = ''
        then 'legacy-unavailable:' || id::text
      else refresh_token_hash
    end
where user_agent_hash is null
   or btrim(user_agent_hash) = ''
   or refresh_token_hash is null
   or btrim(refresh_token_hash) = '';

update cp2_sessions
set record = jsonb_set(
  jsonb_set(
    record,
    '{userAgentHash}',
    to_jsonb(coalesce(
      nullif(btrim(record->>'userAgentHash'), ''),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    )),
    true
  ),
  '{refreshTokenHash}',
  to_jsonb(coalesce(
    nullif(btrim(record->>'refreshTokenHash'), ''),
    'legacy-unavailable:' || entity_id
  )),
  true
)
where nullif(btrim(record->>'userAgentHash'), '') is null
   or nullif(btrim(record->>'refreshTokenHash'), '') is null;

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

alter table sessions drop constraint if exists sessions_user_agent_hash_nonempty_check;
alter table sessions add constraint sessions_user_agent_hash_nonempty_check
  check (btrim(user_agent_hash) <> '') not valid;
alter table sessions validate constraint sessions_user_agent_hash_nonempty_check;

alter table sessions drop constraint if exists sessions_refresh_token_hash_nonempty_check;
alter table sessions add constraint sessions_refresh_token_hash_nonempty_check
  check (btrim(refresh_token_hash) <> '') not valid;
alter table sessions validate constraint sessions_refresh_token_hash_nonempty_check;
