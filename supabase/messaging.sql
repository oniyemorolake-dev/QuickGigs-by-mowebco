-- ================================================================
-- QuickGigs — Messaging tables (run in Supabase SQL Editor)
-- Dashboard → SQL → New query → paste this → Run
-- ================================================================

-- Link Firebase accounts to Supabase users (for display names in chat)
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_firebase_uid_idx ON users (firebase_uid) WHERE firebase_uid IS NOT NULL;

-- Conversations (one per task + poster + worker)
CREATE TABLE IF NOT EXISTS conversations (
  conv_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           BIGINT NOT NULL,
  poster_id         TEXT NOT NULL,
  worker_id         TEXT NOT NULL,
  poster_name       TEXT,
  worker_name       TEXT,
  task_title        TEXT,
  task_category     TEXT,
  status            TEXT NOT NULL DEFAULT 'in_progress',
  is_unlocked       BOOLEAN NOT NULL DEFAULT TRUE,
  last_message      TEXT,
  last_message_at   TIMESTAMPTZ,
  poster_last_read_at TIMESTAMPTZ,
  worker_last_read_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, poster_id, worker_id)
);

CREATE INDEX IF NOT EXISTS conversations_poster_idx ON conversations (poster_id);
CREATE INDEX IF NOT EXISTS conversations_worker_idx ON conversations (worker_id);
CREATE INDEX IF NOT EXISTS conversations_last_msg_idx ON conversations (last_message_at DESC NULLS LAST);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  message_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conv_id     UUID NOT NULL REFERENCES conversations (conv_id) ON DELETE CASCADE,
  sender_id   TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_conv_created_idx ON messages (conv_id, created_at ASC);

-- Row Level Security (open for beta — matches existing anon REST pattern)
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_conversations" ON conversations;
DROP POLICY IF EXISTS "anon_insert_conversations" ON conversations;
DROP POLICY IF EXISTS "anon_update_conversations" ON conversations;
CREATE POLICY "anon_select_conversations" ON conversations FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_conversations" ON conversations FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_conversations" ON conversations FOR UPDATE TO anon USING (true);

DROP POLICY IF EXISTS "anon_select_messages" ON messages;
DROP POLICY IF EXISTS "anon_insert_messages" ON messages;
CREATE POLICY "anon_select_messages" ON messages FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_messages" ON messages FOR INSERT TO anon WITH CHECK (true);

-- Optional: enable Supabase Realtime for live message updates (Dashboard → Database → Replication)
-- ALTER PUBLICATION supabase_realtime ADD TABLE messages;
