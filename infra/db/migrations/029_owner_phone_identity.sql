alter table users
  add column if not exists phone_number_e164 text,
  add column if not exists phone_country_code text,
  add column if not exists phone_national_number text,
  add column if not exists phone_verification_status text,
  add column if not exists phone_added_at timestamp with time zone,
  add column if not exists phone_updated_at timestamp with time zone,
  add column if not exists phone_source text,
  add column if not exists public_phone_enabled boolean not null default false;

update users as owner_user
set
  phone_number_e164 = account.primary_auth_destination,
  phone_country_code = case
    when account.primary_auth_destination like '+254%' then 'KE'
    when account.primary_auth_destination like '+255%' then 'TZ'
    when account.primary_auth_destination like '+256%' then 'UG'
    when account.primary_auth_destination like '+250%' then 'RW'
    when account.primary_auth_destination like '+234%' then 'NG'
    when account.primary_auth_destination like '+44%' then 'GB'
    when account.primary_auth_destination like '+27%' then 'ZA'
    when account.primary_auth_destination like '+1%' then 'US'
    else null
  end,
  phone_national_number = case
    when account.primary_auth_destination like '+254%' then substring(account.primary_auth_destination from 5)
    when account.primary_auth_destination like '+255%' then substring(account.primary_auth_destination from 5)
    when account.primary_auth_destination like '+256%' then substring(account.primary_auth_destination from 5)
    when account.primary_auth_destination like '+250%' then substring(account.primary_auth_destination from 5)
    when account.primary_auth_destination like '+234%' then substring(account.primary_auth_destination from 5)
    when account.primary_auth_destination like '+44%' then substring(account.primary_auth_destination from 4)
    when account.primary_auth_destination like '+27%' then substring(account.primary_auth_destination from 4)
    when account.primary_auth_destination like '+1%' then substring(account.primary_auth_destination from 3)
    else null
  end,
  phone_verification_status = 'unverified',
  phone_added_at = account.created_at,
  phone_updated_at = now(),
  phone_source = 'phone_login',
  public_phone_enabled = false
from accounts as account
where owner_user.account_id = account.id
  and account.primary_auth_channel = 'phone'
  and account.primary_auth_destination ~ '^\+[1-9][0-9]{6,14}$'
  and owner_user.phone_number_e164 is null;

alter table users
  drop constraint if exists users_phone_verification_status_check,
  add constraint users_phone_verification_status_check
    check (phone_verification_status is null or phone_verification_status = 'unverified'),
  drop constraint if exists users_phone_source_check,
  add constraint users_phone_source_check
    check (phone_source is null or phone_source in ('phone_login', 'shop_registration'));

create unique index if not exists users_phone_number_e164_unique_idx
  on users (phone_number_e164)
  where phone_number_e164 is not null;

create index if not exists users_phone_country_code_idx
  on users (phone_country_code)
  where phone_country_code is not null;

comment on column users.phone_number_e164 is
  'Compulsory private owner identity and support contact, normalized to E.164.';
comment on column users.phone_verification_status is
  'Phone identity status. Shop registration stores unverified because no SMS verification occurs.';
comment on column users.public_phone_enabled is
  'Controls future public display. Defaults false and is not exposed by public storefront serializers.';
