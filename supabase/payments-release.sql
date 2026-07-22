-- QuickGigs — payment release tracking (run once in Supabase SQL Editor)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS transfer_id TEXT;

CREATE INDEX IF NOT EXISTS payments_transfer_idx ON payments (transfer_id) WHERE transfer_id IS NOT NULL;
