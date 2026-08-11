/**
 * QuickGigs — Resend email content for send-notification.
 * Builds subject + plain text + on-brand HTML from notification type + payload.
 * Privacy: never include payment instrument details or private chat message bodies.
 */

export type NotifPayload = Record<string, unknown>;

export type BuiltEmail = {
  subject: string;
  text: string;
  html: string;
};

const SITE = 'https://quickgigs.ca';
const PREFS_URL = `${SITE}/profile.html`;
const SUPPORT = 'support@quickgigs.ca';
const BRAND = '#6b3fa0';
const BRAND_SOFT = '#f3eef9';
const TEXT = '#1e1533';
const MUTED = '#5c5670';

function str(v: unknown, fallback = ''): string {
  if (v == null) return fallback;
  return String(v).trim() || fallback;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function moneyish(v: unknown): string {
  const n = Number(v);
  if (isFinite(n) && n > 0) return `$${n.toFixed(n % 1 ? 2 : 0)}`;
  const s = str(v);
  if (!s) return '';
  return s.startsWith('$') ? s : `$${s}`;
}

function cta(label: string, href: string): string {
  const safeHref = esc(href || SITE);
  return `<a href="${safeHref}" style="display:inline-block;padding:12px 22px;border-radius:12px;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;font-family:Arial,Helvetica,sans-serif;">${esc(label)}</a>`;
}

function wrapHtml(opts: {
  preheader: string;
  title: string;
  paragraphs: string[];
  ctaLabel?: string;
  ctaHref?: string;
  showPrefs?: boolean;
}): string {
  const paras = opts.paragraphs
    .filter(Boolean)
    .map((p) =>
      `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${MUTED};font-family:Arial,Helvetica,sans-serif;">${p}</p>`
    )
    .join('');
  const button = opts.ctaLabel && opts.ctaHref
    ? `<p style="margin:24px 0 8px;text-align:center;">${cta(opts.ctaLabel, opts.ctaHref)}</p>`
    : '';
  const prefs = opts.showPrefs !== false
    ? `<p style="margin:28px 0 0;font-size:12px;line-height:1.5;color:#9a91b8;font-family:Arial,Helvetica,sans-serif;text-align:center;">
        <a href="${PREFS_URL}" style="color:${BRAND};text-decoration:underline;">Manage email preferences</a>
        · <a href="mailto:${SUPPORT}" style="color:${BRAND};text-decoration:underline;">Contact support</a>
      </p>`
    : `<p style="margin:28px 0 0;font-size:12px;line-height:1.5;color:#9a91b8;font-family:Arial,Helvetica,sans-serif;text-align:center;">
        <a href="mailto:${SUPPORT}" style="color:${BRAND};text-decoration:underline;">Contact support</a>
      </p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)}</title>
<!--[if mso]><style>body,table,td{font-family:Arial,Helvetica,sans-serif!important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#f7f5ff;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5ff;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;border:1px solid #e8e2f4;overflow:hidden;">
          <tr>
            <td style="padding:20px 24px;background:${BRAND_SOFT};border-bottom:1px solid #e8e2f4;">
              <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:22px;color:${BRAND};">QuickGigs</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px 8px;">
              <h1 style="margin:0 0 16px;font-size:20px;line-height:1.35;color:${TEXT};font-family:Arial,Helvetica,sans-serif;font-weight:700;">${esc(opts.title)}</h1>
              ${paras}
              ${button}
              ${prefs}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px 22px;border-top:1px solid #f0eef8;">
              <p style="margin:0;font-size:11px;line-height:1.5;color:#9a91b8;font-family:Arial,Helvetica,sans-serif;text-align:center;">
                QuickGigs · Canada · <a href="${SITE}" style="color:${BRAND};text-decoration:none;">quickgigs.ca</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function linkOr(payload: NotifPayload, fallback: string): string {
  return str(payload.link || payload.consentUrl || payload.url, fallback);
}

type Spec = {
  subject: string;
  title: string;
  preheader: string;
  paragraphs: string[];
  textLines: string[];
  ctaLabel: string;
  ctaHref: string;
  showPrefs?: boolean;
};

function buildSpec(type: string, payload: NotifPayload, fallbackSubject: string, fallbackText: string): Spec {
  const taskTitle = str(payload.taskTitle || payload.title, 'a task');
  const workerName = str(payload.workerName || payload.taskerName, 'A tasker');
  const posterName = str(payload.posterName, 'The poster');
  const senderName = str(payload.senderName, 'Someone');
  const teenName = str(payload.teenName, 'your teen');
  const guardianName = str(payload.guardianName, 'your parent/guardian');
  const partyName = str(payload.partyName, 'They');
  const amount = moneyish(payload.amount || payload.offer || payload.budget);
  const reason = str(payload.reason, 'Not specified');
  const location = str(payload.location, 'Near you');

  switch (type) {
    case 'application_received':
    case 'apply':
      return {
        subject: fallbackSubject || `New applicant for “${taskTitle}”`,
        title: 'New application on your task',
        preheader: `${workerName} applied to “${taskTitle}”`,
        paragraphs: [
          esc(`${workerName} applied to your task “${taskTitle}”`) +
            (amount ? ` with an offer of <strong style="color:${TEXT}">${esc(amount)}</strong>` : '') + '.',
          'Open QuickGigs to review applicants and accept the best fit.',
        ],
        textLines: [
          `${workerName} applied to your task “${taskTitle}”` + (amount ? ` with an offer of ${amount}` : '') + '.',
          '',
          'Review applicants:',
          linkOr(payload, `${SITE}/mytasks.html?tab=posted`),
        ],
        ctaLabel: 'Review applicants',
        ctaHref: linkOr(payload, `${SITE}/mytasks.html?tab=posted`),
      };

    case 'application_accepted':
    case 'accept':
      return {
        subject: fallbackSubject || `You were hired for “${taskTitle}”`,
        title: 'You’re hired',
        preheader: `${posterName} accepted your application`,
        paragraphs: [
          esc(`Great news — ${posterName} accepted your application for “${taskTitle}”.`),
          'Head to My Tasks to coordinate next steps.',
        ],
        textLines: [
          `Great news — ${posterName} accepted your application for “${taskTitle}”.`,
          '',
          'Open My Tasks:',
          linkOr(payload, `${SITE}/mytasks.html?tab=inprogress`),
        ],
        ctaLabel: 'Open My Tasks',
        ctaHref: linkOr(payload, `${SITE}/mytasks.html?tab=inprogress`),
      };

    case 'task_completed':
    case 'complete':
      return {
        subject: fallbackSubject || `Task complete: “${taskTitle}”`,
        title: 'Task marked complete',
        preheader: `“${taskTitle}” was marked complete`,
        paragraphs: [
          esc(`“${taskTitle}” was marked complete on QuickGigs.`),
          'Please leave a review to help the community.',
        ],
        textLines: [
          `“${taskTitle}” was marked complete on QuickGigs.`,
          '',
          'Leave a review:',
          linkOr(payload, `${SITE}/mytasks.html?tab=completed`),
        ],
        ctaLabel: 'Leave a review',
        ctaHref: linkOr(payload, `${SITE}/mytasks.html?tab=completed`),
      };

    case 'new_message':
    case 'chat_message':
    case 'chat':
      // Privacy: never include private chat message content in email.
      return {
        subject: fallbackSubject || `New message from ${senderName}`,
        title: 'You have a new message',
        preheader: `${senderName} sent you a message on QuickGigs`,
        paragraphs: [
          esc(`${senderName} sent you a message`) +
            (taskTitle !== 'a task' ? esc(` about “${taskTitle}”`) : '') + '.',
          'Open QuickGigs to read and reply securely on the platform.',
        ],
        textLines: [
          `${senderName} sent you a message` + (taskTitle !== 'a task' ? ` about “${taskTitle}”` : '') + '.',
          '',
          'Open messages (content is only shown in-app):',
          linkOr(payload, `${SITE}/messages.html`),
        ],
        ctaLabel: 'Open messages',
        ctaHref: linkOr(payload, `${SITE}/messages.html`),
      };

    case 'counter_offer_received':
    case 'counter_offer':
      return {
        subject: fallbackSubject || `Counter offer${amount ? `: ${amount}` : ''} on “${taskTitle}”`,
        title: 'New counter offer',
        preheader: `${posterName} sent a counter offer`,
        paragraphs: [
          esc(`${posterName} countered your application`) +
            (amount ? ` at <strong style="color:${TEXT}">${esc(amount)}</strong>` : '') +
            esc(` for “${taskTitle}”.`),
          'Accept, decline, or counter back in My Tasks.',
        ],
        textLines: [
          `${posterName} countered your application` + (amount ? ` at ${amount}` : '') + ` for “${taskTitle}”.`,
          '',
          'Respond in My Tasks:',
          linkOr(payload, `${SITE}/mytasks.html?tab=applied`),
        ],
        ctaLabel: 'Respond in My Tasks',
        ctaHref: linkOr(payload, `${SITE}/mytasks.html?tab=applied`),
      };

    case 'counter_offer_reply':
      return {
        subject: fallbackSubject || `Counter back${amount ? `: ${amount}` : ''} on “${taskTitle}”`,
        title: 'Tasker countered back',
        preheader: `${workerName} sent a counter offer`,
        paragraphs: [
          esc(`${workerName} countered back`) +
            (amount ? ` at <strong style="color:${TEXT}">${esc(amount)}</strong>` : '') +
            esc(` on “${taskTitle}”.`),
          'Review the offer in My Tasks → Posted.',
        ],
        textLines: [
          `${workerName} countered back` + (amount ? ` at ${amount}` : '') + ` on “${taskTitle}”.`,
          '',
          'Review in My Tasks:',
          linkOr(payload, `${SITE}/mytasks.html?tab=posted`),
        ],
        ctaLabel: 'Review offer',
        ctaHref: linkOr(payload, `${SITE}/mytasks.html?tab=posted`),
      };

    case 'counter_offer_accepted':
      return {
        subject: fallbackSubject || `Price agreed${amount ? `: ${amount}` : ''} on “${taskTitle}”`,
        title: 'Price agreed',
        preheader: `A counter offer was accepted for “${taskTitle}”`,
        paragraphs: [
          esc(`${partyName} accepted`) +
            (amount ? ` <strong style="color:${TEXT}">${esc(amount)}</strong>` : ' the agreed price') +
            esc(` for “${taskTitle}”.`),
          'Open QuickGigs to continue.',
        ],
        textLines: [
          `${partyName} accepted` + (amount ? ` ${amount}` : ' the agreed price') + ` for “${taskTitle}”.`,
          '',
          'Continue:',
          linkOr(payload, `${SITE}/mytasks.html`),
        ],
        ctaLabel: 'Open QuickGigs',
        ctaHref: linkOr(payload, `${SITE}/mytasks.html`),
      };

    case 'guardian_consent':
      return {
        subject: fallbackSubject || `Approve ${teenName}'s QuickGigs account`,
        title: 'Guardian approval needed',
        preheader: `${teenName} needs your approval to use QuickGigs`,
        paragraphs: [
          esc(`${teenName} signed up for QuickGigs and listed you as their parent/guardian.`),
          'Because they are 16 or 17, we need your approval before they can post or apply to tasks.',
          'If you did not authorize this, ignore this email or contact support.',
        ],
        textLines: [
          `${teenName} signed up for QuickGigs and listed you as their parent/guardian.`,
          '',
          'Approve their account:',
          linkOr(payload, `${SITE}/parent-consent.html`),
          '',
          `If you did not authorize this, contact ${SUPPORT}.`,
        ],
        ctaLabel: 'Review & approve',
        ctaHref: linkOr(payload, `${SITE}/parent-consent.html`),
        showPrefs: false,
      };

    case 'guardian_pending':
      return {
        subject: fallbackSubject || 'Waiting for guardian approval',
        title: 'Waiting for guardian approval',
        preheader: 'Your QuickGigs account needs guardian approval',
        paragraphs: [
          esc(`Ask ${guardianName} to approve your QuickGigs account before you can apply or post.`),
        ],
        textLines: [
          `Ask ${guardianName} to approve your QuickGigs account before you can apply or post.`,
          '',
          linkOr(payload, `${SITE}/dashboard.html`),
        ],
        ctaLabel: 'Open dashboard',
        ctaHref: linkOr(payload, `${SITE}/dashboard.html`),
      };

    case 'guardian_approved':
      return {
        subject: fallbackSubject || 'Your QuickGigs account was approved',
        title: 'Account approved',
        preheader: 'Your parent/guardian approved your QuickGigs account',
        paragraphs: [
          'Great news — your parent/guardian approved your account. You can apply to gigs now.',
        ],
        textLines: [
          'Great news — your parent/guardian approved your account. You can apply to gigs now.',
          '',
          linkOr(payload, `${SITE}/dashboard.html`),
        ],
        ctaLabel: 'Get started',
        ctaHref: linkOr(payload, `${SITE}/dashboard.html`),
      };

    case 'waitlist_invite':
      return {
        subject: fallbackSubject || "You're invited to QuickGigs beta",
        title: "You're invited to the beta",
        preheader: 'Your QuickGigs waitlist invite is ready',
        paragraphs: [
          "You're on the QuickGigs waitlist — we're ready for you to join the beta.",
          "QuickGigs is Canada's marketplace for everyday tasks. Post a gig or earn helping others in your community.",
        ],
        textLines: [
          "You're on the QuickGigs waitlist — we're ready for you to join the beta.",
          '',
          'Create your free account:',
          linkOr(payload, `${SITE}/signup.html`),
        ],
        ctaLabel: 'Create free account',
        ctaHref: linkOr(payload, `${SITE}/signup.html`),
      };

    case 'waitlist_reminder':
      return {
        subject: fallbackSubject || 'Reminder: your QuickGigs beta invite is waiting',
        title: 'Your beta invite is waiting',
        preheader: 'Reminder — your QuickGigs invite is still open',
        paragraphs: [
          'Just a friendly reminder — your QuickGigs beta invite is still open.',
          'Sign up free and start posting tasks or browsing gigs.',
        ],
        textLines: [
          'Just a friendly reminder — your QuickGigs beta invite is still open.',
          '',
          'Sign up:',
          linkOr(payload, `${SITE}/signup.html`),
        ],
        ctaLabel: 'Sign up free',
        ctaHref: linkOr(payload, `${SITE}/signup.html`),
      };

    case 'task_funded':
    case 'chat_unlocked':
      return {
        subject: fallbackSubject || `Chat unlocked for “${taskTitle}”`,
        title: 'Chat unlocked',
        preheader: `You can message about “${taskTitle}” now`,
        paragraphs: [
          type === 'task_funded'
            ? esc(`Escrow is funded for “${taskTitle}”. You can message the other party now.`)
            : esc(`You can message about “${taskTitle}” now.`),
          // Intentionally no payment amounts or card details.
        ],
        textLines: [
          type === 'task_funded'
            ? `Escrow is funded for “${taskTitle}”. You can message the other party now.`
            : `You can message about “${taskTitle}” now.`,
          '',
          linkOr(payload, `${SITE}/messages.html`),
        ],
        ctaLabel: 'Open messages',
        ctaHref: linkOr(payload, `${SITE}/messages.html`),
      };

    case 'task_removed_admin':
      return {
        subject: fallbackSubject || `Your task was removed: “${taskTitle}”`,
        title: 'Task removed',
        preheader: `Your task “${taskTitle}” was removed`,
        paragraphs: [
          esc(`Your task “${taskTitle}” was removed by a QuickGigs moderator.`),
          `Reason: ${esc(reason)}`,
        ],
        textLines: [
          `Your task “${taskTitle}” was removed by a QuickGigs moderator.`,
          '',
          `Reason: ${reason}`,
          '',
          `Questions? ${SUPPORT}`,
        ],
        ctaLabel: 'Contact support',
        ctaHref: `mailto:${SUPPORT}`,
      };

    case 'task_removed_applicant':
      return {
        subject: fallbackSubject || `Task removed: “${taskTitle}”`,
        title: 'Task no longer available',
        preheader: 'A task you applied to was removed',
        paragraphs: [
          esc(`A task you applied to (“${taskTitle}”) was removed by QuickGigs moderation.`),
          `Reason: ${esc(reason)}`,
        ],
        textLines: [
          `A task you applied to (“${taskTitle}”) was removed.`,
          `Reason: ${reason}`,
          '',
          'Browse other gigs:',
          linkOr(payload, `${SITE}/browsetask.html`),
        ],
        ctaLabel: 'Browse tasks',
        ctaHref: linkOr(payload, `${SITE}/browsetask.html`),
      };

    case 'new_gig_match':
      return {
        subject: fallbackSubject || `New gig near you: “${taskTitle}”`,
        title: 'New gig near you',
        preheader: `A new task matches your alerts: “${taskTitle}”`,
        paragraphs: [
          esc(`A new QuickGigs task matches your alerts: “${taskTitle}”.`),
          esc(location) + (amount ? ` · ${esc(amount)}` : ''),
        ],
        textLines: [
          `A new QuickGigs task matches your alerts: “${taskTitle}”.`,
          location + (amount ? ` · ${amount}` : ''),
          '',
          linkOr(payload, `${SITE}/browsetask.html`),
        ],
        ctaLabel: 'View gig',
        ctaHref: linkOr(payload, `${SITE}/browsetask.html`),
      };

    default: {
      const text = str(fallbackText, 'You have an update on QuickGigs.');
      const subject = str(fallbackSubject, 'QuickGigs update');
      return {
        subject,
        title: subject,
        preheader: text.slice(0, 120),
        paragraphs: text.split(/\n+/).filter(Boolean).map((line) => esc(line)),
        textLines: text.split(/\n/),
        ctaLabel: 'Open QuickGigs',
        ctaHref: linkOr(payload, SITE),
      };
    }
  }
}

/** Build subject / text / html for a notification type. */
export function buildNotificationEmail(
  type: string,
  payload: NotifPayload | null | undefined,
  fallbackSubject = 'QuickGigs update',
  fallbackText = '',
): BuiltEmail {
  const p = (payload && typeof payload === 'object') ? payload as NotifPayload : {};
  const spec = buildSpec(String(type || '').trim() || 'generic', p, fallbackSubject, fallbackText);
  const text = spec.textLines.join('\n') +
    (spec.showPrefs === false
      ? `\n\n— QuickGigs\n${SITE}`
      : `\n\nManage email preferences: ${PREFS_URL}\n— QuickGigs\n${SITE}`);
  const html = wrapHtml({
    preheader: spec.preheader,
    title: spec.title,
    paragraphs: spec.paragraphs,
    ctaLabel: spec.ctaLabel,
    ctaHref: spec.ctaHref,
    showPrefs: spec.showPrefs,
  });
  return { subject: spec.subject, text, html };
}

export const DEFAULT_FROM = 'QuickGigs <notifications@quickgigs.ca>';
