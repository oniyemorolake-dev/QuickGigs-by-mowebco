-- QuickGigs — disputes + worker verification (run in Supabase SQL Editor)

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS disputes (
  dispute_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           TEXT NOT NULL,
  opened_by         TEXT NOT NULL,
  opened_by_email   TEXT,
  against_user_id   TEXT,
  reason            TEXT NOT NULL,
  details           TEXT,
  status            TEXT NOT NULL DEFAULT 'open',
  resolution_note   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS disputes_task_idx ON disputes (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS disputes_status_idx ON disputes (status, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON disputes TO anon, authenticated;
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_disputes" ON disputes;
DROP POLICY IF EXISTS "anon_insert_disputes" ON disputes;
DROP POLICY IF EXISTS "anon_update_disputes" ON disputes;
CREATE POLICY "anon_select_disputes" ON disputes FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_disputes" ON disputes FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_disputes" ON disputes FOR UPDATE TO anon USING (true) WITH CHECK (true);
