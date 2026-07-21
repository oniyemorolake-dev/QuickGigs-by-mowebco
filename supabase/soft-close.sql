-- QuickGigs — soft close toggle on platform banner (run in Supabase SQL Editor)
ALTER TABLE platform_banner ADD COLUMN IF NOT EXISTS soft_close BOOLEAN NOT NULL DEFAULT FALSE;
