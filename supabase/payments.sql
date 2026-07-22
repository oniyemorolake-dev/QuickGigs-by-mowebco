-- QuickGigs — payments / escrow records (run before Stripe launch)
-- Safe to re-run

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

GRANT SELECT, INSERT, UPDATE ON payments TO anon, authenticated;

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_payments" ON payments;
DROP POLICY IF EXISTS "anon_insert_payments" ON payments;
DROP POLICY IF EXISTS "anon_update_payments" ON payments;

CREATE POLICY "anon_select_payments" ON payments FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_payments" ON payments FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_payments" ON payments FOR UPDATE TO anon USING (true) WITH CHECK (true);
