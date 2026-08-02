-- Retire phone/SMS verification while preserving historical audit rows.

update otp_challenges
set consumed_at = coalesce(consumed_at, now())
where channel = 'phone' and consumed_at is null;

update verification_challenges
set status = 'invalidated', consumed_at = coalesce(consumed_at, now())
where channel = 'phone' and consumed_at is null;

create or replace function reject_phone_verification_challenge()
returns trigger
language plpgsql
as $$
begin
  if new.channel = 'phone' and new.consumed_at is null then
    raise exception 'Active phone/SMS verification challenges are disabled'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists otp_challenges_reject_phone on otp_challenges;
create trigger otp_challenges_reject_phone
before insert or update on otp_challenges
for each row execute function reject_phone_verification_challenge();

drop trigger if exists verification_challenges_reject_phone on verification_challenges;
create trigger verification_challenges_reject_phone
before insert or update on verification_challenges
for each row execute function reject_phone_verification_challenge();

comment on table sms_delivery_attempts is
  'Historical SMS delivery audit rows; no new authentication delivery attempts are created.';
