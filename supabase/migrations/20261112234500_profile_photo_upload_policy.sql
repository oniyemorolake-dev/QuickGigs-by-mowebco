-- SwiftGigs — photo uploads were refused.
--
-- 1. profile-photos: the upload rule was written "TO authenticated". Firebase
--    sign-ins reach Postgres as the anon role (which is why every other rule
--    here is "TO anon, authenticated" + qg_is_signed_in()), so the rule never
--    applied and storage answered 400 to every profile photo.
-- 2. All three buckets: the task/chat rules also checked metadata->>'mimetype'
--    and 'size'. Storage's permission test inserts the row before metadata
--    exists, so those checks fail on a real upload. No object had been stored
--    in any bucket since July. Type and size are enforced by the bucket
--    settings instead (5 MB, JPEG/PNG/WebP/GIF), which Storage applies itself.
--
-- Rules now: signed in, own folder, image extension (chat: also a party to
-- the conversation). Run in the Supabase SQL Editor. Safe to re-run.
-- APPLIED to the live project 12 Nov 2026.

BEGIN;

DROP POLICY IF EXISTS "users upload profile photos to own folder" ON storage.objects;

DROP POLICY IF EXISTS profile_photos_upload ON storage.objects;
CREATE POLICY profile_photos_upload ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'profile-photos'
    AND public.qg_is_signed_in()
    AND (storage.foldername(name))[1] = public.qg_uid()
    AND lower(storage.extension(name)) = ANY (ARRAY['jpg', 'jpeg', 'png', 'webp', 'gif'])
  );

DROP POLICY IF EXISTS task_photos_upload ON storage.objects;
CREATE POLICY task_photos_upload ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'task-photos'
    AND public.qg_is_signed_in()
    AND (storage.foldername(name))[1] = public.qg_uid()
    AND lower(storage.extension(name)) = ANY (ARRAY['jpg', 'jpeg', 'png', 'webp', 'gif'])
  );

DROP POLICY IF EXISTS chat_photos_upload ON storage.objects;
CREATE POLICY chat_photos_upload ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'chat-photos'
    AND public.qg_is_signed_in()
    AND (storage.foldername(name))[2] = public.qg_uid()
    AND lower(storage.extension(name)) = ANY (ARRAY['jpg', 'jpeg', 'png', 'webp', 'gif'])
    AND public.qg_storage_chat_participant(name)
  );

UPDATE storage.buckets
   SET file_size_limit = 5242880,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
 WHERE id IN ('profile-photos', 'task-photos', 'chat-photos');

COMMIT;
