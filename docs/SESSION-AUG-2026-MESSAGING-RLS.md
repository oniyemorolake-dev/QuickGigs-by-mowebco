# QuickGigs — Session work log (documentation)

**Scope:** Messaging rebuild, security/RLS prep, intentional product rules, junk cleanup, title/name hydration  
**Branch:** `main` (pushed to `origin/main`)  
**Key commits:** `7decd5d` → `ae3c3c7` → `276cf89` → `b5d8dc9`  
**Date context:** mid–late Aug 2026 workstream

---

## 1. Executive summary

This workstream hardened messaging and privacy, rebuilt the Messages UI, cleaned a bad junk commit on `main`, then restored three intentional product decisions that the rebuild had regressed:

1. **Show all conversations** (no poster/tasker mode filter)
2. **Chat unlocks on acceptance** (not payment) while Stripe testing is paused
3. **Real task titles and display names** (fix empty “Untitled” / “a QuickGigs member” caused by RLS recursion + join miss)

Edge Functions for hydration were **deployed**. One SQL fix for RLS recursion was **written** and must still be **applied** in Supabase if not already run.

---

## 2. Timeline of commits (this arc)

| Commit | What it did |
|--------|-------------|
| **`7decd5d`** | Harden messaging UX; server-side notification emails; client prep for `public_user_profiles`; add `supabase/rls-drop-open-policies.sql` |
| **`ae3c3c7`** | Claimed “Rebuild messages UI…” but mostly polluted history with `node_modules/` + Chrome CDP scratch dirs |
| **`276cf89`** | Cleanup: gitignore + untrack junk (no history rewrite / no force-push) |
| **`b5d8dc9`** | Restore accept-gated chat, unfiltered inbox, title/name hydration + RLS recursion SQL + Edge Function joins |

---

## 3. Security & privacy

### 3.1 RLS audit (report only — policies not applied in that step)

- Confirmed live DB: RLS ON on public tables.
- Finding: legacy open/`anon_* true` policies **OR** with tighter `qg_uid()` policies → open access wins.
- Sensitive surfaces called out: `users`, `payments`, `applications`, `tasks`, `reviews`, etc.
- Edge Functions correctly use **service role** (bypass RLS by design).

### 3.2 Lockdown migration (written)

**File:** `supabase/rls-drop-open-policies.sql`

- Drops open “Anyone can…” policies
- Tightens `users` SELECT toward owner/admin
- Creates **`public.public_user_profiles`** (safe columns; no Stripe IDs / DOB / guardian contact)
- Storage: drops overly open policies; keeps intentional public profile/task-image reads

**Status:** Written for review; apply only when approved (do not assume applied unless verified).

### 3.3 Client prep for safe profiles

**File:** `supabase-db.js`

- Other-user / card reads go through `public_user_profiles`
- Fallback to `users` only if the view is missing
- Own profile still uses `users` via self detection (`{ self: true }` / `isSelfUserQuery`)

### 3.4 Notification emails (privacy)

**Files:**

- `supabase/functions/send-notification/index.ts` (deployed)
- `qg-notifications.js`
- `mytasks.html`

**Change:** Recipient email resolved **server-side** from `users` by `user_id` / `firebase_uid`. Client no longer passes other users’ emails for accept/complete flows.

### 3.5 Live investigation: titles/names empty

**Verified against project `nuyfqsxstsrbloztzgau`:**

- `public_user_profiles` **is deployed** and returns names
- Direct `users` SELECT as anon returns `[]` (RLS)
- `tasks` / `applications` REST returned **`42P17` infinite recursion** (circular `EXISTS` between policies)

**Root cause of “Untitled task” / “a QuickGigs member” on Applied cards:**  
Apps load via service-role Edge Function; task rows fail over REST → join miss → empty task object → fallbacks.

---

## 4. Messages UI rebuild

### 4.1 Product rebuild (intended in `ae3c3c7` / surrounding work)

**Primary file:** `messages.html`

- Two-column desktop inbox + thread
- Mobile slide into thread
- Report / Block (no call/video)
- Image attachments via upload + `[img]` + lightbox
- Null-guarded listeners; try/catch boot
- Open handler: `openConversation(conv_id)` from `.im-row` / `?conv=`
- `chat.html` redirects into `messages.html`
- Theme/nav restored inside QuickGigs chrome (not a detached Messenger shell)

### 4.2 Junk pollution cleanup (`276cf89`)

**Problem:** `ae3c3c7` committed `node_modules/` and `tmp-chrome-*` CDP profiles.

**Fix (no rewrite / no force-push):**

- `.gitignore`: `node_modules/`, `tmp-chrome-*/`, `.temp/`
- `git rm -r --cached` for those paths (kept on disk)
- Cleanup commit only

---

## 5. Intentional product rules (restored in `b5d8dc9`)

### 5.1 No poster/tasker mode filter on inbox

**File:** `messages.html`

- Removed mode filtering that hid chats when workspace mode ≠ conversation side
- `conversationsForCurrentMode()` returns **full list** for current Firebase UID
- Kept per-row **Poster / Tasker** role chip
- Removed empty-state copy: *“Conversations for your other mode stay in that mode’s inbox.”*
- Mode-change handler no longer refilters the list (badge refresh only)

