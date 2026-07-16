ALTER TABLE otp_challenges
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'signup';

ALTER TABLE otp_challenges
  DROP CONSTRAINT IF EXISTS otp_challenges_purpose_check;

ALTER TABLE otp_challenges
  ADD CONSTRAINT otp_challenges_purpose_check
  CHECK (purpose IN ('signup', 'recovery'));

CREATE INDEX IF NOT EXISTS otp_challenges_recovery_contact_idx
  ON otp_challenges (channel, destination, created_at DESC)
  WHERE purpose = 'recovery';
