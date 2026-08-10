-- Enforce the registration invariants at the durable boundary:
-- one canonical phone/email belongs to one account, one user belongs to one account,
-- and one user may own at most one store.

do $$
declare
  collision record;
begin
  with canonical_identities as (
    select
      account_id,
      'phone'::text as identity_type,
      btrim(phone_number_e164) as normalized_value
    from users
    where phone_number_e164 is not null
    union all
    select
      id,
      primary_auth_channel,
      case
        when primary_auth_channel = 'email' then lower(btrim(primary_auth_destination))
        else btrim(primary_auth_destination)
      end
    from accounts
    where primary_auth_channel in ('phone', 'email')
    union all
    select
      account_id,
      type,
      case when type = 'email' then lower(btrim(normalized_value)) else btrim(normalized_value) end
    from account_identities
    union all
    select account_id, 'email'::text, lower(btrim(email))
    from user_identities
    where email is not null and btrim(email) <> ''
  )
  select identity_type, normalized_value, count(distinct account_id) as account_count
  into collision
  from canonical_identities
  group by identity_type, normalized_value
  having count(distinct account_id) > 1
  order by identity_type, normalized_value
  limit 1;

  if found then
    raise exception
      'Identity %:% belongs to % accounts; reconcile it before applying the single-identity invariant.',
      collision.identity_type,
      collision.normalized_value,
      collision.account_count;
  end if;
end $$;

do $$
declare
  duplicate_account record;
  duplicate_owner record;
begin
  select account_id, count(*) as user_count
  into duplicate_account
  from users
  group by account_id
  having count(*) > 1
  order by account_id
  limit 1;

  if found then
    raise exception
      'Account % has % users; reconcile it before applying the one-user-per-account invariant.',
      duplicate_account.account_id,
      duplicate_account.user_count;
  end if;

  select user_id, count(*) as store_count
  into duplicate_owner
  from business_memberships
  where role = 'owner'
  group by user_id
  having count(*) > 1
  order by user_id
  limit 1;

  if found then
    raise exception
      'User % owns % stores; reconcile ownership before applying the one-store invariant.',
      duplicate_owner.user_id,
      duplicate_owner.store_count;
  end if;
end $$;

-- Canonicalize existing values before adding checks that prevent case/whitespace aliases.
update accounts
set primary_auth_destination = case
  when primary_auth_channel = 'email' then lower(btrim(primary_auth_destination))
  else btrim(primary_auth_destination)
end
where primary_auth_channel in ('phone', 'email');

update users
set phone_number_e164 = btrim(phone_number_e164)
where phone_number_e164 is not null;

update user_identities
set email = lower(btrim(email))
where email is not null and btrim(email) <> '';

with ranked as (
  select
    id,
    row_number() over (
      partition by
        type,
        case when type = 'email' then lower(btrim(normalized_value)) else btrim(normalized_value) end
      order by is_primary desc, (verified_at is not null) desc, created_at, id
    ) as duplicate_rank
  from account_identities
)
delete from account_identities
where id in (select id from ranked where duplicate_rank > 1);

update account_identities
set
  normalized_value = case
    when type = 'email' then lower(btrim(normalized_value))
    else btrim(normalized_value)
  end,
  display_value = btrim(display_value),
  updated_at = now();

alter table accounts
  drop constraint if exists accounts_primary_auth_destination_canonical_check,
  add constraint accounts_primary_auth_destination_canonical_check check (
    case
      when primary_auth_channel = 'email' then
        primary_auth_destination = lower(btrim(primary_auth_destination))
        and primary_auth_destination ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      when primary_auth_channel = 'phone' then
        primary_auth_destination = btrim(primary_auth_destination)
        and primary_auth_destination ~ '^\+[1-9][0-9]{6,14}$'
      else btrim(primary_auth_destination) <> ''
    end
  );

alter table users
  drop constraint if exists users_phone_number_e164_canonical_check,
  add constraint users_phone_number_e164_canonical_check check (
    phone_number_e164 is null
    or (
      phone_number_e164 = btrim(phone_number_e164)
      and phone_number_e164 ~ '^\+[1-9][0-9]{6,14}$'
    )
  );

alter table account_identities
  drop constraint if exists account_identities_value_canonical_check,
  add constraint account_identities_value_canonical_check check (
    case
      when type = 'email' then
        normalized_value = lower(btrim(normalized_value))
        and normalized_value ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      when type = 'phone' then
        normalized_value = btrim(normalized_value)
        and normalized_value ~ '^\+[1-9][0-9]{6,14}$'
      else false
    end
  );

alter table user_identities
  drop constraint if exists user_identities_email_canonical_check,
  add constraint user_identities_email_canonical_check check (
    email is null
    or (
      email = lower(btrim(email))
      and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    )
  );

-- One application user is the identity/ownership root for exactly one account.
create unique index if not exists users_account_id_unique_idx
  on users (account_id);

-- Memberships for staff/collaborators remain possible; only store ownership is singular.
create unique index if not exists business_memberships_owner_user_unique_idx
  on business_memberships (user_id)
  where role = 'owner';

-- Backfill the canonical identity ledger from primary accounts and verified OAuth profiles.
insert into account_identities (
  id, account_id, user_id, type, normalized_value, display_value,
  is_primary, verified_at, created_at, updated_at
)
select
  gen_random_uuid(),
  account.id,
  app_user.id,
  account.primary_auth_channel,
  account.primary_auth_destination,
  account.primary_auth_destination,
  true,
  null,
  account.created_at,
  now()
from accounts as account
join users as app_user on app_user.account_id = account.id
where account.primary_auth_channel in ('phone', 'email')
on conflict (type, normalized_value) do update set
  is_primary = account_identities.is_primary or excluded.is_primary,
  updated_at = now();

insert into account_identities (
  id, account_id, user_id, type, normalized_value, display_value,
  is_primary, verified_at, created_at, updated_at
)
select distinct on (identity.account_id, identity.email)
  gen_random_uuid(),
  identity.account_id,
  identity.user_id,
  'email',
  identity.email,
  identity.email,
  false,
  identity.linked_at,
  identity.linked_at,
  now()
from user_identities as identity
where identity.email is not null and identity.email <> ''
order by identity.account_id, identity.email, identity.linked_at
on conflict (type, normalized_value) do update set
  verified_at = coalesce(account_identities.verified_at, excluded.verified_at),
  updated_at = now();
