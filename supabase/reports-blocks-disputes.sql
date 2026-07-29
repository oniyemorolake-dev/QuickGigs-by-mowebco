-- =========================================================
-- QuickGigs: reports, blocks, disputes
-- User IDs are Firebase UIDs (text), matching users.user_id
-- =========================================================

-- ---------- REPORTS ----------
CREATE TABLE IF NOT EXISTS reports (
  report_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  TEXT NOT NULL,
  target_type  TEXT NOT NULL CHECK (target_type IN ('task', 'user')),
  target_id    TEXT NOT NULL,
  reason       TEXT NOT NULL CHECK (reason IN
                 ('spam', 'scam', 'inappropriate', 'off_platform', 'other')),
  detail       TEXT,
  status       TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'reviewed', 'dismissed', 'actioned')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports (target_type, target_id);

-- ---------- BLOCKS ----------
CREATE TABLE IF NOT EXISTS blocks (
  block_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id  TEXT NOT NULL,
  blocked_id  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (blocker_id, blocked_id),          -- can't block same person twice
  CHECK (blocker_id <> blocked_id)          -- can't block yourself
);
CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks (blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks (blocked_id);

-- ---------- DISPUTES ----------
CREATE TABLE IF NOT EXISTS disputes (
  dispute_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     TEXT NOT NULL,
  raised_by   TEXT NOT NULL,
  reason      TEXT NOT NULL CHECK (reason IN
                ('not_done', 'not_as_described', 'no_show', 'payment', 'other')),
  detail      TEXT,
  status      TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'reviewing', 'resolved', 'rejected')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_disputes_task   ON disputes (task_id);

-- =========================================================
-- RLS — run ONLY after Firebase JWT → Supabase is linked
-- Admin (mowebsiteco@gmail.com) reads all via service-role
-- on a backend function, NOT the anon client.
-- =========================================================
ALTER TABLE reports  ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

-- helper claim: Firebase UID from JWT (usually 'sub')
DROP POLICY IF EXISTS "insert own reports" ON reports;
CREATE POLICY "insert own reports" ON reports
  FOR INSERT WITH CHECK (reporter_id = auth.jwt() ->> 'sub');

DROP POLICY IF EXISTS "manage own blocks" ON blocks;
CREATE POLICY "manage own blocks" ON blocks
  FOR ALL USING (blocker_id = auth.jwt() ->> 'sub')
  WITH CHECK (blocker_id = auth.jwt() ->> 'sub');

DROP POLICY IF EXISTS "read own blocks" ON blocks;
CREATE POLICY "read own blocks" ON blocks
  FOR SELECT USING (
    blocker_id = auth.jwt() ->> 'sub'
    OR blocked_id = auth.jwt() ->> 'sub'
  );

DROP POLICY IF EXISTS "raise own disputes" ON disputes;
CREATE POLICY "raise own disputes" ON disputes
  FOR INSERT WITH CHECK (raised_by = auth.jwt() ->> 'sub');

DROP POLICY IF EXISTS "read own disputes" ON disputes;
CREATE POLICY "read own disputes" ON disputes
  FOR SELECT USING (raised_by = auth.jwt() ->> 'sub');
