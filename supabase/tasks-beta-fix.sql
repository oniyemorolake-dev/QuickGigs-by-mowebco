-- QuickGigs — fix task posting + accept applicant in beta (run in Supabase SQL Editor)
-- Fixes: task save errors, "Could not accept" when accepting applicants, mark complete/cancel

-- ── TASKS ────────────────────────────────────────────────────────
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS poster_name TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_label TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS photo_urls TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS requires_photos BOOLEAN NOT NULL DEFAULT FALSE;

GRANT SELECT, INSERT, UPDATE ON tasks TO anon, authenticated;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_tasks" ON tasks;
DROP POLICY IF EXISTS "anon_insert_tasks" ON tasks;
DROP POLICY IF EXISTS "anon_update_tasks" ON tasks;

CREATE POLICY "anon_select_tasks" ON tasks FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_tasks" ON tasks FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_tasks" ON tasks FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ── APPLICATIONS ─────────────────────────────────────────────────
ALTER TABLE applications ADD COLUMN IF NOT EXISTS worker_name TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

GRANT SELECT, INSERT, UPDATE ON applications TO anon, authenticated;

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_applications" ON applications;
DROP POLICY IF EXISTS "anon_insert_applications" ON applications;
DROP POLICY IF EXISTS "anon_update_applications" ON applications;

CREATE POLICY "anon_select_applications" ON applications FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_applications" ON applications FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_applications" ON applications FOR UPDATE TO anon USING (true) WITH CHECK (true);
