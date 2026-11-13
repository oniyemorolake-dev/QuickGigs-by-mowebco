-- Applied live 13 Nov 2026 (security sweep).
-- Applications are created only by the submit-application function. A direct
-- insert let a tasker file an application already marked accepted/completed,
-- which exposed a gig's exact address and allowed reviews with no real job.
revoke insert on public.applications from anon, authenticated;

-- Completing a gig releases the payout, so only the server may mark it done.
create or replace function public.protect_application_status()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  request_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
  trusted boolean := request_role = 'service_role'
    or current_user in ('service_role', 'postgres', 'supabase_admin');
  poster_uid text;
begin
  if trusted then
    return NEW;
  end if;

  if lower(coalesce(NEW.status, '')) = 'completed'
     and lower(coalesce(OLD.status, '')) is distinct from 'completed' then
    raise exception 'completion_is_server_managed' using errcode = '42501';
  end if;

  if lower(coalesce(NEW.status, '')) = 'accepted'
     and lower(coalesce(OLD.status, '')) is distinct from 'accepted' then
    select t.posted_by into poster_uid
      from public.tasks t
     where t.task_id::text = NEW.task_id::text
     limit 1;
    if poster_uid is not null and poster_uid = public.qg_uid() then
      return NEW;
    end if;
    raise exception 'application_accept_forbidden' using errcode = '42501';
  end if;

  return NEW;
end;
$function$;

create or replace function public.qg_protect_task_completion()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  request_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
begin
  if request_role = 'service_role'
     or current_user in ('service_role', 'postgres', 'supabase_admin') then
    return NEW;
  end if;
  if lower(coalesce(NEW.status, '')) = 'completed'
     and lower(coalesce(OLD.status, '')) is distinct from 'completed' then
    raise exception 'completion_is_server_managed' using errcode = '42501';
  end if;
  return NEW;
end;
$function$;

drop trigger if exists tasks_protect_completion on public.tasks;
create trigger tasks_protect_completion
  before update on public.tasks
  for each row execute function public.qg_protect_task_completion();
