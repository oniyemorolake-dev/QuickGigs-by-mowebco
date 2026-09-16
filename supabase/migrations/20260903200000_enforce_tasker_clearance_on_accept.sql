-- QuickGigs — money-path gate: block application accept unless tasker is cleared.
-- Fires at the DATA layer so no frontend / API path can bypass it.
-- Does NOT drop or alter protect_qg_application_guardian_fields.
--
-- ── Reconciled against the live database 2026-09-16 ─────────────────────────
-- The live `applications` table already carries:
--   applications_require_verified_tasker_on_acceptance
--     BEFORE UPDATE OF status → require_verified_tasker_on_acceptance()
--     checks users.tasker_verified, joined on firebase_uid.
--
-- This migration is ADDITIVE, not a replacement. Differences:
--   * it gates guardian consent / payout ownership / account_status, which the
--     live trigger does not check at all;
--   * it fires on INSERT as well as UPDATE, so a row inserted directly with
--     status='accepted' can no longer skip the gate (the live trigger is
--     UPDATE-only, so that path was open);
--   * it repeats the tasker_verified check so the INSERT path is covered too.
--     On UPDATE both triggers assert it — same rule, same outcome, harmless.
--
-- FIXED BEFORE APPLYING: the worker lookup previously read
--   WHERE user_id = NEW.worker_id
-- but applications.worker_id holds a Firebase UID, so it matched no row and
-- fell through to 'worker % not found', which would have blocked EVERY accept.
-- Verified on live data: worker_id matched users.firebase_uid 3/3 and
-- users.user_id 0/3. The join is now on firebase_uid.

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
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name = 'firebase_uid'
  ) THEN
    missing := array_append(missing, 'users.firebase_uid');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name = 'tasker_verified'
  ) THEN
    missing := array_append(missing, 'users.tasker_verified');
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
  -- Case-normalised to match the live trigger, which compares LOWER(status).
  becoming_accepted := LOWER(COALESCE(NEW.status, '')) = 'accepted'
    AND (TG_OP = 'INSERT'
         OR LOWER(COALESCE(OLD.status, '')) IS DISTINCT FROM 'accepted');

  IF becoming_accepted THEN

    -- Per-gig guardian hold lives on guardian_status (not status)
    IF coalesce(NEW.guardian_status, 'approved') IN ('pending_guardian', 'rejected') THEN
      RAISE EXCEPTION
        'Cannot accept: this application is on guardian hold (%).',
        coalesce(NEW.guardian_status, 'approved')
        USING ERRCODE = 'check_violation';
    END IF;

    -- applications.worker_id holds a Firebase UID, not users.user_id.
    SELECT guardian_consent_status,
           guardian_stripe_payouts_enabled,
           payout_owner,
           account_status,
           tasker_verified
      INTO w
      FROM public.users
     WHERE firebase_uid = NEW.worker_id
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

    -- Identity verification. The live applications_require_verified_tasker_on_acceptance
    -- trigger asserts this on UPDATE only; repeating it here closes the INSERT path.
    IF w.tasker_verified IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION
        'Cannot accept: tasker identity verification required.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Teen gate: guardian-owned payouts, or pending/rejected consent.
    -- Adults use payout_owner='self' and guardian_consent_status='not_required'.
    -- A NULL consent status coalesces to 'pending' so it fails CLOSED — without
    -- that, NULL made the whole condition NULL and skipped the gate entirely,
    -- which contradicted this comment's original claim.
    IF coalesce(w.payout_owner, 'self') = 'guardian'
       OR coalesce(w.guardian_consent_status, 'pending') IN ('pending', 'rejected') THEN
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
