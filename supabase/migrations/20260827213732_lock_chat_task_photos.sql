-- QuickGigs — lock chat-photos + task-photos storage (Item 1)
-- Firebase JWT: policies key on public.qg_uid() / public.qg_is_signed_in().
-- Path convention: chat-photos/{convId}/{userId}/file
--                 task-photos/{userId}/file
--
-- Run in Supabase SQL Editor (or via migration). Do not re-run storage-beta-fix.sql.

-- ── Bucket settings ──────────────────────────────────────────────
-- chat-photos MUST be private: /object/public/ bypasses RLS.
UPDATE storage.buckets
SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
WHERE id = 'chat-photos';

-- task-photos: keep public for browse UI; enforce size/MIME on the bucket.
UPDATE storage.buckets
SET
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
WHERE id = 'task-photos';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-photos',
  'chat-photos',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task-photos',
  'task-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = 5242880,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── Drop open / legacy policies ──────────────────────────────────
DROP POLICY IF EXISTS "anyone can view chat photos" ON storage.objects;
DROP POLICY IF EXISTS "anyone can view task photos" ON storage.objects;
DROP POLICY IF EXISTS "anyone can view task images" ON storage.objects;
DROP POLICY IF EXISTS "chat_photos_select" ON storage.objects;
DROP POLICY IF EXISTS "chat_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "chat_photos_read" ON storage.objects;
DROP POLICY IF EXISTS "chat_photos_upload" ON storage.objects;
DROP POLICY IF EXISTS "anon_upload_chat_photos" ON storage.objects;
DROP POLICY IF EXISTS "anon_read_chat_photos" ON storage.objects;
DROP POLICY IF EXISTS "auth_upload_chat_photos" ON storage.objects;
DROP POLICY IF EXISTS "auth_read_chat_photos" ON storage.objects;
DROP POLICY IF EXISTS "users upload chat photos to own folder" ON storage.objects;

DROP POLICY IF EXISTS "task_photos_select" ON storage.objects;
DROP POLICY IF EXISTS "task_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "task_photos_read" ON storage.objects;
DROP POLICY IF EXISTS "task_photos_upload" ON storage.objects;
DROP POLICY IF EXISTS "anon_upload_task_photos" ON storage.objects;
DROP POLICY IF EXISTS "anon_read_task_photos" ON storage.objects;
DROP POLICY IF EXISTS "auth_upload_task_photos" ON storage.objects;
DROP POLICY IF EXISTS "auth_read_task_photos" ON storage.objects;
DROP POLICY IF EXISTS "users upload task photos to own folder" ON storage.objects;

-- ── chat-photos: participant SELECT / INSERT ─────────────────────
-- Folder[1] = convId, folder[2] = uploader Firebase UID.
CREATE POLICY "chat_photos_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (
    bucket_id = 'chat-photos'
    AND public.qg_is_signed_in()
    AND (
      public.is_qg_admin()
      OR EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.conv_id::text = (storage.foldername(name))[1]
          AND (c.poster_id = public.qg_uid() OR c.worker_id = public.qg_uid())
      )
    )
  );

CREATE POLICY "chat_photos_upload" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'chat-photos'
    AND public.qg_is_signed_in()
    AND (storage.foldername(name))[2] = public.qg_uid()
    AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp', 'gif')
    AND coalesce(metadata->>'mimetype', '') ~* '^image/(jpeg|png|webp|gif)$'
    AND coalesce((metadata->>'size')::bigint, 0) <= 5242880
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.conv_id::text = (storage.foldername(name))[1]
        AND (c.poster_id = public.qg_uid() OR c.worker_id = public.qg_uid())
    )
  );

-- ── task-photos: marketplace-readable SELECT; own-folder INSERT ──
CREATE POLICY "task_photos_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'task-photos');

CREATE POLICY "task_photos_upload" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'task-photos'
    AND public.qg_is_signed_in()
    AND (storage.foldername(name))[1] = public.qg_uid()
    AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp', 'gif')
    AND coalesce(metadata->>'mimetype', '') ~* '^image/(jpeg|png|webp|gif)$'
    AND coalesce((metadata->>'size')::bigint, 0) <= 5242880
  );
