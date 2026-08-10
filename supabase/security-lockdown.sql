-- ================================================================
-- QuickGigs — Production security lockdown (idempotent; safe to re-run)
-- ================================================================
--
-- DEPLOY STEPS
-- 1. Enable Firebase third-party auth in Supabase
--    Project: quickgigs-7b12d
--    Dashboard → Authentication → Sign In / Providers → Third-party → Firebase
-- 2. Run this entire file in the SQL Editor
-- 3. Set qg-config supabaseFirebaseAuth: true
-- 4. Redeploy Edge Functions (service_role path for payments, accept, etc.)
--
-- Replaces email-based is_qg_admin() with public.admins allow-list.
-- Tightens RLS vs rls-secure.sql / beta-setup-all.sql open policies.
-- ================================================================

-- ── 1. Admins table + is_qg_admin() ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.admins (
  user_id    TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
-- No client policies: clients cannot read/write. Service-role bypasses RLS.
COMMENT ON TABLE public.admins IS 'Server-side admin allow-list. Never expose via anon key.';

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
    WHERE a.user_id = auth.uid()::text
  );
$$;

REVOKE ALL ON FUNCTION public.is_qg_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_qg_admin() TO authenticated, anon, service_role;

-- ── 2. Privileged user column protection ────────────────────────
-- Extends protect_qg_role_fields (dual-role-accounts.sql pattern):
-- blocks non-service clients from changing role / verification / Stripe /
-- dual-role fields, and account_status escalations.
CREATE OR REPLACE FUNCTION public.protect_qg_role_fields()
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
  new_j JSONB := to_jsonb(NEW);
  old_j JSONB := to_jsonb(OLD);
  old_status TEXT;
  new_status TEXT;
  old_rank INT;
  new_rank INT;
BEGIN
  IF request_role = 'service_role'
     OR CURRENT_USER IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- Dual-role workspace fields
  IF (new_j->>'is_tasker') IS DISTINCT FROM (old_j->>'is_tasker') OR
     (new_j->>'is_poster') IS DISTINCT FROM (old_j->>'is_poster') OR
     (new_j->>'last_active_mode') IS DISTINCT FROM (old_j->>'last_active_mode') OR
     (new_j->>'roles_updated_at') IS DISTINCT FROM (old_j->>'roles_updated_at') THEN
    RAISE EXCEPTION 'role_fields_are_server_managed' USING ERRCODE = '42501';
  END IF;

  -- Privileged columns (jsonb so optional/legacy cols do not break CREATE)
  IF (new_j->>'role') IS DISTINCT FROM (old_j->>'role')
     OR (new_j->>'email_verified') IS DISTINCT FROM (old_j->>'email_verified')
     OR (new_j->>'verified') IS DISTINCT FROM (old_j->>'verified')
     OR (new_j->>'is_verified') IS DISTINCT FROM (old_j->>'is_verified')
     OR (new_j->>'tasker_verified') IS DISTINCT FROM (old_j->>'tasker_verified')
     OR (new_j->>'poster_verified') IS DISTINCT FROM (old_j->>'poster_verified')
     OR (new_j->>'stripe_payouts_enabled') IS DISTINCT FROM (old_j->>'stripe_payouts_enabled')
     OR (new_j->>'stripe_connect_id') IS DISTINCT FROM (old_j->>'stripe_connect_id')
     OR (new_j->>'guardian_stripe_connect_id') IS DISTINCT FROM (old_j->>'guardian_stripe_connect_id')
     OR (new_j->>'guardian_stripe_payouts_enabled') IS DISTINCT FROM (old_j->>'guardian_stripe_payouts_enabled')
  THEN
    RAISE EXCEPTION 'privileged_fields_are_server_managed' USING ERRCODE = '42501';
  END IF;

  -- account_status: block client escalations only
  -- rank: blocked < pending_guardian < active
  old_status := LOWER(COALESCE(old_j->>'account_status', ''));
  new_status := LOWER(COALESCE(new_j->>'account_status', ''));
  IF new_status IS DISTINCT FROM old_status THEN
    old_rank := CASE old_status
      WHEN 'active' THEN 2
      WHEN 'pending_guardian' THEN 1
      WHEN 'blocked' THEN 0
      ELSE 0
    END;
    new_rank := CASE new_status
      WHEN 'active' THEN 2
      WHEN 'pending_guardian' THEN 1
      WHEN 'blocked' THEN 0
      ELSE 0
    END;
    IF new_rank > old_rank THEN
      RAISE EXCEPTION 'account_status_escalation_forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_protect_role_fields ON public.users;