### 5.2 Chat unlocks on acceptance (Stripe paused)

**File:** `qg-config.js`

```text
chatUnlockAfter: 'accept'
// When Stripe is live, restore the escrow-gated contact rule.
```

- `getChatUnlockRule()` / `isChatPaymentGated()` honor accept vs payment
- `paymentsEnabled` left **`true`** (Stripe UI/surfaces not fully dark; chat gating independent)
- Copy updated so users do not see “waiting for payment to unlock chat” while accept-gated
- **`payment.html`:** escrow hold copy without “unlock chat”
- Fee model unchanged: **15% tasker-pays**

### 5.3 Resolve names and task titles

**Client:** `supabase-db.js`, `mytasks.html`, `messages.html`

- `taskRowFromApplication()` builds task-shaped rows from app embeds when REST tasks fail
- `fetchMyTasksBundle` / `fetchApplicationsForActor` hydrate from Edge Function `tasks` + embeds
- Applied cards fall back to embedded `task_title` / `posted_by` / `poster_name`
- `enrichConversationNames` also tries to fill `task_title`

**Edge Functions (deployed):**

- `my-applications` — joins tasks; returns apps + posted `tasks`
- `secure-messaging` — list hydrates empty `task_title` / names via service role

**SQL fix (must apply in Supabase if not done):**  
`supabase/rls-fix-tasks-apps-recursion.sql`

- SECURITY DEFINER helpers: `qg_uid_is_applicant_on_task`, `qg_uid_owns_task`
- Recreates `tasks_select_auth` / `applications_*` without recursive `EXISTS`
- Also mirrored into `supabase/firebase-rls-uid-fix.sql` for future applies

---

## 6. Files touched (documentation index)

### Frontend / config

- `messages.html` — rebuild + unfiltered inbox + role chips + title display
- `mytasks.html` — accept-chat copy; Applied card hydration
- `payment.html` — escrow copy
- `qg-config.js` — `chatUnlockAfter: 'accept'`
- `supabase-db.js` — public profiles, enrichment, my-tasks hydrate
- `qg-notifications.js` — strip client emails for user-targeted types
- `chat.html` — redirect to messages

### Supabase

- `supabase/rls-drop-open-policies.sql` — lockdown + `public_user_profiles` (pending apply as policy)
- `supabase/rls-fix-tasks-apps-recursion.sql` — recursion fix (apply in SQL Editor)
- `supabase/firebase-rls-uid-fix.sql` — non-recursive party policies
- `supabase/functions/send-notification/index.ts` — server email resolve
- `supabase/functions/my-applications/index.ts` — task join hydrate
- `supabase/functions/secure-messaging/index.ts` — list hydrate

### Repo hygiene

- `.gitignore` — `node_modules/`, `tmp-chrome-*/`, `.temp/`

---

## 7. Explicit non-goals / unchanged

- **Did not** rewrite git history or force-push
- **Did not** change the **15% tasker fee**
- **Did not** set `paymentsEnabled: false` (left true; chat gate via `chatUnlockAfter`)
- **Did not** fully apply the open-policy drop SQL in this arc as an automatic deploy (review/apply separately)

---

## 8. Current system state (as of push `b5d8dc9`)

| Area | State |
|------|--------|
| Messages UI | Rebuilt two-column + mobile; Report/Block; images |
| Inbox filtering | All threads for signed-in UID; role label only |
| Chat unlock | Acceptance (`chatUnlockAfter: 'accept'`) |
| Notification emails | Server resolves recipient email |
| Public profiles view | Deployed live; client uses it |
| Title/name hydration | Edge Functions deployed; client hydrate wired |
| Junk in git | Untracked going forward (`276cf89`) |
| Tasks/apps RLS recursion | SQL fix written; **apply if REST still 42P17** |

---

## 9. Recommended follow-ups (ops checklist)

1. **Apply** `supabase/rls-fix-tasks-apps-recursion.sql` in Supabase SQL Editor if tasks/apps REST still error with `42P17`.
2. **Review then apply** `supabase/rls-drop-open-policies.sql` when ready for full open-policy lockdown (coordinate with `public_user_profiles` already live).
3. Hard-refresh / purge CDN cache after Pages deploy so `qg-config.js` + `messages.html` + `supabase-db.js` are current.
4. When Stripe goes live: set `chatUnlockAfter: 'payment'` and restore escrow-gated contact copy (comment already in `qg-config.js`).
5. Optional later: set `paymentsEnabled: false` if you want Stripe Connect/checkout UI fully hidden during pause.

---

## 10. One-line product decisions (for stakeholders)

- **Inbox:** one unified Messages list per account, not split by Poster/Tasker mode.
- **Chat:** unlock after accept while Stripe is paused; restore escrow gate at launch.
- **Privacy:** don’t send other users’ emails from the browser for notifications.
- **Data safety:** marketplace cards should use `public_user_profiles`, not full `users` rows.
- **Repo:** never commit `node_modules` or Chrome CDP scratch directories again.

---

*Generated for documentation from the Aug 2026 messaging / RLS workstream.*
