# QuickGigs — Launch prep (post-beta)

**Beta status:** ~10 testers, ~10 tasks posted, **2 completed end-to-end**, engineers OK.  
**Next phase:** soft launch with payments + security — not more beta features.

Pin **[YOUR-SIDE.md](YOUR-SIDE.md)** for one-time setup tasks.

---

## Launch switch — DONE

`qg-config.js` is already flipped:

```js
chatUnlockAfter: 'payment',
paymentsEnabled: true,
```

Chat is escrow-gated. Still on a `pk_test_` key, so this is test-mode payments,
not live money. The remaining flip is Test → Live (Phase 6), not this config.

---

## Phase 1 — Wrap beta (you, ~1 day)

- [ ] Message testers: beta complete, thanks, launch coming with payments
- [ ] Admin: cancel or leave test posts; keep the 2 completed as proof
- [ ] Optional: publish banner in admin — “Launching soon — payments via Stripe”

**Copy-paste message:**

> QuickGigs beta wrap — thanks for testing! We completed real gigs on the platform. Next up: Stripe payments + public launch. I’ll email when it’s live. quickgigs.ca

---

## Phase 2 — Account setup (you, no code)

### Stripe (Test mode first)

1. [dashboard.stripe.com](https://dashboard.stripe.com) → complete business profile + bank (CAD)
2. Enable **Stripe Connect** → **Express** accounts for taskers
3. Note your **Test** publishable + secret keys (never commit secret keys to GitHub)
4. Platform fee: tiered model in `feeBreakdown.js` / `_shared/fee.ts` — one-off **25%**, recurring **10%**, subscriber **20% / 8%**. Run `supabase/tasks-rate-recurring.sql` before recurring/hourly launch.

### Firebase Google login (optional but recommended)

See **[GOOGLE-LOGIN-FIX.md](GOOGLE-LOGIN-FIX.md)** or YOUR-SIDE.md.

### Resend emails — NOT optional any more

This was true when the bell was the only consumer. It is now **required for any
16–17 signup**, because email is the sole delivery channel for guardian approval:

- `register-account` → guardian consent link
- `submit-application` → guardian application-approval link
- `resend-guardian-consent`, `send-notification` → hard-throw `resend_not_configured`

Neither caller crashes without the key (both swallow the error and return
`email_sent: false`), so this fails **silently**. The teen account is created, but:

- the consent URL is **not** returned in the response, and
- `users.consent_token` stores only a **hash** of the token,

so the raw link is unrecoverable and there is no admin or manual fallback. The teen
is stranded until `RESEND_API_KEY` is configured and a resend is triggered.

**Secrets required:** `RESEND_API_KEY`, `FROM_EMAIL`, `SITE_URL`
(`SITE_URL` defaults to `https://quickgigs.ca`; a wrong value mints dead links).

---

## Phase 3 — Database (Supabase SQL Editor)

Run once before wiring Stripe:

| Order | File | Purpose |
|-------|------|---------|
| 1 | `supabase/payments.sql` | `payments` table for escrow records |
| 2 | `supabase/rls-secure.sql` | **Only when** Firebase auth is enabled in Supabase |

**Both are done.** Firebase auth is linked and RLS is live on all 24 public tables
(verified 2026-09-16). The original warning below is kept for history only:

> Do **not** run `rls-secure.sql` until Supabase Auth → Firebase is on, or the app will break for current users.

---

## Phase 4 — Build Stripe (code — we do together)

Recommended model: **Stripe Connect Express + Payment Intent + application fee**.

| Step | What | Where |
|------|------|--------|
| 1 | Supabase Edge Function `create-checkout` (secret key server-side) | `supabase/functions/` |
| 2 | Tasker onboarding link (Connect Express) | Profile or first payout |
| 3 | Wire `payment.html` — real Checkout from accepted task | `payment.html` |
| 4 | Webhook `payment_intent.succeeded` → `savePayment()` + unlock chat | Edge Function |
| 5 | On complete task → transfer/release to worker (Connect) | Edge Function |
| 6 | Flip `qg-config.js` to `payment` mode | Launch day |

**Status: Phase 4 is built** (verified 2026-09-16). All six steps ship as Edge Functions:

- Checkout / escrow — `create-checkout`, `confirm-checkout`, `create-escrow-intent`, `sync-payment`
- Connect Express onboarding — `create-connect-link` (real `accountLinks.create`,
  `type: 'account_onboarding'`), `sync-connect-status`, readiness gated on
  `charges_enabled && payouts_enabled` via `_shared/connect-ready.ts`
- Webhooks — `stripe-webhook`
- Release / refund — `release-payout`, `refund-payment`
- Config flip — done (see Launch switch above)

Under-18 guard: minors cannot open their own Express account; `create-connect-link`
routes to a guardian-owned account instead.

---

## Phase 5 — Server-side enforcement (3 of 5 done)

**Preconditions are all met** (verified against the live DB 2026-09-16):

- Firebase JWT → Supabase **is linked**. `public.qg_is_signed_in()` validates the
  issuer `https://securetoken.google.com/%` and `public.qg_uid()` returns the Firebase
  `sub`. RLS policies key on those.
- RLS **is on for all 24 public tables**. `admins`, `admin_actions`, `admin_notes`,
  `notification_queue`, `phone_verification_challenges` intentionally carry RLS with
  **zero policies** — deny-all to anon, service-role only.
- Admin reads **do** go through a service-role Edge Function (`admin-console`).

Remaining gaps are **#1 (contact filter)** and **#4 (rate limits)** — see checklist.

Client checks stay as UX only. Real enforcement moves to Edge Functions + RLS.

| # | Enforcement | Today (client / partial) | Server target |
|---|-------------|--------------------------|---------------|
| 1 | Contact-info / fraud filter | `analyzeOffPlatformContact` in `qg-utils.js`; `sendMessage` in `supabase-db.js` blocks UX | Edge Function (or DB trigger → function) on **message insert** — reject row if check fails |
| 2 | Escrow-gated chat | `chatUnlockAfter: 'payment'` + client gate in chat/mytasks | Backend: chat/message open only if a held/paid `payments` row exists for that task pair |
| 3 | Admin actions | `admin.html` uses **anon** client for reports/disputes/moderation | Edge Function with **service-role** key; verify caller is in `admins` table **or** has admin custom claim. Covers delete/hide/moderation status + reading others’ reports/disputes |
| 4 | Rate limits | Client throttle only (if any) | Per-user action limits enforced in Edge Functions / DB (post, apply, message, report) |
| 5 | Fee math (tiered) | `feeBreakdown.js` + `qg-utils.js`; `create-checkout` uses `_shared/fee.ts` | Keep fee/payout math **only** server-side at payment/release time; never trust client `amount` / `platform_fee`. Rates: one-off 25%, recurring 10%, sub 20%/8% |

### Checklist

- [ ] **GAP** — Edge Function `filter-message` (or message insert hook): port
      `analyzeOffPlatformContact`; return 400 and do not insert. Still **client-only**
      in `qg-utils.js`; no server port exists. A crafted request can post contact info.
- [x] Escrow-gated chat enforced server-side — `secure-messaging` owns `is_unlocked`:
      `cleanPatch()` strips client attempts to set it, `create` always starts locked,
      `send` returns 403 `conversation_locked`. Unlock only via webhook / `confirm-checkout`.
- [x] Service-role admin Edge Function — shipped as `admin-console` (not `admin-api`);
      authz via `isAdminUser()` against the `admins` table, keyed on Firebase UID.
- [x] `admin.html` has no direct anon table reads left; it goes through `admin-console`.
- [ ] **GAP** — Rate-limit middleware on post / apply / message / report. The only
      throttle anywhere is a single `resend_too_soon` 429 on guardian-consent resend.
- [ ] Audit `create-checkout`, `confirm-checkout`, `release-payout`, `refund-payment` — amounts from DB task/app only; fee via `_shared/fee.ts` (not a hardcoded 25%)
- [x] No service-role or Stripe secret key in any shipped frontend file — scanned
      2026-09-16. The two JWTs in `supabase-db.js` and `supabaseClient.js` both decode
      to `role=anon`. Matches for `sk_`/`service_role` are comments and error strings only.
- [ ] Apply `supabase/tasks-rate-recurring.sql` before enabling hourly/recurring UI
- [ ] Redeploy `create-checkout` after fee helper changes

### Related SQL / files

- `feeBreakdown.js` — client fee single source of truth
- `supabase/functions/_shared/fee.ts` — server fee single source of truth (keep in sync)
- `supabase/tasks-rate-recurring.sql` — `rate_type`, `is_recurring`, `hourly_rate`, `frequency`, `est_hours`, `users.is_subscriber`
- `supabase/admins.sql` — admin UID allow-list (no anon policies; service-role only)
- `qg-admin-gate.js` — single client `isAdmin()` (UX only; claim-ready)
- `supabase/reports-blocks-disputes.sql` — JWT RLS stubs for reports/blocks/disputes
- `supabase/rls-secure.sql` — broader RLS (only after Firebase auth in Supabase)
- `supabase/functions/create-checkout/index.ts` — fee already from env + task amount
- `qg-utils.js` — `analyzeOffPlatformContact` (source of truth to port for #1)

---

## Phase 6 — Launch day checklist

- [ ] Stripe in **Live** mode (not Test) — still `pk_test_`; this is the main blocker
- [x] `chatUnlockAfter: 'payment'` + `paymentsEnabled: true`
- [x] `rls-secure.sql` applied — RLS on all 24 public tables
- [ ] Phase 5 server enforcements live — 3 of 5 done; **contact filter** and
      **rate limits** are the accepted-risk-or-fix decisions before launch
- [ ] Pin `search_path` on `public.qg_uid` / `public.qg_is_signed_in` (advisor WARN,
      still open — these two gate every RLS policy)
- [ ] Terms/privacy match live payment flow
- [ ] Test: post → apply → accept → **pay** → chat → complete → payout.
      **Never run — not in live mode, and not in test mode either.** Live DB as of
      2026-09-16: `payments` 0 rows, tasks `completed` 0, `reviews` 0,
      `stripe_connect_id` 0, `guardian_consent_sent_at` 0. The money path and the
      email path are both entirely unexercised code. Run this in **test** mode first.
- [ ] Admin console bookmarked for moderation
- [ ] `git push origin main` + hard refresh quickgigs.ca

---

## What NOT to do before launch

- Don’t open to hundreds of users without `rls-secure.sql`
- Don’t flip to `payment` mode without working Checkout (posters get stuck)
- Don’t store Stripe **secret** keys (or the Supabase **service-role** key) in `qg-config.js` or any frontend file
- Don’t enable JWT RLS on reports/disputes until `admin-api` (service-role) exists — admin queue will go blank

---

## Suggested order of work (with Cursor)

| Session | Focus |
|---------|--------|
| **Today** | Run `payments.sql`, read Stripe Connect docs, create Stripe Test account |
| **Next** | Edge Function: create Checkout session for accepted task |
| **Then** | Connect Express onboarding for taskers |
| **Then** | Webhooks + release on complete |
| **Launch** | Config flip + rls-secure + live keys |

---

## Beta proof (for panel / investors)

- 10 testers, 10 tasks posted, **2 completed** on-platform
- Full loop: post → apply → accept → chat → complete
- Negotiation, admin moderation, notifications shipped

> **Verify before repeating these numbers externally.** The live DB on 2026-09-16
> holds 4 users, 6 tasks (4 cancelled / 2 in_progress), 0 completed, 0 reviews.
> If the beta data was cleared, say so when citing the figures; right now nothing
> in the database corroborates "10 testers / 2 completed".

Launch adds: **money in escrow**, **locked chat until pay**, **production security**.
