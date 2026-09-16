-- QuickGigs — server-side rate limiting + close the direct message-insert path.
--
-- Two related launch blockers:
--
-- 1. RATE LIMITING. Before this, the only throttle in the whole backend was a
--    single resend_too_soon 429 on guardian-consent resend. Client-side throttles
--    do not count: anything the browser enforces can be skipped by calling the
--    API directly. Limits therefore live here, in one atomic SQL function that
--    every edge function shares, so concurrent function instances can't race
--    past a limit each holding its own in-memory counter.
--
-- 2. MESSAGE WRITE PATH. messages_insert_auth let {anon, authenticated} INSERT
--    into public.messages directly whenever the conversation was unlocked. All
--    legitimate client traffic already goes through the secure-messaging edge
--    function (supabase-db.js sendChatMessage → secureMessagingRequest('send')),
--    but the open policy meant the contact/fraud filter in that function was
--    advisory: a crafted request could insert a row and never run it.
--    Escrow gating was never at risk — that is enforced by
--    trg_protect_conversation_unlock plus the is_unlocked check in the policy —
--    but content filtering was fully bypassable.
--
--    The INSERT policy is therefore removed. SELECT is untouched, so reading a
--    conversation still works exactly as before; only writes are funnelled.

-- ── Rate-limit storage ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rate_limits (
  uid          text        NOT NULL,
  action       text        NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (uid, action, window_start)
);

-- RLS on with NO policies: deny-all to anon/authenticated, service-role only.
-- Same deliberate pattern as admins / admin_actions / notification_queue.
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Supports pruning expired buckets.
CREATE INDEX IF NOT EXISTS rate_limits_window_start_idx
  ON public.rate_limits (window_start);

-- ── Atomic check-and-increment ──────────────────────────────────────────────
-- Fixed-window counter. Returns the verdict rather than raising, so callers can
-- choose between a 429 and a soft degrade.
CREATE OR REPLACE FUNCTION public.qg_rate_limit_hit(
  p_uid            text,
  p_action         text,
  p_limit          integer,
  p_window_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bucket       timestamptz;
  current_hits integer;
BEGIN
  IF p_uid IS NULL OR btrim(p_uid) = '' THEN
    -- Fail closed: an unidentified caller cannot be rate limited, so deny.
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_uid');
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_window_seconds IS NULL OR p_window_seconds < 1 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'bad_limit');
  END IF;

  bucket := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.rate_limits AS rl (uid, action, window_start, hits)
  VALUES (btrim(p_uid), p_action, bucket, 1)
  ON CONFLICT (uid, action, window_start)
  DO UPDATE SET hits = rl.hits + 1
  RETURNING rl.hits INTO current_hits;

  RETURN jsonb_build_object(
    'allowed', current_hits <= p_limit,
    'hits',    current_hits,
    'limit',   p_limit,
    'retry_after',
      GREATEST(
        1,
        ceil(extract(epoch FROM (
          bucket + make_interval(secs => p_window_seconds) - now()
        )))
      )
  );
END;
$$;

-- Never callable from the browser; edge functions reach it with the service role.
REVOKE ALL ON FUNCTION public.qg_rate_limit_hit(text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qg_rate_limit_hit(text, text, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.qg_rate_limit_hit(text, text, integer, integer) FROM authenticated;

-- ── Prune helper (safe to call from a cron job) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.qg_rate_limit_prune(p_older_than interval DEFAULT '1 day')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM public.rate_limits WHERE window_start < now() - p_older_than;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.qg_rate_limit_prune(interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qg_rate_limit_prune(interval) FROM anon;
REVOKE ALL ON FUNCTION public.qg_rate_limit_prune(interval) FROM authenticated;

-- ── Reports: rate limit at the data layer ──────────────────────────────────
-- Reports are still inserted straight from the client under RLS (there is no
-- report edge function), so this one has to be a trigger rather than shared
-- middleware. 10 reports per hour per user.
CREATE OR REPLACE FUNCTION public.qg_rate_limit_reports()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_role text := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
  verdict jsonb;
  actor   text;
BEGIN
  -- Service role and direct admin access are exempt, matching
  -- protect_conversation_unlock.
  IF request_role = 'service_role'
     OR CURRENT_USER IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  actor := public.qg_uid();
  IF actor IS NULL OR actor = '' THEN
    RETURN NEW;  -- not signed in; RLS already rejects this insert
  END IF;

  verdict := public.qg_rate_limit_hit(actor, 'create_report', 10, 3600);

  IF (verdict ->> 'allowed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION
      'rate_limited: too many reports, retry in % seconds', verdict ->> 'retry_after'
      USING ERRCODE = '53400';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rate_limit_reports ON public.reports;
CREATE TRIGGER trg_rate_limit_reports
  BEFORE INSERT ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.qg_rate_limit_reports();

-- ── Funnel message writes through secure-messaging ──────────────────────────
DROP POLICY IF EXISTS messages_insert_auth ON public.messages;
