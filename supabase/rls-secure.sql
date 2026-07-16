-- ================================================================
-- QuickGigs — Secure RLS (run AFTER beta, when ready to lock down)
-- ================================================================
--
-- STEP 1 — Supabase Dashboard (one-time, before running this file):
--   Authentication → Sign In / Up → Third-party → Firebase → Enable
--   Project ID: quickgigs-7b12d (must match Firebase)
--
-- STEP 2 — Run this entire file in SQL Editor
--
-- STEP 3 — Deploy latest supabase-db.js (sends Firebase ID token on requests)
--
-- STEP 4 — Test: log in, post task, apply, chat. If 401/403, Firebase link
--           in Supabase is not enabled yet — finish Step 1 first.
--
-- To stay on open beta policies, do NOT run this file yet.
-- ================================================================

CREATE OR REPLACE FUNCTION public.is_qg_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(auth.jwt() ->> 'email', '') = 'mowebsiteco@gmail.com';
$$;

-- ── TASKS ──────────────────────────────────────────────────────
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_tasks" ON tasks;
DROP POLICY IF EXISTS "anon_insert_tasks" ON tasks;
DROP POLICY IF EXISTS "anon_update_tasks" ON tasks;
DROP POLICY IF EXISTS "tasks_public_browse" ON tasks;
DROP POLICY IF EXISTS "tasks_select_auth" ON tasks;
DROP POLICY IF EXISTS "tasks_insert_auth" ON tasks;
DROP POLICY IF EXISTS "tasks_update_auth" ON tasks;
DROP POLICY IF EXISTS "tasks_admin" ON tasks;

CREATE POLICY "tasks_public_browse" ON tasks
  FOR SELECT TO anon
  USING (status = 'open');

CREATE POLICY "tasks_select_auth" ON tasks
  FOR SELECT TO authenticated
  USING (
    public.is_qg_admin()
    OR status = 'open'
    OR posted_by = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM applications a
      WHERE a.task_id = tasks.task_id
        AND a.worker_id = auth.uid()::text
    )
  );

CREATE POLICY "tasks_insert_auth" ON tasks
  FOR INSERT TO authenticated
  WITH CHECK (posted_by = auth.uid()::text OR public.is_qg_admin());

CREATE POLICY "tasks_update_auth" ON tasks
  FOR UPDATE TO authenticated
  USING (posted_by = auth.uid()::text OR public.is_qg_admin())
  WITH CHECK (posted_by = auth.uid()::text OR public.is_qg_admin());

-- ── APPLICATIONS ─────────────────────────────────────────────────
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_applications" ON applications;
DROP POLICY IF EXISTS "anon_insert_applications" ON applications;
DROP POLICY IF EXISTS "anon_update_applications" ON applications;
DROP POLICY IF EXISTS "applications_select_auth" ON applications;
DROP POLICY IF EXISTS "applications_insert_auth" ON applications;
DROP POLICY IF EXISTS "applications_update_auth" ON applications;

CREATE POLICY "applications_select_auth" ON applications
  FOR SELECT TO authenticated
  USING (
    public.is_qg_admin()
    OR worker_id = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.task_id = applications.task_id
        AND t.posted_by = auth.uid()::text
    )
  );

CREATE POLICY "applications_insert_auth" ON applications
  FOR INSERT TO authenticated
  WITH CHECK (worker_id = auth.uid()::text OR public.is_qg_admin());

CREATE POLICY "applications_update_auth" ON applications
  FOR UPDATE TO authenticated
  USING (
    public.is_qg_admin()
    OR worker_id = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.task_id = applications.task_id
        AND t.posted_by = auth.uid()::text
    )
  )
  WITH CHECK (
    public.is_qg_admin()
    OR worker_id = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.task_id = applications.task_id
        AND t.posted_by = auth.uid()::text
    )
  );

-- ── USERS ────────────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_users" ON users;
DROP POLICY IF EXISTS "anon_insert_users" ON users;
DROP POLICY IF EXISTS "anon_update_users" ON users;
DROP POLICY IF EXISTS "users_select_auth" ON users;
DROP POLICY IF EXISTS "users_insert_auth" ON users;
DROP POLICY IF EXISTS "users_update_auth" ON users;

CREATE POLICY "users_select_auth" ON users
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "users_insert_auth" ON users
  FOR INSERT TO authenticated
  WITH CHECK (firebase_uid = auth.uid()::text OR public.is_qg_admin());

