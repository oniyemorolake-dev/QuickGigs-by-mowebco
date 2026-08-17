-- ================================================================
-- QuickGigs — RLS lockdown: drop open/legacy permissive policies
-- ================================================================
-- REVIEW BEFORE APPLY. Does NOT create teen_job_sessions policies
-- (deploy that table separately).
--
-- Prerequisites (already on live):
--   • public.qg_uid() / qg_is_signed_in() / is_qg_admin()
--   • firebase-rls-uid-fix.sql party policies
--
-- Effect: remove USING (true) / WITH CHECK (true) policies that OR
-- with restrictive ones and defeat them. Tighten users SELECT to
-- owner/admin. Expose non-sensitive profile fields via a view.
--
-- Apply (after review):
--   supabase db query --linked -f supabase/rls-drop-open-policies.sql
--   OR paste into Supabase SQL Editor
-- ================================================================

BEGIN;

-- ── Helpers must exist (no-op if already present) ───────────────
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

GRANT EXECUTE ON FUNCTION public.qg_uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.qg_is_signed_in() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_qg_admin() TO anon, authenticated, service_role;

-- ================================================================
-- 1) USERS — drop open policies; owner-only full-row SELECT;
--    safe public view for cards / discovery
-- ================================================================

DROP POLICY IF EXISTS "Anyone can read users" ON public.users;
DROP POLICY IF EXISTS "Anyone can insert users" ON public.users;

-- Current users_select_auth is qg_is_signed_in() (any signed-in can
-- read ALL rows including DOB/guardian/tokens/Stripe). Replace with
-- owner/admin only. Public cards must use public_user_profiles.
DROP POLICY IF EXISTS "users_select_auth" ON public.users;
CREATE POLICY "users_select_auth" ON public.users
  FOR SELECT TO anon, authenticated
  USING (
    public.qg_is_signed_in()
    AND (firebase_uid = public.qg_uid() OR public.is_qg_admin())
  );

-- Keep insert/update as-is (recreate only if missing after drop above)
DROP POLICY IF EXISTS "users_insert_auth" ON public.users;
CREATE POLICY "users_insert_auth" ON public.users
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    public.qg_is_signed_in()
    AND (firebase_uid = public.qg_uid() OR public.is_qg_admin())
  );

DROP POLICY IF EXISTS "users_update_auth" ON public.users;
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

-- Safe public profile view (owner = table owner → bypasses RLS on
-- underlying users; only non-sensitive columns are exposed).
-- NEVER add: email, phone, date_of_birth, guardian_*, consent_*,
-- stripe_* ids, payment method ids, alert lat/lng, identity sessions.
CREATE OR REPLACE VIEW public.public_user_profiles AS
SELECT
  user_id,
  firebase_uid,
  name,
  avatar_url,
  bio,
  skills,
  availability,
  service_area,
  languages,
  pronouns,
  role,
  status,
  account_status,
  is_tasker,
  is_poster,
  tasker_verified,
  poster_verified,
  rating,
  verified,
  created_at,
  -- Marketplace gates (booleans / enum only — NOT Stripe account IDs)
  stripe_payouts_enabled,
  guardian_stripe_payouts_enabled,
  payout_owner
FROM public.users;

-- security_invoker=false: view uses owner rights so RLS on users does
-- not hide other profiles from this intentional public projection.
ALTER VIEW public.public_user_profiles SET (security_invoker = false);

COMMENT ON VIEW public.public_user_profiles IS
  'Non-sensitive user fields for marketplace cards. Full row access remains on public.users (owner/admin only).';

GRANT SELECT ON public.public_user_profiles TO anon, authenticated, service_role;

-- ================================================================
-- 2) PAYMENTS — drop open read/insert; keep party SELECT only
--    (writes via Edge Functions + service role)
-- ================================================================

DROP POLICY IF EXISTS "Anyone can read payments" ON public.payments;
DROP POLICY IF EXISTS "Anyone can insert payments" ON public.payments;
-- No client INSERT policy on purpose.

-- ================================================================
-- 3) APPLICATIONS — drop open + guardian_approved leak
-- ================================================================

DROP POLICY IF EXISTS "Anyone can read applications" ON public.applications;
DROP POLICY IF EXISTS "Anyone can insert applications" ON public.applications;
DROP POLICY IF EXISTS "applications_select_guardian_approved" ON public.applications;

-- ================================================================
-- 4) TASKS — drop open read/insert; keep browse + party policies
-- ================================================================

DROP POLICY IF EXISTS "Anyone can read tasks" ON public.tasks;
DROP POLICY IF EXISTS "Anyone can insert tasks" ON public.tasks;

