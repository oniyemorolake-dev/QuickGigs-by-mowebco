-- =============================================================================
-- QuickGigs — profile completion meter columns
-- Copy → paste into Supabase SQL Editor → Run
-- Safe to re-run (IF NOT EXISTS). Does NOT rename existing columns.
-- =============================================================================
-- Used by profileCompletion.js:
--   name, email          — account basics (usually already on users)
--   avatar_url           — profile photo (mapped as "photo" in JS)
--   bio                  — short bio (20+ chars for credit)
--   skills               — TEXT: JSON array or comma-separated
--   pronouns             — optional
--   email_verified       — optional mirror of Firebase emailVerified
--   is_verified          — existing worker/trust badge (separate from email)
-- =============================================================================

-- Core identity / contact
ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid TEXT;

-- Encourage fields for the completion meter
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS skills TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pronouns TEXT;

-- Email verification (profileCompletion "verified" reads email_verified / verified)
-- There is no separate users.verified column in production — use email_verified.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing trust badge (worker/trust — NOT used by the completion meter)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Helpful indexes (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS users_firebase_uid_idx
  ON users (firebase_uid) WHERE firebase_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_email_idx
  ON users (email) WHERE email IS NOT NULL;

COMMENT ON COLUMN users.avatar_url IS 'Profile photo URL — profileCompletion "photo" (20%)';
COMMENT ON COLUMN users.bio IS 'Short bio — credit at 20+ characters (20%)';
COMMENT ON COLUMN users.skills IS 'JSON array or comma-separated skills (15%)';
COMMENT ON COLUMN users.pronouns IS 'e.g. she/her, he/him, they/them (5%)';
COMMENT ON COLUMN users.email_verified IS 'Email verified — profileCompletion "verified" (10%); may mirror Firebase';
COMMENT ON COLUMN users.is_verified IS 'Worker/trust verified badge — NOT the completion email check';

-- Optional: backfill email_verified from is_verified is NOT done here
-- (different meanings). Set email_verified from the client after Firebase verify.
