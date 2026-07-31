-- QuickGigs — soft-launch verification (email + phone for taskers; Stripe PM for posters).
-- Run AFTER verification-gates.sql and dual-role-accounts.sql.
-- Browse/profile stay open. Gates apply only when acting (apply/accept/publish).

-- ── Contact verification (soft launch tasker gate) ──
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_e164 TEXT;

-- Future hooks (off by default) — do not enforce for email-only launch
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_verification_required BOOLEAN NOT NULL DEFAULT FALSE;

-- Future hard ID-check hook (Stripe Identity etc.) — not required for soft launch.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tasker_id_check_status TEXT NOT NULL DEFAULT 'not_started';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tasker_id_check_required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tasker_id_checked_at TIMESTAMPTZ;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_tasker_id_check_status_check;
ALTER TABLE public.users ADD CONSTRAINT users_tasker_id_check_status_check
  CHECK (tasker_id_check_status IN ('not_started', 'pending', 'verified', 'rejected'));

COMMENT ON COLUMN public.users.tasker_verified IS
  'Launch: true when email_verified. Optional hooks: phone_verification_required, tasker_id_check_required.';
COMMENT ON COLUMN public.users.tasker_id_check_status IS
  'Hook for future government-ID / selfie check (e.g. Stripe Identity). Soft launch does not require this.';
COMMENT ON COLUMN public.users.tasker_id_check_required IS
  'Policy switch: when true, apply/accept also requires tasker_id_check_status=verified.';

