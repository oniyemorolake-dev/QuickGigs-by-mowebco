-- QuickGigs — beta database setup (paste all of this in Supabase SQL Editor → Run)
-- Fixes accept, decline, post task, chat, profile photo uploads

-- ── TASKS ────────────────────────────────────────────────────────
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS poster_name TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_label TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS photo_urls TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS requires_photos BOOLEAN NOT NULL DEFAULT FALSE;

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

-- ── PROFILE PHOTOS ───────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

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
