-- QuickGigs — profile photos (run in Supabase SQL Editor)

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-photos', 'profile-photos', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "anon_upload_profile_photos" ON storage.objects;
DROP POLICY IF EXISTS "anon_read_profile_photos" ON storage.objects;
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
