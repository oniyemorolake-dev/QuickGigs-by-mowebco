-- QuickGigs — email-only tasker verification launch.
-- Run AFTER verification-soft-launch.sql (or after verification-gates + dual-role).
-- Soft launch change: tasker_verified = email_verified only.
-- Phone + hard ID remain as optional hooks (off by default).

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_e164 TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_verification_required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tasker_id_check_status TEXT NOT NULL DEFAULT 'not_started';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tasker_id_check_required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tasker_id_checked_at TIMESTAMPTZ;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_tasker_id_check_status_check;
ALTER TABLE public.users ADD CONSTRAINT users_tasker_id_check_status_check
  CHECK (tasker_id_check_status IN ('not_started', 'pending', 'verified', 'rejected'));

COMMENT ON COLUMN public.users.tasker_verified IS
  'Launch: true when email_verified. Future: also phone_verification_required / tasker_id_check_required flags.';
COMMENT ON COLUMN public.users.phone_verification_required IS
  'Hook for Firebase Phone Auth later. When true, qg_recompute_tasker_verified also requires phone_verified.';
COMMENT ON COLUMN public.users.tasker_id_check_required IS
  'Hook for hard ID check later. When true, also requires tasker_id_check_status=verified.';

-- Email-only recompute (phone + ID only if their required flags are on)
CREATE OR REPLACE FUNCTION public.qg_recompute_tasker_verified(p_uid TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u RECORD;
  ok BOOLEAN;
BEGIN
  SELECT email_verified,
         phone_verified,
         COALESCE(phone_verification_required, FALSE) AS phone_verification_required,
         COALESCE(tasker_id_check_required, FALSE) AS tasker_id_check_required,
         COALESCE(tasker_id_check_status, 'not_started') AS tasker_id_check_status
  INTO u
  FROM public.users
  WHERE firebase_uid = p_uid
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  ok := (u.email_verified IS TRUE);
  IF u.phone_verification_required IS TRUE THEN
    ok := ok AND (u.phone_verified IS TRUE);
  END IF;
  IF u.tasker_id_check_required IS TRUE THEN
    ok := ok AND (u.tasker_id_check_status = 'verified');
  END IF;

  UPDATE public.users
  SET tasker_verified = ok,
      tasker_verified_at = CASE WHEN ok THEN COALESCE(tasker_verified_at, NOW()) ELSE NULL END,
      tasker_verification_status = CASE WHEN ok THEN 'verified' ELSE 'unverified' END
  WHERE firebase_uid = p_uid;

  RETURN ok;
END;
$$;

REVOKE ALL ON FUNCTION public.qg_recompute_tasker_verified(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qg_recompute_tasker_verified(TEXT) TO service_role;

-- Backfill: anyone already email-verified becomes tasker_verified under email-only rules
UPDATE public.users
SET tasker_verified = TRUE,
    tasker_verified_at = COALESCE(tasker_verified_at, email_verified_at, NOW()),
    tasker_verification_status = 'verified'
WHERE email_verified IS TRUE
  AND COALESCE(phone_verification_required, FALSE) IS FALSE
  AND COALESCE(tasker_id_check_required, FALSE) IS FALSE
  AND tasker_verified IS DISTINCT FROM TRUE;

-- Clear false negatives from the email+phone soft-launch rule
SELECT public.qg_recompute_tasker_verified(firebase_uid)
FROM public.users
WHERE email_verified IS TRUE OR tasker_verified IS TRUE;
