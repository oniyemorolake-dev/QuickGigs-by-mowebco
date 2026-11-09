-- SwiftGigs — launch SQL, 9 Nov 2026. Paste this whole file into the Supabase SQL Editor and run it once.
-- It is the three migrations below, in order. Safe to re-run.

-- ═══════════════════════════════════════════════════════════════
-- migrations/20261109200000_public_profiles_hide_minor_markers.sql
-- ═══════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════
-- migrations/20261109210000_contact_filter_listings.sql
-- ═══════════════════════════════════════════════════════════════
-- SwiftGigs — block contact details in task text and application messages at
-- the database level.
--
-- The post-task and submit-application edge functions already reject these
-- (analyzeListingContact in _shared/off-platform.ts) with a friendly message.
-- This trigger is the backstop for every other write path — e.g. a task owner
-- editing their own row straight through the REST API, which RLS allows.
--
-- Deliberately narrow (email, link, North American phone number, @handle) so a
-- normal description never trips it. Keep in sync with analyzeListingContact.
--
-- Only fires when the text actually changes, so existing rows keep working for
-- status updates even if they contain something this would now reject.
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION public.qg_text_has_contact(p_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_text IS NOT NULL AND (
       p_text ~  '[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9\-]+(\.[a-zA-Z0-9\-]+)*\.[a-zA-Z]{2,}'       -- email
    OR p_text ~* '(https?://|\mwww\.|\mwa\.me/|\mt\.me/)\S+'                                 -- link
    OR p_text ~  '(^|[^0-9])(\+?1[\s.\-]?)?\(?[2-9][0-9]{2}\)?[\s.\-]?[2-9][0-9]{2}[\s.\-]?[0-9]{4}([^0-9]|$)' -- phone
    OR p_text ~  '(^|\s)@[a-zA-Z0-9._]{3,}'                                                  -- @handle
  );
$$;

CREATE OR REPLACE FUNCTION public.qg_block_listing_contact()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'tasks' THEN
    IF (TG_OP = 'INSERT'
        OR NEW.title IS DISTINCT FROM OLD.title
        OR NEW.description IS DISTINCT FROM OLD.description)
       AND public.qg_text_has_contact(coalesce(NEW.title, '') || E'\n' || coalesce(NEW.description, ''))
    THEN
      RAISE EXCEPTION 'contact_info_not_allowed'
        USING ERRCODE = 'check_violation',
              HINT = 'Remove phone numbers, emails, links and social handles from the task.';
    END IF;
  ELSIF TG_TABLE_NAME = 'applications' THEN
    IF (TG_OP = 'INSERT' OR NEW.message IS DISTINCT FROM OLD.message)
       AND public.qg_text_has_contact(NEW.message)
    THEN
      RAISE EXCEPTION 'contact_info_not_allowed'
        USING ERRCODE = 'check_violation',
              HINT = 'Remove phone numbers, emails, links and social handles from the message.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_block_listing_contact ON public.tasks;
CREATE TRIGGER tasks_block_listing_contact
  BEFORE INSERT OR UPDATE OF title, description ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.qg_block_listing_contact();

DROP TRIGGER IF EXISTS applications_block_listing_contact ON public.applications;
CREATE TRIGGER applications_block_listing_contact
  BEFORE INSERT OR UPDATE OF message ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.qg_block_listing_contact();

-- Trigger functions must not be callable as RPCs (same rule as revoke-trigger-rpc.sql).
REVOKE ALL ON FUNCTION public.qg_block_listing_contact() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Verify:
--   SELECT public.qg_text_has_contact('call 403-555-0199');          -- t
--   SELECT public.qg_text_has_contact('Clean 3 rooms on 2026-11-12'); -- f

-- ═══════════════════════════════════════════════════════════════
-- migrations/20261109220000_task_precise_address_private.sql
-- ═══════════════════════════════════════════════════════════════
-- SwiftGigs — keep precise task addresses out of the public tasks table.
--
-- Problem: tasks_select_auth lets anon read every column of any open task, and
-- RLS is row-level, so tasks.precise_address (a poster's full street address)
-- was readable by anyone with the public anon key. The code already carried
-- "SERVER-TODO: restrict SELECT of precise_address" notes for this.
--
-- Fix: a trigger moves precise_address into public.task_private (RLS on, no
-- policies → service-role only) and blanks the column on tasks. The column
-- itself stays, so existing SELECT lists keep working and simply return NULL.
-- Poster and accepted tasker read the address through the
-- qg_task_precise_address() RPC; everyone else gets NULL.
--
-- task_id is stored as text and compared as text so this works whether
-- tasks.task_id is TEXT or UUID. Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.task_private (
  task_id         text PRIMARY KEY,
  precise_address text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.task_private ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_private FROM anon, authenticated;

-- BEFORE trigger: column defaults (task_id) are already filled in at this
-- point, so the address can be copied out and the public column blanked in the
-- same statement, with no second UPDATE on tasks.
CREATE OR REPLACE FUNCTION public.qg_move_precise_address()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.precise_address IS NOT NULL AND btrim(NEW.precise_address) <> '' THEN
    INSERT INTO public.task_private (task_id, precise_address, updated_at)
    VALUES (NEW.task_id::text, left(btrim(NEW.precise_address), 200), now())
    ON CONFLICT (task_id) DO UPDATE
      SET precise_address = EXCLUDED.precise_address, updated_at = now();
  END IF;
  NEW.precise_address := NULL;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.qg_move_precise_address() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tasks_move_precise_address ON public.tasks;
CREATE TRIGGER tasks_move_precise_address
  BEFORE INSERT OR UPDATE OF precise_address ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.qg_move_precise_address();

-- Backfill: move anything already stored, then blank it.
INSERT INTO public.task_private (task_id, precise_address)
SELECT task_id::text, left(btrim(precise_address), 200)
  FROM public.tasks
 WHERE precise_address IS NOT NULL AND btrim(precise_address) <> ''
ON CONFLICT (task_id) DO NOTHING;

UPDATE public.tasks SET precise_address = NULL WHERE precise_address IS NOT NULL;

-- Read path: poster, or the tasker whose application was accepted. Admins too.
CREATE OR REPLACE FUNCTION public.qg_task_precise_address(p_task_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tp.precise_address
    FROM public.task_private tp
    JOIN public.tasks t ON t.task_id::text = tp.task_id
   WHERE tp.task_id = p_task_id
     AND public.qg_is_signed_in()
     AND (
          t.posted_by = public.qg_uid()
       OR public.is_qg_admin()
       OR EXISTS (
            SELECT 1 FROM public.applications a
             WHERE a.task_id::text = tp.task_id
               AND a.worker_id = public.qg_uid()
               AND lower(coalesce(a.status, '')) = 'accepted'
          )
     );
$$;
REVOKE ALL ON FUNCTION public.qg_task_precise_address(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qg_task_precise_address(text) TO authenticated, service_role;

COMMIT;

-- Verify (should return 0):
--   SELECT count(*) FROM public.tasks WHERE precise_address IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- Final check — every number in the result should be 0.
-- ═══════════════════════════════════════════════════════════════
SELECT
  (SELECT count(*) FROM public.public_user_profiles
    WHERE payout_owner IS NOT NULL OR account_status IS NOT NULL
       OR guardian_stripe_payouts_enabled IS NOT NULL)            AS minors_exposed,
  (SELECT count(*) FROM public.tasks WHERE precise_address IS NOT NULL) AS public_addresses,
  (SELECT 1 - count(*) FROM pg_trigger WHERE tgname = 'tasks_block_listing_contact')        AS missing_task_filter,
  (SELECT 1 - count(*) FROM pg_trigger WHERE tgname = 'applications_block_listing_contact') AS missing_application_filter;
