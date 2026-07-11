drop index if exists oauth_sessions_account_idx;
drop index if exists user_identities_account_idx;
drop index if exists otp_challenges_destination_active_idx;
drop index if exists device_trust_business_user_idx;
drop table if exists device_trust;
drop table if exists account_pin_hashes;
alter table sessions drop column if exists pin_verified_at;
