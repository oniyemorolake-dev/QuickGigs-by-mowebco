-- Applied live 13 Nov 2026.
-- 1. error_log + qg_log_client_error(): failed server calls for Admin > Launch control.
-- 2. Queued notification emails were never sent (no scheduler, empty vault).
--    A vault secret generated in-database signs calls from pg_cron to the
--    send-notification function, which verifies it via qg_check_notification_secret().

create table if not exists public.error_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id text,
  fn text not null,
  status integer,
  code text,
  message text,
  page text
);
alter table public.error_log enable row level security;
revoke all on public.error_log from anon, authenticated;
grant select on public.error_log to anon, authenticated;
drop policy if exists error_log_admin_select on public.error_log;
create policy error_log_admin_select on public.error_log
  for select to anon, authenticated
  using (public.qg_is_signed_in() and public.is_qg_admin());
create index if not exists error_log_created_idx on public.error_log (created_at desc);

create or replace function public.qg_log_client_error(
  p_fn text, p_status integer, p_code text, p_message text, p_page text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid text := public.qg_uid();
  recent integer;
begin
  if coalesce(btrim(p_fn), '') = '' then return; end if;
  select count(*) into recent from public.error_log
   where created_at > now() - interval '1 minute'
     and user_id is not distinct from uid;
  if recent >= 10 then return; end if;
  select count(*) into recent from public.error_log
   where created_at > now() - interval '1 minute';
  if recent >= 60 then return; end if;

  insert into public.error_log (user_id, fn, status, code, message, page)
  values (uid, left(btrim(p_fn), 60), p_status, left(coalesce(p_code, ''), 80),
          left(coalesce(p_message, ''), 300), left(coalesce(p_page, ''), 60));

  if random() < 0.02 then
    delete from public.error_log where created_at < now() - interval '14 days';
  end if;
end;
$function$;
revoke all on function public.qg_log_client_error(text, integer, text, text, text) from public;
grant execute on function public.qg_log_client_error(text, integer, text, text, text) to anon, authenticated;

alter table public.notification_queue add column if not exists attempted_at timestamptz;

update public.notification_queue
   set error_message = 'expired_before_sender_existed'
 where sent_at is null and error_message is null
   and created_at < now() - interval '1 day';

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'notification_send_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'notification_send_secret',
      'Lets the database ask send-notification to deliver queued emails'
    );
  end if;
end $$;

create or replace function public.qg_check_notification_secret(p text)
returns boolean
language sql
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from vault.decrypted_secrets s
     where s.name = 'notification_send_secret'
       and length(coalesce(p, '')) >= 32
       and s.decrypted_secret = p
  );
$function$;
revoke all on function public.qg_check_notification_secret(text) from public, anon, authenticated;
grant execute on function public.qg_check_notification_secret(text) to service_role;

create or replace function public.qg_drain_notification_queue()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  secret text;
  r record;
  n integer := 0;
begin
  select decrypted_secret into secret
    from vault.decrypted_secrets where name = 'notification_send_secret' limit 1;
  if secret is null then return 0; end if;

  for r in
    select notification_id
      from public.notification_queue
     where sent_at is null
       and error_message is null
       and created_at > now() - interval '1 day'
       and (attempted_at is null or attempted_at < now() - interval '10 minutes')
     order by created_at
     limit 20
  loop
    update public.notification_queue set attempted_at = now()
     where notification_id = r.notification_id;
    perform net.http_post(
      url := 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/send-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-qg-notification-secret', secret
      ),
      body := jsonb_build_object('notification_id', r.notification_id)
    );
    n := n + 1;
  end loop;
  return n;
end;
$function$;
revoke all on function public.qg_drain_notification_queue() from public, anon, authenticated;
grant execute on function public.qg_drain_notification_queue() to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'swiftgigs-send-queued-emails';
select cron.schedule('swiftgigs-send-queued-emails', '* * * * *', $$select public.qg_drain_notification_queue();$$);
