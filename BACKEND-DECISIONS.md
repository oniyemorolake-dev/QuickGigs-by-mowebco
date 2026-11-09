# SwiftGigs — Backend decisions, features & security

One place for every decision that shapes the platform: what each feature does and
how it's protected. Written 9 Nov 2026 from the code in this repo.

**Stack:** static HTML/JS on GitHub Pages (quickgigs.ca) · Firebase Auth (project
`quickgigs-7b12d`, JS SDK only) · Supabase Postgres + Edge Functions (Canada Central) ·
Stripe Connect Express · Resend (email) · Twilio (SMS, optional).

**The core security rule:** anything the browser checks is UX only. Every rule that
matters is enforced in one of three places: **RLS**, **database triggers** or an
**Edge Function** that runs with the service role after verifying the caller.

---

## 1. Business rules (locked)

| Decision | Rule | Where it lives |
|---|---|---|
| Who pays the fee | **Tasker** pays, deducted from the payout. Poster pays exactly the agreed amount, nothing on top | `qg-config.js` `taskerFeePercent` / `_shared/fee.ts` `PLATFORM_FEE_PERCENT` |
| Fee rate | **15%** beta rate, aiming for ~25% later. One knob on each side, kept in sync | same |
| Why the tasker pays | Posters are the scarce side, so the price they see stays clean | — |
| Recurring / hourly | `rate_type` fixed or hourly; fee charged on each period's total | `feeBreakdown.js` `periodTotal`, `fee.ts` |
| Minimum task | **$20 CAD** | DB check (`tasks_budget_min_20` migration) + `create-checkout` |
| Minimum withdrawal | $20 | `tasker-wallet.sql`, `request-payout` |
| Subscription | $9.99/month (no fee discount currently applied) | — |
| Chat | Locked until escrow is paid | `secure-messaging`, `trg_protect_conversation_unlock` |
| Geography | Canada-wide, Calgary + Edmonton first | geocoder restricted to Canada |
| Workers | Independent contractors; 12-month off-platform clause | `terms.html`, `contractor-agreement.html` |
| Content | Strict adult-content ban | `contentModeration.js`, admin moderation |
| Ages | 18+ full access. 16–17 tasker-only with guardian. Under 16 blocked | `register-account`, `_shared/age.ts` |
| Accounts | One account with a Poster/Tasker mode switch (in Settings) | `role-access`, `qg-role-switch.js` |

---

## 2. Identity & auth

**What:** Firebase sign-in (email/password + Google). The Firebase ID token is sent to
Supabase and to every Edge Function.

**How it's secured**
- Supabase trusts Firebase as a third-party auth provider. `public.qg_uid()` returns the
  Firebase `sub`; `public.qg_is_signed_in()` checks the issuer. Every RLS policy keys on
  these. Both have a pinned `search_path` so they can't be hijacked.
- Edge Functions verify the token themselves against Google's JWKS
  (`_shared/firebase-auth.ts`, issuer `securetoken.google.com/quickgigs-7b12d`), so
  Supabase's own JWT check stays off.
- `users.user_id` is a UUID primary key; `users.firebase_uid` is what auth looks up.
- Triggers stop users from changing their own `role`, verification flags or
  account-security fields (`users_protect_role_fields`,
  `users_protect_verification_fields`, `users_protect_account_security_fields`).
- Firebase API keys are domain-restricted; GitHub secret scanning is on.

## 3. Roles & mode switch

**What:** a user can be a poster, a tasker or both. Enabling a role needs consent to the
matching agreement (Contractor agreement for taskers, Poster & Payment terms for posters).

**Secured by** the `role-access` function (records the consent version) and
`trg_enforce_qg_role_enable_consent`, which refuses to enable a role without that consent.

## 4. Verification gates

| Role | Action | Requirement |
|---|---|---|
| Tasker | Apply / be accepted | Confirmed email (`tasker_verified`) |
| Poster | Publish a task | Stripe payment method on file (`poster_verified`). Drafts are allowed without one |
| Teen | Apply | Email + guardian consent + guardian payout setup |

