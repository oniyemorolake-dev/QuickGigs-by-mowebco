# QuickGigs SQL (synced schema)

Canonical, repeatable database scripts for Supabase project **nuyfqsxstsrbloztzgau**.

## Files

| File | Purpose |
|------|---------|
| [`schema.sql`](schema.sql) | Single source of truth for core tables, indexes, admin allow-list, and (commented) RLS for reports/blocks/disputes. Idempotent — safe to re-run. |
| [`seed-reset.sql`](seed-reset.sql) | **Irreversible** wipe of test content (messages → conversations → reviews → apps → payments → reports/blocks/disputes → tasks). Users delete is commented out. |

Granular one-off migrations also live under [`../supabase/`](../supabase/) (storage, waitlist, etc.). Prefer updating **`sql/schema.sql`** when core columns change so the repo stays in sync.

## Run order

1. Open Supabase → **SQL Editor**.
2. Paste and run **`schema.sql`** (full file).
3. Only if you need a clean test slate: read the warning in **`seed-reset.sql`**, then run it on a **test** project/backup only.
4. **Do not** uncomment / enable SECTION 4 RLS until Firebase JWT is linked to Supabase — enabling RLS early will lock the anon client out.

## Rules

- **Never commit real keys** (anon, service-role, Stripe, Firebase private keys). Schema and indexes only.
- **Never rename** existing tables or columns that live client code already uses.
- Column names must match live selects/writes in `supabase-db.js` (e.g. `task_mode` not `mode`, `review_comment` not `comment`).

## Notes

- Messages are keyed by **`conv_id`** (index `conv_id, created_at`), not `task_id`.
- Task recurring/hourly columns: `rate_type`, `is_recurring`, `hourly_rate`, `frequency`, `est_hours`.
- Task location: `location` (public city/area), `lat` / `lng` (approx for distance), `precise_address` (post-accept only). See also `supabase/tasks-location.sql`.
- Users subscriber flag: `is_subscriber`. Email verification for the profile meter: `email_verified` (not `is_verified`, which is the worker trust badge).
