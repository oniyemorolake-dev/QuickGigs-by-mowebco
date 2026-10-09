-- Chat-photo storage policies subquery public.conversations. Postgres checks
-- table privileges for EVERY INSERT policy on storage.objects, including when
-- the upload is to task-photos. Anon has no GRANT on conversations (messaging
-- goes through the Edge Function), so posting a gig with a photo failed with
-- "permission denied for table conversations".
--
-- Move the conversations lookup into a SECURITY DEFINER helper so storage
-- policy evaluation no longer requires the caller to have table GRANT.

CREATE OR REPLACE FUNCTION public.qg_storage_chat_participant(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.conv_id::text = (storage.foldername(object_name))[1]
      AND public.qg_uid() IN (c.poster_id, c.worker_id)
  );
$$;

REVOKE ALL ON FUNCTION public.qg_storage_chat_participant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qg_storage_chat_participant(text) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "chat_photos_read" ON storage.objects;
DROP POLICY IF EXISTS "chat_photos_upload" ON storage.objects;

CREATE POLICY "chat_photos_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (
    bucket_id = 'chat-photos'
    AND public.qg_is_signed_in()
    AND (
      public.is_qg_admin()
      OR public.qg_storage_chat_participant(name)
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
    AND public.qg_storage_chat_participant(name)
  );
