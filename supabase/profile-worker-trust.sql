-- QuickGigs — worker profile trust fields (availability, service area, languages)
-- Run in Supabase SQL Editor (safe to re-run)

ALTER TABLE users ADD COLUMN IF NOT EXISTS availability TEXT DEFAULT 'available';
ALTER TABLE users ADD COLUMN IF NOT EXISTS service_area TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS languages TEXT;

COMMENT ON COLUMN users.availability IS 'available | busy';
COMMENT ON COLUMN users.service_area IS 'Cities/neighbourhoods the tasker serves';
COMMENT ON COLUMN users.languages IS 'Comma-separated languages spoken';
