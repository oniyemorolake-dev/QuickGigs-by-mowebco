-- SwiftGigs — block contact details in task text and application messages at
-- the database level.
--
-- The post-task and submit-application edge functions already reject these
-- (analyzeListingContact in _shared/off-platform.ts) with a friendly message.
-- This trigger is the backstop for every other write path — e.g. a task owner
-- editing their own row straight through the REST API, which RLS allows.
--
-- Deliberately narrow (email, link, North American phone number, @handle) so a
-- normal description never trips it. Keep in sync with analyzeListingContact.
--
-- Only fires when the text actually changes, so existing rows keep working for
-- status updates even if they contain something this would now reject.
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION public.qg_text_has_contact(p_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_text IS NOT NULL AND (
       p_text ~  '[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9\-]+(\.[a-zA-Z0-9\-]+)*\.[a-zA-Z]{2,}'       -- email
    OR p_text ~* '(https?://|\mwww\.|\mwa\.me/|\mt\.me/)\S+'                                 -- link
    OR p_text ~  '(^|[^0-9])(\+?1[\s.\-]?)?\(?[2-9][0-9]{2}\)?[\s.\-]?[2-9][0-9]{2}[\s.\-]?[0-9]{4}([^0-9]|$)' -- phone
    OR p_text ~  '(^|\s)@[a-zA-Z0-9._]{3,}'                                                  -- @handle
  );
$$;

CREATE OR REPLACE FUNCTION public.qg_block_listing_contact()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'tasks' THEN
    IF (TG_OP = 'INSERT'
        OR NEW.title IS DISTINCT FROM OLD.title
        OR NEW.description IS DISTINCT FROM OLD.description)
       AND public.qg_text_has_contact(coalesce(NEW.title, '') || E'\n' || coalesce(NEW.description, ''))
    THEN
      RAISE EXCEPTION 'contact_info_not_allowed'
        USING ERRCODE = 'check_violation',
              HINT = 'Remove phone numbers, emails, links and social handles from the task.';
    END IF;
  ELSIF TG_TABLE_NAME = 'applications' THEN
    IF (TG_OP = 'INSERT' OR NEW.message IS DISTINCT FROM OLD.message)
       AND public.qg_text_has_contact(NEW.message)
    THEN
      RAISE EXCEPTION 'contact_info_not_allowed'
        USING ERRCODE = 'check_violation',
              HINT = 'Remove phone numbers, emails, links and social handles from the message.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_block_listing_contact ON public.tasks;
CREATE TRIGGER tasks_block_listing_contact
  BEFORE INSERT OR UPDATE OF title, description ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.qg_block_listing_contact();

DROP TRIGGER IF EXISTS applications_block_listing_contact ON public.applications;
CREATE TRIGGER applications_block_listing_contact
  BEFORE INSERT OR UPDATE OF message ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.qg_block_listing_contact();

-- Trigger functions must not be callable as RPCs (same rule as revoke-trigger-rpc.sql).
REVOKE ALL ON FUNCTION public.qg_block_listing_contact() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Verify:
--   SELECT public.qg_text_has_contact('call 403-555-0199');          -- t
--   SELECT public.qg_text_has_contact('Clean 3 rooms on 2026-11-12'); -- f
