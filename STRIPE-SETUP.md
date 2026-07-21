# QuickGigs — Stripe setup (Phase 4)

You finished beta prep. Follow these steps to turn on **Test payments**.

---

## 1. SQL (Supabase SQL Editor)

Run once (if not already):

| File | Purpose |
|------|---------|
| `supabase/payments.sql` | Payment records ✅ (you ran this) |
| `supabase/stripe-connect.sql` | Worker payout accounts |

---

## 2. Supabase secrets

Supabase Dashboard → **Project Settings → Edge Functions → Secrets** (or CLI):

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_YOUR_KEY
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SECRET
supabase secrets set SITE_URL=https://quickgigs.ca
supabase secrets set PLATFORM_FEE_PERCENT=25
```

Never commit `sk_test_` or `whsec_` to GitHub.

---

## 3. Deploy Edge Functions

From your machine (with [Supabase CLI](https://supabase.com/docs/guides/cli) linked to the project):

```bash
cd "c:\QuickGigs by mowebco"
supabase functions deploy create-checkout --no-verify-jwt
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy create-connect-link --no-verify-jwt
```

---

## 4. Stripe webhook

1. Stripe Dashboard → **Developers → Webhooks → Add endpoint**
2. URL: `https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/stripe-webhook`
3. Event: **`checkout.session.completed`**
4. Copy **Signing secret** → `STRIPE_WEBHOOK_SECRET` in Supabase

---

## 5. Frontend config

In `qg-config.js`:

```js
stripePublishableKey: 'pk_test_PASTE_YOURS_HERE',
paymentsEnabled: true,
chatUnlockAfter: 'payment',  // flip when ready to test pay-gated chat
```

Push to GitHub → wait ~2 min → hard refresh quickgigs.ca.

---

## 6. Test flow (Test mode)

1. **Tasker** → Profile → **Set up payouts** (Stripe Connect Express test onboarding)
2. **Poster** → accept a worker on My Tasks
3. **Poster** → **Pay & unlock chat** → Stripe test card `4242 4242 4242 4242`
4. Chat should unlock after payment

---

## Resume app on same Stripe?

Fine. Use metadata `project: quickgigs` on all QuickGigs payments. Keep a **separate webhook endpoint** for QuickGigs (step 4).

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Pay button says “not configured” | Deploy functions + set secrets + `paymentsEnabled: true` + `pk_test_` in config |
| Checkout fails `stripe_not_configured` | Set `STRIPE_SECRET_KEY` in Supabase secrets |
| Chat stays locked after pay | Check webhook fired; Stripe → Webhooks → event log |
| Worker payout missing | Tasker must complete Connect onboarding first |

---

## Launch day

- Switch Stripe to **Live** keys
- Update Supabase secrets with live `sk_live_` and live webhook secret
- Update `stripePublishableKey` to `pk_live_...`
- Run `rls-secure.sql` (after Firebase auth in Supabase)
- Turn off soft close in admin when ready to reopen sign-ups
