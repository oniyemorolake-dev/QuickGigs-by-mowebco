-- QuickGigs — approximate coordinates + precise address (privacy-aware)
-- Run in Supabase → SQL Editor.
-- Public UI shows tasks.location (city/area) only. lat/lng are rounded approx for distance
-- filters. precise_address is for accepted tasker/poster after accept — enforce via RLS later.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS precise_address TEXT;

UPDATE tasks
SET lat = NULL, lng = NULL
WHERE (lat IS NULL) <> (lng IS NULL)
   OR lat NOT BETWEEN 41.5 AND 83.5
   OR lng NOT BETWEEN -141.1 AND -52.5;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_coordinates_pair_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_coordinates_pair_check
  CHECK ((lat IS NULL AND lng IS NULL) OR (lat IS NOT NULL AND lng IS NOT NULL));
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_coordinates_range_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_coordinates_range_check
  CHECK (
    lat IS NULL OR
    (lat BETWEEN 41.5 AND 83.5 AND lng BETWEEN -141.1 AND -52.5)
  );

COMMENT ON COLUMN tasks.location IS 'Public display area (city / neighbourhood) — never a full street address in UI';
COMMENT ON COLUMN tasks.lat IS 'Approximate latitude for distance filter (rounded ~1km); never show raw coords publicly';
COMMENT ON COLUMN tasks.lng IS 'Approximate longitude for distance filter (rounded ~1km); never show raw coords publicly';
COMMENT ON COLUMN tasks.precise_address IS 'Optional full address — reveal only after accept/escrow (client + future RLS)';

CREATE INDEX IF NOT EXISTS tasks_lat_lng_idx ON tasks (lat, lng)
  WHERE lat IS NOT NULL AND lng IS NOT NULL;
