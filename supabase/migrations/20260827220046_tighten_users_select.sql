-- QuickGigs — tighten users SELECT to owner/admin; refresh public_user_profiles.
-- Public cards must use public_user_profiles (no email / Stripe IDs / guardian PII).

DROP POLICY IF EXISTS "Anyone can read users" ON public.users;
DROP POLICY IF EXISTS "users_select_auth" ON public.users;
CREATE POLICY "users_select_auth" ON public.users
  FOR SELECT TO anon, authenticated
  USING (
    public.qg_is_signed_in()
    AND (firebase_uid = public.qg_uid() OR public.is_qg_admin())
  );

-- Safe public projection (security_invoker=false so owner RLS does not hide cards).
-- NEVER add: email, phone, date_of_birth, guardian_*, consent_*, stripe_* account IDs.
CREATE OR REPLACE VIEW public.public_user_profiles AS
SELECT
  user_id,
  firebase_uid,
  name,
  avatar_url,
  bio,
  skills,
  availability,
  service_area,
  languages,
  pronouns,
  role,
  status,
  account_status,
  is_tasker,
  is_poster,
  tasker_verified,
  poster_verified,
  rating,
  verified,
  created_at,
  stripe_payouts_enabled,
  guardian_stripe_payouts_enabled,
  payout_owner
FROM public.users;

ALTER VIEW public.public_user_profiles SET (security_invoker = false);

COMMENT ON VIEW public.public_user_profiles IS
  'Non-sensitive user fields for marketplace cards. Full row access remains on public.users (owner/admin only).';

GRANT SELECT ON public.public_user_profiles TO anon, authenticated, service_role;
