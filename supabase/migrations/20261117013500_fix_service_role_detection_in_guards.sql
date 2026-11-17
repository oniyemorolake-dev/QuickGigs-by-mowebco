-- Three guard triggers only read the legacy `request.jwt.claim.role` setting,
-- which the API no longer fills in. They therefore treated the server itself
-- as an ordinary user and silently blocked it from changing protected fields:
-- admin ban / warn / unban, parent approval of teen accounts, verification.
-- They now read the role the same way the other guards already do.
do $do$
declare r record; src text; fixed text;
begin
  for r in select p.oid, p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('protect_qg_account_security_fields','protect_qg_application_guardian_fields','protect_qg_verification_fields')
  loop
    src := pg_get_functiondef(r.oid);
    fixed := replace(src,
      $a$request_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');$a$,
      $b$request_role TEXT := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::JSONB ->> 'role',
    -- no request context at all = trusted server-side SQL (scheduler, migrations)
    CASE WHEN NULLIF(current_setting('request.jwt.claims', true), '') IS NULL THEN 'service_role' ELSE '' END,
    '');$b$);
    if fixed <> src then execute fixed; end if;
  end loop;
end $do$;
