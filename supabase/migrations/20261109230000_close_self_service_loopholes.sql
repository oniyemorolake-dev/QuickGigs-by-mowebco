-- SwiftGigs — close loopholes found in the 9 Nov launch audit.
--
-- Tested against the live database as a signed-in, non-admin user. Before this
-- migration that user could:
--   1. set their own users.rating to any value
--   2. give themselves is_subscriber = true
--   3. set their own phone_verified / poster payment-method fields
--   4. as a poster, lower the price on an application AFTER accepting it, then
--      pay the lower amount into escrow
-- and one flow bug:
--   5. "Mark complete" writes status = 'completed' straight to tasks. That path
--      never set poster_confirmed_at, so release-payout answered
--      poster_confirmation_required and the tasker was never paid (one payment
--      sat in 'held' for four weeks on a completed task).
--
-- Service-role callers (edge functions) and admins are unaffected: the guards
-- only apply to a signed-in Firebase user who is not an admin.
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

-- 1–3. Server-managed columns on users ---------------------------------------
CREATE OR REPLACE FUNCTION public.qg_protect_user_server_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  new_j jsonb := to_jsonb(NEW);
  old_j jsonb := to_jsonb(OLD);
  col   text;
BEGIN
  IF NOT public.qg_is_signed_in() OR public.is_qg_admin() THEN
    RETURN NEW;
  END IF;
  -- jsonb lookup so a column that does not exist on this database is skipped.
  FOREACH col IN ARRAY ARRAY[
    'rating', 'is_subscriber',
    'phone_verified', 'phone_verified_at',
    'poster_payment_method_id', 'poster_stripe_customer_id'
  ] LOOP
    IF (new_j -> col) IS DISTINCT FROM (old_j -> col) THEN
      RAISE EXCEPTION 'privileged_fields_are_server_managed'
        USING ERRCODE = '42501', DETAIL = col;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.qg_protect_user_server_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS users_protect_server_fields ON public.users;
CREATE TRIGGER users_protect_server_fields
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.qg_protect_user_server_fields();

-- 4. Agreed price is fixed once an application is accepted ---------------------
CREATE OR REPLACE FUNCTION public.qg_lock_accepted_price()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT public.qg_is_signed_in() OR public.is_qg_admin() THEN
    RETURN NEW;
  END IF;
  IF lower(coalesce(OLD.status, '')) IN ('accepted', 'completed')
     AND NEW.price IS DISTINCT FROM OLD.price THEN
    RAISE EXCEPTION 'accepted_price_is_locked'
      USING ERRCODE = '42501',
            HINT = 'The agreed price cannot change after an application is accepted.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.qg_lock_accepted_price() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS applications_lock_accepted_price ON public.applications;
CREATE TRIGGER applications_lock_accepted_price
  BEFORE UPDATE OF price ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.qg_lock_accepted_price();

-- 5. Poster marking a task complete always records the confirmation ------------
-- Only the poster can update their task (RLS), so a poster moving it to
-- 'completed' IS the confirmation, whichever code path wrote it.
CREATE OR REPLACE FUNCTION public.qg_stamp_poster_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF lower(coalesce(NEW.status, '')) = 'completed'
     AND lower(coalesce(OLD.status, '')) IS DISTINCT FROM 'completed'
     AND NEW.poster_confirmed_at IS NULL
     AND public.qg_is_signed_in()
     AND NEW.posted_by = public.qg_uid()
  THEN
    NEW.poster_confirmed_at := now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.qg_stamp_poster_confirmation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tasks_stamp_poster_confirmation ON public.tasks;
CREATE TRIGGER tasks_stamp_poster_confirmation
  BEFORE UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.qg_stamp_poster_confirmation();

-- Housekeeping: exact-duplicate indexes flagged by the performance advisor.
DROP INDEX IF EXISTS public.idx_disputes_status;
DROP INDEX IF EXISTS public.idx_reports_status;
DROP INDEX IF EXISTS public.idx_reports_target;
DROP INDEX IF EXISTS public.idx_msgs_conv;
DROP INDEX IF EXISTS public.idx_msgs_conv_created;
DROP INDEX IF EXISTS public.users_firebase_uid_idx;

COMMIT;
