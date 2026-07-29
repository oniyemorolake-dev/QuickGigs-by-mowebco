-- Prefer the canonical schema:
--   supabase/reports-blocks-disputes.sql
--
-- This file only adds raised_by / detail if an older disputes table
-- already exists (opened_by / details era). Safe to re-run.

ALTER TABLE disputes ADD COLUMN IF NOT EXISTS raised_by TEXT;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS detail TEXT;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_disputes_task   ON disputes (task_id);
CREATE INDEX IF NOT EXISTS disputes_raised_by_idx ON disputes (raised_by);