**Secured by** `applications_require_verified_tasker_on_acceptance`,
`trg_enforce_tasker_clearance` (accept-time), and checks inside `post-task` / `submit-application`.

## 5. Tasks

**What:** post (Quick / Standard / Recurring modes), browse with location filter, save, edit, cancel.

**Secured by**
- Publishing goes through `post-task`: verifies the caller, rate-limits them (10/hour),
  blocks teens from posting, applies the age preference, and geocodes inside Canada only.
- `tasks_protect_transaction_ownership` / `tasks_require_active_actor`: you can only change
  your own tasks, and banned or blocked accounts can't act.
- Contact details (email, link, phone number, @handle) in the title or description are
  rejected by `post-task` (`analyzeListingContact`) and, for any other write path, by the
  `tasks_block_listing_contact` trigger. The rule is narrower than the chat filter so
  normal descriptions (dates, sizes, "set up WhatsApp") aren't blocked.
- Precise street addresses never sit in the public `tasks` table: a trigger moves them to
  `task_private` (service-role only). The poster and the accepted tasker read them through
  the `qg_task_precise_address()` RPC. The current post form doesn't collect a precise
  address, and the pages aren't wired to the RPC yet.

## 6. Applications & bidding

**What:** taskers apply with a price and message (the "Way 2" bidding flow); posters can
counter-offer (negotiation); posters accept one applicant.

**Secured by** `submit-application` (rate limit 30/hour, verification + teen gates),
the `apply_counter` RPC, and triggers that protect application status, guardian fields
and ownership. One application per tasker per task (unique index).
Application messages get the same server-side contact check as task text
(`submit-application` + `applications_block_listing_contact` trigger).

## 7. Payments & escrow (Stripe Connect Express)

**Flow:** accept → poster pays the task amount into escrow (`create-checkout` /
`create-escrow-intent`) → Stripe webhook marks it paid and unlocks chat → poster marks the
task complete (`complete-task`) → `release-payout` transfers 85% to the tasker's Connect
account → tasker withdraws from their wallet (`request-payout`).

**Secured by**
- Amounts always come from the DB task/application, never from the browser. The fee is
  worked out server-side by `_shared/fee.ts` and stored on the `payments` row.
- `stripe-webhook` verifies Stripe's signature (`STRIPE_WEBHOOK_SECRET`).
- `payments` and wallet payout rows can only be written by the service role. Clients
  can't insert or update them.
- Connect readiness = `charges_enabled && payouts_enabled` (`_shared/connect-ready.ts`).
  A tasker can't be accepted for a paid gig until payouts are ready.
- Minors never own a Connect account; the guardian's account receives the payout.
- Refunds only through `refund-payment` (poster/admin, server-side).
- Secret keys live only in Supabase secrets. The frontend has only the publishable key.

## 8. Chat

**What:** 1:1 chat per task with photos (images enabled), realtime updates.

**Secured by**
- All writes go through `secure-messaging`. Direct `INSERT` on `messages` has been removed.
- A conversation starts locked. `is_unlocked` can only be set by the webhook /
  `confirm-checkout` (`trg_protect_conversation_unlock`), and `send` returns 403 while it's locked.
- Server-side off-platform filter (`_shared/off-platform.ts`, ported from `qg-utils.js`;
  keep both in sync): blocks phone numbers, emails, social handles and obfuscated variants.
- Rate limit: 60 messages / 5 min. Sender and relationship validated by triggers.
- Chat photos sit in a private bucket that only the two people in the chat can read.

## 9. Reviews, reports, blocks, disputes

