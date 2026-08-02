drop trigger if exists otp_challenges_reject_phone on otp_challenges;
drop trigger if exists verification_challenges_reject_phone on verification_challenges;
drop function if exists reject_phone_verification_challenge();

comment on table sms_delivery_attempts is
  'Historical SMS delivery audit rows.';
