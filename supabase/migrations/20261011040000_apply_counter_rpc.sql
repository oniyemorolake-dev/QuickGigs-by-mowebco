-- Counters must not PATCH applications from the browser.
-- RLS only lets the poster update a row, so a tasker's accept / counter-back
-- returned "No matching row updated". This RPC runs as definer and checks
-- the actor is the poster or the worker for that application.

CREATE OR REPLACE FUNCTION public.qg_apply_counter(
  p_app_id text,
  p_action text,
  p_amount numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor text := public.qg_uid();
  app public.applications%ROWTYPE;
  poster text;
  action text := lower(btrim(coalesce(p_action, '')));
  amt numeric;
  cby text;
  rnd int;
BEGIN
  IF actor IS NULL OR btrim(actor) = '' THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  IF p_app_id IS NULL OR btrim(p_app_id) = '' THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT * INTO app
  FROM public.applications
  WHERE app_id::text = btrim(p_app_id)
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT t.posted_by INTO poster
  FROM public.tasks t
  WHERE t.task_id = app.task_id
  LIMIT 1;

  IF lower(coalesce(app.status, '')) <> 'pending' THEN
    RAISE EXCEPTION 'not_pending';
  END IF;

  cby := lower(coalesce(app.counter_by, ''));
  rnd := coalesce(app.counter_round, 0);

  IF action = 'send' THEN
    IF poster IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
    END IF;
    amt := round(p_amount);
    IF amt IS NULL OR amt < 20 THEN
      RAISE EXCEPTION 'invalid_amount';
    END IF;
    IF cby = 'poster' THEN
      RAISE EXCEPTION 'counter_pending';
    END IF;
    IF cby = 'worker' THEN
      RAISE EXCEPTION 'respond_to_counter';
    END IF;
    IF rnd >= 1 THEN
      RAISE EXCEPTION 'max_rounds';
    END IF;
    UPDATE public.applications
       SET counter_price = amt,
           counter_by = 'poster',
           counter_round = rnd + 1,
           last_counter_at = now()
     WHERE app_id = app.app_id;
    RETURN jsonb_build_object('success', true, 'action', 'send', 'amount', amt);
  END IF;

  IF action IN ('accept', 'decline', 'counter') AND app.worker_id = actor THEN
    IF cby <> 'poster' OR app.counter_price IS NULL THEN
      RAISE EXCEPTION 'no_counter';
    END IF;
    IF action = 'accept' THEN
      UPDATE public.applications
         SET price = app.counter_price,
             counter_price = NULL,
             counter_by = NULL
       WHERE app_id = app.app_id;
    ELSIF action = 'decline' THEN
      UPDATE public.applications
         SET counter_price = NULL,
             counter_by = NULL
       WHERE app_id = app.app_id;
    ELSE
      amt := round(p_amount);
      IF amt IS NULL OR amt < 20 THEN
        RAISE EXCEPTION 'invalid_amount';
      END IF;
      IF rnd <> 1 THEN
        RAISE EXCEPTION 'max_rounds';
      END IF;
      UPDATE public.applications
         SET counter_price = amt,
             counter_by = 'worker',
             counter_round = rnd + 1,
             last_counter_at = now()
       WHERE app_id = app.app_id;
    END IF;
    RETURN jsonb_build_object('success', true, 'action', action, 'amount', coalesce(amt, app.counter_price));
  END IF;

  IF action IN ('accept', 'decline') AND poster = actor THEN
    IF cby <> 'worker' OR app.counter_price IS NULL THEN
      RAISE EXCEPTION 'no_counter';
    END IF;
    IF action = 'accept' THEN
      UPDATE public.applications
         SET price = app.counter_price,
             counter_price = NULL,
             counter_by = NULL
       WHERE app_id = app.app_id;
    ELSE
      UPDATE public.applications
         SET counter_price = NULL,
             counter_by = NULL
       WHERE app_id = app.app_id;
    END IF;
    RETURN jsonb_build_object('success', true, 'action', action, 'amount', app.counter_price);
  END IF;

  RAISE EXCEPTION 'invalid_action';
END;
$$;

REVOKE ALL ON FUNCTION public.qg_apply_counter(text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qg_apply_counter(text, text, numeric) TO anon, authenticated, service_role;

-- Notices must never roll back a counter / accept / apply write.
CREATE OR REPLACE FUNCTION public.qg_notify_application_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.qg_notify_application_event_inner(TG_OP, to_jsonb(NEW), CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'qg_notify_application_event failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.qg_notify_application_event_inner(
  p_op text,
  newj jsonb,
  oldj jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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
    RETURN;
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

  IF p_op = 'INSERT'
     AND new_st = 'pending'
     AND gs IS DISTINCT FROM 'pending_guardian'
     AND poster <> worker THEN
    PERFORM public.qg_notify_user(
      poster, 'application_received', 'New application',
      worker_name || ' applied' || CASE WHEN offer <> '' THEN ' · $' || offer ELSE '' END || '. Tap to review.',
      link_posted, 'New applicant for ' || title,
      worker_name || ' applied to your task ' || title || '.',
      payload
    );
  ELSIF p_op = 'UPDATE'
     AND old_gs = 'pending_guardian'
     AND gs IS DISTINCT FROM 'pending_guardian'
     AND new_st = 'pending'
     AND poster <> worker THEN
    PERFORM public.qg_notify_user(
      poster, 'application_received', 'New application',
      worker_name || ' applied' || CASE WHEN offer <> '' THEN ' · $' || offer ELSE '' END || '. Tap to review.',
      link_posted, 'New applicant for ' || title,
      worker_name || ' applied to your task ' || title || '.',
      payload
    );
  END IF;

  IF p_op = 'UPDATE' AND old_st IS DISTINCT FROM 'accepted' AND new_st = 'accepted' AND worker <> '' THEN
    PERFORM public.qg_notify_user(
      worker, 'application_accepted', 'Application accepted',
      poster_name || ' accepted you for ' || title || '.',
      link_applied, 'You were hired for ' || title,
      'Great news — ' || poster_name || ' accepted your application for ' || title || '.',
      payload || jsonb_build_object('link', link_applied)
    );
  END IF;

  IF p_op = 'UPDATE' AND old_st = 'pending' AND new_st = 'declined' AND worker <> '' THEN
    PERFORM public.qg_notify_user(
      worker, 'application_declined', 'Application declined',
      'Your application for ' || title || ' was not accepted.',
      'https://quickgigs.ca/browsetask.html', 'Update on ' || title,
      'Your application for ' || title || ' was not accepted.',
      payload || jsonb_build_object('link', 'https://quickgigs.ca/browsetask.html')
    );
  END IF;

  IF p_op = 'UPDATE'
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
        worker, 'counter_offer_received', 'Counter-offer',
        poster_name || ' countered at $' || counter_amt || ' for ' || title || '.',
        link_applied, 'Counter offer: $' || counter_amt || ' on ' || title,
        poster_name || ' countered your application at $' || counter_amt || '.',
        payload || jsonb_build_object('amount', counter_amt, 'link', link_applied)
      );
    ELSIF counter_who IN ('worker', 'tasker') AND poster <> '' THEN
      PERFORM public.qg_notify_user(
        poster, 'counter_offer_reply', 'Counter-offer reply',
        worker_name || ' countered back at $' || counter_amt || ' on ' || title || '.',
        link_posted, 'Counter back: $' || counter_amt || ' on ' || title,
        worker_name || ' countered back at $' || counter_amt || '.',
        payload || jsonb_build_object('amount', counter_amt, 'link', link_posted)
      );
    END IF;
  END IF;
END;
$$;
