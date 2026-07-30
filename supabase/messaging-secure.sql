-- QuickGigs — participant-only messaging security.
-- Browser messaging uses the Firebase-authenticated secure-messaging Edge Function.

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS last_sender_id TEXT;

UPDATE public.conversations c
SET last_sender_id = (
  SELECT m.sender_id FROM public.messages m
  WHERE m.conv_id = c.conv_id
  ORDER BY m.created_at DESC
  LIMIT 1
)
WHERE c.last_sender_id IS NULL
  AND EXISTS (SELECT 1 FROM public.messages m WHERE m.conv_id = c.conv_id);

DROP POLICY IF EXISTS "anon_select_conversations" ON public.conversations;
DROP POLICY IF EXISTS "anon_insert_conversations" ON public.conversations;
DROP POLICY IF EXISTS "anon_update_conversations" ON public.conversations;
DROP POLICY IF EXISTS "conversations_select_auth" ON public.conversations;
DROP POLICY IF EXISTS "conversations_insert_auth" ON public.conversations;
DROP POLICY IF EXISTS "conversations_update_auth" ON public.conversations;
DROP POLICY IF EXISTS "conversations_participant_select" ON public.conversations;

DROP POLICY IF EXISTS "anon_select_messages" ON public.messages;
DROP POLICY IF EXISTS "anon_insert_messages" ON public.messages;
DROP POLICY IF EXISTS "messages_select_auth" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_auth" ON public.messages;
DROP POLICY IF EXISTS "messages_participant_select" ON public.messages;

REVOKE ALL ON public.conversations FROM anon;
REVOKE ALL ON public.messages FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.conversations FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.messages FROM authenticated;
GRANT SELECT ON public.conversations TO authenticated;
GRANT SELECT ON public.messages TO authenticated;

-- Defense for a future Supabase/Firebase third-party Auth integration.
-- Current production browser traffic goes through secure-messaging with service_role.
CREATE POLICY "conversations_participant_select" ON public.conversations
  FOR SELECT TO authenticated
  USING (
    (auth.jwt() ->> 'sub') IN (poster_id, worker_id)
    AND EXISTS (
      SELECT 1
      FROM public.tasks t
      JOIN public.applications a
        ON a.task_id::TEXT = t.task_id::TEXT
       AND a.worker_id = conversations.worker_id
       AND LOWER(COALESCE(a.status, '')) IN ('accepted', 'completed')
      WHERE t.task_id::TEXT = conversations.task_id::TEXT
        AND t.posted_by = conversations.poster_id
    )
  );

CREATE POLICY "messages_participant_select" ON public.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversations c
      JOIN public.tasks t ON t.task_id::TEXT = c.task_id::TEXT AND t.posted_by = c.poster_id
      JOIN public.applications a
        ON a.task_id::TEXT = c.task_id::TEXT
       AND a.worker_id = c.worker_id
       AND LOWER(COALESCE(a.status, '')) IN ('accepted', 'completed')
      WHERE c.conv_id = messages.conv_id
        AND (auth.jwt() ->> 'sub') IN (c.poster_id, c.worker_id)
    )
  );

CREATE OR REPLACE FUNCTION public.validate_qg_conversation_relationship()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.tasks t
    JOIN public.applications a
      ON a.task_id::TEXT = t.task_id::TEXT
     AND a.worker_id = NEW.worker_id
     AND LOWER(COALESCE(a.status, '')) IN ('accepted', 'completed')
    WHERE t.task_id::TEXT = NEW.task_id::TEXT
      AND t.posted_by = NEW.poster_id
  ) THEN
    RAISE EXCEPTION 'accepted_task_relationship_required' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_validate_relationship ON public.conversations;
CREATE TRIGGER conversations_validate_relationship
  BEFORE INSERT OR UPDATE OF task_id, poster_id, worker_id ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.validate_qg_conversation_relationship();

CREATE OR REPLACE FUNCTION public.validate_qg_message_sender()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.conv_id = NEW.conv_id
      AND NEW.sender_id IN (c.poster_id, c.worker_id)
  ) THEN
    RAISE EXCEPTION 'message_sender_is_not_participant' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_validate_sender ON public.messages;
CREATE TRIGGER messages_validate_sender
  BEFORE INSERT OR UPDATE OF conv_id, sender_id ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.validate_qg_message_sender();

CREATE INDEX IF NOT EXISTS conversations_poster_last_idx
  ON public.conversations (poster_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversations_worker_last_idx
  ON public.conversations (worker_id, last_message_at DESC);
