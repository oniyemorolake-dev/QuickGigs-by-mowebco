-- QuickGigs — first-time role enable consent (Tasker / Poster).
-- Apply in Supabase SQL Editor before relying on role-access consent checks.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS tasker_terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS poster_terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tasker_terms_version TEXT,
  ADD COLUMN IF NOT EXISTS poster_terms_version TEXT;

COMMENT ON COLUMN public.users.tasker_terms_accepted_at IS
  'When the user first enabled Tasker and accepted Terms + ICA.';
COMMENT ON COLUMN public.users.poster_terms_accepted_at IS
  'When the user first enabled Poster and accepted Terms + Poster & Payment Terms.';
COMMENT ON COLUMN public.users.tasker_terms_version IS
  'Accepted document versions, e.g. tos:2026-07-02;ica:2026-08-03';
COMMENT ON COLUMN public.users.poster_terms_version IS
  'Accepted document versions, e.g. tos:2026-07-02;poster_payment:2026-08-03';

-- Block enabling a role without recorded consent (service-role updates only path for role flags).
CREATE OR REPLACE FUNCTION public.enforce_qg_role_enable_consent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_tasker IS TRUE AND COALESCE(OLD.is_tasker, FALSE) IS FALSE THEN
    IF NEW.tasker_terms_accepted_at IS NULL OR COALESCE(NEW.tasker_terms_version, '') = '' THEN
      RAISE EXCEPTION 'tasker_consent_required'
        USING ERRCODE = 'check_violation',
              HINT = 'Enable Tasker only via role-access with recorded terms consent.';
    END IF;
  END IF;

  IF NEW.is_poster IS TRUE AND COALESCE(OLD.is_poster, FALSE) IS FALSE THEN
    IF NEW.poster_terms_accepted_at IS NULL OR COALESCE(NEW.poster_terms_version, '') = '' THEN
      RAISE EXCEPTION 'poster_consent_required'
        USING ERRCODE = 'check_violation',
              HINT = 'Enable Poster only via role-access with recorded terms consent.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_qg_role_enable_consent ON public.users;
CREATE TRIGGER trg_enforce_qg_role_enable_consent
  BEFORE UPDATE OF is_tasker, is_poster ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_qg_role_enable_consent();
