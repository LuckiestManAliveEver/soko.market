-- 038 revoked a session as soon as its access token expired (expires_at, ~15 minutes after
-- login) on any write, but since 036/045 a session stays refreshable until the earliest of
-- refresh_expires_at, inactivity_expires_at and absolute_expires_at. The API persists whole
-- collections, so every session was rewritten (and revoked) within one save of its access token
-- expiring; after a restart those sessions loaded as revoked and refresh answered
-- auth_refresh_revoked, signing out everyone idle for more than ~15 minutes.
--
-- The retention triggers now revoke only once the refreshable lifetime is over. least() ignores
-- NULLs, so a row missing the newer limits falls back to expires_at as before.

create or replace function revoke_expired_session()
returns trigger
language plpgsql
as $$
begin
  if coalesce(
       least(new.refresh_expires_at, new.inactivity_expires_at, new.absolute_expires_at),
       new.expires_at
     ) < now()
     and new.revoked_at is null then
    new.revoked_at := now();
    new.revocation_reason := 'expired';
  end if;
  return new;
end;
$$;

create or replace function revoke_expired_session_compatibility_record()
returns trigger
language plpgsql
as $$
begin
  if coalesce(
       least(
         nullif(new.record->>'refreshExpiresAt', '')::timestamptz,
         nullif(new.record->>'inactivityExpiresAt', '')::timestamptz,
         nullif(new.record->>'absoluteExpiresAt', '')::timestamptz
       ),
       nullif(new.record->>'expiresAt', '')::timestamptz
     ) < now()
     and nullif(new.record->>'revokedAt', '') is null then
    new.record := jsonb_set(
      jsonb_set(new.record, '{revokedAt}', to_jsonb(now()::text), true),
      '{revocationReason}',
      to_jsonb('expired'::text),
      true
    );
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- Restore sessions the old trigger revoked while they were still refreshable. The API itself
-- only uses the 'expired' reason once the absolute lifetime has passed, so every row matched
-- here was revoked by the trigger alone. Refresh still enforces every expiry on use.
update sessions
set revoked_at = null,
    revocation_reason = null
where revocation_reason = 'expired'
  and least(refresh_expires_at, inactivity_expires_at, absolute_expires_at) > now();

update cp2_sessions
set record = jsonb_set(jsonb_set(record, '{revokedAt}', 'null'::jsonb), '{revocationReason}', 'null'::jsonb),
    updated_at = now()
where record->>'revocationReason' = 'expired'
  and least(
        nullif(record->>'refreshExpiresAt', '')::timestamptz,
        nullif(record->>'inactivityExpiresAt', '')::timestamptz,
        nullif(record->>'absoluteExpiresAt', '')::timestamptz
      ) > now();
