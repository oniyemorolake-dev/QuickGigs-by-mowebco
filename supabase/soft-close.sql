-- QuickGigs — soft close (run this whole file once in Supabase SQL Editor)
-- Creates platform_banner if missing, adds soft_close column, ensures row id=1 exists.

CREATE TABLE IF NOT EXISTS platform_banner (
  id         INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  message    TEXT NOT NULL DEFAULT '',
  link       TEXT,
  style      TEXT NOT NULL DEFAULT 'info',
  active     BOOLEAN NOT NULL DEFAULT FALSE,
  soft_close BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE platform_banner ADD COLUMN IF NOT EXISTS soft_close BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO platform_banner (id, message, active, soft_close)
VALUES (1, '', false, false)
ON CONFLICT (id) DO NOTHING;

GRANT SELECT, INSERT, UPDATE ON platform_banner TO anon, authenticated;

ALTER TABLE platform_banner ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_platform_banner" ON platform_banner;
DROP POLICY IF EXISTS "anon_insert_platform_banner" ON platform_banner;
DROP POLICY IF EXISTS "anon_update_platform_banner" ON platform_banner;

CREATE POLICY "anon_select_platform_banner" ON platform_banner FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_platform_banner" ON platform_banner FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_platform_banner" ON platform_banner FOR UPDATE TO anon USING (true) WITH CHECK (true);