DROP TRIGGER IF EXISTS users_protect_privileged_columns ON public.users;
CREATE TRIGGER users_protect_role_fields
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_qg_role_fields();

-- ── 3. Applications: block worker self-accept ───────────────────
CREATE OR REPLACE FUNCTION public.protect_application_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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

    IF poster_uid IS NOT NULL AND poster_uid = auth.uid()::text THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'application_accept_forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS applications_protect_status ON public.applications;
CREATE TRIGGER applications_protect_status
  BEFORE UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.protect_application_status();

-- ── 4. Payments RLS (party SELECT only; mutations via Edge Functions) ──
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_payments" ON public.payments;
DROP POLICY IF EXISTS "anon_insert_payments" ON public.payments;
DROP POLICY IF EXISTS "anon_update_payments" ON public.payments;
DROP POLICY IF EXISTS "anon_delete_payments" ON public.payments;
DROP POLICY IF EXISTS "payments_select_auth" ON public.payments;
DROP POLICY IF EXISTS "payments_insert_auth" ON public.payments;
DROP POLICY IF EXISTS "payments_update_auth" ON public.payments;
DROP POLICY IF EXISTS "payments_delete_auth" ON public.payments;

REVOKE ALL ON public.payments FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.payments FROM authenticated;
GRANT SELECT ON public.payments TO authenticated;

CREATE POLICY "payments_select_auth" ON public.payments
  FOR SELECT TO authenticated
  USING (
    public.is_qg_admin()
    OR poster_id = auth.uid()::text
    OR worker_id = auth.uid()::text
  );
-- No INSERT/UPDATE/DELETE policies for authenticated or anon (service_role only).

-- ── 5. Drop remaining anon USING(true) policies ─────────────────
-- tasks
DROP POLICY IF EXISTS "anon_select_tasks" ON public.tasks;
DROP POLICY IF EXISTS "anon_insert_tasks" ON public.tasks;
DROP POLICY IF EXISTS "anon_update_tasks" ON public.tasks;
DROP POLICY IF EXISTS "anon_delete_tasks" ON public.tasks;

-- applications
DROP POLICY IF EXISTS "anon_select_applications" ON public.applications;
DROP POLICY IF EXISTS "anon_insert_applications" ON public.applications;
DROP POLICY IF EXISTS "anon_update_applications" ON public.applications;
DROP POLICY IF EXISTS "anon_delete_applications" ON public.applications;

-- users
DROP POLICY IF EXISTS "anon_select_users" ON public.users;
DROP POLICY IF EXISTS "anon_insert_users" ON public.users;
DROP POLICY IF EXISTS "anon_update_users" ON public.users;
DROP POLICY IF EXISTS "anon_delete_users" ON public.users;

-- conversations / messages
DROP POLICY IF EXISTS "anon_select_conversations" ON public.conversations;
DROP POLICY IF EXISTS "anon_insert_conversations" ON public.conversations;
DROP POLICY IF EXISTS "anon_update_conversations" ON public.conversations;
DROP POLICY IF EXISTS "anon_delete_conversations" ON public.conversations;
DROP POLICY IF EXISTS "anon_select_messages" ON public.messages;
DROP POLICY IF EXISTS "anon_insert_messages" ON public.messages;
DROP POLICY IF EXISTS "anon_update_messages" ON public.messages;
DROP POLICY IF EXISTS "anon_delete_messages" ON public.messages;

-- reviews
DROP POLICY IF EXISTS "anon_select_reviews" ON public.reviews;
DROP POLICY IF EXISTS "anon_insert_reviews" ON public.reviews;
DROP POLICY IF EXISTS "anon_update_reviews" ON public.reviews;
DROP POLICY IF EXISTS "anon_delete_reviews" ON public.reviews;

-- reports / disputes
DROP POLICY IF EXISTS "anon_select_reports" ON public.reports;
DROP POLICY IF EXISTS "anon_insert_reports" ON public.reports;
DROP POLICY IF EXISTS "anon_update_reports" ON public.reports;
DROP POLICY IF EXISTS "anon_delete_reports" ON public.reports;
DROP POLICY IF EXISTS "anon_select_disputes" ON public.disputes;
DROP POLICY IF EXISTS "anon_insert_disputes" ON public.disputes;
DROP POLICY IF EXISTS "anon_update_disputes" ON public.disputes;
DROP POLICY IF EXISTS "anon_delete_disputes" ON public.disputes;

