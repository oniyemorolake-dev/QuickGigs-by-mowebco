-- QuickGigs — tasker gig-alert preferences
-- Run in Supabase SQL Editor (safe to re-run)
-- Matching fan-out runs in the post-task Edge Function (service role).

ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_new_gigs BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_new_gigs_email BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS alert_radius_km INTEGER NOT NULL DEFAULT 50;
ALTER TABLE users ADD COLUMN IF NOT EXISTS alert_categories TEXT[] DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS alert_lat DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS alert_lng DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS alert_location TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_alert_radius_km_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_alert_radius_km_check
      CHECK (alert_radius_km IN (20, 50, 100));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS users_gig_alerts_idx
  ON users (notify_new_gigs)
  WHERE notify_new_gigs = true AND is_tasker = true;

COMMENT ON COLUMN users.notify_new_gigs IS 'Opt-in: in-app alerts for new nearby gigs matching categories';
COMMENT ON COLUMN users.notify_new_gigs_email IS 'Optional email for new gig matches (requires notify_new_gigs)';
COMMENT ON COLUMN users.alert_radius_km IS 'Max distance km: 20 | 50 | 100';
COMMENT ON COLUMN users.alert_categories IS 'task_categories ids; empty = all categories';
COMMENT ON COLUMN users.alert_lat IS 'Rounded ~1km coords for alert matching (not live GPS)';
COMMENT ON COLUMN users.alert_lng IS 'Rounded ~1km coords for alert matching (not live GPS)';
COMMENT ON COLUMN users.alert_location IS 'Display city/area used for gig alerts';
