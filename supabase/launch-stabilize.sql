-- =============================================================================
-- RETIRED — DO NOT RUN THIS FILE AGAINST PRODUCTION
-- =============================================================================
-- Formerly opened anon INSERT/UPDATE on tasks, applications, payments,
-- conversations, and messages. Re-running it undoes RLS lockdown.
--
-- Use instead:
--   supabase/firebase-rls-uid-fix.sql
--   supabase/rls-fix-tasks-apps-recursion.sql
--   supabase/migrations/20260827213732_lock_chat_task_photos.sql
--   supabase/payments.sql          (DDL only — no open INSERT)
--   supabase/rls-drop-open-policies.sql
-- =============================================================================

DO $$
BEGIN
  RAISE EXCEPTION 'launch-stabilize.sql is retired and must not be executed';
END $$;
