-- QuickGigs — ONE-FILE launch stabilize (run in Supabase SQL Editor)
-- Fixes: tasks vanishing, chat locked after pay, payment rows blocked.
-- Safe to re-run. Do NOT run rls-secure.sql until Firebase auth is enabled in Supabase.

-- ── TASKS + APPLICATIONS (My Tasks / In Progress) ───────────────
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

-- ── PAYMENTS (escrow records) ───────────────────────────────────
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
DROP POLICY IF EXISTS "payments_select_auth" ON payments;
DROP POLICY IF EXISTS "payments_insert_auth" ON payments;
DROP POLICY IF EXISTS "payments_update_auth" ON payments;
DROP POLICY IF EXISTS "anon_select_payments" ON payments;
DROP POLICY IF EXISTS "anon_insert_payments" ON payments;
DROP POLICY IF EXISTS "anon_update_payments" ON payments;
CREATE POLICY "anon_select_payments" ON payments FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_payments" ON payments FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_payments" ON payments FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ── CHAT UNLOCK (conversations + messages) ────────────────────────
GRANT SELECT, INSERT, UPDATE ON conversations TO anon, authenticated;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "conversations_select_auth" ON conversations;
DROP POLICY IF EXISTS "conversations_insert_auth" ON conversations;
DROP POLICY IF EXISTS "conversations_update_auth" ON conversations;
DROP POLICY IF EXISTS "anon_select_conversations" ON conversations;
DROP POLICY IF EXISTS "anon_insert_conversations" ON conversations;
DROP POLICY IF EXISTS "anon_update_conversations" ON conversations;
CREATE POLICY "anon_select_conversations" ON conversations FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_conversations" ON conversations FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_conversations" ON conversations FOR UPDATE TO anon USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON messages TO anon, authenticated;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "messages_select_auth" ON messages;
DROP POLICY IF EXISTS "messages_insert_auth" ON messages;
DROP POLICY IF EXISTS "anon_select_messages" ON messages;
DROP POLICY IF EXISTS "anon_insert_messages" ON messages;
CREATE POLICY "anon_select_messages" ON messages FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_messages" ON messages FOR INSERT TO anon WITH CHECK (true);
