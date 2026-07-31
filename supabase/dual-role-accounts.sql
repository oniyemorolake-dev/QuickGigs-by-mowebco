-- QuickGigs — independent Tasker/Poster capabilities and remembered workspace mode.
-- Existing adults retain both capabilities. Teen accounts are Tasker-only until age 18.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_tasker BOOLEAN;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_poster BOOLEAN;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_active_mode TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS roles_updated_at TIMESTAMPTZ;

-- A previous partial run may have installed this function under a different trigger
-- name. Remove every trigger that calls it before the migration-managed backfills.
DO $$
DECLARE
  trigger_record RECORD;
BEGIN
  FOR trigger_record IN
    SELECT trigger_row.tgname
    FROM pg_trigger trigger_row
    JOIN pg_proc function_row ON function_row.oid = trigger_row.tgfoid
    JOIN pg_class table_row ON table_row.oid = trigger_row.tgrelid
    JOIN pg_namespace schema_row ON schema_row.oid = table_row.relnamespace
    WHERE schema_row.nspname = 'public'
      AND table_row.relname = 'users'
      AND function_row.proname = 'protect_qg_role_fields'
      AND NOT trigger_row.tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.users', trigger_record.tgname);
  END LOOP;
END;
$$;

UPDATE public.users
SET is_tasker = TRUE,
    is_poster = TRUE,
    last_active_mode = CASE
      WHEN LOWER(COALESCE(role, '')) = 'worker' THEN 'tasker'
      ELSE 'poster'
    END,
    roles_updated_at = COALESCE(roles_updated_at, NOW())
WHERE is_tasker IS NULL OR is_poster IS NULL OR last_active_mode IS NULL OR roles_updated_at IS NULL;

UPDATE public.users
SET is_tasker = TRUE,
    is_poster = FALSE,
    last_active_mode = 'tasker',
    roles_updated_at = NOW()
WHERE date_of_birth IS NOT NULL
  AND date_of_birth > (CURRENT_DATE - INTERVAL '18 years')::DATE;

ALTER TABLE public.users ALTER COLUMN is_tasker SET DEFAULT TRUE;
ALTER TABLE public.users ALTER COLUMN is_poster SET DEFAULT FALSE;
ALTER TABLE public.users ALTER COLUMN last_active_mode SET DEFAULT 'tasker';
ALTER TABLE public.users ALTER COLUMN roles_updated_at SET DEFAULT NOW();
ALTER TABLE public.users ALTER COLUMN is_tasker SET NOT NULL;
ALTER TABLE public.users ALTER COLUMN is_poster SET NOT NULL;
ALTER TABLE public.users ALTER COLUMN last_active_mode SET NOT NULL;
ALTER TABLE public.users ALTER COLUMN roles_updated_at SET NOT NULL;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_has_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_has_role_check
  CHECK (is_tasker OR is_poster);
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_last_active_mode_check;
ALTER TABLE public.users ADD CONSTRAINT users_last_active_mode_check
  CHECK (
    (last_active_mode = 'tasker' AND is_tasker) OR
    (last_active_mode = 'poster' AND is_poster)
  );

CREATE OR REPLACE FUNCTION public.protect_qg_role_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  request_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF request_role <> 'service_role' AND (
    NEW.is_tasker IS DISTINCT FROM OLD.is_tasker OR
    NEW.is_poster IS DISTINCT FROM OLD.is_poster OR
    NEW.last_active_mode IS DISTINCT FROM OLD.last_active_mode OR
    NEW.roles_updated_at IS DISTINCT FROM OLD.roles_updated_at
  ) THEN
    RAISE EXCEPTION 'role_fields_are_server_managed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_protect_role_fields ON public.users;
CREATE TRIGGER users_protect_role_fields
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_qg_role_fields();

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
BEGIN
  actor_uid := CASE
    WHEN TG_TABLE_NAME = 'tasks' THEN NEW.posted_by
    WHEN TG_TABLE_NAME = 'applications' THEN NEW.worker_id
    ELSE NULL
  END;

  SELECT account_status, status, tasker_verified, poster_verified, is_tasker, is_poster
  INTO actor_status, moderation_status, actor_tasker_verified, actor_poster_verified,
       actor_is_tasker, actor_is_poster
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
  IF TG_TABLE_NAME = 'tasks' AND actor_poster_verified IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'poster_payment_verification_required' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'applications' AND actor_tasker_verified IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'tasker_identity_verification_required' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON COLUMN public.users.is_tasker IS 'Tasker capability enabled through signup choice or explicit opt-in';
COMMENT ON COLUMN public.users.is_poster IS 'Poster capability enabled through signup choice or explicit adult opt-in';
COMMENT ON COLUMN public.users.last_active_mode IS 'Last enabled workspace mode: tasker or poster';
