-- =============================================================================
-- RETIRED — DO NOT RUN THIS FILE AGAINST PRODUCTION
-- =============================================================================
-- Formerly granted open anon INSERT/SELECT/UPDATE across tasks, applications,
-- users, conversations, messages, payments, storage buckets, and more.
-- Re-running it undoes RLS and storage lockdown.
--
-- Use instead:
--   supabase/firebase-rls-uid-fix.sql
--   supabase/rls-fix-tasks-apps-recursion.sql
--   supabase/migrations/20260827213732_lock_chat_task_photos.sql
--   supabase/migrations/20260827220046_tighten_users_select.sql
--   supabase/payments.sql
--   supabase/rls-drop-open-policies.sql
-- =============================================================================

DO $$
BEGIN
  RAISE EXCEPTION 'beta-setup-all.sql is retired and must not be executed';
END $$;
