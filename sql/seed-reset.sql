-- =============================================================================
-- ⚠ IRREVERSIBLE — QuickGigs test-data wipe
-- =============================================================================
-- This deletes rows from child tables first, then parents.
-- It does NOT drop tables or columns.
--
-- DO NOT RUN against production with real users/payments unless you intend
-- to permanently destroy that data. There is no undo.
--
-- Supabase project: nuyfqsxstsrbloztzgau
-- Run in Supabase SQL Editor only after you confirm this is a test project
-- or you have a backup.
-- =============================================================================

BEGIN;

-- Children / leaf tables first
DELETE FROM messages;
DELETE FROM conversations;
DELETE FROM reviews;
DELETE FROM applications;
DELETE FROM payments;
DELETE FROM reports;
DELETE FROM blocks;
DELETE FROM disputes;

-- Parent content
DELETE FROM tasks;

-- Optional tables (guarded — skip if missing)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='waitlist') THEN
    DELETE FROM waitlist;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='admin_notes') THEN
    DELETE FROM admin_notes;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='admin_actions') THEN
    DELETE FROM admin_actions;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='notification_queue') THEN
    DELETE FROM notification_queue;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='saved_tasks') THEN
    DELETE FROM saved_tasks;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_warnings') THEN
    DELETE FROM user_warnings;
  END IF;
END $$;

-- Users: left commented out so accounts survive a content wipe.
-- Uncomment only if you also want to clear the users table.
-- DELETE FROM users;

-- Admins allow-list: keep by default
-- DELETE FROM admins;

COMMIT;
