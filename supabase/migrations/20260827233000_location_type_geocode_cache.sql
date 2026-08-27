-- Location type + geocode cache for Canada-wide task visibility.
-- Run this BEFORE backfill script, then VALIDATE constraint after backfill (see bottom).

-- ── Geocode cache (server-side lookups; no API key in browser) ───────────────
CREATE TABLE IF NOT EXISTS public.geocode_cache (
  lookup_key   TEXT PRIMARY KEY,
  postal_code  TEXT,
  city         TEXT NOT NULL,
  province     TEXT NOT NULL,
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT geocode_cache_lat_lng_canada CHECK (
    lat >= 41.5 AND lat <= 83.5 AND lng >= -141.1 AND lng <= -52.5
  )
);

CREATE INDEX IF NOT EXISTS geocode_cache_postal_idx
  ON public.geocode_cache (postal_code)
  WHERE postal_code IS NOT NULL;

ALTER TABLE public.geocode_cache ENABLE ROW LEVEL SECURITY;

-- Read-only for authenticated users; writes via service role (Edge Functions).
DROP POLICY IF EXISTS geocode_cache_select ON public.geocode_cache;
CREATE POLICY geocode_cache_select ON public.geocode_cache
  FOR SELECT TO authenticated
  USING (public.qg_is_signed_in());

-- ── Task location type ───────────────────────────────────────────────────────
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS location_type TEXT NOT NULL DEFAULT 'in_person';

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_location_type_check;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_location_type_check
  CHECK (location_type IN ('in_person', 'remote'));

COMMENT ON COLUMN public.tasks.location_type IS
  'in_person = physical gig (requires lat/lng); remote = online / anywhere in Canada';

-- In-person tasks must have coordinates; remote tasks must not rely on radius.
ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_in_person_requires_coords;

-- NOT VALID: existing rows without coords remain until backfill runs.
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_in_person_requires_coords
  CHECK (
    location_type = 'remote'
    OR (lat IS NOT NULL AND lng IS NOT NULL)
  ) NOT VALID;

-- After scripts/backfill-task-coords.js completes successfully, run:
--   ALTER TABLE public.tasks VALIDATE CONSTRAINT tasks_in_person_requires_coords;
