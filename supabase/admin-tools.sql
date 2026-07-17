-- QuickGigs — admin console tools (run in Supabase SQL Editor)
-- Also appended to beta-setup-all.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS review_flag BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS admin_notes (
  note_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  body        TEXT NOT NULL,
  admin_email TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_notes_user_idx ON admin_notes (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_actions (
  action_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email  TEXT,
  action_type  TEXT NOT NULL,
  target_type  TEXT,
  target_id    TEXT,
  detail       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_actions_created_idx ON admin_actions (created_at DESC);

GRANT SELECT, INSERT, UPDATE ON admin_notes TO anon, authenticated;
GRANT SELECT, INSERT ON admin_actions TO anon, authenticated;

ALTER TABLE admin_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_admin_notes" ON admin_notes;
DROP POLICY IF EXISTS "anon_insert_admin_notes" ON admin_notes;
DROP POLICY IF EXISTS "anon_select_admin_actions" ON admin_actions;
DROP POLICY IF EXISTS "anon_insert_admin_actions" ON admin_actions;

CREATE POLICY "anon_select_admin_notes" ON admin_notes FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_admin_notes" ON admin_notes FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_select_admin_actions" ON admin_actions FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_admin_actions" ON admin_actions FOR INSERT TO anon WITH CHECK (true);
