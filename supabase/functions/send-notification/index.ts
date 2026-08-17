// Supabase Edge Function — deliver queued notification email via Resend (INTERNAL ONLY)
// Deploy: supabase functions deploy send-notification --no-verify-jwt
// Secrets: RESEND_API_KEY, FROM_EMAIL (optional), NOTIFICATION_SEND_SECRET (or GRADUATION_CRON_SECRET)
//
// Auth: requires header x-qg-notification-secret matching NOTIFICATION_SEND_SECRET
// (or GRADUATION_CRON_SECRET as fallback). Prefers notification_id from notification_queue.
//
// Recipient email: for normal QuickGigs user_ids, ALWAYS resolved server-side from
// public.users (firebase_uid / user_id) via service role. Clients must not supply
// another user's email. Waitlist + guardian rows keep the explicit email on the queue.
//
// Delivery failures are logged and recorded on the queue row — they return delivered:false
// with HTTP 200 so callers (task/application flows) are never blocked by email outages.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildNotificationEmail,
  DEFAULT_FROM,
  type NotifPayload,
} from '../_shared/notification-email.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-qg-notification-secret',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function parsePayload(raw: unknown): NotifPayload {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as NotifPayload;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed as NotifPayload : {};
    } catch {
      return {};
    }
  }
  return {};
}

function looksLikeEmail(value: string): boolean {
  const e = String(value || '').trim();
  return e.includes('@') && e.length >= 5 && e.length <= 254;
}

type Sb = ReturnType<typeof createClient>;

/**
 * Resolve delivery address.
 * - waitlist:* → queue email or email embedded in user_id
 * - guardian / guardian:* → queue email only (guardian address, not teen account)
 * - normal user_id → ALWAYS look up users.email by firebase_uid (then user_id PK)
 */
async function resolveRecipientEmail(
  supabase: Sb,
  userId: string,
  queueEmail: string,
): Promise<{ email: string; source: string }> {
  const uid = String(userId || '').trim();
  const queued = String(queueEmail || '').trim();

  if (uid.startsWith('waitlist:')) {
    if (looksLikeEmail(queued)) return { email: queued, source: 'queue' };
    const embedded = uid.slice('waitlist:'.length).trim();
    if (looksLikeEmail(embedded)) return { email: embedded, source: 'waitlist_user_id' };
    return { email: '', source: 'missing' };
  }

  if (!uid || uid === 'guardian' || uid.startsWith('guardian:')) {
    if (looksLikeEmail(queued)) return { email: queued, source: 'queue_guardian' };
    return { email: '', source: 'guardian_requires_email' };
  }

  const { data: byFb } = await supabase
    .from('users')
    .select('email')
    .eq('firebase_uid', uid)
    .maybeSingle();
  if (byFb && looksLikeEmail(String(byFb.email || ''))) {
    return { email: String(byFb.email).trim(), source: 'users.firebase_uid' };
  }

  const { data: byPk } = await supabase
    .from('users')
    .select('email')
    .eq('user_id', uid)
    .maybeSingle();
  if (byPk && looksLikeEmail(String(byPk.email || ''))) {
    return { email: String(byPk.email).trim(), source: 'users.user_id' };
  }

  // Last resort: rare legacy rows where client already filled a valid email
  if (looksLikeEmail(queued)) return { email: queued, source: 'queue_fallback' };
  return { email: '', source: 'user_email_not_found' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const expected =
      Deno.env.get('NOTIFICATION_SEND_SECRET') ||
      Deno.env.get('GRADUATION_CRON_SECRET') ||
      '';
    if (!expected || expected.length < 16) {
      return json({ ok: false, error: 'notification_secret_not_configured' }, 503);
    }
    const provided = req.headers.get('x-qg-notification-secret') || '';
    if (!provided || !timingSafeEqual(provided, expected)) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const notificationId = body.notification_id ? String(body.notification_id) : '';
    let email = String(body.email || '').trim();
    let userId = String(body.user_id || body.userId || '').trim();
    let type = String(body.type || '').trim();
    let subject = String(body.subject || 'QuickGigs update');
    let text = String(body.body || body.body_text || '');
    let payload: NotifPayload = parsePayload(body.payload);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Prefer queue row — prevents arbitrary email content from becoming the primary path
    if (notificationId) {
      const { data: row, error } = await supabase
        .from('notification_queue')
        .select('*')
        .eq('notification_id', notificationId)
        .maybeSingle();
      if (error || !row) return json({ ok: false, error: 'notification_not_found' }, 404);
      if (row.sent_at) return json({ ok: true, already: true, delivered: true });
      email = String(row.email || email || '').trim();
      userId = String(row.user_id || userId || '').trim();
      type = String(row.type || type || '').trim();
      subject = String(row.subject || subject);
      text = String(row.body_text || row.body || text);
      payload = { ...parsePayload(row.payload), ...payload };
    }

    const resolved = await resolveRecipientEmail(supabase, userId, email);
    email = resolved.email;

    if (notificationId && email) {
      // Persist resolved address on the queue row for audit / retries
      await supabase
        .from('notification_queue')
        .update({ email })
        .eq('notification_id', notificationId);
    }

    if (!email) {
      // Missing recipient is a data issue — report but do not 5xx-crash callers.
      if (notificationId) {
        await supabase
          .from('notification_queue')
          .update({ error_message: resolved.source || 'missing_email' })
          .eq('notification_id', notificationId);
      }
      return json({
        ok: true,
        delivered: false,
        error: 'missing_email',
        resolve_source: resolved.source,
      });
    }

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) {
      console.error('send-notification: RESEND_API_KEY not configured');
      if (notificationId) {
        await supabase
          .from('notification_queue')
          .update({ error_message: 'resend_not_configured' })
          .eq('notification_id', notificationId);
      }
      return json({ ok: true, delivered: false, error: 'resend_not_configured' });
    }

    const built = buildNotificationEmail(type || 'generic', payload, subject, text);
    const from = Deno.env.get('FROM_EMAIL') || DEFAULT_FROM;

    let resendOk = false;
    let resendId = '';
    let resendError = '';

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + resendKey,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: built.subject,
          text: built.text,
          html: built.html,
        }),
      });

      const resendData = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        resendError = JSON.stringify(resendData).slice(0, 500);
        console.error('Resend error:', resendData);
      } else {
        resendOk = true;
        resendId = String(resendData.id || '');
      }
    } catch (sendErr) {
      resendError = sendErr instanceof Error ? sendErr.message : 'resend_network_error';
      console.error('Resend fetch failed:', sendErr);
    }

    if (notificationId) {
      if (resendOk) {
        await supabase
          .from('notification_queue')
          .update({ sent_at: new Date().toISOString(), error_message: null, email })
          .eq('notification_id', notificationId);
      } else {
        await supabase
          .from('notification_queue')
          .update({ error_message: (resendError || 'resend_failed').slice(0, 500), email })
          .eq('notification_id', notificationId);
      }
    }

    // Always 200 after auth + acceptance so email outages never block product actions.
    return json({
      ok: true,
      delivered: resendOk,
      id: resendId || undefined,
      type: type || undefined,
      from,
      resolve_source: resolved.source,
      error: resendOk ? undefined : (resendError ? 'resend_failed' : undefined),
    });
  } catch (err) {
    console.error('send-notification error:', err);
    // Unexpected errors still return a soft failure so upstream actions continue.
    return json({
      ok: true,
      delivered: false,
      error: 'send_failed',
    });
  }
});
