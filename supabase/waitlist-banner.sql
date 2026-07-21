-- QuickGigs — waitlist + platform announcement banner
-- Run in Supabase SQL Editor (safe to re-run)

CREATE TABLE IF NOT EXISTS waitlist (
  waitlist_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             TEXT NOT NULL UNIQUE,
  name              TEXT,
  invited_at        TIMESTAMPTZ,
  signed_up         BOOLEAN NOT NULL DEFAULT FALSE,
  signed_up_at      TIMESTAMPTZ,
  reminder_sent_at  TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS waitlist_email_idx ON waitlist (email);
CREATE INDEX IF NOT EXISTS waitlist_signed_idx ON waitlist (signed_up, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_banner (
  id         INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  message    TEXT NOT NULL DEFAULT '',
  link       TEXT,
  style      TEXT NOT NULL DEFAULT 'info',
  active     BOOLEAN NOT NULL DEFAULT FALSE,
  soft_close BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_banner (id, message, active)
VALUES (1, '', false)
ON CONFLICT (id) DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON waitlist TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON platform_banner TO anon, authenticated;

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_banner ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_waitlist" ON waitlist;
DROP POLICY IF EXISTS "anon_insert_waitlist" ON waitlist;
DROP POLICY IF EXISTS "anon_update_waitlist" ON waitlist;
DROP POLICY IF EXISTS "anon_delete_waitlist" ON waitlist;
DROP POLICY IF EXISTS "anon_select_platform_banner" ON platform_banner;
DROP POLICY IF EXISTS "anon_insert_platform_banner" ON platform_banner;
DROP POLICY IF EXISTS "anon_update_platform_banner" ON platform_banner;

CREATE POLICY "anon_select_waitlist" ON waitlist FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_waitlist" ON waitlist FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_waitlist" ON waitlist FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_waitlist" ON waitlist FOR DELETE TO anon USING (true);
CREATE POLICY "anon_select_platform_banner" ON platform_banner FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_platform_banner" ON platform_banner FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_platform_banner" ON platform_banner FOR UPDATE TO anon USING (true) WITH CHECK (true);
