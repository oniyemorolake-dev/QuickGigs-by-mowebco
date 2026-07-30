-- QuickGigs — per-task guardian approval, age preferences, and age-18 graduation.
-- Run after teen-accounts-secure.sql.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS age_preference TEXT NOT NULL DEFAULT 'adults_only';
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_age_preference_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_age_preference_check
  CHECK (age_preference IN ('adults_only', 'teens_welcome', 'any_with_guardian'));

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS guardian_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS guardian_reviewed_at TIMESTAMPTZ;
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS guardian_distance_km NUMERIC(7,2);
UPDATE public.applications SET guardian_status = 'approved' WHERE guardian_status IS NULL;
ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_guardian_status_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_guardian_status_check
  CHECK (guardian_status IN ('pending_guardian', 'approved', 'rejected'));

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS graduated_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS payout_owner TEXT NOT NULL DEFAULT 'self';
UPDATE public.users
SET payout_owner = CASE
  WHEN date_of_birth IS NOT NULL
   AND date_of_birth > (CURRENT_DATE - INTERVAL '18 years')::date
   AND guardian_email IS NOT NULL
  THEN 'guardian'
  ELSE 'self'
END
WHERE payout_owner IS NULL OR payout_owner NOT IN ('guardian', 'self');
UPDATE public.users
SET payout_owner = 'guardian'
WHERE date_of_birth IS NOT NULL
  AND date_of_birth > (CURRENT_DATE - INTERVAL '18 years')::date
  AND guardian_email IS NOT NULL
  AND graduated_at IS NULL;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_payout_owner_check;
ALTER TABLE public.users ADD CONSTRAINT users_payout_owner_check
  CHECK (payout_owner IN ('guardian', 'self'));

CREATE OR REPLACE FUNCTION public.protect_qg_application_guardian_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF request_role <> 'service_role' AND (
    NEW.guardian_status IS DISTINCT FROM OLD.guardian_status OR
    NEW.guardian_reviewed_at IS DISTINCT FROM OLD.guardian_reviewed_at OR
    NEW.guardian_distance_km IS DISTINCT FROM OLD.guardian_distance_km
  ) THEN
    RAISE EXCEPTION 'guardian_fields_are_server_managed' USING ERRCODE = '42501';
  END IF;

  IF request_role <> 'service_role'
     AND OLD.guardian_status IS DISTINCT FROM 'approved'
     AND (
       NEW.status IS DISTINCT FROM OLD.status OR
       NEW.counter_price IS DISTINCT FROM OLD.counter_price OR
       NEW.counter_by IS DISTINCT FROM OLD.counter_by
     ) THEN
    RAISE EXCEPTION 'application_not_guardian_approved' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS applications_protect_guardian_fields ON public.applications;
CREATE TRIGGER applications_protect_guardian_fields
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.protect_qg_application_guardian_fields();

-- Public browser reads may only see applications released by the guardian gate.
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_applications" ON public.applications;
DROP POLICY IF EXISTS "applications_select_auth" ON public.applications;
DROP POLICY IF EXISTS "applications_select_guardian_approved" ON public.applications;
CREATE POLICY "applications_select_guardian_approved"
  ON public.applications
  FOR SELECT
  TO anon, authenticated
  USING (guardian_status = 'approved');

CREATE INDEX IF NOT EXISTS applications_guardian_queue_idx
  ON public.applications (guardian_status, created_at)
  WHERE guardian_status = 'pending_guardian';
CREATE INDEX IF NOT EXISTS tasks_age_preference_idx
  ON public.tasks (age_preference, status);

-- Prevent repeated birthday emails while allowing other notification types.
CREATE TABLE IF NOT EXISTS public.notification_queue (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  email TEXT,
  type TEXT NOT NULL,
  subject TEXT,
  body_text TEXT,
  payload JSONB,
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_queue_teen_lifecycle_once
  ON public.notification_queue (user_id, type)
  WHERE type IN (
    'turning_18_soon',
    'account_graduated',
    'guardian_role_ended'
  );

CREATE OR REPLACE FUNCTION public.protect_qg_lifecycle_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF NEW.type IN ('turning_18_soon', 'account_graduated', 'guardian_role_ended')
     AND request_role <> 'service_role' THEN
    RAISE EXCEPTION 'lifecycle_notifications_are_server_managed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS notification_queue_protect_lifecycle ON public.notification_queue;
CREATE TRIGGER notification_queue_protect_lifecycle
  BEFORE INSERT OR UPDATE ON public.notification_queue
  FOR EACH ROW EXECUTE FUNCTION public.protect_qg_lifecycle_notifications();

COMMENT ON COLUMN public.tasks.age_preference IS
  'adults_only blocks ages 16-17; both other values admit teens with per-task guardian approval';
COMMENT ON COLUMN public.applications.guardian_distance_km IS
  'Approximate distance snapshot shown to the guardian; raw applicant coordinates are not stored';
