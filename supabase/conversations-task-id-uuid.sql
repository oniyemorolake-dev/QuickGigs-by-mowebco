-- conversations.task_id is still bigint from the numeric-id era.
-- tasks / applications / payments are uuid. New chats fail to insert
-- (UUID into bigint). Old chats fail the party check (22 != 22f628cd-…).
-- parseInt('8c1c2ff2-…') === 8 is how the leftover integers were written.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS task_id_uuid uuid;

UPDATE public.conversations c
SET task_id_uuid = mapped.task_id
FROM (
  SELECT c2.conv_id, t.task_id
  FROM public.conversations c2
  JOIN public.tasks t
    ON t.task_id::text LIKE (c2.task_id::text || '%')
   AND t.posted_by = c2.poster_id
) mapped
WHERE c.conv_id = mapped.conv_id
  AND c.task_id_uuid IS NULL;

UPDATE public.conversations c
SET task_id_uuid = mapped.task_id
FROM (
  SELECT DISTINCT ON (c2.conv_id) c2.conv_id, t.task_id
  FROM public.conversations c2
  JOIN public.tasks t ON t.task_id::text LIKE (c2.task_id::text || '%')
  WHERE c2.task_id_uuid IS NULL
  ORDER BY c2.conv_id, t.created_at
) mapped
WHERE c.conv_id = mapped.conv_id
  AND c.task_id_uuid IS NULL;

DROP TRIGGER IF EXISTS conversations_validate_relationship ON public.conversations;

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_task_id_poster_id_worker_id_key;

ALTER TABLE public.conversations DROP COLUMN task_id;
ALTER TABLE public.conversations RENAME COLUMN task_id_uuid TO task_id;
ALTER TABLE public.conversations ALTER COLUMN task_id SET NOT NULL;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_task_id_poster_id_worker_id_key
  UNIQUE (task_id, poster_id, worker_id);

CREATE INDEX IF NOT EXISTS idx_convs_task ON public.conversations (task_id);

-- Paid / in-progress gigs that never got a conversation row.
INSERT INTO public.conversations (
  task_id, poster_id, worker_id, poster_name, worker_name,
  task_title, task_category, status, is_unlocked
)
SELECT
  t.task_id,
  t.posted_by,
  a.worker_id,
  COALESCE(NULLIF(trim(t.poster_name), ''), pu.name, 'Poster'),
  COALESCE(NULLIF(trim(a.worker_name), ''), wu.name, 'Tasker'),
  COALESCE(t.title, 'Gig'),
  COALESCE(t.category, ''),
  'in_progress',
  EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.task_id = t.task_id
      AND lower(p.status) IN ('held', 'paid', 'completed', 'disputed')
  )
FROM public.tasks t
JOIN public.applications a
  ON a.task_id = t.task_id
 AND lower(a.status) IN ('accepted', 'completed')
LEFT JOIN public.users pu ON pu.firebase_uid = t.posted_by
LEFT JOIN public.users wu ON wu.firebase_uid = a.worker_id
WHERE lower(t.status) IN ('in_progress', 'completed')
  AND NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.task_id = t.task_id
      AND c.poster_id = t.posted_by
      AND c.worker_id = a.worker_id
  );

DROP TRIGGER IF EXISTS conversations_validate_relationship ON public.conversations;
CREATE TRIGGER conversations_validate_relationship
  BEFORE INSERT OR UPDATE OF task_id, poster_id, worker_id ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.validate_qg_conversation_relationship();
