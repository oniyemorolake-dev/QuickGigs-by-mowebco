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

function normalizePhone(raw: string): string {
  const digits = String(raw || '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('+') && digits.length >= 11 && digits.length <= 16) return digits;
  const only = digits.replace(/\D/g, '');
  if (only.length === 10) return '+1' + only;
  if (only.length === 11 && only.startsWith('1')) return '+' + only;
  if (only.length >= 11 && only.length <= 15) return '+' + only;
  return '';
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function publicStatus(user: Record<string, unknown>) {
  const emailVerified = user.email_verified === true;
  const phoneVerified = user.phone_verified === true;
  return {
    tasker_verified: user.tasker_verified === true,
    tasker_verified_at: user.tasker_verified_at || null,
    tasker_verification_status: String(user.tasker_verification_status || 'unverified'),
    tasker_background_check_status: String(user.tasker_background_check_status || 'not_started'),
    tasker_id_check_status: String(user.tasker_id_check_status || 'not_started'),
    tasker_id_check_required: user.tasker_id_check_required === true,
    phone_verification_required: user.phone_verification_required === true,
    email_verified: emailVerified,
    email_verified_at: user.email_verified_at || null,
    phone_verified: phoneVerified,
    phone_verified_at: user.phone_verified_at || null,
    phone_e164: user.phone_e164 ? String(user.phone_e164) : null,
    email_launch: true,
    soft_launch_complete: emailVerified,
    poster_verified: user.poster_verified === true,
    poster_verified_at: user.poster_verified_at || null,
    poster_verification_status: String(user.poster_verification_status || 'unverified'),
  };
}

async function recomputeTasker(supabase: ReturnType<typeof createClient>, uid: string) {
  const { data, error } = await supabase.rpc('qg_recompute_tasker_verified', { p_uid: uid });
  if (error) {
    // Fallback if RPC not deployed yet — email-only launch
    const { data: user } = await supabase
      .from('users')
      .select('email_verified,phone_verified,phone_verification_required,tasker_id_check_required,tasker_id_check_status')
      .eq('firebase_uid', uid)
      .maybeSingle();
    if (!user) return false;
    let ok = user.email_verified === true;
    if (user.phone_verification_required === true) ok = ok && user.phone_verified === true;
    if (user.tasker_id_check_required === true) ok = ok && user.tasker_id_check_status === 'verified';
    const now = new Date().toISOString();
    await supabase.from('users').update({
      tasker_verified: ok,
      tasker_verified_at: ok ? now : null,
      tasker_verification_status: ok ? 'verified' : 'unverified',
    }).eq('firebase_uid', uid);
    return ok;
  }
  return data === true;
}

async function loadUser(supabase: ReturnType<typeof createClient>, uid: string) {
  const { data, error } = await supabase
    .from('users')
    .select('firebase_uid,name,email,phone,status,account_status,date_of_birth,is_tasker,is_poster,tasker_verified,tasker_verified_at,tasker_verification_status,tasker_identity_session_id,tasker_background_check_status,tasker_id_check_status,tasker_id_check_required,phone_verification_required,email_verified,email_verified_at,phone_verified,phone_verified_at,phone_e164,poster_verified,poster_verified_at,poster_verification_status,poster_stripe_customer_id')
    .eq('firebase_uid', uid)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function sendTwilioSms(to: string, body: string): Promise<boolean> {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID') || '';
  const token = Deno.env.get('TWILIO_AUTH_TOKEN') || '';
  const from = Deno.env.get('TWILIO_FROM_NUMBER') || '';
  if (!sid || !token || !from) return false;
  const auth = btoa(`${sid}:${token}`);
  const params = new URLSearchParams({ To: to, From: from, Body: body });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  return res.ok;
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
    let user = await loadUser(supabase, identity.uid);
    if (!user) return json({ ok: false, error: 'user_not_found' }, 404);
    if (
      user.account_status === 'blocked' ||
      ['banned', 'blocked', 'suspended'].includes(String(user.status || '').toLowerCase())
    ) return json({ ok: false, error: 'account_blocked' }, 403);

    if (action === 'status') {
      // Keep email claim in sync opportunistically
      if (identity.emailVerified && user.email_verified !== true) {
        const now = new Date().toISOString();
        await supabase.from('users').update({
          email_verified: true,
          email_verified_at: now,
        }).eq('firebase_uid', identity.uid);
        await recomputeTasker(supabase, identity.uid);
        user = await loadUser(supabase, identity.uid);
      }
      return json({ ok: true, ...publicStatus(user || {}) });
    }

    // Email-launch: sync email from Firebase claims. Phone claim stored as hook data only.
    if (action === 'sync_tasker' || action === 'sync_tasker_contacts') {
      const now = new Date().toISOString();
      const updates: Record<string, unknown> = {};
      if (identity.emailVerified) {
        updates.email_verified = true;
        updates.email_verified_at = user.email_verified_at || now;
      }
      const tokenPhone = normalizePhone(identity.phoneNumber);
      if (tokenPhone) {
        // Store for future Firebase Phone Auth gate — does not grant tasker_verified alone.
        updates.phone_e164 = tokenPhone;
        updates.phone = tokenPhone;
        updates.phone_verified = true;
        updates.phone_verified_at = user.phone_verified_at || now;
      }
      if (Object.keys(updates).length) {
        const { error } = await supabase.from('users').update(updates).eq('firebase_uid', identity.uid);
        if (error) throw error;
      }
      await recomputeTasker(supabase, identity.uid);
      user = await loadUser(supabase, identity.uid);
      return json({ ok: true, ...publicStatus(user || {}) });
    }

    if (action === 'start_tasker') {
      if (user.is_tasker !== true) return json({ ok: false, error: 'tasker_role_required' }, 403);
      if (user.tasker_verified === true) {
        return json({ ok: true, already_verified: true, email_launch: true, ...publicStatus(user) });
      }
      return json({
        ok: true,
        email_launch: true,
        needs_email: user.email_verified !== true,
        message: 'Verify your email to start working.',
        ...publicStatus(user),
      });
    }

    // Future phone hook (Firebase Phone Auth) — structured, not required for email launch.
    if (action === 'send_phone_code' || action === 'confirm_phone_code') {
      return json({
        ok: false,
        error: 'phone_verification_not_enabled',
        message: 'Phone verification is reserved for a later release (Firebase Phone Auth). Email verification is enough for now.',
      }, 501);
    }

    // Future hard ID-check hook (Stripe Identity) — optional until policy flips tasker_id_check_required
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
    const needsStripe = ['start_tasker_id_check', 'sync_tasker_id_check', 'start_poster', 'sync_poster'].includes(action);
    if (needsStripe && !stripeKey) return json({ ok: false, error: 'stripe_not_configured' }, 503);
    const stripe = needsStripe ? new Stripe(stripeKey, { apiVersion: '2023-10-16' }) : null;
    const siteUrl = (Deno.env.get('SITE_URL') || 'https://quickgigs.ca').replace(/\/$/, '');

    if (action === 'start_tasker_id_check') {
      if (!stripe) return json({ ok: false, error: 'stripe_not_configured' }, 503);
      if (user.is_tasker !== true) return json({ ok: false, error: 'tasker_role_required' }, 403);
      if (user.tasker_id_check_status === 'verified') {
        return json({ ok: true, already_verified: true, tasker_id_check_status: 'verified', ...publicStatus(user) });
      }
      const session = await stripe.identity.verificationSessions.create({
        type: 'document',
        options: { document: { require_matching_selfie: true } },
        metadata: {
          project: 'quickgigs',
          purpose: 'tasker_id_check',
          firebase_uid: identity.uid,
        },
        return_url: `${siteUrl}/profile.html?verification=tasker_id&verification_return=1`,
      });
      const { error } = await supabase
        .from('users')
        .update({
          tasker_id_check_status: 'pending',
          tasker_identity_session_id: session.id,
        })
        .eq('firebase_uid', identity.uid);
      if (error) throw error;
      return json({ ok: true, url: session.url, status: 'pending', tasker_id_check_status: 'pending' });
    }

    if (action === 'sync_tasker_id_check') {
      if (!stripe) return json({ ok: false, error: 'stripe_not_configured' }, 503);
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
          tasker_id_check_status: 'verified',
          tasker_id_checked_at: now,
        }).eq('firebase_uid', identity.uid);
        await recomputeTasker(supabase, identity.uid);
        user = await loadUser(supabase, identity.uid);
        return json({ ok: true, tasker_id_check_status: 'verified', ...publicStatus(user || {}) });
      }
      const nextStatus = session.status === 'requires_input'
        ? 'rejected'
        : session.status === 'canceled' ? 'not_started' : 'pending';
      await supabase.from('users').update({
        tasker_id_check_status: nextStatus,
      }).eq('firebase_uid', identity.uid);
      await recomputeTasker(supabase, identity.uid);
      user = await loadUser(supabase, identity.uid);
      return json({ ok: true, tasker_id_check_status: nextStatus, ...publicStatus(user || {}) });
    }

    if (action === 'start_poster') {
      if (!stripe) return json({ ok: false, error: 'stripe_not_configured' }, 503);
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
      const allowedReturns = new Set(['posttask.html', 'profile.html', 'dashboard.html', 'mytasks.html']);
      const rawReturn = String(body.return_path || '')
        .trim()
        .replace(/^\//, '')
        .split('?')[0]
        .split('#')[0];
      const returnPath = allowedReturns.has(rawReturn) ? rawReturn : 'profile.html';
      const session = await stripe.checkout.sessions.create({
        mode: 'setup',
        customer: customerId,
        payment_method_types: ['card'],
        success_url: `${siteUrl}/${returnPath}?verification=poster&verification_return=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl}/${returnPath}?verification=poster&verification_cancelled=1`,
        metadata: {
          project: 'quickgigs',
          purpose: 'poster_payment_method',
          firebase_uid: identity.uid,
          return_path: returnPath,
        },
      });
      await supabase.from('users').update({ poster_verification_status: 'pending' }).eq('firebase_uid', identity.uid);
      return json({ ok: true, url: session.url, status: 'pending', return_path: returnPath });
    }

    if (action === 'sync_poster') {
      if (!stripe) return json({ ok: false, error: 'stripe_not_configured' }, 503);
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
        user = await loadUser(supabase, identity.uid);
        return json({
          ok: true,
          poster_verified: true,
          poster_verified_at: now,
          poster_verification_status: 'verified',
          ...publicStatus(user || {}),
        });
      }
      user = await loadUser(supabase, identity.uid);
      return json({
        ok: true,
        poster_verified: false,
        poster_verification_status: String(user?.poster_verification_status || 'pending'),
        ...publicStatus(user || {}),
      });
    }

    return json({ ok: false, error: 'invalid_action' }, 400);
  } catch (err) {
    console.error('role-verification error:', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
