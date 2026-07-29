-- QuickGigs — approximate coordinates + precise address (privacy-aware)
-- Run in Supabase → SQL Editor.
-- Public UI shows tasks.location (city/area) only. lat/lng are rounded approx for distance
-- filters. precise_address is for accepted tasker/poster after accept — enforce via RLS later.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS precise_address TEXT;

COMMENT ON COLUMN tasks.location IS 'Public display area (city / neighbourhood) — never a full street address in UI';
COMMENT ON COLUMN tasks.lat IS 'Approximate latitude for distance filter (rounded ~1km); never show raw coords publicly';
COMMENT ON COLUMN tasks.lng IS 'Approximate longitude for distance filter (rounded ~1km); never show raw coords publicly';
COMMENT ON COLUMN tasks.precise_address IS 'Optional full address — reveal only after accept/escrow (client + future RLS)';

CREATE INDEX IF NOT EXISTS tasks_lat_lng_idx ON tasks (lat, lng)
  WHERE lat IS NOT NULL AND lng IS NOT NULL;
