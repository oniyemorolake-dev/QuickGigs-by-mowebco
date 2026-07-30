# Verification gates deployment

1. Apply SQL after the teen-account migrations:

```text
teen-accounts-secure.sql
teen-task-approvals.sql
verification-gates.sql
```

Existing users default to unverified. Users already marked `is_verified = true`
are preserved as identity-verified taskers; poster verification is never inferred
from a payout account.

2. Ensure these Edge Function secrets are configured:

- `FIREBASE_PROJECT_ID`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SITE_URL=https://quickgigs.ca`

3. Enable Stripe Identity in the Stripe Dashboard, then deploy:

```sh
supabase functions deploy role-verification
supabase functions deploy submit-application
supabase functions deploy post-task
supabase functions deploy register-account
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook
```

4. Subscribe the Stripe webhook endpoint to:

- `checkout.session.completed`
- `identity.verification_session.verified`
- `identity.verification_session.requires_input`
- `identity.verification_session.canceled`
- `payment_method.detached`

5. Verify enforcement:

- An unverified user can sign up, browse, and edit their profile.
- Direct task insertion fails with `poster_payment_verification_required`.
- Direct application insertion fails with `tasker_identity_verification_required`.
- Changing an application to `accepted` fails while its tasker is unverified.
- Checkout rejects callers who are not the authenticated, payment-verified task poster.
- Stripe Identity completion sets only `tasker_verified`.
- Stripe Setup completion sets only `poster_verified`.
- Teen applications still enter `pending_guardian` after identity verification.
