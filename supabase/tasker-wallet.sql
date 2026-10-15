-- SwiftGigs tasker wallet.
-- Balances are derived from payments (the gig ledger). Clients cannot insert
-- or update payout rows. request-payout (service role) is the only writer.
--
-- Available = worker share of released escrow (paid / released / completed)
--             minus payouts that are pending, processing, or completed.
-- Pending   = worker share still held, in escrow, pending, or disputed.
-- Earned    = released worker share, all time, before withdrawals.
-- Held escrow is never withdrawable.
-- Minimum withdrawal is $20 (2000 cents), the same floor as a gig budget.

create table if not exists public.payout_accounts (
  account_id uuid primary key default gen_random_uuid(),
  worker_id text not null,
  stripe_external_account_id text,
  bank_name text not null,
  last4 text not null,
  currency text not null default 'cad',
  source text not null default 'test',
  status text not null default 'active',
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint payout_accounts_last4_check check (last4 ~ '^[0-9]{4}$'),
  constraint payout_accounts_source_check check (source in ('stripe', 'test')),
  constraint payout_accounts_status_check check (status in ('active', 'removed'))
);

create table if not exists public.payouts (
  payout_id uuid primary key default gen_random_uuid(),
  worker_id text not null,
  account_id uuid references public.payout_accounts (account_id),
  amount_cents integer not null,
  currency text not null default 'cad',
  status text not null,
  mode text not null default 'test_ledger',
  destination_label text not null,
  failure_reason text,
  note text,
  stripe_payout_id text,
  idempotency_key text,
  retry_of uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payouts_amount_check check (amount_cents > 0),
  constraint payouts_status_check check (status in ('pending', 'processing', 'completed', 'failed')),
  constraint payouts_mode_check check (mode in ('stripe', 'test_ledger'))
);

create index if not exists payout_accounts_worker_idx on public.payout_accounts (worker_id, status);
create index if not exists payouts_worker_idx on public.payouts (worker_id, created_at desc);
create unique index if not exists payouts_worker_idempotency_idx
  on public.payouts (worker_id, idempotency_key)
  where idempotency_key is not null;

alter table public.payout_accounts enable row level security;
alter table public.payouts enable row level security;

drop policy if exists payout_accounts_select_own on public.payout_accounts;
create policy payout_accounts_select_own on public.payout_accounts
  for select using (qg_is_signed_in() and worker_id = qg_uid());

drop policy if exists payouts_select_own on public.payouts;
create policy payouts_select_own on public.payouts
  for select using (qg_is_signed_in() and worker_id = qg_uid());

revoke all on table public.payout_accounts from public, anon, authenticated;
revoke all on table public.payouts from public, anon, authenticated;
grant select on table public.payout_accounts to authenticated;
grant select on table public.payouts to authenticated;

-- Worker share in cents. Prefer the stored worker_payout so the wallet matches
-- the gig row. Fall back to the 15% tasker fee only when that column is null.
create or replace function public.qg_payment_worker_cents(p_worker_payout numeric, p_amount numeric)
returns integer
language sql
immutable
as $$
  select greatest(
    case
      when p_worker_payout is not null then round(p_worker_payout * 100)::integer
      when p_amount is not null then
        round(p_amount * 100)::integer - round(round(p_amount * 100) * 0.15)::integer
      else 0
    end,
    0
  );
$$;

