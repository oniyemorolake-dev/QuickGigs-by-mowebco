// SwiftGigs — tasker wallet and withdrawals.
// Deploy: supabase functions deploy request-payout --no-verify-jwt
// Auth is a Firebase ID token (requireFirebaseUser), same as the other money functions.
// Secrets: STRIPE_SECRET_KEY (sk_test_ until launch), SUPABASE_SERVICE_ROLE_KEY
//
// The browser never writes balances. Amounts are checked here against payments.
// Held / escrow / disputed worker shares are pending and cannot be withdrawn.
// Minimum withdrawal is $20 (2000 cents), matching the gig budget floor.
//
// LIVE PAYOUTS NEED, before any real money moves:
// 1. Stripe Connect onboarding with payouts enabled on the connected account.
// 2. A real bank added through Stripe (the Test bank is ledger-only).
// 3. STRIPE_SECRET_KEY switched from sk_test_ to a live secret.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';
import { connectAccountReady } from '../_shared/connect-ready.ts';
import { ageFromDateOfBirth } from '../_shared/age.ts';

const MIN_CENTS = 2000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LIVE_REQUIREMENTS = [
  'Finish Stripe Connect onboarding so payouts are enabled on the connected account.',
  'Add a real bank through Stripe. The Test bank ending 6789 is not a real account and never receives money.',
  'Replace the test Stripe secret (sk_test_) with a live secret. Until then, withdrawals stay in test mode.',
];

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.message === 'string' && e.message) return e.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

type WalletClient = ReturnType<typeof createClient>;

async function walletOp(
  supabase: WalletClient,
  action: string,
  workerId: string,
  payload: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc('qg_wallet_op', {
    p_action: action,
    p_worker_id: workerId,
    p_payload: payload,
  });
  if (error) {
    return { ok: false, error: 'wallet_op_failed', details: error.message };
  }
  return (data || { ok: false, error: 'empty_wallet_op' }) as Record<string, unknown>;
}

