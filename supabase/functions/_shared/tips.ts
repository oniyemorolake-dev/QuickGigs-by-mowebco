// Tips: a poster's thank-you to the tasker after a finished gig.
// 100% of a tip goes to the tasker (no platform fee). The poster is charged on
// the platform account, then the full amount is transferred to the tasker's
// (or, for a 16-17 year old, the guardian's) Stripe account.
//
// Tip sessions carry metadata.project = 'quickgigs_tip', NOT 'quickgigs', so
// every escrow handler (webhook, confirm-checkout, sync-payment) ignores them.

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { isTeenDateOfBirth } from './age.ts';

// deno-lint-ignore no-explicit-any
type Sb = any;

export const TIP_PROJECT = 'quickgigs_tip';
export const TIP_MIN_CENTS = 200;
export const TIP_MAX_CENTS = 20000;

/** Where a tasker's money goes: their own account, or the guardian's for a minor. */
export async function tipDestination(supabase: Sb, workerId: string): Promise<string> {
  const { data: u } = await supabase
    .from('users')
    .select('date_of_birth,guardian_consent_status,guardian_stripe_connect_id,stripe_connect_id')
    .eq('firebase_uid', workerId)
    .maybeSingle();
  if (!u) return '';
  if (isTeenDateOfBirth(u.date_of_birth)) {
    return u.guardian_consent_status === 'approved' ? String(u.guardian_stripe_connect_id || '') : '';
  }
  return String(u.stripe_connect_id || '');
}

/**
 * Bring one tip up to date with Stripe. Safe to call any number of times:
 * pending -> collected (poster charged) -> paid (sent to the tasker).
 */
export async function settleTip(
  supabase: Sb,
  stripe: Stripe,
  tip: Record<string, unknown>,
): Promise<{ status: string; changed: boolean }> {
  const tipId = String(tip.tip_id || '');
  let status = String(tip.status || '');
  if (!tipId || status === 'paid' || status === 'expired' || status === 'failed') {
    return { status, changed: false };
  }
  const sessionId = String(tip.stripe_session_id || '');
  if (!sessionId) return { status, changed: false };

  let piId = String(tip.stripe_pi || '');
  let chargeId = '';
  let changed = false;

  if (status === 'pending') {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.metadata?.project !== TIP_PROJECT || session.metadata?.tip_id !== tipId) {
      return { status, changed: false };
    }
    if (session.payment_status !== 'paid') {
      if (session.status === 'expired') {
        await supabase.from('tips').update({ status: 'expired' }).eq('tip_id', tipId).eq('status', 'pending');
        return { status: 'expired', changed: true };
      }
      return { status, changed: false };
    }
    // Never trust the row for the amount: record what was actually charged.
    const paidCents = Number(session.amount_total || 0);
    piId = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id || '');
    const { data: moved } = await supabase
      .from('tips')
      .update({ status: 'collected', stripe_pi: piId, amount_cents: paidCents, collected_at: new Date().toISOString() })
      .eq('tip_id', tipId)
      .eq('status', 'pending')
      .select('tip_id');
    if (moved && moved.length) changed = true;
    status = 'collected';
    tip = { ...tip, amount_cents: paidCents, stripe_pi: piId };
  }

  if (status !== 'collected' || !piId) return { status, changed };

  const workerId = String(tip.worker_id || '');
  const destination = await tipDestination(supabase, workerId);
  if (!destination) return { status, changed }; // stays collected until payout is set up

  const pi = await stripe.paymentIntents.retrieve(piId);
  chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : (pi.latest_charge?.id || '');
  if (pi.status !== 'succeeded' || !chargeId) return { status, changed };

  const cents = Number(tip.amount_cents || 0);
  const transfer = await stripe.transfers.create(
    {
      amount: cents,
      currency: 'cad',
      destination,
      source_transaction: chargeId,
      metadata: { project: TIP_PROJECT, tip_id: tipId, task_id: String(tip.task_id || ''), worker_id: workerId },
    },
    { idempotencyKey: `qg-tip-${tipId}` },
  );

  const { data: done } = await supabase
    .from('tips')
    .update({ status: 'paid', transfer_id: transfer.id, paid_at: new Date().toISOString() })
    .eq('tip_id', tipId)
    .eq('status', 'collected')
    .select('tip_id');

  if (done && done.length) {
    // Tell the tasker. Best effort: the tip itself is already theirs.
    try {
      const { data: worker } = await supabase.from('users').select('email').eq('firebase_uid', workerId).maybeSingle();
      const { data: task } = await supabase.from('tasks').select('title').eq('task_id', tip.task_id).maybeSingle();
      const dollars = '$' + (cents / 100).toFixed(2);
      if (worker?.email) {
        await supabase.from('notification_queue').insert({
          user_id: workerId,
          email: worker.email,
          type: 'tip_received',
          subject: `You got a ${dollars} tip`,
          body_text: `The poster of "${task?.title || 'your gig'}" sent you a ${dollars} tip. All of it is yours and it is in your SwiftGigs balance now.`,
          payload: { link: 'https://quickgigs.ca/profile.html#earnings', tip_id: tipId, amount_cents: cents },
        });
      }
    } catch (noteErr) {
      console.warn('tip notification skipped:', noteErr);
    }
    return { status: 'paid', changed: true };
  }
  return { status: 'paid', changed };
}
