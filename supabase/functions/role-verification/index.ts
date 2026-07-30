import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { isTeenDateOfBirth } from '../_shared/age.ts';
import { authErrorStatus, requireFirebaseUser } from '../_shared/firebase-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function publicStatus(user: Record<string, unknown>) {
  return {
    tasker_verified: user.tasker_verified === true,
    tasker_verified_at: user.tasker_verified_at || null,
    tasker_verification_status: String(user.tasker_verification_status || 'unverified'),
    tasker_background_check_status: String(user.tasker_background_check_status || 'not_started'),
    poster_verified: user.poster_verified === true,
    poster_verified_at: user.poster_verified_at || null,
    poster_verification_status: String(user.poster_verification_status || 'unverified'),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  let identity;
  try {
    identity = await requireFirebaseUser(req);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'unauthorized' }, authErrorStatus(err));
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'status').toLowerCase();
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('firebase_uid,name,email,status,account_status,date_of_birth,is_tasker,is_poster,tasker_verified,tasker_verified_at,tasker_verification_status,tasker_identity_session_id,tasker_background_check_status,poster_verified,poster_verified_at,poster_verification_status,poster_stripe_customer_id')
      .eq('firebase_uid', identity.uid)
      .maybeSingle();
    if (userError) throw userError;
    if (!user) return json({ ok: false, error: 'user_not_found' }, 404);
    if (
      user.account_status === 'blocked' ||
      ['banned', 'blocked', 'suspended'].includes(String(user.status || '').toLowerCase())
    ) return json({ ok: false, error: 'account_blocked' }, 403);

    if (action === 'status') return json({ ok: true, ...publicStatus(user) });
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
    if (!stripeKey) return json({ ok: false, error: 'stripe_not_configured' }, 503);
    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

    const siteUrl = (Deno.env.get('SITE_URL') || 'https://quickgigs.ca').replace(/\/$/, '');
    if (action === 'start_tasker') {
      if (user.is_tasker !== true) return json({ ok: false, error: 'tasker_role_required' }, 403);
      if (user.tasker_verified === true) return json({ ok: true, already_verified: true, ...publicStatus(user) });
      const session = await stripe.identity.verificationSessions.create({
        type: 'document',
        options: { document: { require_matching_selfie: true } },
        metadata: {
          project: 'quickgigs',
          purpose: 'tasker_identity',
          firebase_uid: identity.uid,
        },
        return_url: `${siteUrl}/profile.html?verification=tasker&verification_return=1`,
      });
      const { error } = await supabase
        .from('users')
        .update({
          tasker_verification_status: 'pending',
          tasker_identity_session_id: session.id,
        })
        .eq('firebase_uid', identity.uid);
      if (error) throw error;
      return json({ ok: true, url: session.url, status: 'pending' });
    }

    if (action === 'sync_tasker') {
      const sessionId = String(user.tasker_identity_session_id || '');
      if (!sessionId) return json({ ok: false, error: 'identity_session_not_found' }, 404);
      const session = await stripe.identity.verificationSessions.retrieve(sessionId);
      if (
        session.metadata?.project !== 'quickgigs' ||
        session.metadata?.firebase_uid !== identity.uid
      ) return json({ ok: false, error: 'identity_session_mismatch' }, 403);
      if (session.status === 'verified') {
        const now = new Date().toISOString();
        await supabase.from('users').update({
          tasker_verified: true,
          tasker_verified_at: now,
          tasker_verification_status: 'verified',
        }).eq('firebase_uid', identity.uid);
        return json({ ok: true, tasker_verified: true, tasker_verified_at: now, tasker_verification_status: 'verified' });
      }
      const nextStatus = session.status === 'requires_input'
        ? 'rejected'
        : session.status === 'canceled' ? 'unverified' : 'pending';
      await supabase.from('users').update({
        tasker_verified: false,
        tasker_verified_at: null,
        tasker_verification_status: nextStatus,
      }).eq('firebase_uid', identity.uid);
      return json({ ok: true, tasker_verified: false, tasker_verification_status: nextStatus });
    }

    if (action === 'start_poster') {
      if (user.is_poster !== true) return json({ ok: false, error: 'poster_role_required' }, 403);
      if (isTeenDateOfBirth(user.date_of_birth)) {
        return json({ ok: false, error: 'teen_poster_unavailable' }, 403);
      }
      if (user.poster_verified === true) return json({ ok: true, already_verified: true, ...publicStatus(user) });
      let customerId = String(user.poster_stripe_customer_id || '');
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: identity.email || String(user.email || '') || undefined,
          name: String(user.name || '') || undefined,
          metadata: { project: 'quickgigs', firebase_uid: identity.uid },
        });
        customerId = customer.id;
        const { error } = await supabase
          .from('users')
          .update({ poster_stripe_customer_id: customerId, poster_verification_status: 'pending' })
          .eq('firebase_uid', identity.uid);
        if (error) throw error;
      }
      const session = await stripe.checkout.sessions.create({
        mode: 'setup',
        customer: customerId,
        payment_method_types: ['card'],
        success_url: `${siteUrl}/profile.html?verification=poster&verification_return=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl}/profile.html?verification=poster&verification_cancelled=1`,
        metadata: {
          project: 'quickgigs',
          purpose: 'poster_payment_method',
          firebase_uid: identity.uid,
        },
      });
      await supabase.from('users').update({ poster_verification_status: 'pending' }).eq('firebase_uid', identity.uid);
      return json({ ok: true, url: session.url, status: 'pending' });
    }

    if (action === 'sync_poster') {
      const sessionId = String(body.session_id || '').trim();
      if (!sessionId) return json({ ok: false, error: 'missing_session_id' }, 400);
      const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['setup_intent'] });
      if (
        session.metadata?.project !== 'quickgigs' ||
        session.metadata?.purpose !== 'poster_payment_method' ||
        session.metadata?.firebase_uid !== identity.uid
      ) return json({ ok: false, error: 'setup_session_mismatch' }, 403);
      const setupIntent = session.setup_intent as Stripe.SetupIntent | null;
      const paymentMethod = setupIntent && typeof setupIntent.payment_method === 'string'
        ? setupIntent.payment_method
        : setupIntent?.payment_method?.id || '';
      if (session.status === 'complete' && setupIntent?.status === 'succeeded' && paymentMethod) {
        const now = new Date().toISOString();
        await supabase.from('users').update({
          poster_verified: true,
          poster_verified_at: now,
          poster_verification_status: 'verified',
          poster_payment_method_id: paymentMethod,
        }).eq('firebase_uid', identity.uid);
        return json({ ok: true, poster_verified: true, poster_verified_at: now, poster_verification_status: 'verified' });
      }
      return json({ ok: true, poster_verified: false, poster_verification_status: 'pending' });
    }

    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (err) {
    console.error('role-verification error:', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
