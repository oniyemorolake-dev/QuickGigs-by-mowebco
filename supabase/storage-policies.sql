-- QuickGigs — storage policies (own-folder writes, images only)
-- RUN AFTER Firebase JWT ↔ Supabase auth linkage (auth.jwt()->>'sub' must be the Firebase uid).
--
-- App buckets today: task-photos, profile-photos, chat-photos
-- (Draft name "task-images" maps to task-photos used by uploadTaskPhoto.)
--
-- NOTE: public = false blocks bare /object/public/ URLs in <img src>.
-- The SELECT policies below allow API reads; the client must use signed URLs
-- or /object/authenticated/ with a key. Until the client is switched, you can
-- leave public = true and still keep the INSERT own-folder lock (safer writes).

-- ── task-photos (task reference images on post-task) ─────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('task-photos', 'task-photos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "anon_upload_task_photos" ON storage.objects;
DROP POLICY IF EXISTS "anon_read_task_photos" ON storage.objects;
DROP POLICY IF EXISTS "auth_upload_task_photos" ON storage.objects;
DROP POLICY IF EXISTS "auth_read_task_photos" ON storage.objects;
DROP POLICY IF EXISTS "task_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "task_photos_select" ON storage.objects;
DROP POLICY IF EXISTS "users upload to own folder" ON storage.objects;
DROP POLICY IF EXISTS "anyone can view task images" ON storage.objects;
DROP POLICY IF EXISTS "users upload task photos to own folder" ON storage.objects;
DROP POLICY IF EXISTS "anyone can view task photos" ON storage.objects;

CREATE POLICY "users upload task photos to own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'task-photos'
  AND (auth.jwt()->>'sub') = (storage.foldername(name))[1]
  AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp', 'gif')
);

CREATE POLICY "anyone can view task photos"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'task-photos');

-- Alias bucket name from the launch draft (optional; safe if unused)
INSERT INTO storage.buckets (id, name, public)
VALUES ('task-images', 'task-images', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "users upload to own folder" ON storage.objects;
DROP POLICY IF EXISTS "anyone can view task images" ON storage.objects;

CREATE POLICY "users upload to own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'task-images'
  AND (auth.jwt()->>'sub') = (storage.foldername(name))[1]
  AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp', 'gif')
);

CREATE POLICY "anyone can view task images"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'task-images');

-- ── profile-photos (path: {uid}/file) ────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-photos', 'profile-photos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "anon_upload_profile_photos" ON storage.objects;
DROP POLICY IF EXISTS "anon_read_profile_photos" ON storage.objects;
DROP POLICY IF EXISTS "profile_photos_read" ON storage.objects;
DROP POLICY IF EXISTS "profile_photos_upload" ON storage.objects;
DROP POLICY IF EXISTS "profile_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "profile_photos_select" ON storage.objects;
DROP POLICY IF EXISTS "users upload profile photos to own folder" ON storage.objects;
DROP POLICY IF EXISTS "anyone can view profile photos" ON storage.objects;

CREATE POLICY "users upload profile photos to own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'profile-photos'
  AND (auth.jwt()->>'sub') = (storage.foldername(name))[1]
  AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp', 'gif')
);

CREATE POLICY "anyone can view profile photos"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'profile-photos');

-- ── chat-photos (path: {convId}/{uid}/file — folder[2] is uploader) ─
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-photos', 'chat-photos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "anon_upload_chat_photos" ON storage.objects;
DROP POLICY IF EXISTS "anon_read_chat_photos" ON storage.objects;
DROP POLICY IF EXISTS "auth_upload_chat_photos" ON storage.objects;
DROP POLICY IF EXISTS "auth_read_chat_photos" ON storage.objects;
DROP POLICY IF EXISTS "chat_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "chat_photos_select" ON storage.objects;
DROP POLICY IF EXISTS "users upload chat photos to own folder" ON storage.objects;
DROP POLICY IF EXISTS "anyone can view chat photos" ON storage.objects;

CREATE POLICY "users upload chat photos to own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'chat-photos'
  AND (auth.jwt()->>'sub') = (storage.foldername(name))[2]
  AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp', 'gif')
);

CREATE POLICY "anyone can view chat photos"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'chat-photos');
