// Supabase Edge Function — deliver queued notification email via Resend (INTERNAL ONLY)
// Deploy: supabase functions deploy send-notification --no-verify-jwt
// Secrets: RESEND_API_KEY, FROM_EMAIL (optional), NOTIFICATION_SEND_SECRET (or GRADUATION_CRON_SECRET)
//
// Auth: requires header x-qg-notification-secret matching NOTIFICATION_SEND_SECRET
// (or GRADUATION_CRON_SECRET as fallback). Prefers notification_id from notification_queue.
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
      type = String(row.type || type || '').trim();
      subject = String(row.subject || subject);
      text = String(row.body_text || row.body || text);
      payload = { ...parsePayload(row.payload), ...payload };
    }

    if (!email) {
      // Missing recipient is a data issue — report but do not 5xx-crash callers.
      if (notificationId) {
        await supabase
          .from('notification_queue')
          .update({ error_message: 'missing_email' })
          .eq('notification_id', notificationId);
      }
      return json({ ok: true, delivered: false, error: 'missing_email' });
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
          .update({ sent_at: new Date().toISOString(), error_message: null })
          .eq('notification_id', notificationId);
      } else {
        await supabase
          .from('notification_queue')
          .update({ error_message: (resendError || 'resend_failed').slice(0, 500) })
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
