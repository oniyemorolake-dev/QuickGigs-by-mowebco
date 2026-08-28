-- QuickGigs — admin console hardening (run in Supabase SQL Editor)
-- Does NOT change RLS on users, tasks, applications, chat, or payments.
--
-- 1) Ensure admins table exists (Firebase UID allow-list).
-- 2) Lock admin-only tables so browser JWT cannot write audit/banner/waitlist rows.
-- 3) Revoke broad grants; service-role Edge Functions bypass RLS.

CREATE TABLE IF NOT EXISTS admins (
  user_id    TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
-- No client policies: only service-role (Edge Functions) may read/write.

COMMENT ON TABLE admins IS 'Server-side admin allow-list (Firebase UID). Never expose via anon key.';

-- Insert your Firebase UID (Authentication → Users → User UID):
-- INSERT INTO admins (user_id) VALUES ('YOUR_FIREBASE_UID')
-- ON CONFLICT (user_id) DO NOTHING;

-- ── admin_actions / admin_notes: service-role only ───────────────────────────
REVOKE ALL ON admin_actions FROM anon, authenticated;
REVOKE ALL ON admin_notes FROM anon, authenticated;

DROP POLICY IF EXISTS "anon_select_admin_notes" ON admin_notes;
DROP POLICY IF EXISTS "anon_insert_admin_notes" ON admin_notes;
DROP POLICY IF EXISTS "anon_select_admin_actions" ON admin_actions;
DROP POLICY IF EXISTS "anon_insert_admin_actions" ON admin_actions;

-- ── waitlist: keep public SELECT; writes via admin-console Edge Function ────
REVOKE INSERT, UPDATE, DELETE ON waitlist FROM anon, authenticated;

DROP POLICY IF EXISTS "anon_insert_waitlist" ON waitlist;
DROP POLICY IF EXISTS "anon_update_waitlist" ON waitlist;
DROP POLICY IF EXISTS "anon_delete_waitlist" ON waitlist;
-- anon_select_waitlist remains for legacy reads until admin UI fully migrates.

-- ── platform_banner: public read; admin writes via Edge Function ─────────────
REVOKE INSERT, UPDATE ON platform_banner FROM anon, authenticated;

DROP POLICY IF EXISTS "anon_insert_platform_banner" ON platform_banner;
DROP POLICY IF EXISTS "anon_update_platform_banner" ON platform_banner;
-- anon_select_platform_banner remains for qg-announcement.js.
