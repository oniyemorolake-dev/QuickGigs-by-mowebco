-- QuickGigs — money-path gate: block application accept unless tasker is cleared.
-- Fires at the DATA layer so no frontend / API path can bypass it.
-- Does NOT drop or alter protect_qg_application_guardian_fields.

-- ── STEP 1: column guard (fail closed if schema drift) ───────────────────────
DO $$
DECLARE
  missing text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name = 'guardian_consent_status'
  ) THEN
    missing := array_append(missing, 'users.guardian_consent_status');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name = 'guardian_stripe_payouts_enabled'
  ) THEN
    missing := array_append(missing, 'users.guardian_stripe_payouts_enabled');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name = 'payout_owner'
  ) THEN
    missing := array_append(missing, 'users.payout_owner');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name = 'account_status'
  ) THEN
    missing := array_append(missing, 'users.account_status');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'applications'
      AND column_name = 'guardian_status'
  ) THEN
    missing := array_append(missing, 'applications.guardian_status');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'applications'
      AND column_name = 'status'
  ) THEN
    missing := array_append(missing, 'applications.status');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'applications'
      AND column_name = 'worker_id'
  ) THEN
    missing := array_append(missing, 'applications.worker_id');
  END IF;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'enforce_tasker_clearance_on_accept aborted — missing columns: %',
      array_to_string(missing, ', ');
  END IF;
END;
$$;

-- ── STEP 2: function ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_tasker_clearance_on_accept()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w record;
  becoming_accepted boolean;
BEGIN
  becoming_accepted := NEW.status = 'accepted'
    AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'accepted');

  IF becoming_accepted THEN

    -- Per-gig guardian hold lives on guardian_status (not status)
    IF coalesce(NEW.guardian_status, 'approved') IN ('pending_guardian', 'rejected') THEN
      RAISE EXCEPTION
        'Cannot accept: this application is on guardian hold (%).',
        coalesce(NEW.guardian_status, 'approved')
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT guardian_consent_status,
           guardian_stripe_payouts_enabled,
           payout_owner,
           account_status
      INTO w
      FROM public.users
     WHERE user_id = NEW.worker_id
     LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Cannot accept: worker % not found.',
        NEW.worker_id
        USING ERRCODE = 'check_violation';
    END IF;

    IF coalesce(w.account_status, 'active') IN ('pending_guardian', 'blocked', 'suspended') THEN
      RAISE EXCEPTION
        'Cannot accept: tasker account is not active (%).',
        coalesce(w.account_status, 'active')
        USING ERRCODE = 'check_violation';
    END IF;

    -- Teen gate: guardian-owned payouts, or explicit pending/rejected consent.
    -- Adults use payout_owner='self' and guardian_consent_status='not_required'
    -- (NULL is NOT treated as adult).
    IF coalesce(w.payout_owner, 'self') = 'guardian'
       OR w.guardian_consent_status IN ('pending', 'rejected') THEN
      IF w.guardian_consent_status IS DISTINCT FROM 'approved'
         OR coalesce(w.guardian_stripe_payouts_enabled, false) = false THEN
        RAISE EXCEPTION
          'Cannot accept: tasker is not cleared (needs guardian consent AND Stripe payouts enabled).'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

-- ── STEP 3: trigger (does not touch protect_qg_application_guardian_fields) ───
DROP TRIGGER IF EXISTS trg_enforce_tasker_clearance ON public.applications;
CREATE TRIGGER trg_enforce_tasker_clearance
  BEFORE INSERT OR UPDATE OF status ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_tasker_clearance_on_accept();

-- ── STEP 4: rollback (commented — do not run with this migration) ────────────
-- DROP TRIGGER IF EXISTS trg_enforce_tasker_clearance ON public.applications;
-- DROP FUNCTION IF EXISTS public.enforce_tasker_clearance_on_accept();

-- ── STEP 5: manual test queries (do not run in this migration) ───────────────
--
-- FAIL — uncleared teen application (expect check_violation):
-- UPDATE public.applications
--    SET status = 'accepted'
--  WHERE app_id = '<uncleared_teen_app_id>'
--    AND guardian_status = 'pending_guardian';
--
-- SUCCEED — adult or fully-cleared teen (guardian_status='approved',
-- account active, and either payout_owner='self' with consent not_required,
-- or payout_owner='guardian' with consent approved + stripe payouts true):
-- UPDATE public.applications
--    SET status = 'accepted'
--  WHERE app_id = '<cleared_adult_or_teen_app_id>';
