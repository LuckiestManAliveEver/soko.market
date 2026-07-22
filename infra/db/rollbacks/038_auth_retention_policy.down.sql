drop trigger if exists cp2_sessions_retention_trigger on cp2_sessions;
drop trigger if exists sessions_retention_trigger on sessions;
drop trigger if exists cp2_passkey_ceremonies_retention_trigger on cp2_passkey_ceremonies;
drop trigger if exists cp2_otp_challenges_retention_trigger on cp2_otp_challenges;
drop trigger if exists verification_challenges_retention_trigger on verification_challenges;
drop trigger if exists otp_challenges_retention_trigger on otp_challenges;

drop function if exists revoke_expired_session_compatibility_record();
drop function if exists revoke_expired_session();
drop function if exists discard_expired_passkey_ceremony();
drop function if exists discard_expired_otp_compatibility_record();
drop function if exists discard_expired_otp_challenge();
