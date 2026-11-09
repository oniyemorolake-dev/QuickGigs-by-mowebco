-- SwiftGigs — stop public_user_profiles from identifying minors.
--
-- Problem (docs/TEEN-ACCOUNTS.md → "Open security issue"):
--   public_user_profiles is SECURITY DEFINER (security_invoker = false) with no
--   WHERE clause, and is granted to anon. It exposed account_status,
--   payout_owner and guardian_stripe_payouts_enabled next to name, avatar_url
--   and service_area. Filtering payout_owner = 'guardian' listed every teen on
--   the platform with name, photo and approximate location, using only the
--   public anon key.
--
-- Fix: the three teen-revealing columns are kept (so the current frontend's
-- SELECT lists don't 400) but always return NULL. stripe_payouts_enabled now
-- carries the combined "can this tasker be paid?" answer, which is the only
-- thing the accept gate in mytasks.html actually needs:
--   payout_owner = 'guardian' → guardian_stripe_payouts_enabled
--   otherwise                 → stripe_payouts_enabled OR guardian_stripe_payouts_enabled
-- That mirrors the existing client logic exactly, so no JS change is required.
-- (Side effect: the accept toast shows the generic "finish payout setup" text
-- instead of the teen-specific one. Real enforcement stays server-side in
-- 20260903200000_enforce_tasker_clearance_on_accept.sql.)
--
-- Own-profile and admin reads use public.users (owner/admin RLS) and are
-- unaffected. Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

-- DROP without CASCADE: aborts (and rolls back) if anything depends on the
-- view, rather than silently dropping the dependant.
DROP VIEW IF EXISTS public.public_user_profiles;

CREATE VIEW public.public_user_profiles AS
SELECT
  user_id,
  firebase_uid,
  name,
  avatar_url,
  bio,
  skills,
  availability,
  service_area,
  languages,
  pronouns,
  role,
  status,
  NULL::text    AS account_status,            -- was: reveals pending_guardian (minor)
  is_tasker,
  is_poster,
  tasker_verified,
  poster_verified,
  rating,
  verified,
  created_at,
  CASE
    WHEN payout_owner::text = 'guardian'
      THEN COALESCE(guardian_stripe_payouts_enabled, false)
    ELSE COALESCE(stripe_payouts_enabled, false)
      OR COALESCE(guardian_stripe_payouts_enabled, false)
  END            AS stripe_payouts_enabled,   -- combined "payouts ready"
  NULL::boolean AS guardian_stripe_payouts_enabled, -- was: reveals guardian-owned payouts
  NULL::text    AS payout_owner                -- was: 'guardian' = minor
FROM public.users;

-- Owner rights so marketplace cards still render for other users. Safe only
-- because every column above is non-sensitive. NEVER add: email, phone,
-- date_of_birth, account_status, payout_owner, guardian_*, consent_*,
-- stripe_* account IDs.
ALTER VIEW public.public_user_profiles SET (security_invoker = false);

COMMENT ON VIEW public.public_user_profiles IS
  'Non-sensitive user fields for marketplace cards. Must not expose anything that identifies a minor. Full rows stay on public.users (owner/admin only).';

GRANT SELECT ON public.public_user_profiles TO anon, authenticated, service_role;

COMMIT;

-- Verify (should return 0):
--   SELECT count(*) FROM public.public_user_profiles
--   WHERE payout_owner IS NOT NULL OR account_status IS NOT NULL
--      OR guardian_stripe_payouts_enabled IS NOT NULL;
