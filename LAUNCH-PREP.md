# QuickGigs — Launch prep (post-beta)

**Beta status:** ~10 testers, ~10 tasks posted, **2 completed end-to-end**, engineers OK.  
**Next phase:** soft launch with payments + security — not more beta features.

Pin **[YOUR-SIDE.md](YOUR-SIDE.md)** for one-time setup tasks.

---

## Launch switch (when Stripe is live)

In `qg-config.js`:

```js
chatUnlockAfter: 'payment',  // was 'accept' for beta
paymentsEnabled: true,
```

Until then, leave beta settings. Chat stays open on accept.

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

### Resend emails (optional)

See YOUR-SIDE.md — bell works without this.

---

## Phase 3 — Database (Supabase SQL Editor)

Run once before wiring Stripe:

| Order | File | Purpose |
|-------|------|---------|
| 1 | `supabase/payments.sql` | `payments` table for escrow records |
| 2 | `supabase/rls-secure.sql` | **Only when** Firebase auth is enabled in Supabase |

Do **not** run `rls-secure.sql` until Supabase Auth → Firebase is on, or the app will break for current users.

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

**Already in repo:** `payment.html` (placeholder), `savePayment()` / `getPaymentByTask()` in `supabase-db.js`, chat lock copy for payment mode.

**Not in repo yet:** Stripe keys in Supabase secrets, Checkout session, Connect onboarding, webhooks.

---

## Phase 5 — Server-side enforcement (RUN LATER)

**Do not start until:** Firebase JWT → Supabase is linked, RLS is on, and admin reads go through a service-role Edge Function (never put the service-role key in frontend code).

Client checks stay as UX only. Real enforcement moves to Edge Functions + RLS.

| # | Enforcement | Today (client / partial) | Server target |
|---|-------------|--------------------------|---------------|
| 1 | Contact-info / fraud filter | `analyzeOffPlatformContact` in `qg-utils.js`; `sendMessage` in `supabase-db.js` blocks UX | Edge Function (or DB trigger → function) on **message insert** — reject row if check fails |
| 2 | Escrow-gated chat | `chatUnlockAfter: 'payment'` + client gate in chat/mytasks | Backend: chat/message open only if a held/paid `payments` row exists for that task pair |
| 3 | Admin actions | `admin.html` uses **anon** client for reports/disputes/moderation | Edge Function with **service-role** key; verify caller is in `admins` table **or** has admin custom claim. Covers delete/hide/moderation status + reading others’ reports/disputes |
| 4 | Rate limits | Client throttle only (if any) | Per-user action limits enforced in Edge Functions / DB (post, apply, message, report) |
| 5 | Fee math (tiered) | `feeBreakdown.js` + `qg-utils.js`; `create-checkout` uses `_shared/fee.ts` | Keep fee/payout math **only** server-side at payment/release time; never trust client `amount` / `platform_fee`. Rates: one-off 25%, recurring 10%, sub 20%/8% |

### Checklist (when ready)

- [ ] Edge Function: `filter-message` (or message insert hook) — port `analyzeOffPlatformContact` logic; return 400 and do not insert
- [ ] Edge Function / RLS: block message insert unless escrow payment exists for `task_id` + poster/worker pair
- [ ] Edge Function: `admin-api` — service role; authz via `admins` or JWT claim; proxy report/dispute reads + moderation writes
- [ ] Point `admin.html` moderation/reports/disputes at `admin-api` (remove direct anon table reads for those)
- [ ] Rate-limit middleware on post / apply / message / report functions
- [ ] Audit `create-checkout`, `confirm-checkout`, `release-payout`, `refund-payment` — amounts from DB task/app only; fee via `_shared/fee.ts` (not a hardcoded 25%)
- [ ] Confirm no service-role key in any HTML/JS shipped to the browser
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

- [ ] Stripe in **Live** mode (not Test)
- [ ] `chatUnlockAfter: 'payment'` + `paymentsEnabled: true`
- [ ] `rls-secure.sql` applied
- [ ] Phase 5 server enforcements live (or accepted residual risk documented)
- [ ] Terms/privacy match live payment flow
- [ ] Test: post → apply → accept → **pay** → chat → complete → payout
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

Launch adds: **money in escrow**, **locked chat until pay**, **production security**.
