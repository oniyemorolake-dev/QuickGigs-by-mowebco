# Teen accounts deployment

1. Run these SQL files in order:
   - `teen-accounts-secure.sql`
   - `teen-task-approvals.sql`
2. Configure Edge Function secrets:
   - `FIREBASE_PROJECT_ID=quickgigs-7b12d`
   - `GUARDIAN_CONSENT_SECRET` (at least 32 random characters)
   - `RESEND_API_KEY`
   - `FROM_EMAIL`
   - `SITE_URL=https://quickgigs.ca`
   - existing `STRIPE_SECRET_KEY`
   - `GRADUATION_CRON_SECRET` (a separate random secret)
3. Deploy:

```sh
supabase functions deploy register-account
supabase functions deploy guardian-consent
supabase functions deploy resend-guardian-consent
supabase functions deploy guardian-queue
supabase functions deploy my-applications
supabase functions deploy graduate-account
supabase functions deploy post-task
supabase functions deploy submit-application
supabase functions deploy create-connect-link
supabase functions deploy sync-connect-status
supabase functions deploy release-payout
```

4. In Supabase Vault, add `graduation_function_url` and
   `graduation_cron_secret`, then run `graduation-cron.sql`.
5. Verify RLS as an anonymous client: a `pending_guardian` application must
   not be selectable, while the same row is returned by `my-applications`
   only for its Firebase-authenticated worker.

The functions use custom Firebase token verification, so their Supabase JWT
gateway checks are disabled in `config.toml`. Do not remove the in-function
Firebase verification from authenticated actions.
