-- QuickGigs — restore My Tasks visibility (Posted + In Progress)
-- Run in Supabase SQL Editor if tasks vanish after accept or payment.
-- Safe to re-run. Fixes accidental rls-secure.sql on tasks/applications.

GRANT SELECT, INSERT, UPDATE ON tasks TO anon, authenticated;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tasks_public_browse" ON tasks;
DROP POLICY IF EXISTS "tasks_select_auth" ON tasks;
DROP POLICY IF EXISTS "tasks_insert_auth" ON tasks;
DROP POLICY IF EXISTS "tasks_update_auth" ON tasks;
DROP POLICY IF EXISTS "tasks_admin" ON tasks;
DROP POLICY IF EXISTS "anon_select_tasks" ON tasks;
DROP POLICY IF EXISTS "anon_insert_tasks" ON tasks;
DROP POLICY IF EXISTS "anon_update_tasks" ON tasks;

CREATE POLICY "anon_select_tasks" ON tasks FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_tasks" ON tasks FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_tasks" ON tasks FOR UPDATE TO anon USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON applications TO anon, authenticated;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "applications_select_auth" ON applications;
DROP POLICY IF EXISTS "applications_insert_auth" ON applications;
DROP POLICY IF EXISTS "applications_update_auth" ON applications;
DROP POLICY IF EXISTS "anon_select_applications" ON applications;
DROP POLICY IF EXISTS "anon_insert_applications" ON applications;
DROP POLICY IF EXISTS "anon_update_applications" ON applications;

CREATE POLICY "anon_select_applications" ON applications FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_applications" ON applications FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_applications" ON applications FOR UPDATE TO anon USING (true) WITH CHECK (true);
