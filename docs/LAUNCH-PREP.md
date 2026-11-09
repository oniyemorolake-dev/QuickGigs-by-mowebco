# SwiftGigs — Launch checklist

**Last checked:** 9 Nov 2026, against the repo (commit after `cc630e7`).
**Can't be checked from the repo:** anything in the Supabase, Stripe, Firebase or
Resend dashboards. Those items are marked **(you)**. Tick them when you've confirmed
them in the dashboard.

How each decision was made and how each feature is secured:
**[BACKEND-DECISIONS.md](BACKEND-DECISIONS.md)**.

---

## 0. Status at a glance

| Area | State |
|---|---|
| Frontend (all pages, SwiftGigs redesign) | Done |
| Rebrand (icon, social card, emails, Stripe line item) | Done in code. Emails change when functions are redeployed |
| Fee model (tasker pays 15%) | Code and legal pages agree. **Live secret needs checking** (step 1) |
| Database security fixes (9 Nov) | **Applied to the live database** |
| App updates (PWA) | Fixed in code. Live after push |
| Mark complete → payout | Fixed in database (live) and code (after push/redeploy) |
| Money loop end to end | One test payment exists; payout never released. **Re-test after push** |
| Stripe | Test mode (`pk_test_`) |
| Emails (Resend) | Code ready. Domain and secrets **(you)** |

### Applied to the live database on 9 Nov (nothing to run)

`supabase/launch-2026-11-09.sql` is kept as a record; all of it is already live.

1. Public profile view no longer shows which accounts are minors.
2. Phone numbers, emails, links and @handles are rejected in task text and application messages.
3. Precise street addresses are kept out of the public `tasks` table.
4. Users can no longer change their own rating, subscriber flag, phone-verified flag or
   payment-method fields.
5. A poster can no longer lower the price of an application after accepting it.
6. A poster marking a task complete always records the confirmation, so the payout can release.
7. Duplicate indexes removed; `search_path` pinned on `qg_payment_worker_cents`.

---

## 1. Blockers (before anyone pays real money)

- [ ] **Push the code** (or apply `swiftgigs-launch-finish.patch`). Nothing in the repo
      is live until this happens.
- [ ] **Redeploy all edge functions (you):**
      `supabase functions deploy --project-ref nuyfqsxstsrbloztzgau --no-verify-jwt`
      Brings live: SwiftGigs wording in emails and Stripe, the friendly contact-filter
      message, the mark-complete repair, and the live-mode switch.
- [ ] **Check the fee secret (you).** The one live payment was charged **25%** ($62.50 on
      $250), not 15%. In Supabase → Edge Functions → Secrets, set
      `PLATFORM_FEE_PERCENT` to `15` (or delete it; the default is 15).
- [ ] **Re-run the money loop in Stripe Test mode** with two accounts: post → apply →
      accept → **Pay & unlock chat** (card `4242 4242 4242 4242`) → message →
      **Mark complete** → tasker sees the payout. Then confirm the `payments` row shows
      `platform_fee` = 15%, status `completed`, and a `transfer_id`.
      *Known stuck row:* the 12 Oct test payment ($250) is still `held` on a completed
      task. After the redeploy, tap Mark complete on it again as the poster, or refund
      it from Admin.
- [ ] **Resend configured (you).** Required, not optional: guardian approval for
      16–17-year-olds is sent **only** by email, and it fails silently without the key.
      - Verify the sending domain in Resend
      - Supabase secrets: `RESEND_API_KEY`, `FROM_EMAIL="SwiftGigs <notify@quickgigs.ca>"`,
        `SITE_URL=https://quickgigs.ca`
      - Test: Admin → Waitlist → **Send invite** to yourself
- [ ] **Schedule dispute auto-rules (you, optional for day one).** Only the daily
      account-graduation job is scheduled. `supabase/dispute-auto-rules-cron.sql` adds the
      auto-release / no-show job; it needs `DISPUTE_CRON_SECRET`.

## 2. Decide

- [ ] **Legal agreement versions.** The Contractor and Poster agreements still show
      version `2026-08-03`. The fee wording changed; bumping the version (in
      `qg-config.js` + `role-access`) makes every existing user re-accept.
- [ ] **Geocoding provider.** Address search in the browser calls OpenStreetMap's free
      Nominatim service directly. Its usage policy caps it at about one request a second
      and it can block busy sites. Set `MAPBOX_ACCESS_TOKEN` (the server already supports
      it) before real traffic.

## 3. Go-live switch (you)

- [ ] Stripe → complete the business profile and add your CAD bank account → switch to **Live**
- [ ] Supabase secrets: `STRIPE_SECRET_KEY=sk_live_…`, `STRIPE_WEBHOOK_SECRET` (from the
      **live** webhook endpoint pointing at `stripe-webhook`), and **`STRIPE_LIVE_MODE=true`**.
      Without that last one the payment functions refuse live keys on purpose
- [ ] `qg-config.js` → `stripePublishableKey: 'pk_live_…'` (publishable key only, never
      the secret key)
- [ ] Optional: `PLATFORM_FEE_PERCENT` secret, if you want something other than 15. If you
      change it, change `taskerFeePercent` in `qg-config.js` to match
- [ ] One real $20 task between two of your own accounts, then refund it from Admin
- [ ] Push to `main` → wait 2–5 min → hard refresh quickgigs.ca (Ctrl+Shift+R)
- [ ] Admin → turn off soft close / open sign-ups
- [ ] Email the waitlist

## 4. Already done (no action)

- Launch config: `chatUnlockAfter: 'payment'`, `paymentsEnabled: true`, `supabaseFirebaseAuth: true`
- Firebase JWT → Supabase linked. RLS on all 24 public tables. Service-role-only tables:
  `admins`, `admin_actions`, `admin_notes`, `notification_queue`,
  `phone_verification_challenges`, `rate_limits`
- Admin console goes through the `admin-console` edge function (service role + `admins` table)
- Server fee math only: `create-checkout` reads the amount from the DB task/application,
  never from the browser. `release-payout` uses the stored split
- Direct inserts into `messages` are closed, so all chat goes through `secure-messaging`
- `post-task` and `submit-application` reject contact details server-side (live once redeployed)
- `search_path` pinned on `qg_uid()` / `qg_is_signed_in()` (migration `20260916200000`)
- No secret keys in frontend files (the two JWTs in the repo are `role=anon`)
- Terms / Poster terms / Contractor agreement describe the live fee model (updated 9 Nov)

## 5. Don'ts

- Never put `sk_live_`, `sk_test_` or the Supabase **service-role** key in any frontend file
- Never push `motechco-master-plan.html`
- Don't switch to Live Stripe until step 1's test-mode money loop has passed
- Don't use the beta numbers ("10 testers / 2 completed") publicly unless you can
  back them up: the DB on 16 Sep didn't show them