function stripeStatus(status: string): 'processing' | 'completed' | 'failed' {
  if (status === 'paid') return 'completed';
  if (status === 'failed' || status === 'canceled') return 'failed';
  return 'processing';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  try {
    let identity;
    try {
      identity = await requireFirebaseUser(req);
    } catch (authErr) {
      const raw = authErr instanceof Error ? authErr.message : 'unauthorized';
      const safe = raw === 'missing_authorization' ? raw : 'invalid_firebase_token';
      return json({ ok: false, error: safe }, authErrorStatus(authErr));
    }
    const workerId = identity.uid;

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const action = String(body.action || 'snapshot');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
    const testMode = !stripeKey || stripeKey.startsWith('sk_test_');

    const { data: userRow } = await supabase
      .from('users')
      .select('stripe_connect_id,stripe_payouts_enabled,date_of_birth,graduated_at,payout_owner,guardian_stripe_connect_id,guardian_stripe_payouts_enabled')
      .eq('firebase_uid', workerId)
      .maybeSingle();

    const age = ageFromDateOfBirth(userRow?.date_of_birth);
    const guardianOwns = !userRow?.graduated_at && (
      userRow?.payout_owner === 'guardian' || (age != null && age < 18)
    );
    const connectId = guardianOwns
      ? String(userRow?.guardian_stripe_connect_id || '')
      : String(userRow?.stripe_connect_id || '');

    let connectReady = false;
    let connectDetail = '';
    if (stripeKey && connectId) {
      try {
        const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
        const account = await stripe.accounts.retrieve(connectId);
        connectReady = connectAccountReady(account).ready && account.payouts_enabled === true;
        if (action === 'snapshot') {
          try {
            const banks = await stripe.accounts.listExternalAccounts(connectId, {
              object: 'bank_account',
              limit: 20,
            });
            for (const bank of banks.data) {
              const row = bank as Stripe.BankAccount;
              if (!row.id || !row.last4) continue;
              await walletOp(supabase, 'upsert_bank', workerId, {
                stripe_external_account_id: row.id,
                bank_name: row.bank_name || 'Bank',
                last4: row.last4,
              });
            }
          } catch (bankErr) {
            connectDetail = errorMessage(bankErr);
          }
        }
      } catch (acctErr) {
        connectDetail = errorMessage(acctErr);
        connectReady = false;
      }
    }

    function meta(extra: Record<string, unknown> = {}) {
      return {
        currency: 'cad',
        minimum_cents: MIN_CENTS,
        test_mode: testMode,
        connect_ready: connectReady,
        connect_detail: connectDetail,
        guardian_payout: guardianOwns,
        live_payouts_ready: !testMode && connectReady && !guardianOwns,
        live_requirements: LIVE_REQUIREMENTS,
        ...extra,
      };
    }

    if (action === 'snapshot') {
      const snap = await walletOp(supabase, 'snapshot', workerId, {});
      if (!snap.ok) return json({ ...snap, ...meta() }, 500);
      return json({ ...snap, ...meta() });
    }

    if (guardianOwns && (action === 'withdraw' || action === 'retry' || action === 'add_test_bank')) {
      return json(meta({
        ok: false,
        error: 'guardian_payout_required',
        failure_reason: 'Payouts for this account go to the approved guardian. A parent finishes Stripe setup from their consent link.',
      }), 403);
    }

    if (action === 'add_test_bank') {
      if (!testMode) {
        return json(meta({
          ok: false,
          error: 'test_bank_not_allowed',
          failure_reason: 'Test banks are off once live Stripe is on. Add a bank through Stripe Connect.',
        }), 400);
      }
      const added = await walletOp(supabase, 'add_test_bank', workerId, {});
      if (!added.ok) return json({ ...added, ...meta() }, 400);
      const snap = await walletOp(supabase, 'snapshot', workerId, {});
      return json({ ...snap, ...meta(), account_id: added.account_id });
    }

    if (action === 'remove_bank') {
      const removed = await walletOp(supabase, 'remove_bank', workerId, {
        account_id: String(body.account_id || ''),
      });
      if (!removed.ok) return json({ ...removed, ...meta() }, 400);
      let warning = '';
      const pending = Number(removed.pending_payouts || 0);
      if (pending > 0) {
        warning = 'This bank was removed from your wallet. A payout already sent to it is still in progress and keeps the original account.';
      } else if (removed.stripe_external_account_id && stripeKey && connectId) {
        try {
          const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
          await stripe.accounts.deleteExternalAccount(
            connectId,
            String(removed.stripe_external_account_id),
          );
        } catch (delErr) {
          warning = errorMessage(delErr);
        }
      }
      const snap = await walletOp(supabase, 'snapshot', workerId, {});
      return json({ ...snap, ...meta(), warning });
    }

    if (action === 'withdraw' || action === 'retry') {
      let amountCents = Number(body.amount_cents);
      let accountId = String(body.account_id || '');
      let retryOf = '';
      if (action === 'retry') {
        const loaded = await walletOp(supabase, 'load_payout', workerId, {
          payout_id: String(body.payout_id || ''),
        });
        if (!loaded.ok) return json({ ...loaded, ...meta() }, 400);
        const prev = loaded.payout as Record<string, unknown>;
        const acct = loaded.account as Record<string, unknown> | null;
        if (String(prev.status) !== 'failed') {
          return json(meta({ ok: false, error: 'not_failed', failure_reason: 'Only a failed payout can be retried.' }), 400);
        }
        if (!acct || String(acct.status) !== 'active') {
          return json(meta({
            ok: false,
            error: 'bank_removed',
            failure_reason: 'That bank account was removed. Add another bank and try again.',
          }), 400);
        }
        amountCents = Number(prev.amount_cents);
        accountId = String(acct.account_id || '');
        retryOf = String(prev.payout_id || '');
      }
      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        return json(meta({
          ok: false,
          error: 'amount_not_positive',
          failure_reason: 'Enter an amount greater than $0.',
        }), 400);
      }

      const reserved = await walletOp(supabase, 'reserve', workerId, {
        amount_cents: amountCents,
        account_id: accountId,
        idempotency_key: String(body.idempotency_key || ''),
        min_cents: MIN_CENTS,
        retry_of: retryOf,
      });
      if (!reserved.ok) return json({ ...reserved, ...meta() }, 400);

      const payout = reserved.payout as Record<string, unknown>;
      if (reserved.duplicate && String(payout.status) !== 'pending') {
        const snap = await walletOp(supabase, 'snapshot', workerId, {});
        return json({ ...snap, ...meta(), payout, duplicate: true });
      }

      let account = reserved.account as Record<string, unknown> | undefined;
      if (!account) {
        const loaded = await walletOp(supabase, 'load_payout', workerId, {
          payout_id: String(payout.payout_id || ''),
        });
        account = (loaded.account || undefined) as Record<string, unknown> | undefined;
      }

      const source = String(account?.source || '');
      const externalId = String(account?.stripe_external_account_id || '');
      const payoutId = String(payout.payout_id || '');
      const cents = Number(payout.amount_cents);

      let finishStatus: 'processing' | 'completed' | 'failed' = 'failed';
      let mode: 'stripe' | 'test_ledger' = 'test_ledger';
      let stripePayoutId = '';
      let failure = '';
      let note = '';

      const canStripe = connectReady && source === 'stripe' && !!externalId && !!stripeKey;
      if (canStripe) {
        mode = 'stripe';
        try {
          const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
          const created = await stripe.payouts.create({
            amount: cents,
            currency: 'cad',
            destination: externalId,
            metadata: { project: 'quickgigs', payout_id: payoutId, worker_id: workerId },
          }, {
            stripeAccount: connectId,
            idempotencyKey: 'qg-withdraw-' + payoutId,
          });
          stripePayoutId = created.id;
          finishStatus = stripeStatus(created.status);
          if (finishStatus === 'failed') {
            failure = created.failure_message || created.failure_code || 'Stripe could not pay this bank.';
          }
        } catch (payErr) {
          finishStatus = 'failed';
          failure = errorMessage(payErr);
        }
      } else if (source === 'test' && testMode) {
        mode = 'test_ledger';
        finishStatus = 'completed';
        note = 'Test payout recorded. No money was sent to a bank. Live payouts need Stripe Connect onboarding and a live Stripe key.';
      } else if (!connectReady) {
        failure = 'Stripe Connect onboarding is not finished, so this payout cannot be sent to a bank.';
      } else if (source === 'test') {
        failure = 'Test banks cannot be used for a live payout. Add a bank through Stripe Connect.';
      } else {
        failure = 'That bank is missing a Stripe account id, so the payout was not sent.';
      }

      const finished = await walletOp(supabase, 'finish', workerId, {
        payout_id: payoutId,
        status: finishStatus,
        mode,
        stripe_payout_id: stripePayoutId,
        failure_reason: failure,
        note,
      });
      const snap = await walletOp(supabase, 'snapshot', workerId, {});
      return json({
        ...snap,
        ...meta(),
        ok: finishStatus !== 'failed',
        error: finishStatus === 'failed' ? 'payout_failed' : undefined,
        failure_reason: failure || undefined,
        payout: (finished.payout as Record<string, unknown>) || payout,
      });
    }

    return json(meta({ ok: false, error: 'unknown_action' }), 400);
  } catch (err) {
    console.error('request-payout error:', err);
    return json({ ok: false, error: 'payout_failed', details: errorMessage(err) }, 500);
  }
});
