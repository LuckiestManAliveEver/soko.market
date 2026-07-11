alter table sessions add column if not exists pin_verified_at timestamp with time zone;

create table if not exists account_pin_hashes (
  account_id uuid primary key references accounts(id) on delete cascade,
  pin_hash text not null,
  updated_at timestamp with time zone not null default now(),
  constraint account_pin_hashes_pin_hash_nonempty_check
    check (btrim(pin_hash) <> '')
);

create table if not exists device_trust (
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  device_id text not null,
  level text not null,
  reason text,
  updated_by uuid not null references users(id),
  updated_at timestamp with time zone not null,
  primary key (business_id, user_id, device_id),
  constraint device_trust_level_check
    check (level in ('unknown', 'trusted', 'restricted')),
  constraint device_trust_device_id_nonempty_check
    check (btrim(device_id) <> '')
);

create index if not exists device_trust_business_user_idx
  on device_trust (business_id, user_id, updated_at desc);

create index if not exists otp_challenges_destination_active_idx
  on otp_challenges (channel, destination, expires_at, verified_at);

create index if not exists user_identities_account_idx
  on user_identities (account_id, user_id, linked_at desc);

create index if not exists oauth_sessions_account_idx
  on oauth_sessions (account_id, created_at desc)
  where account_id is not null;

insert into account_pin_hashes (account_id, pin_hash, updated_at)
select
  (record->>'accountId')::uuid,
  record->>'pinHash',
  coalesce((record->>'updatedAt')::timestamp with time zone, now())
from cp2_account_pin_hashes
where record ? 'accountId'
  and record ? 'pinHash'
  and record->>'accountId' <> ''
  and record->>'pinHash' <> ''
on conflict (account_id) do update set
  pin_hash = excluded.pin_hash,
  updated_at = excluded.updated_at;

insert into otp_challenges (
  id, channel, destination, code_hash, attempts, max_attempts, expires_at, verified_at, created_at
)
select
  (record->>'id')::uuid,
  record->>'channel',
  record->>'destination',
  record->>'codeHash',
  coalesce((record->>'attempts')::integer, 0),
  coalesce((record->>'maxAttempts')::integer, 5),
  (record->>'expiresAt')::timestamp with time zone,
  nullif(record->>'verifiedAt', '')::timestamp with time zone,
  (record->>'createdAt')::timestamp with time zone
from cp2_otp_challenges
where record ? 'id'
  and record ? 'channel'
  and record ? 'destination'
  and record ? 'codeHash'
  and record ? 'expiresAt'
  and record ? 'createdAt'
on conflict (id) do update set
  channel = excluded.channel,
  destination = excluded.destination,
  code_hash = excluded.code_hash,
  attempts = excluded.attempts,
  max_attempts = excluded.max_attempts,
  expires_at = excluded.expires_at,
  verified_at = excluded.verified_at;

update sessions
set pin_verified_at = nullif(cp2_sessions.record->>'pinVerifiedAt', '')::timestamp with time zone
from cp2_sessions
where sessions.id = (cp2_sessions.record->>'id')::uuid
  and cp2_sessions.record ? 'pinVerifiedAt';

insert into device_trust (
  business_id, user_id, device_id, level, reason, updated_by, updated_at
)
select
  (record->>'businessId')::uuid,
  (record->>'userId')::uuid,
  record->>'deviceId',
  record->>'level',
  nullif(record->>'reason', ''),
  (record->>'updatedBy')::uuid,
  (record->>'updatedAt')::timestamp with time zone
from cp2_device_trust
where record ? 'businessId'
  and record ? 'userId'
  and record ? 'deviceId'
  and record ? 'level'
  and record ? 'updatedBy'
  and record ? 'updatedAt'
on conflict (business_id, user_id, device_id) do update set
  level = excluded.level,
  reason = excluded.reason,
  updated_by = excluded.updated_by,
  updated_at = excluded.updated_at;

insert into identity_providers (id, display_name, authorization_url, token_url, user_info_url, scopes, pkce, created_at)
select distinct
  provider_id,
  provider_id,
  '',
  '',
  null,
  '[]'::jsonb,
  true,
  now()
from (
  select record->>'provider' as provider_id from cp2_user_identities
  union
  select record->>'provider' as provider_id from cp2_oauth_sessions
) providers
where provider_id is not null and provider_id <> ''
on conflict (id) do nothing;

insert into user_identities (
  id, account_id, user_id, provider_id, provider_subject, email, display_name,
  encrypted_access_token, encrypted_refresh_token, encrypted_id_token, token_type,
  token_expires_at, scope, linked_at, updated_at
)
select
  (record->>'id')::uuid,
  (record->>'accountId')::uuid,
  (record->>'userId')::uuid,
  record->>'provider',
  record->>'providerSubject',
  nullif(record->>'email', ''),
  nullif(record->>'displayName', ''),
  nullif(record->>'encryptedAccessToken', ''),
  nullif(record->>'encryptedRefreshToken', ''),
  nullif(record->>'encryptedIdToken', ''),
  nullif(record->>'tokenType', ''),
  nullif(record->>'tokenExpiresAt', '')::timestamp with time zone,
  nullif(record->>'scope', ''),
  (record->>'linkedAt')::timestamp with time zone,
  coalesce(nullif(record->>'updatedAt', '')::timestamp with time zone, (record->>'linkedAt')::timestamp with time zone)
from cp2_user_identities
where record ? 'id'
  and record ? 'accountId'
  and record ? 'userId'
  and record ? 'provider'
  and record ? 'providerSubject'
  and record ? 'linkedAt'
on conflict (id) do update set
  account_id = excluded.account_id,
  user_id = excluded.user_id,
  provider_id = excluded.provider_id,
  provider_subject = excluded.provider_subject,
  email = excluded.email,
  display_name = excluded.display_name,
  encrypted_access_token = excluded.encrypted_access_token,
  encrypted_refresh_token = excluded.encrypted_refresh_token,
  encrypted_id_token = excluded.encrypted_id_token,
  token_type = excluded.token_type,
  token_expires_at = excluded.token_expires_at,
  scope = excluded.scope,
  updated_at = excluded.updated_at;

insert into oauth_sessions (
  id, provider_id, account_id, state_hash, csrf_hash, code_challenge,
  encrypted_code_verifier, redirect_uri, expires_at, completed_at, created_at
)
select
  (record->>'id')::uuid,
  record->>'provider',
  nullif(record->>'accountId', '')::uuid,
  coalesce(record->>'stateHash', ''),
  coalesce(record->>'csrfHash', ''),
  coalesce(record->>'codeChallenge', ''),
  coalesce(record->>'codeVerifier', record->>'encryptedCodeVerifier', ''),
  coalesce(record->>'redirectUri', ''),
  (record->>'expiresAt')::timestamp with time zone,
  nullif(record->>'completedAt', '')::timestamp with time zone,
  (record->>'createdAt')::timestamp with time zone
from cp2_oauth_sessions
where record ? 'id'
  and record ? 'provider'
  and record ? 'expiresAt'
  and record ? 'createdAt'
on conflict (id) do update set
  provider_id = excluded.provider_id,
  account_id = excluded.account_id,
  state_hash = excluded.state_hash,
  csrf_hash = excluded.csrf_hash,
  code_challenge = excluded.code_challenge,
  encrypted_code_verifier = excluded.encrypted_code_verifier,
  redirect_uri = excluded.redirect_uri,
  expires_at = excluded.expires_at,
  completed_at = excluded.completed_at;
