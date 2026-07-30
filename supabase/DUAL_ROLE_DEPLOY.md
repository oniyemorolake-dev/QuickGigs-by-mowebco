# Dual Tasker/Poster role deployment

Apply this after the teen-account and verification migrations:

1. Run `supabase/dual-role-accounts.sql` in Supabase SQL Editor.
2. Deploy the authenticated functions:

```sh
supabase functions deploy role-access
supabase functions deploy register-account
supabase functions deploy post-task
supabase functions deploy submit-application
supabase functions deploy role-verification
supabase functions deploy create-checkout
```

3. Confirm `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the existing Firebase verification secrets are configured.

Migration behavior:

- Existing adult accounts keep Tasker and Poster capabilities.
- Existing teen accounts become Tasker-only.
- New accounts enable only the role selected during signup.
- Poster opt-in is rejected until the account holder is 18.
- `dual-role-accounts.sql` must remain the final migration defining `require_active_qg_actor()`, because it composes account, role, and verification gates.

Verification:

- A Tasker-only account cannot post through the UI or `post-task`.
- A Poster-only account cannot apply through the UI or `submit-application`.
- A teen cannot enable Poster mode through `role-access`.
- Dual-role accounts restore `last_active_mode` and show the segmented header switch.
