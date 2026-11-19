-- Domain move: links in notification and alert functions point at swiftgigs.ca.
-- Email addresses on quickgigs.ca are left as they are. Old links keep working
-- because quickgigs.ca forwards to the same page on swiftgigs.ca.
do $do$
declare r record; src text; fixed text;
begin
  for r in select p.oid from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('qg_admin_alert_check','qg_notify_application_event','qg_notify_chat_unlocked',
                                'qg_notify_message_event','qg_notify_task_completed')
  loop
    src := pg_get_functiondef(r.oid);
    fixed := regexp_replace(src, '(https?://)(www\.)?quickgigs\.ca', '\1swiftgigs.ca', 'g');
    if fixed <> src then execute fixed; end if;
  end loop;
end $do$;
