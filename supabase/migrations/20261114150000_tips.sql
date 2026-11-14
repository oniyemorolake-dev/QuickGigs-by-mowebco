-- Tips: a poster's thank-you after a finished gig. 100% goes to the tasker.
create table if not exists public.tips (
  tip_id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(task_id),
  poster_id text not null,
  worker_id text not null,
  amount_cents integer not null check (amount_cents between 200 and 20000),
  status text not null default 'pending' check (status in ('pending','collected','paid','expired','failed')),
  stripe_session_id text,
  stripe_pi text,
  transfer_id text,
  created_at timestamptz not null default now(),
  collected_at timestamptz,
  paid_at timestamptz
);
create index if not exists tips_task_idx on public.tips (task_id);
create index if not exists tips_worker_idx on public.tips (worker_id, created_at desc);
create index if not exists tips_poster_idx on public.tips (poster_id, created_at desc);
alter table public.tips enable row level security;
revoke all on public.tips from anon, authenticated;
grant select on public.tips to anon, authenticated;
drop policy if exists tips_select_own on public.tips;
create policy tips_select_own on public.tips for select to anon, authenticated
  using (public.qg_is_signed_in() and (public.is_qg_admin() or poster_id = public.qg_uid() or worker_id = public.qg_uid()));

-- The tasker's balance counts tips: paid tips are earned, collected-but-not-yet-sent are pending.
do $do$
declare src text; before text;
begin
  select pg_get_functiondef('public.qg_wallet_op'::regproc) into src;
  before := src;
  src := replace(src,
$a$        from public.payments p
        left join public.tasks t on t.task_id = p.task_id
       where p.worker_id = v_worker
    ) lines;$a$,
$b$        from public.payments p
        left join public.tasks t on t.task_id = p.task_id
       where p.worker_id = v_worker
      union all
      select tp.tip_id, tp.task_id, tp.created_at::timestamp, 'tip',
             'Tip: ' || coalesce(nullif(tt.title, ''), 'Gig'),
             case when tp.status = 'paid' then 'released' else 'pending' end,
             tp.amount_cents
        from public.tips tp
        left join public.tasks tt on tt.task_id = tp.task_id
       where tp.worker_id = v_worker and tp.status in ('paid', 'collected')
    ) lines;$b$);
  if src = before then raise exception 'wallet snapshot patch did not apply'; end if;
  before := src;
  src := replace(src,
$a$      into v_earned
      from public.payments
     where worker_id = v_worker;

    select coalesce(sum(amount_cents) filter (
             where status in ('pending', 'processing', 'completed')
           ), 0)::integer
      into v_reserved
      from public.payouts
     where worker_id = v_worker;

    v_available := greatest(v_earned - v_reserved, 0);

    if v_amount < v_min then$a$,
$b$      into v_earned
      from public.payments
     where worker_id = v_worker;

    v_earned := v_earned + coalesce((select sum(amount_cents) from public.tips
                                      where worker_id = v_worker and status = 'paid'), 0)::integer;

    select coalesce(sum(amount_cents) filter (
             where status in ('pending', 'processing', 'completed')
           ), 0)::integer
      into v_reserved
      from public.payouts
     where worker_id = v_worker;

    v_available := greatest(v_earned - v_reserved, 0);

    if v_amount < v_min then$b$);
  if src = before then raise exception 'wallet reserve patch did not apply'; end if;
  execute src;
end $do$;
