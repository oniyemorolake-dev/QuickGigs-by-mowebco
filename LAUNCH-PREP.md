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
| Rebrand | Done in code: icon, social card, emails, Stripe line item. `FROM_EMAIL` secret still to update **(you)** |
| Fee model (tasker pays 15%, poster pays $0 on top) | Done: client, server and legal pages agree |
| Escrow-gated chat | Done (server-enforced) |
| RLS on all public tables | Done (verified 16 Sep) |
| Rate limits (post / apply / message / report) | Done (server) |
| Contact-info filter | Chat: done (server). Task text and application messages: **client only** |
| Minor privacy in public profiles | Fix written, **not yet applied** (step 2) |
| Money loop (pay → release) | **Never run end to end** |
| Stripe | Test mode (`pk_test_`) |
| Emails (Resend) | Code ready. Domain and secrets **(you)** |

---

## 1. Blockers (do these before anyone pays real money)

- [ ] **Apply the minor-privacy fix.** Paste
      `supabase/migrations/20261109200000_public_profiles_hide_minor_markers.sql`
      into the Supabase SQL Editor and run it. Then run the verify query at the
      bottom of that file, which should return `0`.
      *Why:* before this fix, anyone holding the public anon key could list every teen
      on the platform with their name, photo and area.
- [ ] **Run the money loop in Stripe Test mode** using two accounts (poster + tasker):
      post → apply → accept → **Pay & unlock chat** (card `4242 4242 4242 4242`) →
      message → **Mark complete** → tasker sees the payout in their wallet.
      Then check that the `payments` row shows `platform_fee` = 15% and
      `worker_payout` = 85%.
      As of 16 Sep the live DB had 0 payments, 0 completed tasks and 0 Connect accounts,
      so none of this code has run for real yet.
- [ ] **Resend configured (you).** This is required, not optional: guardian approval for
      16–17-year-olds is sent **only** by email, and it fails silently without the key.
      - Verify the sending domain in Resend
      - Supabase secrets: `RESEND_API_KEY`, `FROM_EMAIL="SwiftGigs <notify@quickgigs.ca>"`,
        `SITE_URL=https://quickgigs.ca`
      - Test: Admin → Waitlist → **Send invite** to yourself
- [ ] **Redeploy every edge function (you).** The emails, the Stripe line item and the
      error messages now say SwiftGigs, but the deployed copies still say QuickGigs
      until you redeploy. JWT verify stays **off**, because the functions check Firebase
      tokens themselves.

## 2. Decide: fix or accept the risk

- [ ] **Contact filter on task text and application messages.** Chat messages are
      filtered server-side (`secure-messaging` → `_shared/off-platform.ts`). Task
      titles and descriptions (`post-task`) and application messages
      (`submit-application`) are only filtered in the browser. Someone calling the API
      directly could put a phone number in a task or bid, which is the easiest way to
      dodge the fee before escrow.
      *Fix:* about 20 lines per function, reusing the existing helper.
- [ ] **Legal agreement versions.** The Contractor and Poster agreements still show
      version `2026-08-03`. I updated the fee wording in them but left the version
      number alone, because bumping it (in `qg-config.js` + `role-access`) makes every
      existing user re-accept. Bump it if you want fresh consent to the 15% wording.

## 3. Go-live switch (you)

- [ ] Stripe → complete the business profile and add your CAD bank account → switch to **Live**
- [ ] Supabase secrets: `STRIPE_SECRET_KEY=sk_live_…`, `STRIPE_WEBHOOK_SECRET` (from the
      **live** webhook endpoint pointing at `stripe-webhook`)
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
- `search_path` pinned on `qg_uid()` / `qg_is_signed_in()` (migration `20260916200000`)
- No secret keys in frontend files (the two JWTs in the repo are `role=anon`)
- Terms / Poster terms / Contractor agreement describe the live fee model (updated 9 Nov)

## 5. Don'ts

- Never put `sk_live_`, `sk_test_` or the Supabase **service-role** key in any frontend file
- Never push `motechco-master-plan.html`
- Don't switch to Live Stripe until step 1's test-mode money loop has passed
- Don't use the beta numbers ("10 testers / 2 completed") publicly unless you can
  back them up: the DB on 16 Sep didn't show them
