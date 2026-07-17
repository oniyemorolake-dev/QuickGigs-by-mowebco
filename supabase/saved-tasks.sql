-- QuickGigs — saved task bookmarks (run in Supabase SQL Editor)
-- Also included at end of beta-setup-all.sql

CREATE TABLE IF NOT EXISTS saved_tasks (
  saved_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL,
  task_id    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, task_id)
);

CREATE INDEX IF NOT EXISTS saved_tasks_user_idx
  ON saved_tasks (user_id, created_at DESC);

GRANT SELECT, INSERT, DELETE ON saved_tasks TO anon, authenticated;

ALTER TABLE saved_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_saved_tasks" ON saved_tasks;
DROP POLICY IF EXISTS "anon_insert_saved_tasks" ON saved_tasks;
DROP POLICY IF EXISTS "anon_delete_saved_tasks" ON saved_tasks;

CREATE POLICY "anon_select_saved_tasks" ON saved_tasks FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_saved_tasks" ON saved_tasks FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_delete_saved_tasks" ON saved_tasks FOR DELETE TO anon USING (true);
