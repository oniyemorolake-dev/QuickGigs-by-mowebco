# QuickGigs — Stripe Connect Express escrow (CA / CAD)

Poster pays → funds held on the **platform** → poster marks complete → **Transfer** of tasker share (amount − **15%** platform fee) to the tasker's Express account.

**Never store card or bank numbers** — Stripe hosts all of that.

---

## 1. SQL (Supabase SQL Editor)

| File | Purpose |
|------|---------|
| `supabase/payments.sql` | Payment / escrow records |
| `supabase/payments-release.sql` | `transfer_id` column |
| `supabase/stripe-connect.sql` | `stripe_connect_id`, `stripe_payouts_enabled` |
| `supabase/teen-accounts-secure.sql` | Guardian Connect columns (minors) |

---

## 2. Supabase secrets

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_YOUR_KEY
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SECRET
supabase secrets set SITE_URL=https://quickgigs.ca
# Optional flat override when FEE_FORCE_ENV=1:
# supabase secrets set FEE_FORCE_ENV=1
# supabase secrets set PLATFORM_FEE_PERCENT=15
```

Never commit secrets.

---

## 3. Deploy Edge Functions

```bash
cd "c:\QuickGigs by mowebco"
supabase functions deploy create-connect-link --no-verify-jwt
supabase functions deploy sync-connect-status --no-verify-jwt
supabase functions deploy create-checkout --no-verify-jwt
supabase functions deploy create-escrow-intent --no-verify-jwt
supabase functions deploy confirm-checkout --no-verify-jwt
supabase functions deploy release-payout --no-verify-jwt
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy submit-application --no-verify-jwt
```

---

## 4. Stripe webhook events

Endpoint: `https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/stripe-webhook`

Subscribe to at least:

- `checkout.session.completed` / `checkout.session.expired`
- `payment_intent.succeeded` / `payment_intent.payment_failed`
- `account.updated`
- `payment_method.detached` (poster verification revoke)
- Identity events if using Stripe Identity

---

## 5. Flow

1. **Tasker** → Profile → **Set up payouts** → `create-connect-link` → Stripe Express hosted onboarding (`business_type: individual`, `country: CA`, `transfers` capability).  
   - Under-18: blocked; guardian must onboard (`guardian_token` path). Stripe requires 18+ account holders.
2. **Readiness** = `charges_enabled && payouts_enabled` → synced to `users.stripe_payouts_enabled` (`sync-connect-status` + `account.updated` webhook). Required to **apply** / be **accepted** on paid tasks.
3. **Poster** accepts tasker → **Pay** (`create-checkout` embedded Checkout, or `create-escrow-intent` PaymentIntent).  
   - No `transfer_data` — funds stay on platform.  
   - `transfer_group = task_<taskId>`.
4. Webhook marks `payments.status = held` and unlocks chat.
5. **Mark complete** → `release-payout` creates Transfer of **85%** to Connect account (same `transfer_group`), idempotent via `transfer_id` + Stripe idempotency key.

### Test card

`4242 4242 4242 4242`

---

## 6. Frontend config (`qg-config.js`)

```js
paymentsEnabled: true,
chatUnlockAfter: 'payment',
platformFeePercent: 15,
createCheckoutUrl: '.../create-checkout',
createEscrowIntentUrl: '.../create-escrow-intent',
connectLinkUrl: '.../create-connect-link',
releasePayoutUrl: '.../release-payout',
```

Push → hard refresh (service worker).

---

## Resume app on same Stripe?

Use metadata `project: quickgigs` on all QuickGigs objects. Keep a **separate webhook endpoint** for QuickGigs.
