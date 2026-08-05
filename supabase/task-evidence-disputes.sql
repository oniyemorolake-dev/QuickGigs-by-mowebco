-- QuickGigs — task evidence stamps + dispute freeze/resolve
-- Apply in Supabase SQL Editor after payments.sql / reports-blocks-disputes.sql

-- ── Task lifecycle helpers ──────────────────────────────────────
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS worker_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS poster_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evidence_frozen BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.tasks.worker_completed_at IS
  'Server time when tasker stamped completed (auto-release timer starts).';
COMMENT ON COLUMN public.tasks.poster_confirmed_at IS
  'Server time when poster confirmed completion / mark complete.';
COMMENT ON COLUMN public.tasks.evidence_frozen IS
  'True while an open dispute freezes escrow auto-rules.';

-- ── Status stamps (timestamped tasker check-ins) ───────────────
CREATE TABLE IF NOT EXISTS public.task_status_stamps (
  stamp_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  stamp_type TEXT NOT NULL
    CHECK (stamp_type IN ('on_my_way', 'arrived', 'started', 'completed')),
  stamped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  distance_m DOUBLE PRECISION,
  location_status TEXT NOT NULL DEFAULT 'none'
    CHECK (location_status IN ('ok', 'unavailable', 'denied', 'none')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, worker_id, stamp_type)
);

CREATE INDEX IF NOT EXISTS idx_task_status_stamps_task
  ON public.task_status_stamps (task_id, stamped_at);

-- ── Evidence photos (before/after/progress) ────────────────────
CREATE TABLE IF NOT EXISTS public.task_evidence_photos (
  photo_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'progress'
    CHECK (kind IN ('before', 'after', 'progress')),
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_evidence_photos_task
  ON public.task_evidence_photos (task_id, created_at DESC);

-- ── Disputes: resolution + money outcome ───────────────────────
ALTER TABLE public.disputes
  ADD COLUMN IF NOT EXISTS against_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_id UUID,
  ADD COLUMN IF NOT EXISTS resolution TEXT,
  ADD COLUMN IF NOT EXISTS resolved_by TEXT,
  ADD COLUMN IF NOT EXISTS resolution_reason TEXT,
  ADD COLUMN IF NOT EXISTS release_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'disputes_resolution_check'
  ) THEN
    ALTER TABLE public.disputes
      ADD CONSTRAINT disputes_resolution_check
      CHECK (
        resolution IS NULL
        OR resolution IN ('release', 'refund', 'split')
      );
  END IF;
END $$;

-- ── Payments: disputed status (no CHECK today — document allowed values) ──
COMMENT ON COLUMN public.payments.status IS
  'pending | held | disputed | paid | completed | refunded | failed';

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS dispute_id UUID;

CREATE INDEX IF NOT EXISTS idx_payments_dispute
  ON public.payments (dispute_id)
  WHERE dispute_id IS NOT NULL;

-- ── RLS: evidence visible only to poster, tasker, or via service role ──
ALTER TABLE public.task_status_stamps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_evidence_photos ENABLE ROW LEVEL SECURITY;

-- Prefer Edge Functions (service role) for writes. Client SELECT via JWT sub
-- when Firebase→Supabase is linked; otherwise service-role reads only.

DROP POLICY IF EXISTS "task_stamps_party_select" ON public.task_status_stamps;
CREATE POLICY "task_stamps_party_select" ON public.task_status_stamps
  FOR SELECT USING (
    worker_id = COALESCE(auth.jwt() ->> 'sub', '')
    OR EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.task_id::text = task_status_stamps.task_id
        AND t.posted_by = COALESCE(auth.jwt() ->> 'sub', '')
    )
    OR EXISTS (
      SELECT 1 FROM public.admins a
      WHERE a.user_id = COALESCE(auth.jwt() ->> 'sub', '')
    )
  );

DROP POLICY IF EXISTS "task_evidence_photos_party_select" ON public.task_evidence_photos;
CREATE POLICY "task_evidence_photos_party_select" ON public.task_evidence_photos
  FOR SELECT USING (
    uploaded_by = COALESCE(auth.jwt() ->> 'sub', '')
    OR EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.task_id::text = task_evidence_photos.task_id
        AND t.posted_by = COALESCE(auth.jwt() ->> 'sub', '')
    )
    OR EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.task_id::text = task_evidence_photos.task_id
        AND a.worker_id = COALESCE(auth.jwt() ->> 'sub', '')
        AND LOWER(COALESCE(a.status, '')) IN ('accepted', 'completed')
    )
    OR EXISTS (
      SELECT 1 FROM public.admins ad
      WHERE ad.user_id = COALESCE(auth.jwt() ->> 'sub', '')
    )
  );

-- Disputes: parties on the task can read (not only raised_by)
DROP POLICY IF EXISTS "read own disputes" ON public.disputes;
DROP POLICY IF EXISTS "disputes_party_select" ON public.disputes;
CREATE POLICY "disputes_party_select" ON public.disputes
  FOR SELECT USING (
    raised_by = COALESCE(auth.jwt() ->> 'sub', '')
    OR against_id = COALESCE(auth.jwt() ->> 'sub', '')
    OR EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.task_id::text = disputes.task_id
        AND t.posted_by = COALESCE(auth.jwt() ->> 'sub', '')
    )
    OR EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.task_id::text = disputes.task_id
        AND a.worker_id = COALESCE(auth.jwt() ->> 'sub', '')
        AND LOWER(COALESCE(a.status, '')) IN ('accepted', 'completed')
    )
    OR EXISTS (
      SELECT 1 FROM public.admins ad
      WHERE ad.user_id = COALESCE(auth.jwt() ->> 'sub', '')
    )
  );

-- Keep insert own disputes for JWT clients; Edge Function uses service role.
DROP POLICY IF EXISTS "raise own disputes" ON public.disputes;
CREATE POLICY "raise own disputes" ON public.disputes
  FOR INSERT WITH CHECK (raised_by = COALESCE(auth.jwt() ->> 'sub', ''));

GRANT SELECT ON public.task_status_stamps TO anon, authenticated;
GRANT SELECT ON public.task_evidence_photos TO anon, authenticated;
-- Writes go through Edge Functions (service role).
