-- QuickGigs — Stripe Connect fields (run once in Supabase SQL Editor)
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_connect_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS users_stripe_connect_idx ON users (stripe_connect_id) WHERE stripe_connect_id IS NOT NULL;
