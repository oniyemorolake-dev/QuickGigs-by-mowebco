-- QuickGigs — pin search_path on the two RLS identity helpers.
--
-- Why this matters more than a routine advisor WARN: public.qg_uid() and
-- public.qg_is_signed_in() are the functions every RLS policy in the database
-- keys on. They were the only two functions in the public schema without a
-- pinned search_path (verified 2026-09-16 — every other function already sets
-- one), so they were the single unpinned link in the authorization chain.
--
-- Bodies are reproduced verbatim from the live definitions; the only change is
-- the added SET search_path. auth.jwt() is schema-qualified, and everything
-- else in these bodies is a pg_catalog builtin, so an empty user search_path
-- is sufficient. CREATE OR REPLACE preserves existing grants.

-- ── Guard: fail closed if either function is missing or has been changed ─────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'qg_uid'
  ) THEN
    RAISE EXCEPTION 'pin_search_path aborted — public.qg_uid() not found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'qg_is_signed_in'
  ) THEN
    RAISE EXCEPTION 'pin_search_path aborted — public.qg_is_signed_in() not found';
  END IF;
END;
$$;

-- ── qg_uid(): Firebase UID from the verified JWT ────────────────────────────
CREATE OR REPLACE FUNCTION public.qg_uid()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT NULLIF(TRIM(COALESCE(auth.jwt() ->> 'sub', '')), '');
$function$;

-- ── qg_is_signed_in(): true only for a Firebase-issued token ────────────────
CREATE OR REPLACE FUNCTION public.qg_is_signed_in()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT COALESCE(
    (auth.jwt() ->> 'iss') LIKE 'https://securetoken.google.com/%'
    AND NULLIF(TRIM(COALESCE(auth.jwt() ->> 'sub', '')), '') IS NOT NULL,
    false
  );
$function$;

-- ── Verify: both must now report a pinned search_path ───────────────────────
DO $$
DECLARE
  unpinned text;
BEGIN
  SELECT string_agg(p.proname, ', ')
    INTO unpinned
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('qg_uid', 'qg_is_signed_in')
     AND (
       p.proconfig IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'
       )
     );

  IF unpinned IS NOT NULL THEN
    RAISE EXCEPTION 'pin_search_path failed — still unpinned: %', unpinned;
  END IF;
END;
$$;
