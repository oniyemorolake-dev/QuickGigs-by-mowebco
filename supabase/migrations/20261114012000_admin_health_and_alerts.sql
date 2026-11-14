-- Admin health view + automatic alert emails.
-- qg_admin_health(): everything Launch control needs to say "is anything broken".
-- qg_admin_alert_check(): runs every 10 minutes and emails admins when something is.

create or replace function public.qg_admin_health()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  out jsonb;
begin
  if not public.is_qg_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'checked_at', now(),
    'errors', coalesce((
      select jsonb_agg(e order by e.created_at desc)
      from (
        select l.id, l.created_at, l.fn, l.status, l.code, l.message, l.page, l.user_id,
               u.name as user_name
        from public.error_log l
        left join public.users u on u.firebase_uid = l.user_id
        where l.created_at > now() - interval '7 days'
        order by l.created_at desc
        limit 1500
      ) e), '[]'::jsonb),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
        'last_status', r.status, 'last_run', r.start_time,
        'last_message', left(coalesce(r.return_message, ''), 200)))
      from cron.job j
      left join lateral (
        select d.status, d.start_time, d.return_message
        from cron.job_run_details d where d.jobid = j.jobid
        order by d.start_time desc limit 1
      ) r on true), '[]'::jsonb),
    'emails', jsonb_build_object(
      'waiting', (select count(*) from public.notification_queue
                   where sent_at is null and error_message is null),
      'oldest_waiting', (select min(created_at) from public.notification_queue
                          where sent_at is null and error_message is null),
      'failed_3d', (select count(*) from public.notification_queue
                     where error_message is not null and sent_at is null
                       and created_at > now() - interval '3 days'),
      'sent_24h', (select count(*) from public.notification_queue
                    where sent_at > now() - interval '24 hours')),
    'money', jsonb_build_object(
      'held', (select count(*) from public.payments where status = 'held'),
      'unpaid_after_complete', (
        select count(*) from public.payments p
        join public.tasks t on t.task_id::text = p.task_id::text
        where p.status = 'held' and t.status = 'completed'
          and coalesce(t.poster_confirmed_at, p.created_at) < now() - interval '1 hour')),
    'activity', jsonb_build_object(
      'signups_24h', (select count(*) from public.users where created_at > now() - interval '24 hours'),
      'gigs_24h', (select count(*) from public.tasks where created_at > now() - interval '24 hours'),
      'applications_24h', (select count(*) from public.applications where created_at > now() - interval '24 hours'))
  ) into out;
  return out;
end;
$$;

revoke all on function public.qg_admin_health() from public;
grant execute on function public.qg_admin_health() to anon, authenticated;

create or replace function public.qg_admin_alert_check()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  problems text[] := '{}';
  n integer;
  people integer;
  body text;
  queued integer := 0;
begin
  -- One alert email an hour at most.
  if exists (select 1 from public.notification_queue
              where type = 'admin_alert' and created_at > now() - interval '1 hour') then
    return 0;
  end if;

  select count(*) into n from public.error_log
   where created_at > now() - interval '10 minutes' and status >= 500;
  if n >= 3 then
    problems := problems || format('%s server errors in the last 10 minutes', n);
  end if;

  select count(*), count(distinct user_id) into n, people from public.error_log
   where created_at > now() - interval '10 minutes'
     and (status = 0 or code = 'timeout' or fn = 'page-error');
  if n >= 6 and people >= 3 then
    problems := problems || format('%s people hit loading or page errors in the last 10 minutes (%s errors)', people, n);
  end if;

  select count(*) into n from public.notification_queue
   where sent_at is null and error_message is null
     and type <> 'admin_alert' and created_at < now() - interval '10 minutes';
  if n > 0 then
    problems := problems || format('%s emails have been waiting over 10 minutes to send', n);
  end if;

  select count(*) into n from public.notification_queue
   where error_message is not null and sent_at is null
     and coalesce(attempted_at, created_at) > now() - interval '10 minutes';
  if n > 0 then
    problems := problems || format('%s emails failed to send', n);
  end if;

  select count(*) into n from public.payments p
    join public.tasks t on t.task_id::text = p.task_id::text
   where p.status = 'held' and t.status = 'completed'
     and coalesce(t.poster_confirmed_at, p.created_at) < now() - interval '1 hour'
     -- only while it is newly stuck, so one old payment does not email every hour
     and coalesce(t.poster_confirmed_at, p.created_at) > now() - interval '2 hours 15 minutes';
  if n > 0 then
    problems := problems || format('%s finished gigs where the tasker has not been paid after an hour', n);
  end if;

  if coalesce(array_length(problems, 1), 0) = 0 then
    return 0;
  end if;

  body := 'SwiftGigs needs a look:' || E'\n\n- ' || array_to_string(problems, E'\n- ')
       || E'\n\nOpen Launch control: https://quickgigs.ca/admin.html';

  insert into public.notification_queue (user_id, email, type, subject, body_text, payload)
  select a.user_id, u.email, 'admin_alert', 'SwiftGigs alert: ' || problems[1], body,
         jsonb_build_object('link', 'https://quickgigs.ca/admin.html', 'problems', to_jsonb(problems))
    from public.admins a
    join public.users u on u.firebase_uid = a.user_id
   where coalesce(u.email, '') <> '';
  get diagnostics queued = row_count;
  return queued;
end;
$$;

revoke all on function public.qg_admin_alert_check() from public, anon, authenticated;

select cron.unschedule('swiftgigs-admin-alert-check')
 where exists (select 1 from cron.job where jobname = 'swiftgigs-admin-alert-check');
select cron.schedule('swiftgigs-admin-alert-check', '*/10 * * * *', 'select public.qg_admin_alert_check();');
