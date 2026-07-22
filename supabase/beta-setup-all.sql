-- QuickGigs — beta database setup (paste all of this in Supabase SQL Editor → Run)
-- Fixes accept, decline, post task, chat, profile photo uploads

-- ── TASKS ────────────────────────────────────────────────────────
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS poster_name TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_label TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS photo_urls TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS requires_photos BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS tasks_created_idx ON tasks (created_at DESC);
CREATE INDEX IF NOT EXISTS tasks_status_created_idx ON tasks (status, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON tasks TO anon, authenticated;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_tasks" ON tasks;
DROP POLICY IF EXISTS "anon_insert_tasks" ON tasks;
DROP POLICY IF EXISTS "anon_update_tasks" ON tasks;

CREATE POLICY "anon_select_tasks" ON tasks FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_tasks" ON tasks FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_tasks" ON tasks FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ── APPLICATIONS (accept / decline / withdraw) ───────────────────
ALTER TABLE applications ADD COLUMN IF NOT EXISTS worker_name TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

GRANT SELECT, INSERT, UPDATE ON applications TO anon, authenticated;

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_applications" ON applications;
DROP POLICY IF EXISTS "anon_insert_applications" ON applications;
DROP POLICY IF EXISTS "anon_update_applications" ON applications;

CREATE POLICY "anon_select_applications" ON applications FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_applications" ON applications FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_applications" ON applications FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ── USERS (names + avatars readable by everyone in beta) ─────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS skills TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_firebase_uid_idx ON users (firebase_uid) WHERE firebase_uid IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON users TO anon, authenticated;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_users" ON users;
DROP POLICY IF EXISTS "anon_insert_users" ON users;
DROP POLICY IF EXISTS "anon_update_users" ON users;

CREATE POLICY "anon_select_users" ON users FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_users" ON users FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_users" ON users FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ── PROFILE PHOTOS ───────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-photos', 'profile-photos', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "profile_photos_read" ON storage.objects;
DROP POLICY IF EXISTS "profile_photos_upload" ON storage.objects;

CREATE POLICY "profile_photos_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'profile-photos');

CREATE POLICY "profile_photos_upload" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'profile-photos');

-- ── CONVERSATIONS + MESSAGES (keep chat history visible in beta) ─
-- Do NOT run rls-secure.sql until Firebase auth is enabled in Supabase.

GRANT SELECT, INSERT, UPDATE ON conversations TO anon, authenticated;
GRANT SELECT, INSERT ON messages TO anon, authenticated;

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_conversations" ON conversations;
DROP POLICY IF EXISTS "anon_insert_conversations" ON conversations;
DROP POLICY IF EXISTS "anon_update_conversations" ON conversations;
DROP POLICY IF EXISTS "anon_select_messages" ON messages;
DROP POLICY IF EXISTS "anon_insert_messages" ON messages;

CREATE POLICY "anon_select_conversations" ON conversations FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_conversations" ON conversations FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_conversations" ON conversations FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_select_messages" ON messages FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_messages" ON messages FOR INSERT TO anon WITH CHECK (true);

-- ── TASK + CHAT PHOTOS (post task uploads + chat images) ─────────
-- If uploads still fail, run supabase/storage-beta-fix.sql alone.

INSERT INTO storage.buckets (id, name, public)
VALUES ('task-photos', 'task-photos', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "anon_upload_task_photos" ON storage.objects;
DROP POLICY IF EXISTS "anon_read_task_photos" ON storage.objects;
DROP POLICY IF EXISTS "auth_upload_task_photos" ON storage.objects;
DROP POLICY IF EXISTS "auth_read_task_photos" ON storage.objects;
DROP POLICY IF EXISTS "task_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "task_photos_select" ON storage.objects;

CREATE POLICY "task_photos_insert" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'task-photos');

CREATE POLICY "task_photos_select" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'task-photos');

INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-photos', 'chat-photos', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "anon_upload_chat_photos" ON storage.objects;
DROP POLICY IF EXISTS "anon_read_chat_photos" ON storage.objects;
DROP POLICY IF EXISTS "auth_upload_chat_photos" ON storage.objects;
DROP POLICY IF EXISTS "auth_read_chat_photos" ON storage.objects;
DROP POLICY IF EXISTS "chat_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "chat_photos_select" ON storage.objects;

CREATE POLICY "chat_photos_insert" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'chat-photos');

CREATE POLICY "chat_photos_select" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'chat-photos');

-- ── REVIEWS (show on profiles after completed tasks) ─────────────
GRANT SELECT, INSERT ON reviews TO anon, authenticated;

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_reviews" ON reviews;
DROP POLICY IF EXISTS "anon_insert_reviews" ON reviews;

CREATE POLICY "anon_select_reviews" ON reviews FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_reviews" ON reviews FOR INSERT TO anon WITH CHECK (true);

-- ── P1/P2: reports, email queue, warnings, user status ───────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

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
GRANT SELECT, INSERT, UPDATE ON reports TO anon, authenticated;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_reports" ON reports;
DROP POLICY IF EXISTS "anon_insert_reports" ON reports;
DROP POLICY IF EXISTS "anon_update_reports" ON reports;
CREATE POLICY "anon_select_reports" ON reports FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_reports" ON reports FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_reports" ON reports FOR UPDATE TO anon USING (true) WITH CHECK (true);

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

