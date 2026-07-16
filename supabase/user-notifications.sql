-- QuickGigs — in-app notification bell (run in Supabase SQL Editor)
-- Also included at end of beta-setup-all.sql

CREATE TABLE IF NOT EXISTS user_notifications (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT NOT NULL,
  type              TEXT NOT NULL,
  title             TEXT NOT NULL,
  body              TEXT,
  link              TEXT,
  payload           JSONB,
  read_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_notifications_user_idx
  ON user_notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_notifications_unread_idx
  ON user_notifications (user_id, created_at DESC) WHERE read_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON user_notifications TO anon, authenticated;

ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_user_notifications" ON user_notifications;
DROP POLICY IF EXISTS "anon_insert_user_notifications" ON user_notifications;
DROP POLICY IF EXISTS "anon_update_user_notifications" ON user_notifications;

CREATE POLICY "anon_select_user_notifications" ON user_notifications FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_user_notifications" ON user_notifications FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_user_notifications" ON user_notifications FOR UPDATE TO anon USING (true) WITH CHECK (true);
