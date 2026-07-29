-- QuickGigs — recurring + hourly tasks + subscriber flag for fee lookup
-- Run in Supabase → SQL Editor.
-- Fee rates live in feeBreakdown.js (client) and create-checkout (server) — never hardcode 25% elsewhere.

-- Add recurring + hourly support to tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rate_type TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10,2);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS frequency TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS est_hours NUMERIC(6,2);

-- Constraints (drop/recreate so re-runs are safe)
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_rate_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_rate_type_check
  CHECK (rate_type IN ('fixed', 'hourly'));

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_frequency_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_frequency_check
  CHECK (frequency IS NULL OR frequency IN ('weekly', 'biweekly', 'monthly'));

-- Track subscriber status for fee lookup
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_subscriber BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN tasks.rate_type IS 'fixed | hourly — fee math uses amount for this charge';
COMMENT ON COLUMN tasks.is_recurring IS 'true → 10% fee (8% if subscriber); false → 25% (20% if subscriber)';
COMMENT ON COLUMN tasks.hourly_rate IS 'CAD/hr when rate_type=hourly; null for fixed';
COMMENT ON COLUMN tasks.frequency IS 'weekly | biweekly | monthly for recurring; null for one-off';
COMMENT ON COLUMN tasks.est_hours IS 'Estimated hours per period (hourly recurring)';
COMMENT ON COLUMN users.is_subscriber IS 'Subscriber fee rates: one-off 20%, recurring 8%';