- **Reviews:** after completion, one per party per task (`review_comment`, not `COMMENT`).
- **Reports & blocks:** RLS stubs, with reports rate-limited by `trg_rate_limit_reports` (10/hour).
- **Disputes:** `raise-dispute` freezes the payout; `resolve-dispute` is admin-only;
  `dispute-auto-rules` (cron, `DISPUTE_CRON_SECRET`) auto-releases after
  `DISPUTE_AUTO_RELEASE_DAYS` (default 3) and flags no-shows. Evidence photos and
  timestamps come from `task-evidence`.

## 10. Under-18 accounts (16–17)

Full detail: `docs/TEEN-ACCOUNTS.md`.
- Tasker-only. The account stays frozen at `pending_guardian` until the guardian
  **(1)** approves it through an emailed one-time link (signed, 7-day expiry, only a hash
  stored) and **(2)** finishes Stripe Connect payout setup.
- Each application also needs guardian approval before the poster sees it.
- Tasks must opt in to teens (`age_preference`). Live safety check-ins / "Need help"
  alerts go to the guardian (`teen-safety`). The guardian portal shows location only while
  a job is active.
- At 18 the account graduates automatically (`graduate-account`, daily cron).
- **Privacy:** migration `20261109200000` stops the public profile view from exposing
  which accounts belong to minors. **Must be applied before launch.**

## 11. Admin

**What:** admin console (users, tasks, reports, disputes, waitlist, announcements, CSV backups).

**Secured by** `admin-login.html` (Firebase + admin check, UX only) → every read and write
goes through the `admin-console` edge function using the service role, which checks the
caller's Firebase UID against the `admins` table. `admins`, `admin_actions` and
`admin_notes` have RLS with no policies, so only the service role can read them.

## 12. Notifications

In-app bell (`user_notifications`, DB triggers on application / message / unlock /
completion) + email through `send-notification` (Resend), protected by
`NOTIFICATION_SEND_SECRET` (header `x-qg-notification-secret`). Push notifications go
through the PWA service worker. Email preferences link in every email.

## 13. Rate limits

Counted in Postgres (`qg_rate_limit_hit`, atomic), so every function instance shares
one counter. If the caller can't be identified the request is refused; if the limiter
itself errors, the request goes through (and the error is logged).

| Action | Limit |
|---|---|
| Post task | 10 / hour |
| Apply | 30 / hour |
| Message | 60 / 5 min |
| Report | 10 / hour |
| Guardian consent resend | cooldown (429 `resend_too_soon`) |

## 14. Storage

Buckets: `profile-photos`, `task-photos`, `chat-photos`. Writes are locked to the owner's
own folder; chat photos are readable only by the two people in the conversation. Task and
chat buckets limit uploads to 5 MB images (JPEG/PNG/WebP/GIF), set at the bucket level.
Clear error messages come from `formatUploadError()`.

## 15. Secrets (Supabase → Edge Functions → Secrets)

| Required for launch | Optional / feature-specific |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (auto) | `PLATFORM_FEE_PERCENT` (default 15), `POSTER_FEE_PERCENT` (default 0) |
| `FIREBASE_PROJECT_ID` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `MAPBOX_ACCESS_TOKEN` / `GEOCODE_API_KEY` |
| `RESEND_API_KEY`, `FROM_EMAIL`, `SITE_URL` | `ADMIN_NOTIFY_EMAIL` |
| `NOTIFICATION_SEND_SECRET`, `GUARDIAN_CONSENT_SECRET` | `DISPUTE_AUTO_RELEASE_DAYS` |
| `GRADUATION_CRON_SECRET`, `DISPUTE_CRON_SECRET` | |

## 16. Known gaps (as of 9 Nov)

1. `supabase/launch-2026-11-09.sql` (minor privacy, listing contact filter, private
   addresses) is written and tested locally but must be run on the live database.
2. Money loop never exercised end to end, even in test mode.
3. Agreement version still `2026-08-03` even though the fee wording changed (re-consent decision).
4. Subscription ($9.99) exists as a business rule but currently gives no fee discount.
5. Pages don't yet read precise addresses through `qg_task_precise_address()`.