-- Ensure browse policy exists (open tasks only; no write)
DROP POLICY IF EXISTS "tasks_public_browse" ON public.tasks;
CREATE POLICY "tasks_public_browse" ON public.tasks
  FOR SELECT TO anon, authenticated
  USING (status = 'open');

-- ================================================================
-- 5) REVIEWS — drop open INSERT; keep public SELECT + reviewer insert
-- ================================================================

DROP POLICY IF EXISTS "Anyone can insert reviews" ON public.reviews;

-- Public marketplace reviews (intentional)
DROP POLICY IF EXISTS "Anyone can read reviews" ON public.reviews;
CREATE POLICY "Anyone can read reviews" ON public.reviews
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "reviews_select_auth" ON public.reviews;
CREATE POLICY "reviews_select_auth" ON public.reviews
  FOR SELECT TO anon, authenticated
  USING (true);

-- Reviewer only; must be party on a completed application for that task
DROP POLICY IF EXISTS "reviews_insert_auth" ON public.reviews;
CREATE POLICY "reviews_insert_auth" ON public.reviews
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    public.qg_is_signed_in()
    AND reviewer_id = public.qg_uid()
    AND EXISTS (
      SELECT 1
      FROM public.applications a
      WHERE a.task_id::text = reviews.task_id::text
        AND lower(COALESCE(a.status, '')) = 'completed'
        AND (
          a.worker_id = public.qg_uid()
          OR EXISTS (
            SELECT 1 FROM public.tasks t
            WHERE t.task_id::text = reviews.task_id::text
              AND t.posted_by = public.qg_uid()
          )
        )
    )
  );

-- ================================================================
-- 6) saved_tasks / user_notifications / user_warnings — owner only
-- ================================================================

-- saved_tasks
DROP POLICY IF EXISTS "anon_select_saved_tasks" ON public.saved_tasks;
DROP POLICY IF EXISTS "anon_insert_saved_tasks" ON public.saved_tasks;
DROP POLICY IF EXISTS "anon_delete_saved_tasks" ON public.saved_tasks;
DROP POLICY IF EXISTS "anon_update_saved_tasks" ON public.saved_tasks;

DROP POLICY IF EXISTS "saved_tasks_select_own" ON public.saved_tasks;
DROP POLICY IF EXISTS "saved_tasks_insert_own" ON public.saved_tasks;
DROP POLICY IF EXISTS "saved_tasks_delete_own" ON public.saved_tasks;

CREATE POLICY "saved_tasks_select_own" ON public.saved_tasks
  FOR SELECT TO anon, authenticated
  USING (public.qg_is_signed_in() AND user_id = public.qg_uid());

CREATE POLICY "saved_tasks_insert_own" ON public.saved_tasks
  FOR INSERT TO anon, authenticated
  WITH CHECK (public.qg_is_signed_in() AND user_id = public.qg_uid());

CREATE POLICY "saved_tasks_delete_own" ON public.saved_tasks
  FOR DELETE TO anon, authenticated
  USING (public.qg_is_signed_in() AND user_id = public.qg_uid());

-- user_notifications
DROP POLICY IF EXISTS "anon_select_user_notifications" ON public.user_notifications;
DROP POLICY IF EXISTS "anon_insert_user_notifications" ON public.user_notifications;
DROP POLICY IF EXISTS "anon_update_user_notifications" ON public.user_notifications;
DROP POLICY IF EXISTS "anon_delete_user_notifications" ON public.user_notifications;

DROP POLICY IF EXISTS "user_notifications_select_own" ON public.user_notifications;
DROP POLICY IF EXISTS "user_notifications_insert_own" ON public.user_notifications;
DROP POLICY IF EXISTS "user_notifications_update_own" ON public.user_notifications;

CREATE POLICY "user_notifications_select_own" ON public.user_notifications
  FOR SELECT TO anon, authenticated
  USING (public.qg_is_signed_in() AND user_id = public.qg_uid());

-- Client may insert own; Edge Functions use service role for system notices
CREATE POLICY "user_notifications_insert_own" ON public.user_notifications
  FOR INSERT TO anon, authenticated
  WITH CHECK (public.qg_is_signed_in() AND user_id = public.qg_uid());

CREATE POLICY "user_notifications_update_own" ON public.user_notifications
  FOR UPDATE TO anon, authenticated
  USING (public.qg_is_signed_in() AND user_id = public.qg_uid())
  WITH CHECK (public.qg_is_signed_in() AND user_id = public.qg_uid());

