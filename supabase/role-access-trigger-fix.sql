-- QuickGigs — allow only trusted server/admin database roles to manage role fields.
-- Run once after dual-role-accounts.sql if role-access returns
-- role_fields_are_server_managed.

CREATE OR REPLACE FUNCTION public.protect_qg_role_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  request_role TEXT := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::JSONB ->> 'role',
    ''
  );
BEGIN
  IF request_role <> 'service_role'
     AND CURRENT_USER NOT IN ('service_role', 'postgres', 'supabase_admin')
     AND (
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
