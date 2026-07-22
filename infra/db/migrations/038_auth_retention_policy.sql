create or replace function discard_expired_otp_challenge()
returns trigger
language plpgsql
as $$
begin
  if new.verified_at is null and new.expires_at < now() then
    return null;
  end if;
  return new;
end;
$$;

create or replace function discard_expired_otp_compatibility_record()
returns trigger
language plpgsql
as $$
begin
  if nullif(new.record->>'verifiedAt', '') is null
     and nullif(new.record->>'expiresAt', '')::timestamptz < now() then
    return null;
  end if;
  return new;
end;
$$;

create or replace function discard_expired_passkey_ceremony()
returns trigger
language plpgsql
as $$
begin
  if nullif(new.record->>'expiresAt', '')::timestamptz < now() then
    return null;
  end if;
  return new;
end;
$$;

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

drop trigger if exists otp_challenges_retention_trigger on otp_challenges;
create trigger otp_challenges_retention_trigger
before insert or update on otp_challenges
for each row
execute function discard_expired_otp_challenge();

drop trigger if exists verification_challenges_retention_trigger on verification_challenges;
create trigger verification_challenges_retention_trigger
before insert or update on verification_challenges
for each row
execute function discard_expired_otp_challenge();

drop trigger if exists cp2_otp_challenges_retention_trigger on cp2_otp_challenges;
create trigger cp2_otp_challenges_retention_trigger
before insert or update on cp2_otp_challenges
for each row
execute function discard_expired_otp_compatibility_record();

drop trigger if exists cp2_passkey_ceremonies_retention_trigger on cp2_passkey_ceremonies;
create trigger cp2_passkey_ceremonies_retention_trigger
before insert or update on cp2_passkey_ceremonies
for each row
execute function discard_expired_passkey_ceremony();

drop trigger if exists sessions_retention_trigger on sessions;
create trigger sessions_retention_trigger
before insert or update on sessions
for each row
execute function revoke_expired_session();

drop trigger if exists cp2_sessions_retention_trigger on cp2_sessions;
create trigger cp2_sessions_retention_trigger
before insert or update on cp2_sessions
for each row
execute function revoke_expired_session_compatibility_record();

delete from verification_challenges
where verified_at is null and expires_at < now();

delete from otp_challenges
where verified_at is null and expires_at < now();

delete from cp2_otp_challenges
where nullif(record->>'verifiedAt', '') is null
  and nullif(record->>'expiresAt', '')::timestamptz < now();

delete from cp2_passkey_ceremonies
where nullif(record->>'expiresAt', '')::timestamptz < now();

update sessions
set revoked_at = now(),
    revocation_reason = 'expired'
where expires_at < now() and revoked_at is null;

update cp2_sessions
set record = jsonb_set(
               jsonb_set(record, '{revokedAt}', to_jsonb(now()::text), true),
               '{revocationReason}',
               to_jsonb('expired'::text),
               true
             ),
    updated_at = now()
where nullif(record->>'expiresAt', '')::timestamptz < now()
  and nullif(record->>'revokedAt', '') is null;

comment on function discard_expired_otp_challenge() is
  'Prevents stale application snapshots from restoring expired, unverified OTP challenges.';
comment on function discard_expired_passkey_ceremony() is
  'Prevents stale application snapshots from restoring expired passkey ceremonies.';
comment on function revoke_expired_session() is
  'Keeps expired sessions revoked when older application instances persist stale snapshots.';
