-- QuickGigs — fix display names (run in Supabase SQL Editor)
-- Lets the app read user names for chat, applicants, and task cards

ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_firebase_uid_idx ON users (firebase_uid) WHERE firebase_uid IS NOT NULL;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_users" ON users;
DROP POLICY IF EXISTS "anon_insert_users" ON users;
DROP POLICY IF EXISTS "anon_update_users" ON users;

CREATE POLICY "anon_select_users" ON users FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_users" ON users FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_users" ON users FOR UPDATE TO anon USING (true);

-- Backfill firebase_uid from email for older rows (safe to re-run)
-- UPDATE users u SET firebase_uid = (
--   SELECT firebase_uid FROM users u2 WHERE u2.email = u.email AND u2.firebase_uid IS NOT NULL LIMIT 1
-- ) WHERE u.firebase_uid IS NULL;