-- notification_queue
DROP POLICY IF EXISTS "anon_select_notifications" ON public.notification_queue;
DROP POLICY IF EXISTS "anon_insert_notifications" ON public.notification_queue;
DROP POLICY IF EXISTS "anon_update_notifications" ON public.notification_queue;
DROP POLICY IF EXISTS "anon_delete_notifications" ON public.notification_queue;

-- admin tables
DROP POLICY IF EXISTS "anon_select_admin_notes" ON public.admin_notes;
DROP POLICY IF EXISTS "anon_insert_admin_notes" ON public.admin_notes;
DROP POLICY IF EXISTS "anon_update_admin_notes" ON public.admin_notes;
DROP POLICY IF EXISTS "anon_select_admin_actions" ON public.admin_actions;
DROP POLICY IF EXISTS "anon_insert_admin_actions" ON public.admin_actions;

-- waitlist / platform_banner
DROP POLICY IF EXISTS "anon_select_waitlist" ON public.waitlist;
DROP POLICY IF EXISTS "anon_insert_waitlist" ON public.waitlist;
DROP POLICY IF EXISTS "anon_update_waitlist" ON public.waitlist;
DROP POLICY IF EXISTS "anon_delete_waitlist" ON public.waitlist;
DROP POLICY IF EXISTS "anon_select_platform_banner" ON public.platform_banner;
DROP POLICY IF EXISTS "anon_insert_platform_banner" ON public.platform_banner;
DROP POLICY IF EXISTS "anon_update_platform_banner" ON public.platform_banner;
DROP POLICY IF EXISTS "anon_delete_platform_banner" ON public.platform_banner;

-- ── 6. Core authenticated policies (tightened from rls-secure.sql) ──

-- TASKS
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tasks_public_browse" ON public.tasks;
DROP POLICY IF EXISTS "tasks_select_auth" ON public.tasks;
DROP POLICY IF EXISTS "tasks_insert_auth" ON public.tasks;
DROP POLICY IF EXISTS "tasks_update_auth" ON public.tasks;
DROP POLICY IF EXISTS "tasks_admin" ON public.tasks;

-- Anon: open tasks browse only (marketplace landing). No write.
CREATE POLICY "tasks_public_browse" ON public.tasks
  FOR SELECT TO anon
  USING (status = 'open');

CREATE POLICY "tasks_select_auth" ON public.tasks
  FOR SELECT TO authenticated
  USING (
    public.is_qg_admin()
    OR status = 'open'
    OR posted_by = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.task_id::text = tasks.task_id::text
        AND a.worker_id = auth.uid()::text
    )
  );

CREATE POLICY "tasks_insert_auth" ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (posted_by = auth.uid()::text OR public.is_qg_admin());

CREATE POLICY "tasks_update_auth" ON public.tasks
  FOR UPDATE TO authenticated
  USING (posted_by = auth.uid()::text OR public.is_qg_admin())
  WITH CHECK (posted_by = auth.uid()::text OR public.is_qg_admin());

-- APPLICATIONS
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "applications_select_auth" ON public.applications;
DROP POLICY IF EXISTS "applications_insert_auth" ON public.applications;
DROP POLICY IF EXISTS "applications_update_auth" ON public.applications;

CREATE POLICY "applications_select_auth" ON public.applications
  FOR SELECT TO authenticated
  USING (
    public.is_qg_admin()
    OR worker_id = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.task_id::text = applications.task_id::text
        AND t.posted_by = auth.uid()::text
    )
  );

CREATE POLICY "applications_insert_auth" ON public.applications
  FOR INSERT TO authenticated
  WITH CHECK (worker_id = auth.uid()::text OR public.is_qg_admin());

-- UPDATE: poster of task or admin ONLY (workers cannot accept themselves via RLS)
CREATE POLICY "applications_update_auth" ON public.applications
  FOR UPDATE TO authenticated
  USING (
    public.is_qg_admin()
    OR EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.task_id::text = applications.task_id::text
        AND t.posted_by = auth.uid()::text
    )
  )
  WITH CHECK (
    public.is_qg_admin()
    OR EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.task_id::text = applications.task_id::text
        AND t.posted_by = auth.uid()::text
    )
  );

