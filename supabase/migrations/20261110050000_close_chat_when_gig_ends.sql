-- SwiftGigs — close the chat when a gig ends (Uber/Lyft style).
--
-- Before: only the complete-task edge function locked chats, and it locked
-- every conversation between the two people (including other active gigs).
-- Any other completion path, and every cancellation, left the chat open.
--
-- Now: whenever a task moves to completed or cancelled, by any path, its own
-- conversation is locked (is_unlocked = false) and marked ended. Messages
-- stay readable; nobody can send. Only the server can unlock a chat
-- (trg_protect_conversation_unlock), so neither party can reopen it.
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION public.qg_close_chat_when_task_ends()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_status text := lower(coalesce(NEW.status, ''));
BEGIN
  IF new_status IN ('completed', 'cancelled')
     AND lower(coalesce(OLD.status, '')) IS DISTINCT FROM new_status THEN
    UPDATE public.conversations
       SET is_unlocked = false,
           status = CASE WHEN new_status = 'completed' THEN 'completed' ELSE 'closed' END
     WHERE task_id::text = NEW.task_id::text
       AND (is_unlocked IS DISTINCT FROM false
            OR lower(coalesce(status, '')) NOT IN ('completed', 'closed'));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.qg_close_chat_when_task_ends() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tasks_close_chat_when_ended ON public.tasks;
CREATE TRIGGER tasks_close_chat_when_ended
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.qg_close_chat_when_task_ends();

-- Close chats on gigs that already ended.
UPDATE public.conversations c
   SET is_unlocked = false,
       status = CASE WHEN lower(t.status) = 'completed' THEN 'completed' ELSE 'closed' END
  FROM public.tasks t
 WHERE t.task_id::text = c.task_id::text
   AND lower(coalesce(t.status, '')) IN ('completed', 'cancelled')
   AND (c.is_unlocked IS DISTINCT FROM false
        OR lower(coalesce(c.status, '')) NOT IN ('completed', 'closed'));

COMMIT;
