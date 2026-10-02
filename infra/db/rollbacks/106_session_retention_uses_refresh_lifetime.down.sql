-- Reverses 106_session_retention_uses_refresh_lifetime.sql: restores 038's access-token-based
-- retention functions. Sessions restored by 106 are left as they are; rolling back never
-- re-revokes them.
create or replace function revoke_expired_session()
returns trigger
language plpgsql
as $$
begin
  if new.expires_at < now() and new.revoked_at is null then
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
  if nullif(new.record->>'expiresAt', '')::timestamptz < now()
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
