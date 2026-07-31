-- Quick fix: protect_qg_transaction_ownership fails on tasks updates because
-- NEW.worker_id does not exist on the tasks row type.
-- Run this in the SQL Editor, then re-run verification-soft-launch.sql
-- (or just the backfill UPDATE at the bottom if the rest already applied).

CREATE OR REPLACE FUNCTION public.protect_qg_transaction_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  poster_is_verified BOOLEAN;
  new_j JSONB := to_jsonb(NEW);
  old_j JSONB := to_jsonb(OLD);
BEGIN
  IF TG_TABLE_NAME = 'applications' THEN
    IF (new_j->>'worker_id') IS DISTINCT FROM (old_j->>'worker_id')
       OR (new_j->>'task_id') IS DISTINCT FROM (old_j->>'task_id') THEN
      RAISE EXCEPTION 'application_identity_is_immutable' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'tasks' THEN
    IF (new_j->>'posted_by') IS DISTINCT FROM (old_j->>'posted_by') THEN
      RAISE EXCEPTION 'task_owner_is_immutable' USING ERRCODE = '42501';
    END IF;
    IF LOWER(COALESCE(new_j->>'status', '')) = 'open'
       AND LOWER(COALESCE(old_j->>'status', '')) <> 'open' THEN
      SELECT poster_verified INTO poster_is_verified
      FROM public.users
      WHERE firebase_uid = new_j->>'posted_by'
      LIMIT 1;
      IF poster_is_verified IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'poster_payment_verification_required' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Optional: finish the soft-launch care-category backfill if columns already exist
UPDATE public.tasks t
SET requires_enhanced_verification = TRUE
WHERE LOWER(COALESCE(t.category, '')) IN ('care', 'childcare', 'eldercare', 'in-home-care', 'inhome')
  AND COALESCE(requires_enhanced_verification, FALSE) IS DISTINCT FROM TRUE;
