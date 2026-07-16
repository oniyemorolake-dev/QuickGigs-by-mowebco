-- QuickGigs — identity fields (pronouns, gender, DOB, guardian consent)
-- Run in Supabase SQL Editor (safe to re-run)

ALTER TABLE users ADD COLUMN IF NOT EXISTS pronouns TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_collected_at TIMESTAMPTZ;

ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_consent_status TEXT DEFAULT 'not_required';
ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_consent_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_consent_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status TEXT DEFAULT 'active';

COMMENT ON COLUMN users.pronouns IS 'e.g. she/her, he/him, they/them';
COMMENT ON COLUMN users.gender IS 'Self-described gender identity';
COMMENT ON COLUMN users.guardian_consent_status IS 'not_required | pending | approved | rejected';
COMMENT ON COLUMN users.account_status IS 'active | pending_guardian | suspended';

CREATE INDEX IF NOT EXISTS idx_users_guardian_token ON users (guardian_consent_token) WHERE guardian_consent_token IS NOT NULL;
