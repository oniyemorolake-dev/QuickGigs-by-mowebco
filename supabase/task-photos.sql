-- QuickGigs — task photos (run in Supabase SQL Editor after tasks-beta-fix.sql)
-- Adds reference photos on posts + optional "tasker must share photo updates"

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS photo_urls TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS requires_photos BOOLEAN NOT NULL DEFAULT FALSE;

-- Public bucket for task reference images (posters upload when creating a task)
INSERT INTO storage.buckets (id, name, public)
VALUES ('task-photos', 'task-photos', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "anon_upload_task_photos" ON storage.objects;
DROP POLICY IF EXISTS "anon_read_task_photos" ON storage.objects;

CREATE POLICY "anon_upload_task_photos" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'task-photos');

CREATE POLICY "anon_read_task_photos" ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'task-photos');

-- Chat images (posters only — reference photos sent in unlocked chat)
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-photos', 'chat-photos', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "anon_upload_chat_photos" ON storage.objects;
DROP POLICY IF EXISTS "anon_read_chat_photos" ON storage.objects;

CREATE POLICY "anon_upload_chat_photos" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'chat-photos');

CREATE POLICY "anon_read_chat_photos" ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'chat-photos');
