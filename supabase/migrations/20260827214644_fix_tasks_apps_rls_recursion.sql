-- QuickGigs — break tasks ↔ applications RLS recursion (42P17).
-- Cause: tasks_select_auth EXISTS applications, applications_* EXISTS tasks.
-- Fix: SECURITY DEFINER helpers that read the other table without re-entering RLS.
-- Apply in Supabase SQL Editor, then re-test:
--   select task_id, title from tasks limit 1;
--   select app_id from applications limit 1;

CREATE OR REPLACE FUNCTION public.qg_uid_is_applicant_on_task(p_task_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.applications a
    WHERE a.task_id::text = p_task_id
      AND a.worker_id = public.qg_uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.qg_uid_owns_task(p_task_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.task_id::text = p_task_id
      AND t.posted_by = public.qg_uid()
  );
$$;

REVOKE ALL ON FUNCTION public.qg_uid_is_applicant_on_task(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qg_uid_owns_task(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qg_uid_is_applicant_on_task(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.qg_uid_owns_task(text) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "tasks_select_auth" ON public.tasks;
CREATE POLICY "tasks_select_auth" ON public.tasks
  FOR SELECT TO anon, authenticated
  USING (
    status = 'open'
    OR (
      public.qg_is_signed_in()
      AND (
        public.is_qg_admin()
        OR posted_by = public.qg_uid()
        OR public.qg_uid_is_applicant_on_task(tasks.task_id::text)
      )
    )
  );

DROP POLICY IF EXISTS "applications_select_auth" ON public.applications;
CREATE POLICY "applications_select_auth" ON public.applications
  FOR SELECT TO anon, authenticated
  USING (
    public.qg_is_signed_in()
    AND (
      public.is_qg_admin()
      OR worker_id = public.qg_uid()
      OR public.qg_uid_owns_task(applications.task_id::text)
    )
  );

DROP POLICY IF EXISTS "applications_update_auth" ON public.applications;
CREATE POLICY "applications_update_auth" ON public.applications
  FOR UPDATE TO anon, authenticated
  USING (
    public.qg_is_signed_in()
    AND (
      public.is_qg_admin()
      OR public.qg_uid_owns_task(applications.task_id::text)
    )
  )
  WITH CHECK (
    public.qg_is_signed_in()
    AND (
      public.is_qg_admin()
      OR public.qg_uid_owns_task(applications.task_id::text)
    )
  );
