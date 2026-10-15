-- Throws if the wallet ledger does not match gig payments. Rolls back all test rows.
begin;

insert into public.payments (poster_id, worker_id, task_id, amount, worker_payout, status)
values ('wallet-test-poster', 'wallet-test-worker', 'e052cf0e-36cb-454f-a466-b17ac8550f94', 250, 187.50, 'held');

insert into public.payments (poster_id, worker_id, task_id, amount, worker_payout, status)
values ('wallet-test-poster', 'wallet-test-worker', 'e052cf0e-36cb-454f-a466-b17ac8550f94', 100, 85.00, 'paid');

create temp table wallet_checks (name text primary key, ok boolean, detail jsonb);

do $$
declare
  snap jsonb;
  bank jsonb;
  acct uuid;
  overdraw jsonb;
  low jsonb;
  good jsonb;
  again jsonb;
  fin jsonb;
  snap2 jsonb;
  rem jsonb;
  snap3 jsonb;
  payout_id text;
begin
  snap := public.qg_wallet_op('snapshot', 'wallet-test-worker', '{}'::jsonb);
  insert into wallet_checks values (
    'held_is_pending_not_available',
    (snap->>'available_cents')::int = 8500
      and (snap->>'pending_cents')::int = 18750
      and (snap->>'earned_cents')::int = 8500
      and (snap->>'tie_out_cents')::int = 0,
    snap
  );

  bank := public.qg_wallet_op('add_test_bank', 'wallet-test-worker', '{}'::jsonb);
  acct := (bank->>'account_id')::uuid;

  overdraw := public.qg_wallet_op('reserve', 'wallet-test-worker', jsonb_build_object(
    'amount_cents', 9000, 'account_id', acct, 'min_cents', 2000, 'idempotency_key', 'over-1'
  ));
  insert into wallet_checks values ('over_available_blocked', overdraw->>'error' = 'amount_exceeds_available', overdraw);

  low := public.qg_wallet_op('reserve', 'wallet-test-worker', jsonb_build_object(
    'amount_cents', 500, 'account_id', acct, 'min_cents', 2000, 'idempotency_key', 'low-1'
  ));
  insert into wallet_checks values ('below_minimum_blocked', low->>'error' = 'below_minimum', low);

  snap := public.qg_wallet_op('snapshot', 'wallet-test-worker', '{}'::jsonb);
  insert into wallet_checks values (
    'failed_does_not_reduce_available',
    (snap->>'available_cents')::int = 8500,
    snap
  );

  good := public.qg_wallet_op('reserve', 'wallet-test-worker', jsonb_build_object(
    'amount_cents', 2000, 'account_id', acct, 'min_cents', 2000, 'idempotency_key', 'ok-1'
  ));
  insert into wallet_checks values (
    'reserve_within_available',
    coalesce((good->>'ok')::boolean, false) and (good->>'available_cents')::int = 6500,
    good
  );

  again := public.qg_wallet_op('reserve', 'wallet-test-worker', jsonb_build_object(
    'amount_cents', 2000, 'account_id', acct, 'min_cents', 2000, 'idempotency_key', 'ok-1'
  ));
  insert into wallet_checks values ('idempotent_retry', coalesce((again->>'duplicate')::boolean, false), again);

  snap := public.qg_wallet_op('snapshot', 'wallet-test-worker', '{}'::jsonb);
  insert into wallet_checks values (
    'duplicate_does_not_double_charge',
    (snap->>'available_cents')::int = 6500 and (snap->>'reserved_cents')::int = 2000,
    snap
  );

  payout_id := good->'payout'->>'payout_id';
  fin := public.qg_wallet_op('finish', 'wallet-test-worker', jsonb_build_object(
    'payout_id', payout_id, 'status', 'failed', 'failure_reason', 'Stripe test failure', 'mode', 'stripe'
  ));
  snap2 := public.qg_wallet_op('snapshot', 'wallet-test-worker', '{}'::jsonb);
  insert into wallet_checks values (
    'stripe_failure_returns_funds',
    (snap2->>'available_cents')::int = 8500
      and exists (
        select 1 from jsonb_array_elements(snap2->'payouts') p
        where p->>'failure_reason' = 'Stripe test failure' and p->>'status' = 'failed'
      ),
    jsonb_build_object('finish', fin, 'available', snap2->>'available_cents')
  );

  good := public.qg_wallet_op('reserve', 'wallet-test-worker', jsonb_build_object(
    'amount_cents', 2000, 'account_id', acct, 'min_cents', 2000, 'idempotency_key', 'pend-1'
  ));
  rem := public.qg_wallet_op('remove_bank', 'wallet-test-worker', jsonb_build_object('account_id', acct));
  snap3 := public.qg_wallet_op('snapshot', 'wallet-test-worker', '{}'::jsonb);
  insert into wallet_checks values (
    'removed_bank_keeps_pending_destination',
    (rem->>'pending_payouts')::int = 1
      and exists (
        select 1 from jsonb_array_elements(snap3->'payouts') p
        where p->>'status' = 'pending'
          and coalesce((p->>'account_removed')::boolean, false)
          and coalesce(p->>'destination_label', '') <> ''
      ),
    jsonb_build_object('remove', rem, 'snap', snap3)
  );

  again := public.qg_wallet_op('reserve', 'wallet-test-worker', jsonb_build_object(
    'amount_cents', 2000, 'account_id', acct, 'min_cents', 2000, 'idempotency_key', 'removed-1'
  ));
  insert into wallet_checks values ('removed_bank_blocks_new_payout', again->>'error' = 'bank_removed', again);

  again := public.qg_wallet_op('reserve', 'wallet-test-worker', jsonb_build_object(
    'amount_cents', 0, 'account_id', acct, 'min_cents', 2000, 'idempotency_key', 'zero-1'
  ));
  insert into wallet_checks values ('zero_blocked', again->>'error' = 'amount_not_positive', again);
end
$$;

do $$
begin
  if exists (select 1 from wallet_checks where ok is not true) then
    raise exception 'wallet checks failed: %', (select jsonb_agg(jsonb_build_object('name', name, 'detail', detail)) from wallet_checks where ok is not true);
  end if;
end
$$;

select name, ok from wallet_checks order by name;

rollback;
