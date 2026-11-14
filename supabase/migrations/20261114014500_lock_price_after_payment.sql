-- Once a gig is funded the agreed price is fixed. Changing it afterwards left
-- the recorded amount and the real charge out of step, and the payout failed.
create or replace function public.qg_lock_price_after_payment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.price is distinct from old.price
     or new.counter_price is distinct from old.counter_price then
    if exists (
      select 1 from public.payments p
       where p.task_id::text = new.task_id::text
         and p.worker_id = new.worker_id
         and p.status in ('held', 'paid', 'completed', 'disputed')
    ) then
      raise exception 'price_locked_after_payment'
        using hint = 'This gig is already paid for. The price cannot change.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists qg_lock_price_after_payment on public.applications;
create trigger qg_lock_price_after_payment
  before update of price, counter_price on public.applications
  for each row execute function public.qg_lock_price_after_payment();

-- Launch control: flag an unpaid tasker after 10 minutes, not an hour.
do $do$
declare src text;
begin
  select pg_get_functiondef('public.qg_admin_health'::regproc) into src;
  src := replace(src,
    $a$and coalesce(t.poster_confirmed_at, p.created_at) < now() - interval '1 hour')),$a$,
    $b$and coalesce(t.poster_confirmed_at, p.created_at) < now() - interval '10 minutes')),$b$);
  execute src;
end $do$;