-- USERS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select_auth" ON public.users;
DROP POLICY IF EXISTS "users_insert_auth" ON public.users;
DROP POLICY IF EXISTS "users_update_auth" ON public.users;

-- Marketplace browse: authenticated may SELECT all rows.
-- NOTE: clients must project carefully — do not select stripe_connect_id,
-- guardian_*, email, phone, or other sensitive columns in public card queries.
-- Anon has NO user select policy.
CREATE POLICY "users_select_auth" ON public.users
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "users_insert_auth" ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (firebase_uid = auth.uid()::text OR public.is_qg_admin());

CREATE POLICY "users_update_auth" ON public.users
  FOR UPDATE TO authenticated
  USING (firebase_uid = auth.uid()::text OR public.is_qg_admin())
  WITH CHECK (firebase_uid = auth.uid()::text OR public.is_qg_admin());

-- CONVERSATIONS (parties only; no anon)
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversations_select_auth" ON public.conversations;
DROP POLICY IF EXISTS "conversations_insert_auth" ON public.conversations;
DROP POLICY IF EXISTS "conversations_update_auth" ON public.conversations;
DROP POLICY IF EXISTS "conversations_participant_select" ON public.conversations;

CREATE POLICY "conversations_select_auth" ON public.conversations
  FOR SELECT TO authenticated
  USING (
    public.is_qg_admin()
    OR poster_id = auth.uid()::text
    OR worker_id = auth.uid()::text
  );

CREATE POLICY "conversations_insert_auth" ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_qg_admin()
    OR poster_id = auth.uid()::text
    OR worker_id = auth.uid()::text
  );

CREATE POLICY "conversations_update_auth" ON public.conversations
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

-- MESSAGES (conversation parties; no anon)
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_select_auth" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_auth" ON public.messages;
DROP POLICY IF EXISTS "messages_participant_select" ON public.messages;

CREATE POLICY "messages_select_auth" ON public.messages
  FOR SELECT TO authenticated
  USING (
    public.is_qg_admin()
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.conv_id = messages.conv_id
        AND (c.poster_id = auth.uid()::text OR c.worker_id = auth.uid()::text)
    )
  );

CREATE POLICY "messages_insert_auth" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.conv_id = messages.conv_id
        AND (c.poster_id = auth.uid()::text OR c.worker_id = auth.uid()::text)
    )
  );

-- REVIEWS
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reviews_select_auth" ON public.reviews;
DROP POLICY IF EXISTS "reviews_insert_auth" ON public.reviews;
DROP POLICY IF EXISTS "reviews_select_public" ON public.reviews;
DROP POLICY IF EXISTS "reviews_insert_public" ON public.reviews;

CREATE POLICY "reviews_select_auth" ON public.reviews
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "reviews_insert_auth" ON public.reviews
  FOR INSERT TO authenticated
  WITH CHECK (reviewer_id = auth.uid()::text);

-- STORAGE (from rls-secure.sql; authenticated only)
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
        SELECT 1 FROM public.conversations c
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
      SELECT 1 FROM public.conversations c
      WHERE c.conv_id::text = (storage.foldername(name))[1]
        AND c.poster_id = auth.uid()::text
    )
  );

-- ── Messaging unlock: clients cannot set is_unlocked = true ─────
-- Unlock only via service_role (webhook / confirm-checkout / sync-payment).
CREATE OR REPLACE FUNCTION public.protect_conversation_unlock()
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
BEGIN
  IF request_role = 'service_role'
     OR CURRENT_USER IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.is_unlocked := FALSE;
    RETURN NEW;
  END IF;

  -- UPDATE: never allow client escalate locked → unlocked
  IF COALESCE(NEW.is_unlocked, FALSE) IS TRUE
     AND COALESCE(OLD.is_unlocked, FALSE) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'conversation_unlock_is_server_managed' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_conversation_unlock ON public.conversations;
CREATE TRIGGER trg_protect_conversation_unlock
  BEFORE INSERT OR UPDATE ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_conversation_unlock();

-- Messages require unlocked conversation (server-enforced contact gate)
DROP POLICY IF EXISTS "messages_insert_auth" ON public.messages;
CREATE POLICY "messages_insert_auth" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.conv_id = messages.conv_id
        AND (c.poster_id = auth.uid()::text OR c.worker_id = auth.uid()::text)
        AND c.is_unlocked IS TRUE
    )
  );