CREATE TABLE IF NOT EXISTS user_warnings (
  warning_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  reason       TEXT,
  source       TEXT DEFAULT 'admin',
  report_id    UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS user_warnings_user_idx ON user_warnings (user_id, created_at DESC);
GRANT SELECT, INSERT ON user_warnings TO anon, authenticated;
ALTER TABLE user_warnings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_warnings" ON user_warnings;
DROP POLICY IF EXISTS "anon_insert_warnings" ON user_warnings;
CREATE POLICY "anon_select_warnings" ON user_warnings FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_warnings" ON user_warnings FOR INSERT TO anon WITH CHECK (true);

-- ── DISPUTES + WORKER VERIFICATION ───────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS disputes (
  dispute_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           TEXT NOT NULL,
  opened_by         TEXT NOT NULL,
  opened_by_email   TEXT,
  against_user_id   TEXT,
  reason            TEXT NOT NULL,
  details           TEXT,
  status            TEXT NOT NULL DEFAULT 'open',
  resolution_note   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS disputes_task_idx ON disputes (task_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON disputes TO anon, authenticated;
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_disputes" ON disputes;
DROP POLICY IF EXISTS "anon_insert_disputes" ON disputes;
DROP POLICY IF EXISTS "anon_update_disputes" ON disputes;
CREATE POLICY "anon_select_disputes" ON disputes FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_disputes" ON disputes FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_disputes" ON disputes FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ── IN-APP NOTIFICATION BELL ─────────────────────────────────────
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

-- ── SAVED TASK BOOKMARKS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_tasks (
  saved_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL,
  task_id    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, task_id)
);
CREATE INDEX IF NOT EXISTS saved_tasks_user_idx
  ON saved_tasks (user_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON saved_tasks TO anon, authenticated;
ALTER TABLE saved_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_saved_tasks" ON saved_tasks;
DROP POLICY IF EXISTS "anon_insert_saved_tasks" ON saved_tasks;
DROP POLICY IF EXISTS "anon_delete_saved_tasks" ON saved_tasks;
CREATE POLICY "anon_select_saved_tasks" ON saved_tasks FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_saved_tasks" ON saved_tasks FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_delete_saved_tasks" ON saved_tasks FOR DELETE TO anon USING (true);

-- ── ADMIN CONSOLE TOOLS ──────────────────────────────────────────
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

GRANT SELECT, INSERT ON admin_notes TO anon, authenticated;
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

-- ── WAITLIST + PLATFORM BANNER ───────────────────────────────────
CREATE TABLE IF NOT EXISTS waitlist (
  waitlist_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             TEXT NOT NULL UNIQUE,
  name              TEXT,
  invited_at        TIMESTAMPTZ,
  signed_up         BOOLEAN NOT NULL DEFAULT FALSE,
  signed_up_at      TIMESTAMPTZ,
  reminder_sent_at  TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS waitlist_email_idx ON waitlist (email);
CREATE INDEX IF NOT EXISTS waitlist_signed_idx ON waitlist (signed_up, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_banner (
  id         INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  message    TEXT NOT NULL DEFAULT '',
  link       TEXT,
  style      TEXT NOT NULL DEFAULT 'info',
  active     BOOLEAN NOT NULL DEFAULT FALSE,
  soft_close BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO platform_banner (id, message, active) VALUES (1, '', false) ON CONFLICT (id) DO NOTHING;
ALTER TABLE platform_banner ADD COLUMN IF NOT EXISTS soft_close BOOLEAN NOT NULL DEFAULT FALSE;

GRANT SELECT, INSERT, UPDATE, DELETE ON waitlist TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON platform_banner TO anon, authenticated;
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_banner ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_waitlist" ON waitlist;
DROP POLICY IF EXISTS "anon_insert_waitlist" ON waitlist;
DROP POLICY IF EXISTS "anon_update_waitlist" ON waitlist;
DROP POLICY IF EXISTS "anon_delete_waitlist" ON waitlist;
DROP POLICY IF EXISTS "anon_select_platform_banner" ON platform_banner;
DROP POLICY IF EXISTS "anon_insert_platform_banner" ON platform_banner;
DROP POLICY IF EXISTS "anon_update_platform_banner" ON platform_banner;
CREATE POLICY "anon_select_waitlist" ON waitlist FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_waitlist" ON waitlist FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_waitlist" ON waitlist FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_waitlist" ON waitlist FOR DELETE TO anon USING (true);
CREATE POLICY "anon_select_platform_banner" ON platform_banner FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_platform_banner" ON platform_banner FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_platform_banner" ON platform_banner FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ── NEGOTIABLE BUDGETS + COUNTER-OFFERS ──────────────────────────
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS budget_negotiable BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE applications ADD COLUMN IF NOT EXISTS counter_price NUMERIC;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS counter_by TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS counter_round INT NOT NULL DEFAULT 0;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS last_counter_at TIMESTAMPTZ;

-- ── PAYMENTS (Stripe launch) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  payment_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id        TEXT NOT NULL,
  poster_id      TEXT NOT NULL,
  worker_id      TEXT NOT NULL,
  amount         NUMERIC NOT NULL DEFAULT 0,
  platform_fee   NUMERIC NOT NULL DEFAULT 0,
  worker_payout  NUMERIC NOT NULL DEFAULT 0,
  stripe_id      TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS payments_task_idx ON payments (task_id);
GRANT SELECT, INSERT, UPDATE ON payments TO anon, authenticated;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_payments" ON payments;
DROP POLICY IF EXISTS "anon_insert_payments" ON payments;
DROP POLICY IF EXISTS "anon_update_payments" ON payments;
CREATE POLICY "anon_select_payments" ON payments FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_payments" ON payments FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_payments" ON payments FOR UPDATE TO anon USING (true) WITH CHECK (true);
