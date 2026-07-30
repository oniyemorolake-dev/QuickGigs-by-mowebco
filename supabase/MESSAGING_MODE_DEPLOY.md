# Mode-scoped messaging deployment

Deploy after the dual-role account migration:

1. Run `supabase/messaging-secure.sql` in the Supabase SQL Editor.
2. Deploy the Firebase-authenticated messaging function:

```sh
supabase functions deploy secure-messaging
```

3. Confirm `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the existing Firebase
   verification secrets are configured for the function.

`messaging-secure.sql` removes all anonymous conversation/message access. Deploy the
function and web client together; the browser no longer reads or writes these tables
directly.

Verification:

- A Tasker inbox only lists conversations where the signed-in UID is `worker_id`.
- A Poster inbox only lists conversations where the signed-in UID is `poster_id`.
- The Messages tab badge counts only the active mode.
- The inactive role pill shows a dot when that side has unread conversations.
- Fetching a conversation or its messages as a non-participant returns 404.
- Conversation creation fails unless the task poster and accepted tasker match.