create or replace function public.qg_wallet_op(p_action text, p_worker_id text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := lower(coalesce(p_action, ''));
  v_worker text := btrim(coalesce(p_worker_id, ''));
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_earned integer := 0;
  v_pending integer := 0;
  v_reserved integer := 0;
  v_available integer := 0;
  v_lines jsonb := '[]'::jsonb;
  v_accounts jsonb := '[]'::jsonb;
  v_history jsonb := '[]'::jsonb;
  v_acct public.payout_accounts%rowtype;
  v_existing public.payouts%rowtype;
  v_amount integer;
  v_min integer;
  v_account_id uuid;
  v_key text;
  v_label text;
  v_id uuid;
  v_reason text;
  v_pending_n integer := 0;
  v_retry uuid;
  v_ext text;
  v_bank text;
  v_last4 text;
begin
  if v_worker = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_worker');
  end if;

  if v_action = 'snapshot' then
    select coalesce(sum(cents) filter (where bucket = 'released'), 0)::integer,
           coalesce(sum(cents) filter (where bucket = 'pending'), 0)::integer,
           coalesce(jsonb_agg(jsonb_build_object(
             'payment_id', payment_id,
             'task_id', task_id,
             'title', title,
             'status', status,
             'bucket', bucket,
             'cents', cents
           ) order by created_at desc) filter (where bucket in ('released', 'pending')), '[]'::jsonb)
      into v_earned, v_pending, v_lines
    from (
      select p.payment_id,
             p.task_id,
             p.created_at,
             lower(coalesce(p.status, '')) as status,
             coalesce(nullif(t.title, ''), 'Gig') as title,
             case
               when lower(coalesce(p.status, '')) in ('paid', 'released', 'completed') then 'released'
               when lower(coalesce(p.status, '')) in ('held', 'escrow', 'pending', 'disputed') then 'pending'
               else 'ignored'
             end as bucket,
             public.qg_payment_worker_cents(p.worker_payout, p.amount) as cents
        from public.payments p
        left join public.tasks t on t.task_id = p.task_id
       where p.worker_id = v_worker
    ) lines;

    select coalesce(sum(amount_cents) filter (
             where status in ('pending', 'processing', 'completed')
           ), 0)::integer
      into v_reserved
      from public.payouts
     where worker_id = v_worker;

    v_available := greatest(v_earned - v_reserved, 0);

    select coalesce(jsonb_agg(jsonb_build_object(
             'account_id', account_id,
             'bank_name', bank_name,
             'last4', last4,
             'source', source,
             'status', status,
             'currency', currency,
             'stripe_external_account_id', stripe_external_account_id
           ) order by created_at desc), '[]'::jsonb)
      into v_accounts
      from public.payout_accounts
     where worker_id = v_worker;

    select coalesce(jsonb_agg(jsonb_build_object(
             'payout_id', po.payout_id,
             'amount_cents', po.amount_cents,
             'status', po.status,
             'mode', po.mode,
             'destination_label', po.destination_label,
             'failure_reason', po.failure_reason,
             'note', po.note,
             'stripe_payout_id', po.stripe_payout_id,
             'created_at', po.created_at,
             'retry_of', po.retry_of,
             'account_id', po.account_id,
             'account_removed', coalesce(a.status, '') = 'removed'
           ) order by po.created_at desc), '[]'::jsonb)
      into v_history
      from public.payouts po
      left join public.payout_accounts a on a.account_id = po.account_id
     where po.worker_id = v_worker;

    return jsonb_build_object(
      'ok', true,
      'currency', 'cad',
      'available_cents', v_available,
      'pending_cents', v_pending,
      'earned_cents', v_earned,
      'reserved_cents', v_reserved,
      'tie_out_cents', v_available + v_reserved - v_earned,
      'gigs', v_lines,
      'accounts', v_accounts,
      'payouts', v_history
    );
  end if;

  perform pg_advisory_xact_lock(hashtext(v_worker)::bigint);

  if v_action = 'add_test_bank' then
    select * into v_acct
      from public.payout_accounts
     where worker_id = v_worker
       and source = 'test'
       and status = 'active'
       and last4 = '6789'
     limit 1;
    if found then
      return jsonb_build_object('ok', true, 'account_id', v_acct.account_id, 'existed', true);
    end if;
    insert into public.payout_accounts (worker_id, bank_name, last4, source, currency)
    values (v_worker, 'Test bank', '6789', 'test', 'cad')
    returning account_id into v_id;
    return jsonb_build_object('ok', true, 'account_id', v_id, 'existed', false);
  end if;

  if v_action = 'upsert_bank' then
    v_ext := btrim(coalesce(v_payload->>'stripe_external_account_id', ''));
    v_bank := btrim(coalesce(v_payload->>'bank_name', 'Bank'));
    v_last4 := btrim(coalesce(v_payload->>'last4', ''));
    if v_ext = '' or v_last4 !~ '^[0-9]{4}$' then
      return jsonb_build_object('ok', false, 'error', 'invalid_bank');
    end if;
    if length(v_bank) > 80 then v_bank := left(v_bank, 80); end if;
    select * into v_acct
      from public.payout_accounts
     where worker_id = v_worker and stripe_external_account_id = v_ext
     limit 1;
    if found then
      update public.payout_accounts
         set bank_name = v_bank,
             last4 = v_last4,
             source = 'stripe',
             status = 'active',
             removed_at = null
       where account_id = v_acct.account_id;
      return jsonb_build_object('ok', true, 'account_id', v_acct.account_id);
    end if;
    insert into public.payout_accounts (
      worker_id, stripe_external_account_id, bank_name, last4, source, currency
    ) values (v_worker, v_ext, v_bank, v_last4, 'stripe', 'cad')
    returning account_id into v_id;
    return jsonb_build_object('ok', true, 'account_id', v_id);
  end if;

  if v_action = 'remove_bank' then
    begin
      v_account_id := nullif(v_payload->>'account_id', '')::uuid;
    exception when invalid_text_representation then
      return jsonb_build_object('ok', false, 'error', 'bank_not_found');
    end;
    update public.payout_accounts
       set status = 'removed', removed_at = now()
     where account_id = v_account_id
       and worker_id = v_worker
       and status = 'active'
    returning * into v_acct;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'bank_not_found');
    end if;
    select count(*)::integer into v_pending_n
      from public.payouts
     where account_id = v_acct.account_id
       and worker_id = v_worker
       and status in ('pending', 'processing');
    return jsonb_build_object(
      'ok', true,
      'account_id', v_acct.account_id,
      'stripe_external_account_id', v_acct.stripe_external_account_id,
      'pending_payouts', v_pending_n
    );
  end if;

  if v_action = 'reserve' then
    v_key := nullif(btrim(coalesce(v_payload->>'idempotency_key', '')), '');
    if v_key is not null then
      select * into v_existing
        from public.payouts
       where worker_id = v_worker and idempotency_key = v_key;
      if found then
        return jsonb_build_object('ok', true, 'duplicate', true, 'payout', to_jsonb(v_existing));
      end if;
    end if;

    begin
      v_account_id := nullif(v_payload->>'account_id', '')::uuid;
    exception when invalid_text_representation then
      return jsonb_build_object('ok', false, 'error', 'bank_not_found');
    end;

    select * into v_acct
      from public.payout_accounts
     where account_id = v_account_id and worker_id = v_worker;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'bank_not_found');
    end if;
    v_label := v_acct.bank_name || ' ···' || v_acct.last4;

    begin
      v_amount := (v_payload->>'amount_cents')::integer;
    exception when others then
      v_amount := null;
    end;
    begin
      v_min := (v_payload->>'min_cents')::integer;
    exception when others then
      v_min := 2000;
    end;
    if v_min is null or v_min < 1 then v_min := 2000; end if;
    begin
      v_retry := nullif(v_payload->>'retry_of', '')::uuid;
    exception when invalid_text_representation then
      v_retry := null;
    end;

    if v_amount is null or v_amount <= 0 then
      return jsonb_build_object(
        'ok', false,
        'error', 'amount_not_positive',
        'failure_reason', 'Enter an amount greater than $0.'
      );
    end if;

    if v_acct.status <> 'active' then
      insert into public.payouts (
        worker_id, account_id, amount_cents, status, mode, destination_label,
        failure_reason, idempotency_key, retry_of
      ) values (
        v_worker, v_acct.account_id, v_amount,
        'failed', 'test_ledger', v_label,
        'That bank account was removed. Add another bank and try again.',
        v_key, v_retry
      ) returning payout_id into v_id;
      return jsonb_build_object('ok', false, 'error', 'bank_removed', 'payout_id', v_id, 'failure_reason', 'That bank account was removed. Add another bank and try again.');
    end if;

    select coalesce(sum(public.qg_payment_worker_cents(worker_payout, amount)) filter (
             where lower(coalesce(status, '')) in ('paid', 'released', 'completed')
           ), 0)::integer
      into v_earned
      from public.payments
     where worker_id = v_worker;

    select coalesce(sum(amount_cents) filter (
             where status in ('pending', 'processing', 'completed')
           ), 0)::integer
      into v_reserved
      from public.payouts
     where worker_id = v_worker;

    v_available := greatest(v_earned - v_reserved, 0);

    if v_amount < v_min then
      v_reason := 'The minimum withdrawal is $' || trim(to_char(v_min / 100.0, 'FM999990.00')) || '.';
      insert into public.payouts (
        worker_id, account_id, amount_cents, status, destination_label, failure_reason, idempotency_key, retry_of
      ) values (
        v_worker, v_acct.account_id, v_amount, 'failed', v_label, v_reason, v_key, v_retry
      ) returning payout_id into v_id;
      return jsonb_build_object('ok', false, 'error', 'below_minimum', 'payout_id', v_id, 'failure_reason', v_reason, 'available_cents', v_available, 'minimum_cents', v_min);
    end if;

    if v_amount > v_available then
      v_reason := 'That amount is higher than your available balance. Money still held in escrow cannot be withdrawn.';
      insert into public.payouts (
        worker_id, account_id, amount_cents, status, destination_label, failure_reason, idempotency_key, retry_of
      ) values (
        v_worker, v_acct.account_id, v_amount, 'failed', v_label, v_reason, v_key, v_retry
      ) returning payout_id into v_id;
      return jsonb_build_object('ok', false, 'error', 'amount_exceeds_available', 'payout_id', v_id, 'failure_reason', v_reason, 'available_cents', v_available);
    end if;

    insert into public.payouts (
      worker_id, account_id, amount_cents, status, mode, destination_label, idempotency_key, retry_of
    ) values (
      v_worker, v_acct.account_id, v_amount, 'pending', 'test_ledger', v_label, v_key, v_retry
    ) returning payout_id into v_id;

    select * into v_existing from public.payouts where payout_id = v_id;
    return jsonb_build_object(
      'ok', true,
      'payout', to_jsonb(v_existing),
      'account', jsonb_build_object(
        'account_id', v_acct.account_id,
        'source', v_acct.source,
        'stripe_external_account_id', v_acct.stripe_external_account_id,
        'bank_name', v_acct.bank_name,
        'last4', v_acct.last4
      ),
      'available_cents', v_available - v_amount
    );
  end if;

  if v_action = 'finish' then
    v_id := nullif(v_payload->>'payout_id', '')::uuid;
    if v_payload->>'status' not in ('processing', 'completed', 'failed') then
      return jsonb_build_object('ok', false, 'error', 'invalid_status');
    end if;
    update public.payouts
       set status = v_payload->>'status',
           mode = case when v_payload->>'mode' in ('stripe', 'test_ledger') then v_payload->>'mode' else mode end,
           stripe_payout_id = coalesce(nullif(v_payload->>'stripe_payout_id', ''), stripe_payout_id),
           failure_reason = nullif(v_payload->>'failure_reason', ''),
           note = nullif(v_payload->>'note', ''),
           updated_at = now()
     where payout_id = v_id
       and worker_id = v_worker
       and status in ('pending', 'processing')
    returning * into v_existing;
    if not found then
      select * into v_existing from public.payouts where payout_id = v_id and worker_id = v_worker;
      if not found then
        return jsonb_build_object('ok', false, 'error', 'payout_not_found');
      end if;
      return jsonb_build_object('ok', true, 'already', true, 'payout', to_jsonb(v_existing));
    end if;
    return jsonb_build_object('ok', true, 'payout', to_jsonb(v_existing));
  end if;

  if v_action = 'load_payout' then
    v_id := nullif(v_payload->>'payout_id', '')::uuid;
    select * into v_existing from public.payouts where payout_id = v_id and worker_id = v_worker;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'payout_not_found');
    end if;
    select * into v_acct from public.payout_accounts where account_id = v_existing.account_id and worker_id = v_worker;
    return jsonb_build_object(
      'ok', true,
      'payout', to_jsonb(v_existing),
      'account', case when v_acct.account_id is null then null else jsonb_build_object(
        'account_id', v_acct.account_id,
        'status', v_acct.status,
        'source', v_acct.source,
        'stripe_external_account_id', v_acct.stripe_external_account_id
      ) end
    );
  end if;

  return jsonb_build_object('ok', false, 'error', 'unknown_action');
exception
  when unique_violation then
    select * into v_existing
      from public.payouts
     where worker_id = v_worker
       and idempotency_key = nullif(btrim(coalesce(p_payload->>'idempotency_key', '')), '');
    if found then
      return jsonb_build_object('ok', true, 'duplicate', true, 'payout', to_jsonb(v_existing));
    end if;
    return jsonb_build_object('ok', false, 'error', 'duplicate_payout');
end;
$$;

revoke all on function public.qg_payment_worker_cents(numeric, numeric) from public, anon, authenticated;
grant execute on function public.qg_payment_worker_cents(numeric, numeric) to service_role;

revoke all on function public.qg_wallet_op(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.qg_wallet_op(text, text, jsonb) to service_role;

comment on table public.payouts is
  'Tasker withdrawal attempts. Written only by the request-payout edge function. Failed rows do not reduce available balance.';
comment on table public.payout_accounts is
  'Payout destinations. Test rows are ledger-only. Stripe rows store last4, never a full account number.';
