-- QuickGigs — action-time verification gates.
-- Run after teen-accounts-secure.sql and teen-task-approvals.sql.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tasker_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tasker_verified_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tasker_verification_status TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tasker_identity_session_id TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tasker_background_check_status TEXT NOT NULL DEFAULT 'not_started';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tasker_background_checked_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS poster_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS poster_verified_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS poster_verification_status TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS poster_stripe_customer_id TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS poster_payment_method_id TEXT;

-- Preserve users who were already explicitly identity-verified by QuickGigs.
UPDATE public.users
SET tasker_verified = TRUE,
    tasker_verified_at = COALESCE(tasker_verified_at, NOW()),
    tasker_verification_status = 'verified'
WHERE is_verified = TRUE AND tasker_verified = FALSE;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_tasker_verification_status_check;
ALTER TABLE public.users ADD CONSTRAINT users_tasker_verification_status_check
  CHECK (tasker_verification_status IN ('unverified', 'pending', 'verified', 'rejected'));
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_poster_verification_status_check;
ALTER TABLE public.users ADD CONSTRAINT users_poster_verification_status_check
  CHECK (poster_verification_status IN ('unverified', 'pending', 'verified', 'failed'));
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_background_check_status_check;
ALTER TABLE public.users ADD CONSTRAINT users_background_check_status_check
  CHECK (tasker_background_check_status IN ('not_started', 'pending', 'clear', 'review', 'failed'));

CREATE UNIQUE INDEX IF NOT EXISTS users_tasker_identity_session_unique
  ON public.users (tasker_identity_session_id)
  WHERE tasker_identity_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_poster_stripe_customer_unique
  ON public.users (poster_stripe_customer_id)
  WHERE poster_stripe_customer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.protect_qg_verification_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF request_role <> 'service_role' AND (
    NEW.tasker_verified IS DISTINCT FROM OLD.tasker_verified OR
    NEW.tasker_verified_at IS DISTINCT FROM OLD.tasker_verified_at OR
    NEW.tasker_verification_status IS DISTINCT FROM OLD.tasker_verification_status OR
    NEW.tasker_identity_session_id IS DISTINCT FROM OLD.tasker_identity_session_id OR
    NEW.tasker_background_check_status IS DISTINCT FROM OLD.tasker_background_check_status OR
    NEW.tasker_background_checked_at IS DISTINCT FROM OLD.tasker_background_checked_at OR
    NEW.poster_verified IS DISTINCT FROM OLD.poster_verified OR
    NEW.poster_verified_at IS DISTINCT FROM OLD.poster_verified_at OR
    NEW.poster_verification_status IS DISTINCT FROM OLD.poster_verification_status OR
    NEW.poster_stripe_customer_id IS DISTINCT FROM OLD.poster_stripe_customer_id OR
    NEW.poster_payment_method_id IS DISTINCT FROM OLD.poster_payment_method_id
  ) THEN
    RAISE EXCEPTION 'verification_fields_are_server_managed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_protect_verification_fields ON public.users;
CREATE TRIGGER users_protect_verification_fields
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_qg_verification_fields();

-- Defense in depth for all inserts, including service-role Edge Functions.
CREATE OR REPLACE FUNCTION public.require_active_qg_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_uid TEXT;
  actor_status TEXT;
  moderation_status TEXT;
  actor_tasker_verified BOOLEAN;
  actor_poster_verified BOOLEAN;
BEGIN
  actor_uid := CASE
    WHEN TG_TABLE_NAME = 'tasks' THEN NEW.posted_by
    WHEN TG_TABLE_NAME = 'applications' THEN NEW.worker_id
    ELSE NULL
  END;

  SELECT account_status, status, tasker_verified, poster_verified
  INTO actor_status, moderation_status, actor_tasker_verified, actor_poster_verified
  FROM public.users
  WHERE firebase_uid = actor_uid
  LIMIT 1;

  IF actor_status IS DISTINCT FROM 'active' OR
     LOWER(COALESCE(moderation_status, 'active')) IN ('banned', 'blocked', 'suspended') THEN
    RAISE EXCEPTION 'account_not_active' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'tasks' AND actor_poster_verified IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'poster_payment_verification_required' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'applications' AND actor_tasker_verified IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'tasker_identity_verification_required' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_verified_tasker_on_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  worker_verified BOOLEAN;
BEGIN
  IF LOWER(COALESCE(NEW.status, '')) = 'accepted'
     AND LOWER(COALESCE(OLD.status, '')) <> 'accepted' THEN
    SELECT tasker_verified INTO worker_verified
    FROM public.users
    WHERE firebase_uid = NEW.worker_id
    LIMIT 1;
    IF worker_verified IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'tasker_identity_verification_required' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS applications_require_verified_tasker_on_acceptance ON public.applications;
CREATE TRIGGER applications_require_verified_tasker_on_acceptance
  BEFORE UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.require_verified_tasker_on_acceptance();

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
  -- Use jsonb so this function can fire on both applications and tasks
  -- (NEW.worker_id is not a field on tasks rows).
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

DROP TRIGGER IF EXISTS applications_protect_transaction_ownership ON public.applications;
CREATE TRIGGER applications_protect_transaction_ownership
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.protect_qg_transaction_ownership();
DROP TRIGGER IF EXISTS tasks_protect_transaction_ownership ON public.tasks;
CREATE TRIGGER tasks_protect_transaction_ownership
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.protect_qg_transaction_ownership();

COMMENT ON COLUMN public.users.tasker_background_check_status IS
  'Reserved provider hook; background checks are not required until policy enables them';
COMMENT ON COLUMN public.users.poster_verified IS
  'True only after Stripe confirms a reusable payment method for posting';
