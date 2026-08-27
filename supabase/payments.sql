-- QuickGigs — payments / escrow schema (DDL only)
-- Safe to re-run for column/index creation.
--
-- DO NOT create anon INSERT/UPDATE policies. Payment writes are
-- service_role only (create-checkout / webhooks). Client SELECT uses
-- payments_select_auth (party / admin) from firebase-rls-uid-fix.sql.

CREATE TABLE IF NOT EXISTS payments (
  payment_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id        TEXT NOT NULL,
  poster_id      TEXT NOT NULL,
  worker_id      TEXT NOT NULL,
  amount         NUMERIC NOT NULL DEFAULT 0,
  platform_fee   NUMERIC NOT NULL DEFAULT 0,
  worker_payout  NUMERIC NOT NULL DEFAULT 0,
  stripe_id      TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,
  transfer_id    TEXT
);

CREATE INDEX IF NOT EXISTS payments_task_idx ON payments (task_id);
CREATE INDEX IF NOT EXISTS payments_poster_idx ON payments (poster_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_worker_idx ON payments (worker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_stripe_idx ON payments (stripe_id) WHERE stripe_id IS NOT NULL;

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Strip any legacy open policies / client write grants if this file is re-run.
DROP POLICY IF EXISTS "anon_select_payments" ON payments;
DROP POLICY IF EXISTS "anon_insert_payments" ON payments;
DROP POLICY IF EXISTS "anon_update_payments" ON payments;
DROP POLICY IF EXISTS "Anyone can insert payments" ON payments;
DROP POLICY IF EXISTS "Anyone can read payments" ON payments;
DROP POLICY IF EXISTS "payments_insert_auth" ON payments;
DROP POLICY IF EXISTS "payments_update_auth" ON payments;

REVOKE INSERT, UPDATE, DELETE ON payments FROM anon;
REVOKE INSERT, UPDATE, DELETE ON payments FROM authenticated;
-- SELECT for authenticated may remain for party RLS; anon has no SELECT grant.
REVOKE ALL ON payments FROM anon;
GRANT SELECT ON payments TO authenticated;
GRANT ALL ON payments TO service_role;
