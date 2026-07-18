-- QuickGigs — negotiable budgets + structured counter-offers (beta)
-- Run in Supabase SQL Editor after beta-setup-all.sql

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS budget_negotiable BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE applications ADD COLUMN IF NOT EXISTS counter_price NUMERIC;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS counter_by TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS counter_round INT NOT NULL DEFAULT 0;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS last_counter_at TIMESTAMPTZ;
