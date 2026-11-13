-- Applied live 13 Nov 2026 (security sweep).
-- 1. Disputes can freeze a payout, so they may only be opened through the
--    raise-dispute function (which checks the caller is part of the gig).
drop policy if exists "raise own disputes" on public.disputes;

-- 2. Trim table permissions down to what the app uses.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
revoke all on public.admins, public.admin_actions, public.admin_notes,
  public.notification_queue, public.rate_limits,
  public.phone_verification_challenges, public.task_private
  from anon, authenticated;
revoke insert, update, delete on public.tasker_reputation, public.public_user_profiles
  from anon, authenticated;
revoke delete on public.users, public.tasks, public.applications, public.disputes,
  public.reviews, public.reports, public.platform_banner, public.task_categories,
  public.geocode_cache, public.user_warnings, public.task_evidence_photos,
  public.task_status_stamps, public.user_notifications
  from anon, authenticated;
revoke insert, update on public.platform_banner, public.task_categories,
  public.geocode_cache, public.user_warnings, public.task_evidence_photos,
  public.task_status_stamps, public.disputes
  from anon, authenticated;

-- 3. Duplicate wide-open waitlist insert rule (the form uses join_waitlist()).
drop policy if exists waitlist_insert_public on public.waitlist;

-- 4. A user may not clear their own review flag or claim an email they do not sign in with.
create or replace function public.qg_protect_user_server_fields()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  new_j jsonb := to_jsonb(NEW);
  old_j jsonb := to_jsonb(OLD);
  col   text;
  jwt_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
begin
  if not public.qg_is_signed_in() or public.is_qg_admin() then
    return NEW;
  end if;
  foreach col in array array[
    'rating', 'is_subscriber', 'review_flag',
    'phone_verified', 'phone_verified_at',
    'poster_payment_method_id', 'poster_stripe_customer_id'
  ] loop
    if (new_j -> col) is distinct from (old_j -> col) then
      raise exception 'privileged_fields_are_server_managed'
        using errcode = '42501', detail = col;
    end if;
  end loop;
  if lower(btrim(coalesce(NEW.email, ''))) is distinct from lower(btrim(coalesce(OLD.email, '')))
     and lower(btrim(coalesce(NEW.email, ''))) <> jwt_email then
    raise exception 'privileged_fields_are_server_managed'
      using errcode = '42501', detail = 'email';
  end if;
  return NEW;
end;
$function$;

-- 5. Old image bucket had no size or type limit.
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif']
 where id = 'task-images';
