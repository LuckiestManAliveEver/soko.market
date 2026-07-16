DROP INDEX IF EXISTS otp_challenges_recovery_contact_idx;

ALTER TABLE otp_challenges
  DROP CONSTRAINT IF EXISTS otp_challenges_purpose_check;

ALTER TABLE otp_challenges
  DROP COLUMN IF EXISTS purpose;
