// QuickGigs — Stripe Connect Express onboarding for taskers
// Deploy: supabase functions deploy create-connect-link --no-verify-jwt
// Secrets: STRIPE_SECRET_KEY, SITE_URL
//
// Creates (or reuses) an Express connected account, saves stripe_connect_id /
// guardian_stripe_connect_id, returns accountLinks.create URL for hosted onboarding.
//
// TODO / GUARD: Stripe requires account holders to be 18+. Under-18 taskers must
// NOT create their own Express account — a guardian completes onboarding instead
// (guardian_token + guardian_stripe_connect_id).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';
import { verifyGuardianToken } from '../_shared/guardian-token.ts';
import { ageFromDateOfBirth, isTeenDateOfBirth } from '../_shared/age.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function stripeErrMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.message === 'string' && e.message) return e.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      return json({ ok: false, error: 'stripe_not_configured' }, 503);
    }

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: 'invalid_json' }, 400);
    }

    const guardianToken = String(body.guardian_token || '').trim();
    let workerId = '';
    let guardianMode = false;
    if (guardianToken) {
      try {
        const claims = await verifyGuardianToken(guardianToken, 'guardian_payout');
        workerId = claims.uid;
        guardianMode = true;
      } catch (tokErr) {
        return json({
          ok: false,
          error: 'invalid_guardian_token',
          details: stripeErrMessage(tokErr),
        }, 403);
      }
    } else {
      try {
        const identity = await requireFirebaseUser(req);
        workerId = identity.uid;
      } catch (authErr) {
        return json({
          ok: false,
          error: authErr instanceof Error ? authErr.message : 'unauthorized',
        }, authErrorStatus(authErr));
      }
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: userRow, error: userErr } = await supabase
      .from('users')
      .select('date_of_birth,account_status,guardian_consent_status,guardian_email,guardian_stripe_connect_id,stripe_connect_id,email,is_tasker')
      .eq('firebase_uid', workerId)
      .maybeSingle();

    if (userErr) {
      return json({ ok: false, error: 'user_lookup_failed', details: userErr.message }, 500);
    }
    if (!userRow) return json({ ok: false, error: 'user_not_found' }, 404);

    // --- Under-18 guard: Stripe account holders must be 18+ ---
    // Minors cannot create their own Express account; guardian path only.
    const age = ageFromDateOfBirth(userRow.date_of_birth);
    const under18 = age != null ? age < 18 : isTeenDateOfBirth(userRow.date_of_birth);
    if (!guardianMode && under18) {
      return json({
        ok: false,
        error: 'minor_requires_guardian_payout',
        // TODO: Stripe requires account holders to be 18+. Minors' payout accounts
        // must be held by a guardian (parent-consent → create-connect-link with guardian_token).
        message:
          'Stripe requires payout account holders to be 18 or older. Ask your parent/guardian to open the consent link and set up payouts for you.',
      }, 403);
    }

    if (guardianMode && (
      userRow.account_status !== 'active' ||
      userRow.guardian_consent_status !== 'approved'
    )) {
      return json({ ok: false, error: 'guardian_consent_required' }, 403);
    }

    const email = guardianMode
      ? String(userRow.guardian_email || '')
      : String(body.email || userRow.email || '');

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
    let accountId = guardianMode
      ? (userRow.guardian_stripe_connect_id || '')
      : (userRow.stripe_connect_id || '');

    if (!accountId) {
      let account: Stripe.Account;
      try {
        account = await stripe.accounts.create({
          type: 'express',
          country: 'CA',
          email: email || undefined,
          business_type: 'individual',
          capabilities: {
            transfers: { requested: true },
          },
          metadata: {
            project: 'quickgigs',
            firebase_uid: workerId,
            payout_owner: guardianMode ? 'guardian' : 'worker',
          },
        });
      } catch (createErr) {
        console.error('stripe.accounts.create failed:', createErr);
        return json({
          ok: false,
          error: 'stripe_account_create_failed',
          details: stripeErrMessage(createErr),
        }, 502);
      }
      accountId = account.id;
      const { error: saveErr } = await supabase
        .from('users')
        .update(guardianMode
          ? { guardian_stripe_connect_id: accountId }
          : { stripe_connect_id: accountId })
        .eq('firebase_uid', workerId);
      if (saveErr) {
        console.error('Failed to save connect id:', saveErr);
        return json({
          ok: false,
          error: 'connect_id_save_failed',
          details: saveErr.message,
          account_id: accountId,
        }, 500);
      }
    }

    const siteUrl = (Deno.env.get('SITE_URL') || 'https://quickgigs.ca').replace(/\/$/, '');
    let link: Stripe.AccountLink;
    try {
      link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: guardianMode
          ? `${siteUrl}/parent-consent.html?payout=refresh`
          : `${siteUrl}/profile.html?stripe=refresh`,
        return_url: guardianMode
          ? `${siteUrl}/parent-consent.html?payout=done`
          : `${siteUrl}/profile.html?stripe=done`,
        type: 'account_onboarding',
      });
    } catch (linkErr) {
      console.error('stripe.accountLinks.create failed:', linkErr);
      return json({
        ok: false,
        error: 'stripe_account_link_failed',
        details: stripeErrMessage(linkErr),
        account_id: accountId,
      }, 502);
    }

    return json({
      ok: true,
      url: link.url,
      account_id: accountId,
      payout_owner: guardianMode ? 'guardian' : 'worker',
    });
  } catch (err) {
    console.error('create-connect-link error:', err);
    return json({ ok: false, error: stripeErrMessage(err) }, 500);
  }
});
