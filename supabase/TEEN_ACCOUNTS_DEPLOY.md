# Teen accounts deployment

1. Run `teen-accounts-secure.sql` in the Supabase SQL editor.
2. Configure Edge Function secrets:
   - `FIREBASE_PROJECT_ID=quickgigs-7b12d`
   - `GUARDIAN_CONSENT_SECRET` (at least 32 random characters)
   - `RESEND_API_KEY`
   - `FROM_EMAIL`
   - `SITE_URL=https://quickgigs.ca`
   - existing `STRIPE_SECRET_KEY`
3. Deploy:

```sh
supabase functions deploy register-account
supabase functions deploy guardian-consent
supabase functions deploy resend-guardian-consent
supabase functions deploy post-task
supabase functions deploy submit-application
supabase functions deploy create-connect-link
supabase functions deploy release-payout
```

The functions use custom Firebase token verification, so their Supabase JWT
gateway checks are disabled in `config.toml`. Do not remove the in-function
Firebase verification from authenticated actions.
