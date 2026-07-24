-- QuickGigs — fix chat unlock after payment (run in Supabase SQL Editor)
-- Restores anon access for beta (Firebase + anon key). Safe to re-run.

-- Payments: poster must read/write payment rows
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

-- Conversations: unlock chat after pay (PATCH is_unlocked)
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

-- Messages: send after unlock
GRANT SELECT, INSERT, UPDATE ON messages TO anon, authenticated;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "messages_select_auth" ON messages;
DROP POLICY IF EXISTS "messages_insert_auth" ON messages;
DROP POLICY IF EXISTS "anon_select_messages" ON messages;
DROP POLICY IF EXISTS "anon_insert_messages" ON messages;
CREATE POLICY "anon_select_messages" ON messages FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_messages" ON messages FOR INSERT TO anon WITH CHECK (true);
