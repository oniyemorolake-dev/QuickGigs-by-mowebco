-- SwiftGigs — keep precise task addresses out of the public tasks table.
--
-- Problem: tasks_select_auth lets anon read every column of any open task, and
-- RLS is row-level, so tasks.precise_address (a poster's full street address)
-- was readable by anyone with the public anon key. The code already carried
-- "SERVER-TODO: restrict SELECT of precise_address" notes for this.
--
-- Fix: a trigger moves precise_address into public.task_private (RLS on, no
-- policies → service-role only) and blanks the column on tasks. The column
-- itself stays, so existing SELECT lists keep working and simply return NULL.
-- Poster and accepted tasker read the address through the
-- qg_task_precise_address() RPC; everyone else gets NULL.
--
-- task_id is stored as text and compared as text so this works whether
-- tasks.task_id is TEXT or UUID. Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.task_private (
  task_id         text PRIMARY KEY,
  precise_address text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.task_private ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_private FROM anon, authenticated;

-- BEFORE trigger: column defaults (task_id) are already filled in at this
-- point, so the address can be copied out and the public column blanked in the
-- same statement, with no second UPDATE on tasks.
CREATE OR REPLACE FUNCTION public.qg_move_precise_address()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.precise_address IS NOT NULL AND btrim(NEW.precise_address) <> '' THEN
    INSERT INTO public.task_private (task_id, precise_address, updated_at)
    VALUES (NEW.task_id::text, left(btrim(NEW.precise_address), 200), now())
    ON CONFLICT (task_id) DO UPDATE
      SET precise_address = EXCLUDED.precise_address, updated_at = now();
  END IF;
  NEW.precise_address := NULL;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.qg_move_precise_address() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tasks_move_precise_address ON public.tasks;
CREATE TRIGGER tasks_move_precise_address
  BEFORE INSERT OR UPDATE OF precise_address ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.qg_move_precise_address();

-- Backfill: move anything already stored, then blank it.
INSERT INTO public.task_private (task_id, precise_address)
SELECT task_id::text, left(btrim(precise_address), 200)
  FROM public.tasks
 WHERE precise_address IS NOT NULL AND btrim(precise_address) <> ''
ON CONFLICT (task_id) DO NOTHING;

UPDATE public.tasks SET precise_address = NULL WHERE precise_address IS NOT NULL;

-- Read path: poster, or the tasker whose application was accepted. Admins too.
CREATE OR REPLACE FUNCTION public.qg_task_precise_address(p_task_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tp.precise_address
    FROM public.task_private tp
    JOIN public.tasks t ON t.task_id::text = tp.task_id
   WHERE tp.task_id = p_task_id
     AND public.qg_is_signed_in()
     AND (
          t.posted_by = public.qg_uid()
       OR public.is_qg_admin()
       OR EXISTS (
            SELECT 1 FROM public.applications a
             WHERE a.task_id::text = tp.task_id
               AND a.worker_id = public.qg_uid()
               AND lower(coalesce(a.status, '')) = 'accepted'
          )
     );
$$;
REVOKE ALL ON FUNCTION public.qg_task_precise_address(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qg_task_precise_address(text) TO authenticated, service_role;

COMMIT;

-- Verify (should return 0):
--   SELECT count(*) FROM public.tasks WHERE precise_address IS NOT NULL;