CREATE POLICY "users_update_auth" ON users
  FOR UPDATE TO authenticated
  USING (firebase_uid = auth.uid()::text OR public.is_qg_admin())
  WITH CHECK (firebase_uid = auth.uid()::text OR public.is_qg_admin());

-- ── CONVERSATIONS ────────────────────────────────────────────────
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_conversations" ON conversations;
DROP POLICY IF EXISTS "anon_insert_conversations" ON conversations;
DROP POLICY IF EXISTS "anon_update_conversations" ON conversations;
DROP POLICY IF EXISTS "conversations_select_auth" ON conversations;
DROP POLICY IF EXISTS "conversations_insert_auth" ON conversations;
DROP POLICY IF EXISTS "conversations_update_auth" ON conversations;

CREATE POLICY "conversations_select_auth" ON conversations
  FOR SELECT TO authenticated
  USING (
    public.is_qg_admin()
    OR poster_id = auth.uid()::text
    OR worker_id = auth.uid()::text
  );

CREATE POLICY "conversations_insert_auth" ON conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_qg_admin()
    OR poster_id = auth.uid()::text
    OR worker_id = auth.uid()::text
  );

CREATE POLICY "conversations_update_auth" ON conversations
  FOR UPDATE TO authenticated
  USING (
    public.is_qg_admin()
    OR poster_id = auth.uid()::text
    OR worker_id = auth.uid()::text
  )
  WITH CHECK (
    public.is_qg_admin()
    OR poster_id = auth.uid()::text
    OR worker_id = auth.uid()::text
  );

-- ── MESSAGES ─────────────────────────────────────────────────────
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_messages" ON messages;
DROP POLICY IF EXISTS "anon_insert_messages" ON messages;
DROP POLICY IF EXISTS "messages_select_auth" ON messages;
DROP POLICY IF EXISTS "messages_insert_auth" ON messages;

CREATE POLICY "messages_select_auth" ON messages
  FOR SELECT TO authenticated
  USING (
    public.is_qg_admin()
    OR EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.conv_id = messages.conv_id
        AND (c.poster_id = auth.uid()::text OR c.worker_id = auth.uid()::text)
    )
  );

CREATE POLICY "messages_insert_auth" ON messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.conv_id = messages.conv_id
        AND (c.poster_id = auth.uid()::text OR c.worker_id = auth.uid()::text)
    )
  );

-- ── REVIEWS ──────────────────────────────────────────────────────
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_reviews" ON reviews;
DROP POLICY IF EXISTS "anon_insert_reviews" ON reviews;
DROP POLICY IF EXISTS "reviews_select_auth" ON reviews;
DROP POLICY IF EXISTS "reviews_insert_auth" ON reviews;

CREATE POLICY "reviews_select_auth" ON reviews
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "reviews_insert_auth" ON reviews
  FOR INSERT TO authenticated
  WITH CHECK (reviewer_id = auth.uid()::text OR public.is_qg_admin());

-- ── STORAGE (photos) ─────────────────────────────────────────────
DROP POLICY IF EXISTS "anon_upload_task_photos" ON storage.objects;
DROP POLICY IF EXISTS "anon_read_task_photos" ON storage.objects;
DROP POLICY IF EXISTS "anon_upload_chat_photos" ON storage.objects;
DROP POLICY IF EXISTS "anon_read_chat_photos" ON storage.objects;
DROP POLICY IF EXISTS "task_photos_read" ON storage.objects;
DROP POLICY IF EXISTS "task_photos_upload" ON storage.objects;
DROP POLICY IF EXISTS "chat_photos_read" ON storage.objects;
DROP POLICY IF EXISTS "chat_photos_upload" ON storage.objects;

CREATE POLICY "task_photos_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'task-photos');

CREATE POLICY "task_photos_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'task-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "chat_photos_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-photos'
    AND (
      public.is_qg_admin()
      OR EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.conv_id::text = (storage.foldername(name))[1]
          AND (c.poster_id = auth.uid()::text OR c.worker_id = auth.uid()::text)
      )
    )
  );

CREATE POLICY "chat_photos_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-photos'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.conv_id::text = (storage.foldername(name))[1]
        AND c.poster_id = auth.uid()::text
    )
  );
