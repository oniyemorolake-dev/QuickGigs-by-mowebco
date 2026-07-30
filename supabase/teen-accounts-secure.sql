-- QuickGigs — secure teen accounts, guardian consent, and payout ownership.
-- Run in Supabase SQL Editor before deploying the teen-account Edge Functions.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS account_status TEXT DEFAULT 'active';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS guardian_name TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS guardian_email TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS guardian_phone TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS identity_collected_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS consent_token TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS consent_token_expires_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS consent_accepted_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS guardian_consent_status TEXT DEFAULT 'not_required';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS guardian_consent_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS guardian_consent_sent_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS guardian_consent_token TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS guardian_stripe_connect_id TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS guardian_stripe_payouts_enabled BOOLEAN DEFAULT FALSE;

UPDATE public.users SET account_status = 'blocked'
WHERE account_status IN ('suspended', 'rejected');
UPDATE public.users SET account_status = 'active'
WHERE account_status IS NULL OR account_status NOT IN ('pending_guardian', 'active', 'blocked');

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_account_status_check;
ALTER TABLE public.users ADD CONSTRAINT users_account_status_check
  CHECK (account_status IN ('pending_guardian', 'active', 'blocked'));

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_guardian_consent_status_check;
ALTER TABLE public.users ADD CONSTRAINT users_guardian_consent_status_check
  CHECK (guardian_consent_status IN ('not_required', 'pending', 'approved', 'rejected'));

CREATE UNIQUE INDEX IF NOT EXISTS users_firebase_uid_unique
  ON public.users (firebase_uid) WHERE firebase_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_consent_token_idx
  ON public.users (consent_token) WHERE consent_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.protect_qg_account_security_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF request_role <> 'service_role' AND (
    NEW.status IS DISTINCT FROM OLD.status OR
    NEW.account_status IS DISTINCT FROM OLD.account_status OR
    NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth OR
    NEW.identity_collected_at IS DISTINCT FROM OLD.identity_collected_at OR
    NEW.guardian_name IS DISTINCT FROM OLD.guardian_name OR
    NEW.guardian_email IS DISTINCT FROM OLD.guardian_email OR
    NEW.guardian_phone IS DISTINCT FROM OLD.guardian_phone OR
    NEW.guardian_consent_status IS DISTINCT FROM OLD.guardian_consent_status OR
    NEW.guardian_consent_at IS DISTINCT FROM OLD.guardian_consent_at OR
    NEW.guardian_consent_sent_at IS DISTINCT FROM OLD.guardian_consent_sent_at OR
    NEW.guardian_consent_token IS DISTINCT FROM OLD.guardian_consent_token OR
    NEW.consent_token IS DISTINCT FROM OLD.consent_token OR
    NEW.consent_accepted_at IS DISTINCT FROM OLD.consent_accepted_at OR
    NEW.guardian_stripe_connect_id IS DISTINCT FROM OLD.guardian_stripe_connect_id OR
    NEW.guardian_stripe_payouts_enabled IS DISTINCT FROM OLD.guardian_stripe_payouts_enabled
  ) THEN
    RAISE EXCEPTION 'security_fields_are_server_managed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_protect_account_security_fields ON public.users;
CREATE TRIGGER users_protect_account_security_fields
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_qg_account_security_fields();

-- Defense in depth: even service-role inserts through the verified functions must
-- reference an active account. Pending teens can browse/profile but cannot post/apply.
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
BEGIN
  actor_uid := CASE
    WHEN TG_TABLE_NAME = 'tasks' THEN NEW.posted_by
    WHEN TG_TABLE_NAME = 'applications' THEN NEW.worker_id
    ELSE NULL
  END;

  SELECT account_status, status INTO actor_status, moderation_status
  FROM public.users
  WHERE firebase_uid = actor_uid
  LIMIT 1;

  IF actor_status IS DISTINCT FROM 'active' OR
     LOWER(COALESCE(moderation_status, 'active')) IN ('banned', 'blocked', 'suspended') THEN
    RAISE EXCEPTION 'account_not_active' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_require_active_actor ON public.tasks;
CREATE TRIGGER tasks_require_active_actor
  BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.require_active_qg_actor();

DROP TRIGGER IF EXISTS applications_require_active_actor ON public.applications;
CREATE TRIGGER applications_require_active_actor
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.require_active_qg_actor();

-- Browser clients may read tasks/applications, but inserts must go through verified
-- Edge Functions using the service role. Remove every known open beta insert policy.
DROP POLICY IF EXISTS "anon_insert_tasks" ON public.tasks;
DROP POLICY IF EXISTS "tasks_insert_auth" ON public.tasks;
DROP POLICY IF EXISTS "anon_insert_applications" ON public.applications;
DROP POLICY IF EXISTS "applications_insert_auth" ON public.applications;

REVOKE INSERT ON public.tasks FROM anon, authenticated;
REVOKE INSERT ON public.applications FROM anon, authenticated;
REVOKE INSERT ON public.users FROM anon, authenticated;

COMMENT ON COLUMN public.users.consent_token IS
  'SHA-256 hash of the current one-time signed guardian consent token; never store the raw URL token';
COMMENT ON COLUMN public.users.guardian_stripe_connect_id IS
  'Stripe Connect account legally owned by the guardian for a minor worker';
