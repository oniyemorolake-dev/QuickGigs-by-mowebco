-- QuickGigs — live teen job monitoring (guardian visibility during active jobs).
-- Run in Supabase SQL Editor after teen-task-approvals.sql.
-- Location is shared with the linked guardian only while status = 'active'.

CREATE TABLE IF NOT EXISTS public.teen_job_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id TEXT NOT NULL,
  teen_uid TEXT NOT NULL,
  guardian_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  check_in_state TEXT NOT NULL DEFAULT 'ok',
  last_check_in_at TIMESTAMPTZ,
  next_check_in_due_at TIMESTAMPTZ,
  last_stamp TEXT,
  last_stamp_at TIMESTAMPTZ,
  last_lat DOUBLE PRECISION,
  last_lng DOUBLE PRECISION,
  last_location_at TIMESTAMPTZ,
  location_share_active BOOLEAN NOT NULL DEFAULT true,
  home_distance_km NUMERIC(7,2),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  end_reason TEXT,
  alert_count INT NOT NULL DEFAULT 0,
  last_alert_at TIMESTAMPTZ,
  last_alert_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teen_job_sessions_status_check
    CHECK (status IN ('active', 'ended_by_guardian', 'ended_complete', 'ended_cancelled')),
  CONSTRAINT teen_job_sessions_check_in_state_check
    CHECK (check_in_state IN ('ok', 'awaiting', 'overdue', 'need_help', 'safety_alert'))
);

CREATE UNIQUE INDEX IF NOT EXISTS teen_job_sessions_active_uniq
  ON public.teen_job_sessions (task_id, teen_uid)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS teen_job_sessions_guardian_active_idx
  ON public.teen_job_sessions (lower(guardian_email), status);

CREATE INDEX IF NOT EXISTS teen_job_sessions_due_idx
  ON public.teen_job_sessions (next_check_in_due_at)
  WHERE status = 'active';

ALTER TABLE public.teen_job_sessions ENABLE ROW LEVEL SECURITY;

-- No direct anon/authenticated client access — service_role edge functions only.
DROP POLICY IF EXISTS "teen_job_sessions_deny_all" ON public.teen_job_sessions;
CREATE POLICY "teen_job_sessions_deny_all" ON public.teen_job_sessions
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE public.teen_job_sessions IS
  'Active-job safety sessions for under-18 taskers. Guardian reads via guardian JWT + service role.';
