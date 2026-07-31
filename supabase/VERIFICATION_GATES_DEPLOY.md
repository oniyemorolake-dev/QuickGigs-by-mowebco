# Verification gates deployment (email-only launch)

Anyone may sign up and **browse** freely. Verification is required only when they **act**.

## Launch rules

| Role | Gate | Requirement |
|------|------|-------------|
| Tasker | Apply / Accept | Confirmed **email**. Sets `tasker_verified`. Copy: “Verify your email to start working.” |
| Poster | Publish (`status=open`) | Stripe payment method via existing Setup Checkout. Sets `poster_verified`. |
| Poster | Draft (`status=draft`) | Allowed without payment method. |
| Teen | Apply | Email verification **plus** existing guardian consent/approval. |

### Hooks (structured, not required yet)

- `phone_verification_required` → future Firebase Phone Auth
- `tasker_id_check_required` + `start_tasker_id_check` → future hard ID (Stripe Identity)
- `task_categories.requires_enhanced_verification` / `tasks.requires_enhanced_verification` — Care flagged now

## SQL order

```text
verification-gates.sql          (if not already)
dual-role-accounts.sql
role-access-trigger-fix.sql
protect-transaction-ownership-fix.sql   (if you hit worker_id errors)
verification-soft-launch.sql
verification-email-launch.sql             ← email-only recompute + backfill
```

## Secrets

- `STRIPE_SECRET_KEY=sk_test_…` (Supabase secrets — never commit)
- `STRIPE_WEBHOOK_SECRET`
- `FIREBASE_PROJECT_ID`
- `SITE_URL`

Escrow stays off (`paymentsEnabled: false`). Poster PM verification is on via `posterPaymentVerificationEnabled: true` and existing `role-verification` `start_poster` / `sync_poster`.

## Deploy

```sh
supabase functions deploy role-verification
supabase functions deploy submit-application
supabase functions deploy post-task
supabase functions deploy stripe-webhook
```

## Verify

- Unverified users browse + edit profile.
- Apply fails without email verification.
- Publish fails without `poster_verified`; draft succeeds.
- Stripe Setup completion sets `poster_verified`.
- Teen apps still need guardian approval after email verify.
