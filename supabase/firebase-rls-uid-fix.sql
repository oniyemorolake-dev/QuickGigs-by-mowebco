-- ================================================================
-- QuickGigs — Firebase RLS fix (run NOW in SQL Editor)
-- ================================================================
-- WHY THE SESSION MODAL APPEARS
-- 1) Firebase UIDs are NOT UUIDs → auth.uid() breaks / returns null
-- 2) Firebase JWTs lack role:"authenticated" by default → PostgREST
--    runs you as Postgres role "anon", so TO authenticated policies
--    never match → 401/403 → "Your session needs a refresh"
--
-- FIX
-- • public.qg_uid()  = auth.jwt()->>'sub'  (Firebase UID as text)
-- • public.qg_is_signed_in() = Firebase issuer present
-- • Recreate policies for TO anon, authenticated with qg_uid()
--   (safe: pure anon key has no Firebase iss/sub, so private rows stay closed)
-- ================================================================

CREATE OR REPLACE FUNCTION public.qg_uid()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(TRIM(COALESCE(auth.jwt() ->> 'sub', '')), '');
$$;

CREATE OR REPLACE FUNCTION public.qg_is_signed_in()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (auth.jwt() ->> 'iss') LIKE 'https://securetoken.google.com/%'
    AND NULLIF(TRIM(COALESCE(auth.jwt() ->> 'sub', '')), '') IS NOT NULL,
    false
  );
$$;

REVOKE ALL ON FUNCTION public.qg_uid() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qg_is_signed_in() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qg_uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.qg_is_signed_in() TO anon, authenticated, service_role;

-- Admin check must use Firebase sub, not auth.uid()
CREATE OR REPLACE FUNCTION public.is_qg_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admins a
    WHERE a.user_id = public.qg_uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_qg_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_qg_admin() TO authenticated, anon, service_role;

-- Accept-application trigger
CREATE OR REPLACE FUNCTION public.protect_application_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  request_role TEXT := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::JSONB ->> 'role',
    ''
  );
  poster_uid TEXT;
BEGIN
  IF LOWER(COALESCE(NEW.status, '')) = 'accepted'
     AND LOWER(COALESCE(OLD.status, '')) IS DISTINCT FROM 'accepted' THEN

    IF request_role = 'service_role'
       OR CURRENT_USER IN ('service_role', 'postgres', 'supabase_admin') THEN
      RETURN NEW;
    END IF;

    SELECT t.posted_by INTO poster_uid
    FROM public.tasks t
    WHERE t.task_id::text = NEW.task_id::text
    LIMIT 1;

    IF poster_uid IS NOT NULL AND poster_uid = public.qg_uid() THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'application_accept_forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- ── PAYMENTS ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "payments_select_auth" ON public.payments;
CREATE POLICY "payments_select_auth" ON public.payments
  FOR SELECT TO anon, authenticated
  USING (
    public.qg_is_signed_in()
    AND (
      public.is_qg_admin()
      OR poster_id = public.qg_uid()
      OR worker_id = public.qg_uid()
    )
  );

-- ── TASKS ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tasks_select_auth" ON public.tasks;
DROP POLICY IF EXISTS "tasks_insert_auth" ON public.tasks;
DROP POLICY IF EXISTS "tasks_update_auth" ON public.tasks;

CREATE POLICY "tasks_select_auth" ON public.tasks
  FOR SELECT TO anon, authenticated
  USING (
    status = 'open'
    OR (
      public.qg_is_signed_in()
      AND (
        public.is_qg_admin()
        OR posted_by = public.qg_uid()
        OR EXISTS (
          SELECT 1 FROM public.applications a
          WHERE a.task_id::text = tasks.task_id::text
            AND a.worker_id = public.qg_uid()
        )
      )
    )
  );

CREATE POLICY "tasks_insert_auth" ON public.tasks
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    public.qg_is_signed_in()
    AND (posted_by = public.qg_uid() OR public.is_qg_admin())
  );

CREATE POLICY "tasks_update_auth" ON public.tasks
  FOR UPDATE TO anon, authenticated
  USING (
    public.qg_is_signed_in()
    AND (posted_by = public.qg_uid() OR public.is_qg_admin())
  )
  WITH CHECK (
    public.qg_is_signed_in()
    AND (posted_by = public.qg_uid() OR public.is_qg_admin())
  );

-- ── APPLICATIONS ────────────────────────────────────────────────
DROP POLICY IF EXISTS "applications_select_auth" ON public.applications;
DROP POLICY IF EXISTS "applications_insert_auth" ON public.applications;
DROP POLICY IF EXISTS "applications_update_auth" ON public.applications;

CREATE POLICY "applications_select_auth" ON public.applications
  FOR SELECT TO anon, authenticated
  USING (
    public.qg_is_signed_in()
    AND (
      public.is_qg_admin()
      OR worker_id = public.qg_uid()
      OR EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.task_id::text = applications.task_id::text
          AND t.posted_by = public.qg_uid()
      )
    )
  );

