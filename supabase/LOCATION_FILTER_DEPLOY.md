# Location and radius filtering deployment

1. Run `supabase/tasks-location.sql` in the Supabase SQL Editor.
2. Deploy the authenticated task-posting function:

```sh
supabase functions deploy post-task
```

3. Confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured for the function.
4. Post a test task using a Canadian city or area and verify `tasks.lat` and `tasks.lng` are populated.
5. In Browse, test the 20 km, 50 km, 100 km, and Anywhere filters and confirm cards show distance and default to nearest-first.

New task coordinates are resolved server-side through Nominatim and rounded to approximately one-kilometre precision. Existing tasks without coordinates remain visible with “Anywhere,” but are excluded from finite-radius results until they are reposted or backfilled.
