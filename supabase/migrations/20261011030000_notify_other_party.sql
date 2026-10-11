-- Cross-user notices (apply, hire, decline, counter, chat, complete, unlock)
-- must be written server-side. Clients can only insert user_notifications for
-- themselves (user_notifications_insert_own), so the applicant's browser
-- cannot create the poster's "new application" row.

CREATE OR REPLACE FUNCTION public.qg_notify_user(
  p_user_id text,
  p_type text,
  p_title text,
  p_body text,
  p_link text,
  p_subject text,
  p_email_body text,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nid uuid;
  dedupe_key text;
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
    RETURN NULL;
  END IF;

  dedupe_key := coalesce(
    p_payload->>'taskId',
    p_payload->>'task_id',
    p_payload->>'convId',
    p_payload->>'conv_id',
    ''
  );

  IF EXISTS (
    SELECT 1
    FROM public.user_notifications n
    WHERE n.user_id = p_user_id
      AND n.type = p_type
      AND n.created_at > now() - interval '2 minutes'
      AND coalesce(
        n.payload->>'taskId',
        n.payload->>'task_id',
        n.payload->>'convId',
        n.payload->>'conv_id',
        ''
      ) = dedupe_key
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.user_notifications (user_id, type, title, body, link, payload)
  VALUES (
    p_user_id,
    p_type,
    left(coalesce(p_title, p_type), 160),
    left(coalesce(p_body, ''), 400),
    left(coalesce(p_link, ''), 400),
    coalesce(p_payload, '{}'::jsonb)
  )
  RETURNING notification_id INTO nid;

  INSERT INTO public.notification_queue (user_id, email, type, subject, body_text, payload)
  VALUES (
    p_user_id,
    '',
    p_type,
    left(coalesce(p_subject, p_title, p_type), 200),
    left(coalesce(p_email_body, p_body, ''), 2000),
    coalesce(p_payload, '{}'::jsonb)
  );

  RETURN nid;
END;
$$;

REVOKE ALL ON FUNCTION public.qg_notify_user(text, text, text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qg_notify_user(text, text, text, text, text, text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.qg_notify_application_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  newj jsonb := to_jsonb(NEW);
  oldj jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  poster text;
  title text;
  poster_name text;
  worker text;
  worker_name text;
  offer text;
  task_id_text text;
  link_posted text;
  link_applied text;
  gs text;
  old_gs text;
  new_st text;
  old_st text;
  counter_amt text;
  counter_who text;
  payload jsonb;
BEGIN
  worker := coalesce(newj->>'worker_id', '');
  worker_name := coalesce(nullif(btrim(newj->>'worker_name'), ''), 'A tasker');
  task_id_text := coalesce(newj->>'task_id', '');
  IF newj ? 'price' AND nullif(newj->>'price', '') IS NOT NULL AND (newj->>'price')::numeric > 0 THEN
    offer := trim(to_char((newj->>'price')::numeric, 'FM999999990'));
  ELSE
    offer := '';
  END IF;

  SELECT t.posted_by,
         coalesce(nullif(btrim(t.title), ''), 'a task'),
         coalesce(nullif(btrim(t.poster_name), ''), 'The poster')
    INTO poster, title, poster_name
  FROM public.tasks t
  WHERE t.task_id::text = task_id_text
  LIMIT 1;

  IF poster IS NULL THEN
    RETURN NEW;
  END IF;

  link_posted := 'https://quickgigs.ca/mytasks.html?tab=posted&expand=' || task_id_text;
  link_applied := 'https://quickgigs.ca/mytasks.html?tab=applied&expand=' || task_id_text;
  gs := lower(coalesce(newj->>'guardian_status', 'approved'));
  old_gs := lower(coalesce(oldj->>'guardian_status', ''));
  new_st := lower(coalesce(newj->>'status', 'pending'));
  old_st := lower(coalesce(oldj->>'status', ''));

  payload := jsonb_build_object(
    'taskTitle', title,
    'taskId', task_id_text,
    'workerName', worker_name,
    'posterName', poster_name,
    'offer', offer,
    'link', link_posted
  );

  IF TG_OP = 'INSERT'
     AND new_st = 'pending'
     AND gs IS DISTINCT FROM 'pending_guardian'
     AND poster <> worker THEN
    PERFORM public.qg_notify_user(
      poster,
      'application_received',
      'New application',
      worker_name || ' applied' || CASE WHEN offer <> '' THEN ' · $' || offer ELSE '' END || '. Tap to review.',
      link_posted,
      'New applicant for “' || title || '”',
      worker_name || ' applied to your task “' || title || '”' ||
        CASE WHEN offer <> '' THEN ' with an offer of $' || offer ELSE '' END || '.',
      payload
    );
  END IF;

  IF TG_OP = 'UPDATE'
     AND old_gs = 'pending_guardian'
     AND gs IS DISTINCT FROM 'pending_guardian'
     AND new_st = 'pending'
     AND poster <> worker THEN
    PERFORM public.qg_notify_user(
      poster,
      'application_received',
      'New application',
      worker_name || ' applied' || CASE WHEN offer <> '' THEN ' · $' || offer ELSE '' END || '. Tap to review.',
      link_posted,
      'New applicant for “' || title || '”',
      worker_name || ' applied to your task “' || title || '”' ||
        CASE WHEN offer <> '' THEN ' with an offer of $' || offer ELSE '' END || '.',
      payload
    );
  END IF;

  IF TG_OP = 'UPDATE'
     AND old_st IS DISTINCT FROM 'accepted'
     AND new_st = 'accepted'
     AND worker <> '' THEN
    PERFORM public.qg_notify_user(
      worker,
      'application_accepted',
      'Application accepted',
      poster_name || ' accepted you for “' || title || '”.',
      link_applied,
      'You were hired for “' || title || '”',
      'Great news — ' || poster_name || ' accepted your application for “' || title || '”.',
      payload || jsonb_build_object('link', link_applied)
    );
  END IF;

  IF TG_OP = 'UPDATE'
     AND old_st IN ('pending')
     AND new_st = 'declined'
     AND worker <> '' THEN
    PERFORM public.qg_notify_user(
      worker,
      'application_declined',
      'Application declined',
      'Your application for “' || title || '” was not accepted.',
      'https://quickgigs.ca/browsetask.html',
      'Update on “' || title || '”',
      'Your application for “' || title || '” was not accepted. Browse other gigs on SwiftGigs.',
      payload || jsonb_build_object('link', 'https://quickgigs.ca/browsetask.html')
    );
  END IF;

  IF TG_OP = 'UPDATE'
     AND newj ? 'counter_price'
     AND (newj->>'counter_price') IS DISTINCT FROM (oldj->>'counter_price')
     AND nullif(newj->>'counter_price', '') IS NOT NULL THEN
    counter_amt := trim(to_char((newj->>'counter_price')::numeric, 'FM999999990.00'));
    IF right(counter_amt, 3) = '.00' THEN
      counter_amt := left(counter_amt, length(counter_amt) - 3);
    END IF;
    counter_who := lower(coalesce(newj->>'counter_by', ''));
    IF counter_who IN ('poster', 'task') AND worker <> '' THEN
      PERFORM public.qg_notify_user(
        worker,
        'counter_offer_received',
        'Counter-offer',
        poster_name || ' countered at $' || counter_amt || ' for “' || title || '”.',
        link_applied,
        'Counter offer: $' || counter_amt || ' on “' || title || '”',
        poster_name || ' countered your application at $' || counter_amt || ' for “' || title || '”.',
        payload || jsonb_build_object('amount', counter_amt, 'link', link_applied)
      );
    ELSIF counter_who IN ('worker', 'tasker') AND poster <> '' THEN
      PERFORM public.qg_notify_user(
        poster,
        'counter_offer_reply',
        'Counter-offer reply',
        worker_name || ' countered back at $' || counter_amt || ' on “' || title || '”.',
        link_posted,
        'Counter back: $' || counter_amt || ' on “' || title || '”',
        worker_name || ' countered back at $' || counter_amt || ' on “' || title || '”.',
        payload || jsonb_build_object('amount', counter_amt, 'link', link_posted)
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qg_notify_application ON public.applications;
CREATE TRIGGER trg_qg_notify_application
  AFTER INSERT OR UPDATE ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.qg_notify_application_event();

CREATE OR REPLACE FUNCTION public.qg_notify_message_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  poster text;
  worker text;
  recipient text;
  sender_name text;
  task_title text;
  conv_id_text text;
  task_id_text text;
  preview text;
  link text;
BEGIN
  IF NEW.body IS NULL OR btrim(NEW.body) = '' THEN
    RETURN NEW;
  END IF;
  IF left(btrim(NEW.body), 8) IN ('[system]', '[SYSTEM]')
     OR left(btrim(NEW.body), 7) = '[sys] ' THEN
    RETURN NEW;
  END IF;

  SELECT c.poster_id, c.worker_id,
         coalesce(nullif(btrim(c.task_title), ''), 'a task'),
         c.conv_id::text,
         c.task_id::text,
         CASE
           WHEN NEW.sender_id = c.poster_id THEN coalesce(nullif(btrim(c.poster_name), ''), 'The poster')
           ELSE coalesce(nullif(btrim(c.worker_name), ''), 'A tasker')
         END
    INTO poster, worker, task_title, conv_id_text, task_id_text, sender_name
  FROM public.conversations c
  WHERE c.conv_id = NEW.conv_id
  LIMIT 1;

  IF poster IS NULL THEN
    RETURN NEW;
  END IF;

  recipient := CASE
    WHEN NEW.sender_id = poster THEN worker
    WHEN NEW.sender_id = worker THEN poster
    ELSE NULL
  END;
  IF recipient IS NULL OR recipient = NEW.sender_id THEN
    RETURN NEW;
  END IF;

  preview := CASE
    WHEN left(NEW.body, 5) = '[img]' THEN 'Photo'
    ELSE left(btrim(NEW.body), 80)
  END;
  link := 'https://quickgigs.ca/messages.html?conv=' || conv_id_text;

  PERFORM public.qg_notify_user(
    recipient,
    'new_message',
    'New message',
    sender_name || ': “' || preview || '”',
    link,
    'New message from ' || sender_name,
    sender_name || ' sent you a message about “' || task_title || '”.',
    jsonb_build_object(
      'senderName', sender_name,
      'taskTitle', task_title,
      'taskId', task_id_text,
      'convId', conv_id_text,
      'preview', preview,
      'link', link
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qg_notify_message ON public.messages;
CREATE TRIGGER trg_qg_notify_message
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.qg_notify_message_event();

CREATE OR REPLACE FUNCTION public.qg_notify_task_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  poster text;
  worker text;
  title text;
  task_id_text text;
  link text;
  payload jsonb;
BEGIN
  IF lower(coalesce(OLD.status, '')) = 'completed' THEN
    RETURN NEW;
  END IF;
  IF lower(coalesce(NEW.status, '')) <> 'completed' THEN
    RETURN NEW;
  END IF;

  poster := coalesce(NEW.posted_by, '');
  title := coalesce(nullif(btrim(NEW.title), ''), 'your task');
  task_id_text := NEW.task_id::text;
  link := 'https://quickgigs.ca/mytasks.html?tab=completed';

  SELECT a.worker_id INTO worker
  FROM public.applications a
  WHERE a.task_id = NEW.task_id
    AND lower(coalesce(a.status, '')) IN ('accepted', 'completed')
  ORDER BY a.created_at DESC NULLS LAST
  LIMIT 1;

  payload := jsonb_build_object('taskTitle', title, 'taskId', task_id_text, 'link', link);

  IF poster <> '' THEN
    PERFORM public.qg_notify_user(
      poster,
      'task_completed',
      'Task complete',
      '“' || title || '” is done — leave a review when you can.',
      link,
      'Task complete: “' || title || '”',
      '“' || title || '” was marked complete on SwiftGigs.',
      payload || jsonb_build_object('role', 'poster')
    );
  END IF;

  IF worker IS NOT NULL AND worker <> '' AND worker IS DISTINCT FROM poster THEN
    PERFORM public.qg_notify_user(
      worker,
      'task_completed',
      'Task complete',
      '“' || title || '” is complete — payout is on the way.',
      link,
      'Task complete: “' || title || '”',
      '“' || title || '” was marked complete on SwiftGigs.',
      payload || jsonb_build_object('role', 'worker')
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_qg_notify_task_completed ON public.tasks;
CREATE TRIGGER trg_qg_notify_task_completed
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.qg_notify_task_completed();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'conversations'
      AND column_name = 'is_unlocked'
  ) THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.qg_notify_chat_unlocked()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $body$
      DECLARE
        title text;
        conv_id_text text;
        link text;
        payload jsonb;
      BEGIN
        IF OLD.is_unlocked IS TRUE OR NEW.is_unlocked IS NOT TRUE THEN
          RETURN NEW;
        END IF;
        title := coalesce(nullif(btrim(NEW.task_title), ''), 'your task');
        conv_id_text := NEW.conv_id::text;
        link := 'https://quickgigs.ca/messages.html?conv=' || conv_id_text;
        payload := jsonb_build_object(
          'taskTitle', title,
          'taskId', NEW.task_id::text,
          'convId', conv_id_text,
          'link', link
        );
        IF coalesce(NEW.worker_id, '') <> '' THEN
          PERFORM public.qg_notify_user(
            NEW.worker_id,
            'task_funded',
            'Chat unlocked',
            'Payment secured for “' || title || '”. Chat is unlocked.',
            link,
            'Chat unlocked for “' || title || '”',
            'Payment is secured for “' || title || '”. You can message the other party now.',
            payload
          );
        END IF;
        IF coalesce(NEW.poster_id, '') <> '' THEN
          PERFORM public.qg_notify_user(
            NEW.poster_id,
            'chat_unlocked',
            'Chat unlocked',
            'You can message about “' || title || '” now.',
            link,
            'Chat unlocked for “' || title || '”',
            'You can message about “' || title || '” now.',
            payload
          );
        END IF;
        RETURN NEW;
      END;
      $body$;
    $fn$;

    DROP TRIGGER IF EXISTS trg_qg_notify_chat_unlocked ON public.conversations;
    CREATE TRIGGER trg_qg_notify_chat_unlocked
      AFTER UPDATE OF is_unlocked ON public.conversations
      FOR EACH ROW
      EXECUTE FUNCTION public.qg_notify_chat_unlocked();
  END IF;
END $$;