-- Phone OTP challenge table (server-managed)
CREATE TABLE IF NOT EXISTS public.phone_verification_challenges (
  firebase_uid TEXT PRIMARY KEY,
  phone_e164 TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.phone_verification_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.phone_verification_challenges FROM anon, authenticated;
GRANT ALL ON TABLE public.phone_verification_challenges TO service_role;

-- Category catalog + vulnerable-people flag (stricter check later)
CREATE TABLE IF NOT EXISTS public.task_categories (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  requires_enhanced_verification BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO public.task_categories (id, label, requires_enhanced_verification) VALUES
  ('errands', 'Errands', FALSE),
  ('home', 'Home', FALSE),
  ('tutoring', 'Tutoring', FALSE),
  ('beauty', 'Beauty', FALSE),
  ('moving', 'Moving', FALSE),
  ('cooking', 'Cooking', FALSE),
  ('tech', 'Tech', FALSE),
  ('care', 'Care', TRUE),
  ('gardening', 'Garden', FALSE),
  ('events', 'Events', FALSE),
  ('trades', 'Trades', FALSE),
  ('other', 'Other', FALSE)
ON CONFLICT (id) DO UPDATE
SET label = EXCLUDED.label,
    requires_enhanced_verification = EXCLUDED.requires_enhanced_verification;

ALTER TABLE public.task_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_categories_public_read ON public.task_categories;
CREATE POLICY task_categories_public_read
  ON public.task_categories
  FOR SELECT
  TO anon, authenticated
  USING (active IS TRUE);

REVOKE INSERT, UPDATE, DELETE ON TABLE public.task_categories FROM anon, authenticated;
GRANT SELECT ON TABLE public.task_categories TO anon, authenticated;
GRANT ALL ON TABLE public.task_categories TO service_role;

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS requires_enhanced_verification BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.task_categories.requires_enhanced_verification IS
  'Categories involving being alone with vulnerable people (childcare, in-home care). Soft launch flags only; hard launch can require ID check.';
COMMENT ON COLUMN public.tasks.requires_enhanced_verification IS
  'Copied from category at publish time so future gates can require stricter tasker ID checks.';

-- Protect contact + ID-check fields (same server-managed pattern)
CREATE OR REPLACE FUNCTION public.protect_qg_verification_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  db_role TEXT := CURRENT_USER;
BEGIN
  -- Trusted DB roles (Edge Functions / migrations) may update.
  IF request_role = 'service_role'
     OR db_role IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF (
    NEW.tasker_verified IS DISTINCT FROM OLD.tasker_verified OR
    NEW.tasker_verified_at IS DISTINCT FROM OLD.tasker_verified_at OR
    NEW.tasker_verification_status IS DISTINCT FROM OLD.tasker_verification_status OR
    NEW.tasker_identity_session_id IS DISTINCT FROM OLD.tasker_identity_session_id OR
    NEW.tasker_background_check_status IS DISTINCT FROM OLD.tasker_background_check_status OR
    NEW.tasker_background_checked_at IS DISTINCT FROM OLD.tasker_background_checked_at OR
    NEW.tasker_id_check_status IS DISTINCT FROM OLD.tasker_id_check_status OR
    NEW.tasker_id_check_required IS DISTINCT FROM OLD.tasker_id_check_required OR
    NEW.tasker_id_checked_at IS DISTINCT FROM OLD.tasker_id_checked_at OR
    NEW.email_verified IS DISTINCT FROM OLD.email_verified OR
    NEW.email_verified_at IS DISTINCT FROM OLD.email_verified_at OR
    NEW.phone_verified IS DISTINCT FROM OLD.phone_verified OR
    NEW.phone_verified_at IS DISTINCT FROM OLD.phone_verified_at OR
    NEW.phone_e164 IS DISTINCT FROM OLD.phone_e164 OR
    NEW.phone_verification_required IS DISTINCT FROM OLD.phone_verification_required OR
    NEW.poster_verified IS DISTINCT FROM OLD.poster_verified OR
    NEW.poster_verified_at IS DISTINCT FROM OLD.poster_verified_at OR
    NEW.poster_verification_status IS DISTINCT FROM OLD.poster_verification_status OR
    NEW.poster_stripe_customer_id IS DISTINCT FROM OLD.poster_stripe_customer_id OR
    NEW.poster_payment_method_id IS DISTINCT FROM OLD.poster_payment_method_id
  ) THEN
    RAISE EXCEPTION 'verification_fields_are_server_managed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_protect_verification_fields ON public.users;
CREATE TRIGGER users_protect_verification_fields
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_qg_verification_fields();

-- Recompute launch tasker_verified from email (+ optional future phone / ID hooks)
CREATE OR REPLACE FUNCTION public.qg_recompute_tasker_verified(p_uid TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u RECORD;
  ok BOOLEAN;
BEGIN
  SELECT email_verified,
         phone_verified,
         COALESCE(phone_verification_required, FALSE) AS phone_verification_required,
         COALESCE(tasker_id_check_required, FALSE) AS tasker_id_check_required,
         COALESCE(tasker_id_check_status, 'not_started') AS tasker_id_check_status
  INTO u
  FROM public.users
  WHERE firebase_uid = p_uid
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  ok := (u.email_verified IS TRUE);
  IF u.phone_verification_required IS TRUE THEN
    ok := ok AND (u.phone_verified IS TRUE);
  END IF;
  IF u.tasker_id_check_required IS TRUE THEN
    ok := ok AND (u.tasker_id_check_status = 'verified');
  END IF;

  UPDATE public.users
  SET tasker_verified = ok,
      tasker_verified_at = CASE WHEN ok THEN COALESCE(tasker_verified_at, NOW()) ELSE NULL END,
      tasker_verification_status = CASE WHEN ok THEN 'verified' ELSE 'unverified' END
  WHERE firebase_uid = p_uid;

  RETURN ok;
END;
$$;

REVOKE ALL ON FUNCTION public.qg_recompute_tasker_verified(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qg_recompute_tasker_verified(TEXT) TO service_role;

-- Reopening / promoting a draft to open still requires poster payment verification
-- (protect_qg_transaction_ownership — fixed below for multi-table NEW typing).

-- Shared trigger functions cannot reference table-specific columns directly:
-- when fired on tasks, NEW has no worker_id (and vice versa). Use jsonb.
CREATE OR REPLACE FUNCTION public.protect_qg_transaction_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  poster_is_verified BOOLEAN;
  new_j JSONB := to_jsonb(NEW);
  old_j JSONB := to_jsonb(OLD);
BEGIN
  IF TG_TABLE_NAME = 'applications' THEN
    IF (new_j->>'worker_id') IS DISTINCT FROM (old_j->>'worker_id')
       OR (new_j->>'task_id') IS DISTINCT FROM (old_j->>'task_id') THEN
      RAISE EXCEPTION 'application_identity_is_immutable' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'tasks' THEN
    IF (new_j->>'posted_by') IS DISTINCT FROM (old_j->>'posted_by') THEN
      RAISE EXCEPTION 'task_owner_is_immutable' USING ERRCODE = '42501';
    END IF;
    IF LOWER(COALESCE(new_j->>'status', '')) = 'open'
       AND LOWER(COALESCE(old_j->>'status', '')) <> 'open' THEN
      SELECT poster_verified INTO poster_is_verified
      FROM public.users
      WHERE firebase_uid = new_j->>'posted_by'
      LIMIT 1;
      IF poster_is_verified IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'poster_payment_verification_required' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Same jsonb pattern for require_active_qg_actor actor_uid lookup (safe on both tables)
CREATE OR REPLACE FUNCTION public.require_active_qg_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_uid TEXT;
  actor_status TEXT;
  moderation_status TEXT;
  actor_tasker_verified BOOLEAN;
  actor_poster_verified BOOLEAN;
  actor_is_tasker BOOLEAN;
  actor_is_poster BOOLEAN;
  actor_id_required BOOLEAN;
  actor_id_status TEXT;
  task_status TEXT;
  new_j JSONB := to_jsonb(NEW);
BEGIN
  actor_uid := CASE TG_TABLE_NAME
    WHEN 'tasks' THEN new_j->>'posted_by'
    WHEN 'applications' THEN new_j->>'worker_id'
    ELSE NULL
  END;

  SELECT account_status, status, tasker_verified, poster_verified, is_tasker, is_poster,
         COALESCE(tasker_id_check_required, FALSE), COALESCE(tasker_id_check_status, 'not_started')
  INTO actor_status, moderation_status, actor_tasker_verified, actor_poster_verified,
       actor_is_tasker, actor_is_poster, actor_id_required, actor_id_status
  FROM public.users
  WHERE firebase_uid = actor_uid
  LIMIT 1;

  IF actor_status IS DISTINCT FROM 'active' OR
     LOWER(COALESCE(moderation_status, 'active')) IN ('banned', 'blocked', 'suspended') THEN
    RAISE EXCEPTION 'account_not_active' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'tasks' AND actor_is_poster IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'poster_role_required' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'applications' AND actor_is_tasker IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'tasker_role_required' USING ERRCODE = '42501';
  END IF;

  IF TG_TABLE_NAME = 'tasks' THEN
    task_status := LOWER(COALESCE(new_j->>'status', 'open'));
    IF task_status <> 'draft' AND actor_poster_verified IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'poster_payment_verification_required' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'applications' THEN
    IF actor_tasker_verified IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'tasker_identity_verification_required' USING ERRCODE = '42501';
    END IF;
    IF actor_id_required IS TRUE AND actor_id_status IS DISTINCT FROM 'verified' THEN
      RAISE EXCEPTION 'tasker_id_check_required' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Backfill enhanced flag on existing care tasks
UPDATE public.tasks t
SET requires_enhanced_verification = TRUE
WHERE LOWER(COALESCE(t.category, '')) IN ('care', 'childcare', 'eldercare', 'in-home-care', 'inhome')
  AND requires_enhanced_verification IS DISTINCT FROM TRUE;
