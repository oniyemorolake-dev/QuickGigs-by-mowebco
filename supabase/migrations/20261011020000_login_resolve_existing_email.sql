-- When a returning user signs in with Google (new Firebase uid) or the
-- client lookup races the JWT, treat a verified-email match as the same
-- account instead of sending them through signup again.

CREATE OR REPLACE FUNCTION public.qg_login_resolve()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  uid text := public.qg_uid();
  jwt_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  jwt_verified boolean := coalesce((auth.jwt() ->> 'email_verified')::boolean, false);
  rec public.users;
BEGIN
  IF uid IS NULL OR uid = '' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO rec
  FROM public.users
  WHERE firebase_uid = uid
  LIMIT 1;

  IF rec.user_id IS NULL AND jwt_verified AND jwt_email <> '' THEN
    SELECT * INTO rec
    FROM public.users
    WHERE lower(email) = jwt_email
    ORDER BY created_at ASC NULLS LAST
    LIMIT 1;

    IF rec.user_id IS NOT NULL
       AND rec.firebase_uid IS DISTINCT FROM uid
       AND NOT EXISTS (
         SELECT 1 FROM public.users u2 WHERE u2.firebase_uid = uid
       ) THEN
      UPDATE public.users
         SET firebase_uid = uid
       WHERE user_id = rec.user_id;
      rec.firebase_uid := uid;
    END IF;
  END IF;

  IF rec.user_id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'firebase_uid', rec.firebase_uid,
    'status', rec.status,
    'date_of_birth', rec.date_of_birth,
    'role', rec.role,
    'is_tasker', rec.is_tasker,
    'is_poster', rec.is_poster,
    'last_active_mode', rec.last_active_mode,
    'account_status', rec.account_status,
    'guardian_consent_status', rec.guardian_consent_status,
    'guardian_email', rec.guardian_email,
    'guardian_consent_token', rec.guardian_consent_token,
    'graduated_at', rec.graduated_at,
    'payout_owner', rec.payout_owner,
    'stripe_payouts_enabled', rec.stripe_payouts_enabled,
    'tasker_verified', rec.tasker_verified,
    'tasker_verification_status', rec.tasker_verification_status,
    'poster_verified', rec.poster_verified,
    'poster_verification_status', rec.poster_verification_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.qg_login_resolve() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qg_login_resolve() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.qg_login_resolve() IS
  'Login gate: own users row by Firebase uid, or verified JWT email. Relinks firebase_uid when Google signs in an existing email.';
