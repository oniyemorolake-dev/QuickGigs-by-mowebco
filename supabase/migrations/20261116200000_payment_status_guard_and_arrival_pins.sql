-- A refunded or paid-out payment can never go back to held or pending.
-- (A refunded test payment was revived as "held" by a later payment sync,
-- because the held update matched on the Stripe id with no status check.)
create or replace function public.qg_payment_no_regress()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if lower(coalesce(old.status, '')) in ('refunded', 'paid', 'completed', 'released')
     and lower(coalesce(new.status, '')) in ('held', 'pending') then
    return old;
  end if;
  return new;
end;
$$;
drop trigger if exists qg_payment_no_regress on public.payments;
create trigger qg_payment_no_regress before update on public.payments
  for each row execute function public.qg_payment_no_regress();

-- Repair the one row this already happened to (refunded 15 Nov, revived 16 Nov).
update public.payments p
   set status = 'refunded'
 where p.status = 'held'
   and exists (select 1 from public.admin_actions a
                where a.action_type = 'payment_refund' and a.target_id = p.task_id::text);

-- Arrival PINs: the poster gets a 4-digit code, the tasker enters it on arrival.
-- Server-only: RLS on, no policies, no client grants.
create table if not exists public.task_pins (
  task_id uuid primary key references public.tasks(task_id) on delete cascade,
  pin text not null check (pin ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
alter table public.task_pins enable row level security;
revoke all on public.task_pins from anon, authenticated;
