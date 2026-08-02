drop table if exists cp2_sms_delivery_attempts;
drop table if exists sms_delivery_attempts;
drop index if exists verification_challenges_one_active_phone_idx;
alter table verification_challenges drop constraint if exists verification_challenges_resend_count_check;
alter table verification_challenges drop column if exists identifier_hash;
alter table verification_challenges drop column if exists provider_message_id;
alter table verification_challenges drop column if exists provider;
alter table verification_challenges drop column if exists next_resend_at;
alter table verification_challenges drop column if exists resend_count;
alter table verification_challenges drop column if exists consumed_at;
alter table verification_challenges drop constraint if exists verification_challenges_status_check;
alter table verification_challenges add constraint verification_challenges_status_check
  check (status in ('pending', 'verified', 'expired', 'locked'));
alter table otp_challenges drop constraint if exists otp_challenges_resend_count_check;
alter table otp_challenges drop column if exists provider_message_id;
alter table otp_challenges drop column if exists provider;
alter table otp_challenges drop column if exists next_resend_at;
alter table otp_challenges drop column if exists resend_count;
alter table otp_challenges drop column if exists consumed_at;
