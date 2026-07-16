-- QuickGigs — Priority 1 & 2 features (run in Supabase SQL Editor)
-- Reports, email notification queue, user warnings / auto-ban

-- ── USER STATUS (active / warned / banned) ───────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

-- ── REPORTS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
  report_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     TEXT NOT NULL,
  reporter_email  TEXT,
  target_type     TEXT NOT NULL,
  target_id       TEXT NOT NULL,
  target_label    TEXT,
  reason          TEXT NOT NULL,
  details         TEXT,
  status          TEXT NOT NULL DEFAULT 'open',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reports_target_idx ON reports (target_type, target_id);
CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON reports TO anon, authenticated;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_reports" ON reports;
DROP POLICY IF EXISTS "anon_insert_reports" ON reports;
DROP POLICY IF EXISTS "anon_update_reports" ON reports;
CREATE POLICY "anon_select_reports" ON reports FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_reports" ON reports FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_reports" ON reports FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ── EMAIL NOTIFICATION QUEUE ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_queue (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT NOT NULL,
  email             TEXT,
  type              TEXT NOT NULL,
  subject           TEXT,
  body_text         TEXT,
  payload           JSONB,
  sent_at           TIMESTAMPTZ,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notification_queue_pending_idx
  ON notification_queue (created_at ASC) WHERE sent_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON notification_queue TO anon, authenticated;
ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_notifications" ON notification_queue;
DROP POLICY IF EXISTS "anon_insert_notifications" ON notification_queue;
DROP POLICY IF EXISTS "anon_update_notifications" ON notification_queue;
CREATE POLICY "anon_select_notifications" ON notification_queue FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_notifications" ON notification_queue FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_notifications" ON notification_queue FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ── USER WARNINGS (3 warnings → auto-ban via app logic) ──────────
CREATE TABLE IF NOT EXISTS user_warnings (
  warning_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  reason       TEXT,
  source       TEXT DEFAULT 'admin',
  report_id    UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_warnings_user_idx ON user_warnings (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON users TO anon, authenticated;
GRANT SELECT, INSERT ON user_warnings TO anon, authenticated;

ALTER TABLE user_warnings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_warnings" ON user_warnings;
DROP POLICY IF EXISTS "anon_insert_warnings" ON user_warnings;
CREATE POLICY "anon_select_warnings" ON user_warnings FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_warnings" ON user_warnings FOR INSERT TO anon WITH CHECK (true);