-- user_warnings: clients may SELECT own only; NO client INSERT
DROP POLICY IF EXISTS "anon_select_warnings" ON public.user_warnings;
DROP POLICY IF EXISTS "anon_insert_warnings" ON public.user_warnings;
DROP POLICY IF EXISTS "anon_update_warnings" ON public.user_warnings;
DROP POLICY IF EXISTS "anon_delete_warnings" ON public.user_warnings;

DROP POLICY IF EXISTS "user_warnings_select_own" ON public.user_warnings;
CREATE POLICY "user_warnings_select_own" ON public.user_warnings
  FOR SELECT TO anon, authenticated
  USING (
    public.qg_is_signed_in()
    AND (user_id = public.qg_uid() OR public.is_qg_admin())
  );
-- Inserts: service_role / SQL only (admin console must use Edge Function)

-- ================================================================
-- 7) STORAGE — drop open view + bucket-only INSERT; keep owner /
--    participant policies; re-add intentional public media reads
-- ================================================================

-- Open SELECT (drop)
DROP POLICY IF EXISTS "anyone can view chat photos" ON storage.objects;
DROP POLICY IF EXISTS "anyone can view profile photos" ON storage.objects;
DROP POLICY IF EXISTS "anyone can view task images" ON storage.objects;
DROP POLICY IF EXISTS "anyone can view task photos" ON storage.objects;
DROP POLICY IF EXISTS "chat_photos_select" ON storage.objects;
DROP POLICY IF EXISTS "profile_photos_select" ON storage.objects;
DROP POLICY IF EXISTS "task_photos_select" ON storage.objects;

-- Bucket-only INSERT (drop)
DROP POLICY IF EXISTS "chat_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "profile_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "task_photos_insert" ON storage.objects;

-- Recreate participant/owner policies (idempotent; qg_uid path)
DROP POLICY IF EXISTS "chat_photos_read" ON storage.objects;
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

-- Match existing firebase-rls chat upload: poster uploads into own folder
DROP POLICY IF EXISTS "chat_photos_upload" ON storage.objects;
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

-- Marketplace task photos: signed-in read; own-folder upload
DROP POLICY IF EXISTS "task_photos_read" ON storage.objects;
CREATE POLICY "task_photos_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'task-photos');

DROP POLICY IF EXISTS "task_photos_upload" ON storage.objects;
CREATE POLICY "task_photos_upload" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'task-photos'
    AND public.qg_is_signed_in()
    AND (storage.foldername(name))[1] = public.qg_uid()
  );

-- Intentional public avatar / task-image reads (browse UI). Not chat.
DROP POLICY IF EXISTS "profile_photos_public_read" ON storage.objects;
CREATE POLICY "profile_photos_public_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'profile-photos');

DROP POLICY IF EXISTS "task_images_public_read" ON storage.objects;
CREATE POLICY "task_images_public_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'task-images');

-- Owner-folder uploads (authenticated role; Firebase may also use
-- task_photos_upload / chat_photos_upload via anon + JWT)
-- Keep existing "users upload …" policies if present.

-- ================================================================
-- 8) platform_banner / task_categories / waitlist
-- ================================================================

DROP POLICY IF EXISTS "platform_banner_public_select" ON public.platform_banner;
CREATE POLICY "platform_banner_public_select" ON public.platform_banner
  FOR SELECT TO anon, authenticated
  USING (COALESCE(active, true) = true);

DROP POLICY IF EXISTS "task_categories_public_select" ON public.task_categories;
CREATE POLICY "task_categories_public_select" ON public.task_categories
  FOR SELECT TO anon, authenticated
  USING (COALESCE(active, true) = true);

DROP POLICY IF EXISTS "waitlist_public_insert" ON public.waitlist;
CREATE POLICY "waitlist_public_insert" ON public.waitlist
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    email IS NOT NULL
    AND length(trim(email)) > 3
  );
-- No SELECT policy on waitlist → clients cannot list emails

COMMIT;

-- ================================================================
-- Post-apply sanity (run separately with a Firebase JWT session):
--   SELECT public.qg_uid(), public.qg_is_signed_in();  -- should be uid / true
--   SELECT count(*) FROM public.users;                 -- 0 or 1 (own / admin)
--   SELECT count(*) FROM public.public_user_profiles;  -- all public cards
--   SELECT count(*) FROM public.payments;              -- only own party rows
--   SELECT count(*) FROM public.tasks WHERE status='open'; -- browse OK
-- ================================================================
-- NOT IN THIS FILE: teen_job_sessions — apply with teen-job-safety.sql
-- ================================================================
