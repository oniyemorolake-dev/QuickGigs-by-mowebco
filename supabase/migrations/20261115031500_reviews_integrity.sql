-- Reviews: one per person per gig, and only about the other person on that gig.
-- Before this, any signed-in reviewer could name any user as the reviewee.
create unique index if not exists reviews_task_reviewer_uniq on public.reviews (task_id, reviewer_id);

create or replace function public.qg_review_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_poster text;
  v_worker text;
begin
  select t.posted_by into v_poster from public.tasks t where t.task_id::text = new.task_id;
  select a.worker_id into v_worker from public.applications a
   where a.task_id::text = new.task_id and lower(coalesce(a.status, '')) = 'completed'
   order by a.created_at desc limit 1;
  if v_poster is null or v_worker is null then
    raise exception 'review_task_not_completed';
  end if;
  if new.reviewer_id = v_poster and new.reviewee_id = v_worker then
    null;
  elsif new.reviewer_id = v_worker and new.reviewee_id = v_poster then
    null;
  else
    raise exception 'review_wrong_person' using hint = 'You can only review the other person on this gig.';
  end if;
  if new.rating is null or new.rating < 1 or new.rating > 5 then
    raise exception 'review_invalid_rating';
  end if;
  new.review_comment := left(coalesce(new.review_comment, ''), 500);
  new.created_at := now() at time zone 'UTC';
  return new;
end;
$$;

drop trigger if exists qg_review_guard on public.reviews;
create trigger qg_review_guard before insert on public.reviews
  for each row execute function public.qg_review_guard();

revoke update, delete on public.reviews from anon, authenticated;