CREATE POLICY "applications_insert_auth" ON public.applications
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    public.qg_is_signed_in()
    AND (worker_id = public.qg_uid() OR public.is_qg_admin())
  );

CREATE POLICY "applications_update_auth" ON public.applications
  FOR UPDATE TO anon, authenticated
  USING (
    public.qg_is_signed_in()
    AND (
      public.is_qg_admin()
      OR EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.task_id::text = applications.task_id::text
          AND t.posted_by = public.qg_uid()
      )
    )
  )
  WITH CHECK (
    public.qg_is_signed_in()
    AND (
      public.is_qg_admin()
      OR EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.task_id::text = applications.task_id::text
          AND t.posted_by = public.qg_uid()
      )
    )
  );

-- ── USERS ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "users_select_auth" ON public.users;
DROP POLICY IF EXISTS "users_insert_auth" ON public.users;
DROP POLICY IF EXISTS "users_update_auth" ON public.users;

CREATE POLICY "users_select_auth" ON public.users
  FOR SELECT TO anon, authenticated
  USING (public.qg_is_signed_in());

CREATE POLICY "users_insert_auth" ON public.users
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    public.qg_is_signed_in()
    AND (firebase_uid = public.qg_uid() OR public.is_qg_admin())
  );

CREATE POLICY "users_update_auth" ON public.users
  FOR UPDATE TO anon, authenticated
  USING (
    public.qg_is_signed_in()
    AND (firebase_uid = public.qg_uid() OR public.is_qg_admin())
  )
  WITH CHECK (
    public.qg_is_signed_in()
    AND (firebase_uid = public.qg_uid() OR public.is_qg_admin())
  );

-- ── CONVERSATIONS ───────────────────────────────────────────────
DROP POLICY IF EXISTS "conversations_select_auth" ON public.conversations;
DROP POLICY IF EXISTS "conversations_insert_auth" ON public.conversations;
DROP POLICY IF EXISTS "conversations_update_auth" ON public.conversations;

CREATE POLICY "conversations_select_auth" ON public.conversations
  FOR SELECT TO anon, authenticated
  USING (
    public.qg_is_signed_in()
    AND (
      public.is_qg_admin()
      OR poster_id = public.qg_uid()
      OR worker_id = public.qg_uid()
    )
  );

CREATE POLICY "conversations_insert_auth" ON public.conversations
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    public.qg_is_signed_in()
    AND (
      public.is_qg_admin()
      OR poster_id = public.qg_uid()
      OR worker_id = public.qg_uid()
    )
  );

CREATE POLICY "conversations_update_auth" ON public.conversations
  FOR UPDATE TO anon, authenticated
  USING (
    public.qg_is_signed_in()
    AND (
      public.is_qg_admin()
      OR poster_id = public.qg_uid()
      OR worker_id = public.qg_uid()
    )
  )
  WITH CHECK (
    public.qg_is_signed_in()
    AND (
      public.is_qg_admin()
      OR poster_id = public.qg_uid()
      OR worker_id = public.qg_uid()
    )
  );

-- ── MESSAGES ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "messages_select_auth" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_auth" ON public.messages;

CREATE POLICY "messages_select_auth" ON public.messages
  FOR SELECT TO anon, authenticated
  USING (
    public.qg_is_signed_in()
    AND (
      public.is_qg_admin()
      OR EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.conv_id = messages.conv_id
          AND (c.poster_id = public.qg_uid() OR c.worker_id = public.qg_uid())
      )
    )
  );

CREATE POLICY "messages_insert_auth" ON public.messages
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    public.qg_is_signed_in()
    AND sender_id = public.qg_uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.conv_id = messages.conv_id
        AND (c.poster_id = public.qg_uid() OR c.worker_id = public.qg_uid())
        AND c.is_unlocked IS TRUE
    )
  );

-- ── REVIEWS ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "reviews_select_auth" ON public.reviews;
DROP POLICY IF EXISTS "reviews_insert_auth" ON public.reviews;

CREATE POLICY "reviews_select_auth" ON public.reviews
  FOR SELECT TO anon, authenticated
  USING (public.qg_is_signed_in());

CREATE POLICY "reviews_insert_auth" ON public.reviews
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    public.qg_is_signed_in()
    AND reviewer_id = public.qg_uid()
  );

-- ── STORAGE ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "task_photos_read" ON storage.objects;
DROP POLICY IF EXISTS "task_photos_upload" ON storage.objects;
DROP POLICY IF EXISTS "chat_photos_read" ON storage.objects;
DROP POLICY IF EXISTS "chat_photos_upload" ON storage.objects;

CREATE POLICY "task_photos_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (
    bucket_id = 'task-photos'
    AND public.qg_is_signed_in()
  );

CREATE POLICY "task_photos_upload" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'task-photos'
    AND public.qg_is_signed_in()
    AND (storage.foldername(name))[1] = public.qg_uid()
  );

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
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.conv_id::text = (storage.foldername(name))[1]
        AND c.poster_id = public.qg_uid()
    )
  );

-- Sanity check (optional): should return your functions
-- SELECT public.qg_uid(), public.qg_is_signed_in();  -- null/false in SQL editor (no JWT)
