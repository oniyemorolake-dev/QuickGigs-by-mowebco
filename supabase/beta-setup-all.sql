-- QuickGigs — beta database setup (paste all of this in Supabase SQL Editor → Run)
-- Fixes accept, decline, post task, chat, profile photo uploads

-- ── TASKS ────────────────────────────────────────────────────────
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS poster_name TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open';

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
  WITH CHECK (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] IS NOT NULL
  );
