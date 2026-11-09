# QuickGigs pre-launch audit

**Date:** 27 Aug 2026  
**Scope:** Read-only diagnosis of static front end + Supabase (Canada Central, `nuyfqsxstsrbloztzgau`) + Firebase Auth (`quickgigs-7b12d`).  
**Method:** Code review of committed SQL/JS/HTML; live anon REST probes against production PostgREST. **No application code was modified in this pass.**

---

## Prioritised fix list — before real money

Ordered by blast radius if CAD escrow goes live.

1. **Apply `supabase/rls-fix-tasks-apps-recursion.sql`** — Live `tasks` / `applications` SELECT returns `42P17` infinite recursion. Marketplace browse and client task reads are broken except via service-role Edge Functions.  
2. **Close open Storage policies on `chat-photos` (and audit `task-photos`)** — `supabase/storage-beta-fix.sql` grants bucket-wide INSERT/SELECT to anon. Any holder of the anon key can upload or read chat attachments.  
3. **Ensure payment writes are service-role only** — Remove or dead-code `savePayment()` client `sbPost('payments', …)` (`supabase-db.js` ~4426). Confirm no client INSERT/UPDATE grants on `payments`. Fees must stay on Edge Functions (`create-checkout`, etc.).  
4. **Tighten `users` SELECT** — Live `public_user_profiles` is good; `firebase-rls-uid-fix.sql` still defines `users_select_auth` as any signed-in user (`qg_is_signed_in()`). Apply owner/admin SELECT from `rls-drop-open-policies.sql` so JWT holders cannot dump emails / Stripe / guardian fields via REST.  
5. **Stop treating admin UI as security** — `qg-admin-gate.js` is documented UX-only. Gate every admin mutation behind service-role Edge Functions that check `admins` / custom claim `admin:true`. Do not rely on `users.role === 'admin'` alone in the browser.  
6. **Confirm `protect_qg_role_fields` + payment ownership triggers are live** — Schema files define them; if not applied, a self-UPDATE could escalate `role` / verification / Stripe IDs.  
7. **Verify Stripe fee math only server-side** — `create-checkout` already computes `platform_fee` / `worker_payout`. Ban any path that trusts browser-supplied fee fields.  
8. **Geo completeness for escrow markets** — Require `lat`/`lng` (or postal → geocode) on in-person tasks before fund; otherwise “near me” silently drops tasks without coords (`filterTasksByDistance` + `includeUnknown:false` in browse).  
9. **Never re-apply open-policy SQL** — `supabase/chat-unlock-fix.sql` (and older `payments.sql` / `beta-setup-all.sql` / `launch-stabilize.sql`) still contain `anon_insert_payments` / open conversation policies. Re-running them after lockdown re-enables forgeable payments and open chat. Treat as toxic; quarantine or delete from runbooks.  
10. **Strip prod console logs that emit Firebase UIDs / task / app IDs** — e.g. apply/complete paths in `browsetask.html`, `mytasks.html`, `supabase-db.js`, `qg-role-access.js`, `admin.html`.

---

## Can wait until after launch

- Full Canada postal geocoder (vs Nominatim client-side); wire hero `?postal=` into posttask (currently collected on `index.html` but unused)  
- Dedicated remote/online task type (not location-filtered)  
- Removing Calgary/Edmonton marketing defaults and datalist suggestions  
- Orphan / half-built page cleanup (`modeselector.html`, `workers.html`, demo data in `mytasks.html`, unload `profileCompletion.js` / `qg-abuse.js`)  
- Naming convention sweep (`user_id` TEXT vs UUID claim; mixed `worker`/`tasker`; drop `role === 'both'` fallbacks)  
- Align `public_user_profiles.verified` / `rating` with base columns (`is_verified`; no `users.verified` per `profile-completion.sql`)  
- XSS polish on admin notif list (lower risk if admin-only)  
- Rotating Firebase web API key / restricting by HTTP referrer (expected public; still good hygiene)  
- Replace Oracle wording in `privacy.html` with Supabase  
- Fix `review.html` still treating `qg-mode` as light/dark (collides with poster/tasker mode)  
- Single-account mode UX polish (dual-role already in schema — see §5)

---

## 1. Security

### 1.1 Live RLS / anon REST (probed 27 Aug 2026)

| Table / view | Anon key (no JWT) result | Severity | Why it matters | Fix |
|--------------|--------------------------|----------|----------------|-----|
| `users` | HTTP 200, `[]` | — | Empty list under anon without JWT | Keep; do not re-open |
| `public_user_profiles` | HTTP 206, names returned | Low (intentional) | Safe projection for cards | Keep; never add email/Stripe columns |
| `tasks` | HTTP 500 `42P17` infinite recursion | **Critical** | Browse/My Tasks client REST fails; forces Edge Function workarounds | Apply `supabase/rls-fix-tasks-apps-recursion.sql` |
| `applications` | HTTP 500 `42P17` | **Critical** | Same recursion with `tasks` policies | Same SQL fix |
| `payments` | HTTP 401 / `42501` permission denied (no GRANT SELECT to anon) | Medium (good) | Anon cannot read payments via REST today | Keep no GRANT; never add client INSERT |
| `reviews` | HTTP 200, `[]` | Medium | Empty DB or policies allow SELECT with no rows; `reviews_select_auth` historically `USING (true)` for authenticated | Prefer public-safe columns only; no PII in reviews |

**File evidence (policy recursion):** `supabase/firebase-rls-uid-fix.sql` historically had `tasks_select_auth` `EXISTS applications` and `applications_select_auth` `EXISTS tasks`. Fix helpers `qg_uid_is_applicant_on_task` / `qg_uid_owns_task` are in `supabase/rls-fix-tasks-apps-recursion.sql` but **were not applied** on the live project at probe time.

### 1.2 Cross-user reads / writes

| Finding | File:line | Severity | Why | Fix |
|---------|-----------|----------|-----|-----|
| Signed-in users may SELECT all `users` rows under Firebase RLS script | `supabase/firebase-rls-uid-fix.sql` ~229–231 `USING (public.qg_is_signed_in())` | **High** | JWT + anon key can dump emails, DOB, guardian, Stripe IDs if columns are selected | Apply owner/admin-only SELECT (`rls-drop-open-policies.sql` ~72–77); clients already prefer `public_user_profiles` (`supabase-db.js` ~101–114, `sbGetPublicProfiles` ~1725) |
| `security-lockdown.sql` uses `auth.uid()::text` while Firebase JWTs need `qg_uid()` | `supabase/security-lockdown.sql` ~355–366, ~376–381 | **High** | Policies keyed on Supabase Auth UID do not match Firebase `sub` | Prefer `firebase-rls-uid-fix.sql` / `qg_uid()` everywhere; never mix |
| Task UPDATE restricted to poster / admin (Firebase script) | `supabase/firebase-rls-uid-fix.sql` ~173–180 | Medium | Correct intent; verify live | Confirm policy live; add column-level protection so poster cannot rewrite `budget` after escrow without Edge Function |
| Application accept blocked for worker via trigger | `supabase/security-lockdown.sql` ~127+ `protect_application_status` | **High** (if live) | Prevents self-hire | Confirm trigger installed on production |
| Privileged user fields blocked on UPDATE | `supabase/security-lockdown.sql` ~48–117 `protect_qg_role_fields` | **Critical** (if missing) | Without it, self-UPDATE of `role='admin'` | Verify trigger `users_protect_role_fields` exists in DB |

### 1.3 Admin gate is client-side UX

| Finding | File:line | Severity | Why | Fix |
|---------|-----------|----------|-----|-----|
| Documented UX-only admin helper | `qg-admin-gate.js` 1–12, `isAdmin` 63–94 | **Critical** | Attacker ignores UI; hits REST/Edge with stolen session | All admin reads/writes via service-role functions checking `admins` table / claim |
| Email allow-list in public config | `qg-config.js` 81 `adminEmail: 'mowebsiteco@gmail.com'` | Medium | Reveals operator email; soft bypass for menus | Remove from public config; use UID claim only |
| Console entry still checks `users.role === 'admin'` | `qg-admin-gate.js` 9–11, 51–56 | High | If role escalateable or row readable, UI unlocks | Server gate + custom claim |

**What an attacker can do:** Open `admin.html` is blocked in UX only. Direct PostgREST with Firebase JWT still subject to RLS/triggers. If open policies or missing triggers exist, they can read/write whatever those allow — **not** “whatever the admin page shows.” Assume worst case until SQL is verified applied.

### 1.4 Secrets in repo / history

| Finding | File:line | Severity | Why | Fix |
|---------|-----------|----------|-----|-----|
| Supabase **anon** JWT hardcoded | `supabase-db.js` 7; `supabaseClient.js` ~9 | Medium (expected for SPA) | Public by design; dangerous only with weak RLS | Treat as public; harden RLS |
| Firebase web `apiKey` + config in many HTML pages | e.g. `login.html` 157+, `admin.html` 572+, `messages.html` 524+ | Low–Medium | Normal for Firebase JS SDK | Restrict key by domain in Google Cloud; do not commit service accounts |
| Stripe **publishable** test key in config | `qg-config.js` 40 `stripePublishableKey: 'pk_test_…'` | Low | Publishable | Keep test until launch; never commit `sk_` |
| Stripe / service role only via `Deno.env` in functions | e.g. `create-checkout/index.ts` 3, 301 | — | Correct | Keep |
| No `sk_live` / service-role in frontend | — | — | Correct | Keep scanning CI |
| Formspree form endpoint ID committed | `feedback.html` ~55 `formspree.io/f/…` | Low | Public form endpoint; spam risk | Rate-limit / rotate Formspree; CAPTCHA if abused |
| Firebase JWT reject → Bearer falls back to **anon** | `supabaseClient.js` ~144–147 | Medium | Signed-in UX may silently use anon RLS | Fail closed when `supabaseFirebaseAuth` is true; surface auth error |

Git history search showed money/auth hardening commits (`2c166f5`, `1d3c382`, etc.) but **no evidence in this pass of a committed service-role key in current JS/HTML**. Still rotate if any historical leak is found outside this scan.

### 1.5 Escrow / fee forgeability

| Finding | File:line | Severity | Why | Fix |
|---------|-----------|----------|-----|-----|
| Client `savePayment` posts `amount`, `platform_fee`, `worker_payout` | `supabase-db.js` 4426–4436 | **Critical** if INSERT allowed | Browser can invent fees | Delete path or ensure RLS denies; only Edge Functions write payments |
| Open payment/chat policies still in repo | `supabase/chat-unlock-fix.sql` 13–15, 26–38 | **Critical** if re-applied | `anon_insert_payments` + open conversations/messages | Quarantine file; never run after lockdown |
| Checkout amount from DB app price / budget only | `create-checkout/index.ts` `resolveAmount` ~51–64 | — (good) | Server does not trust `body.amount` | Keep |
| Fee display helpers in browser | `feeBreakdown.js` 25–74; `qg-utils.js` ~1205; `qg-config.js` 65 `taskerFeePercent: 15` | Low (UX) | Display-only if server recomputes | Keep server as source of truth |
| Checkout computes fee server-side | `supabase/functions/create-checkout/index.ts` 450–518 | — | Correct | Keep; ignore client fee fields |

### 1.6 Uploads / chat attachments

| Finding | File:line | Severity | Why | Fix |
|---------|-----------|----------|-----|-----|
| Client validates image type + size | `supabase-db.js` 1573–1581; `messages.html` 1324–1326 | Medium | Good UX; not authoritative | Enforce MIME/size in Storage policies / Edge |
| Chat path `chat-photos/{convId}/{userId}/…` | `supabase-db.js` 1534–1543 | Medium | Path convention helps | RLS must require party membership |
| **Open chat bucket policies** | `supabase/storage-beta-fix.sql` 39–45 `WITH CHECK (bucket_id = 'chat-photos')` / `USING (bucket_id = 'chat-photos')` | **Critical** | Any anon can read/write all chat images | Replace with participant policies (see `rls-drop-open-policies.sql` storage section) |

### 1.7 XSS

| Finding | File:line | Severity | Why | Fix |
|---------|-----------|----------|-----|-----|
| Chat bubbles escape text | `messages.html` `esc` ~654; `renderMessageBody` 1160–1176 returns `esc(bodyText)` | — | Good | Keep |
| Image URLs passed through `safeMediaUrl` + `esc` | `messages.html` 1163–1168 | — | Good | Keep |
| Admin notif list concatenates `n.title` / `n.text` into `innerHTML` without esc | `admin.html` 1078 | Medium | XSS if attacker can inject notif payload | Use `esc()` / `textContent` |
| Most card UIs use `esc(...)` helpers | e.g. `mytasks.html` titles via `formatTaskDisplayTitle` + `esc` | — | Prefer keep pattern | Ban raw `innerHTML` for user fields in review |

---

## 2. Data model and SQL

Canonical file: `sql/schema.sql`.

### 2.1 Constraints

| Finding | File:line | Severity | Why | Fix |
|---------|-----------|----------|-----|-----|
| `users.firebase_uid` nullable TEXT; unique partial index | `sql/schema.sql` 22, 499–500 | Medium | Dupes possible with NULL | Enforce NOT NULL after backfill; keep unique index |
| No UNIQUE on `users.email` in schema excerpt | `sql/schema.sql` 20–75 | Medium | Duplicate accounts | Add unique where email present |
| `users.user_id` is **TEXT** PK, not UUID | `sql/schema.sql` 21 | Medium | Docs/product language say UUID | Align docs or migrate |
| Dual-role CHECKs exist | `sql/schema.sql` 149–156 | — | Good | Keep |
| `tasks.budget` NUMERIC **without** `CHECK (budget >= 20)` | `sql/schema.sql` 188 | **High** | $20 minimum is client-only (`qg-config.js` 108 `minBudget: 20`) | Add CHECK + Edge validation |
| `rate_type` CHECK fixed/hourly | `sql/schema.sql` 240 | — | Good | Keep |
| `tasks.status` no CHECK enum | `sql/schema.sql` 190 | Medium | Typos / illegal status | CHECK (`open`,`in_progress`,`completed`,`cancelled`,…) |
| Applications `status` no CHECK | `sql/schema.sql` 275 | Medium | Same | CHECK pending/accepted/declined/cancelled |
| Payments amounts NUMERIC | `sql/schema.sql` 315–317 | — | Good (not float) | Keep NUMERIC(12,2) |
| `tasks.lat`/`lng` are **DOUBLE PRECISION** | `sql/schema.sql` 203–204 | Low | Fine for coords; not money | Keep; index later |
| Canada bounding CHECK on coords | `sql/schema.sql` 260–264 | — | Good | Keep |
| FKs sparse: apps/tasks/payments lack FK to users/tasks | `sql/schema.sql` apps/payments sections | Medium | Orphans | Add FKs when IDs stable |
| `messages.conv_id` FK to conversations | `sql/schema.sql` 404 | — | Good | Extend pattern |
| `MODE` / `COMMENT` reserved words | Uses `task_mode`, `review_comment` | — | Verified not reintroduced in schema | Keep names |

### 2.2 Indexes

Present (`sql/schema.sql` ~477–504): `tasks(status,created_at)`, `task_mode`, `posted_by`, `applications(task_id)`, `applications(worker_id)`, `payments(task_id)`, `users(firebase_uid)`, reviews reviewee, etc.

**Missing / weak:** no btree/GiST on `(lat,lng)` for proximity; no index on `tasks.location` text; no `payments(poster_id)` / `(worker_id)` called out in schema section.

### 2.3 Denormalization / drift

| Item | Notes |
|------|-------|
| `poster_name`, `worker_name`, `task_title` on conversations | Denormalized; hydration Edge Functions compensate when empty |
| Client dual casing `TITLE`/`title` | `normalizeTaskRow` in `supabase-db.js` bridges |
| `SELECT_TASKS_*` includes `lat,lng,task_mode` | Matches schema |
| `public_user_profiles` selects `verified` / `rating` | Base table documents `is_verified`; `profile-completion.sql` says no `users.verified` — view may be wrong or legacy |
| Apply path may send `origin_lat` / `origin_lng` | `supabase-db.js` ~3251 — **no matching columns** in SQL tree; may be stripped or fail silently |
| Evidence / alert / phone columns | Live `SELECT_*` ahead of `schema.sql` CREATE (evidence, `alert_*`, phone E.164) — schema file lag |
| Hero `postal` query param | Collected on `index.html`; **not read** by `posttask.html` / browse |

### 2.4 Timestamps

`TIMESTAMPTZ` used widely (`created_at`, etc.) — good. Client `parseQgTimestamp` in `qg-utils.js` treats naive stamps as UTC — keep consistent writes as `timestamptz`.

### 2.5 Naming convention recommendation

**Prefer:** `snake_case` everywhere in DB; Firebase UIDs in `*_id` text columns that store Firebase `sub`; booleans `is_*`; money `numeric(12,2)`.

**Violations / inconsistencies:**

- Product language “UUID `user_id`” vs schema `TEXT`  
- `worker` vs `tasker` (`worker_id`, `is_tasker`, mode `tasker`)  
- Legacy UPPERCASE field aliases in HTML (`TASK_ID`, `POSTED_BY`)  
- `role` string (`poster`/`worker`/`admin`) overlapping `is_poster` / `is_tasker`

---

## 3. Geography and task visibility

### 3.1 How location is stored

| Column | Type | Role |
|--------|------|------|
| `tasks.location` | TEXT | Free-text city/area (e.g. `"Calgary, AB"`) — `sql/schema.sql` 189 |
| `tasks.lat` / `tasks.lng` | DOUBLE PRECISION | Optional coordinates; Canada range CHECK — 203–204, 260–264 |
| `tasks.precise_address` | (detail select) | Sensitive; client comment warns RLS must enforce — `qg-location.js` 222–226 |

Defaults often **`Calgary, AB`** when empty: `supabase-db.js` 1388, 1507; `posttask.html` placeholders 436–439.

### 3.2 How browse decides visibility

1. Load open tasks (`browsetask.html` cache / `getOpenTasksPage` path).  
2. Client filter `getFilteredBrowseTasks` (`browsetask.html` 1317–1353):  
   - Text string on title/category/desc/poster/location  
   - Budget / mode / category / date  
   - **Without geo position:** `taskMatchesLocation` — substring / token match on `location` text (862–884)  
   - **With geo position + radius:** `filterTasksByDistance` (`qg-location.js` 308–326) using **haversine** on `lat`/`lng`; tasks **without coords are excluded** when `includeUnknown:false` (browse passes that at 1351)

### 3.3 Direct answer: Halifax / Winnipeg / Whitehorse / rural SK?

**Yes, they can post** if they type a location string (or geocode succeeds into `lat`/`lng`).  

**Seeing “local” results depends on:**

1. **Text filter:** other tasks’ `location` strings must substring-match (fragile: `"Winnipeg"` vs `"Winnipeg, MB"` vs typos).  
2. **Near-me radius:** both viewer and tasks need coordinates; tasks missing `lat`/`lng` drop out of radius filter.  
3. **Defaults:** new posts may still land as Calgary if the poster never changes the field (`posttask.html` / `supabase-db.js` defaults).

So Canada-wide **claim is only as good as data entry + geocoding**, not a server-side national index.

### 3.4 Calgary / Edmonton hardcoding (examples)

| File:line | What |
|-----------|------|
| `qg-location.js` 14 | `DEFAULT = 'Calgary, AB'` |
| `supabase-db.js` 1388, 1507 | location default Calgary |
| `posttask.html` 436–439, 470, 745–746 | datalist + hints Calgary/Edmonton |
| `dashboard.html` 913, 1316 | fallback city Calgary |
| `index.html` / `signup.html` meta | marketing Calgary & Edmonton |
| `mytasks.html` 1091–1093 | demo tasks Calgary |
| `admin.html` 1017 | neighbourhood chart NW Calgary… |
| `qg-age.js` 9 | `timeZone: 'America/Edmonton'` |

### 3.5 Proximity options (static front end, no app server)

| Approach | Pros | Cons |
|----------|------|------|
| **Postal → lat/lng** (client geocode or Edge + cache table) | Real radius; Canada-wide | Rate limits; need Edge for secrets/quota; privacy |
| **Haversine radius** (already partially built) | Works offline-ish once coords exist | Useless without coords; client-side filter after download |
| **Province + city hierarchy** | Simple UX; no geo API | Not true proximity; string fragility |

**Recommendation:** Require geocode on post (Edge Function + Nominatim/Google); store `lat`/`lng`; browse filters by radius server-side when possible. Keep city text for display only.

### 3.6 Remote / online-only tasks

No first-class `remote` / `online` flag found in schema selects. Location filters apply uniformly — **online tasks will be incorrectly radius-filtered** unless coords are null and text filter is off. **Gap:** add `location_type` (`in_person` \| `remote`) and skip distance filter for remote.

---

## 4. Dead weight and what to remove

| Finding | File / note | Severity | Why | Fix |
|---------|-------------|----------|-----|-----|
| Demo/hardcoded tasks in My Tasks | `mytasks.html` 1091–1093 | Medium | Confusing in beta | Remove |
| `modeselector.html` | **Orphan** — no in-app `href`; superseded by signup + header switch | Medium | Dead SEO/surface | Redirect to dashboard or delete |
| `profileCompletion.js` / `qg-abuse.js` | Never loaded by any HTML | Medium | Dead weight; abuse config unused | Wire or delete |
| `workers.html` | Separate surface | Low | May duplicate Browse | Confirm traffic; redirect or delete |
| `chat.html` | Compat redirect to messages | — | Keep until deep links updated | — |
| APEX leftovers | No APEX apps; uppercase `TASK_ID`/`WORKER_ID` shims remain | Low | Migration scar | Keep until DB confirmed snake_case-only |
| Privacy still mentions Oracle | `privacy.html` ~109–112 | Medium | Inaccurate legal copy | Say Supabase / Firebase |
| `review.html` theme bug | Treats `qg-mode` as light/dark | Medium | Collides with poster/tasker mode | Use theme key only (`qg-theme`) |
| Open Storage / unlock SQL left in tree | `storage-beta-fix.sql`, `chat-unlock-fix.sql` | **High** | Easy to re-apply open policies | Quarantine; document “do not run” |
| Prod `console.log` / `info` leaking UIDs | `browsetask.html` apply path; `mytasks.html` complete; `qg-role-access.js`; `admin.html` | **High** | PII in device logs | Strip or gate behind debug flag |
| Dual CSS stacks on landing | `index.html` + `qg-tokens.css` | Low | Theme fights dark hero | Landing-only tokens |
| Stale `role === 'both'` UI | `profile.html`, `workers.html`, `qg-admin.js` | Low | Dual-role is `is_tasker`∧`is_poster` | Prefer booleans only |
| “Payments coming soon” copy | `qg-wave2.js`, `how-it-works.html` | Medium | Conflicts with live escrow UI | Align copy with Stripe state |

Half-built but reachable (worse than missing):

- Admin console with client gate  
- Escrow UI while `chatUnlockAfter: 'accept'` and payments still enabled  
- Teen safety / guardian flows (complex; verify end-to-end before marketing)  
- Worker counter-offers may break under poster-only `applications` UPDATE RLS (product bug, not fee forge)

---

## 5. The mode question

### 5.1 Current model

| Layer | Behaviour |
|-------|-----------|
| DB | `is_tasker`, `is_poster`, `last_active_mode` (`tasker`\|`poster`) with CHECKs — `sql/schema.sql` 28–31, 149–156 |
| Legacy | `role` text (`poster` / `worker` / `admin`) still present |
| UI | Workspace toggle via `qg-mode` / `setMode` (`dashboard.html`, `qg-theme.js`, brand-init) — **one Firebase account can hold both roles** when enabled |
| Signup | Role choice at signup; second role via consent / role-access Edge flows |

**Can one person do both today?** Yes, by design in dual-role schema and UI mode switch — not two separate accounts required.

### 5.2 Case for single account + mode switch (current direction)

- Lower signup friction; poster who trusts you becomes supply  
- One identity for reviews/trust; payments still party-scoped (`poster_id` / `worker_id`)  
- RLS already party-based on Firebase UID — dual role does not require two UIDs  
- Matches `is_tasker` / `is_poster` columns already shipped  

### 5.3 Case for separate accounts

- Cleaner mental model / support  
- Harder to game both sides of one job (still need server checks for self-accept)  
- Worse liquidity and higher CAC  

### 5.4 Recommendation

**Keep one account with a Poster / Tasker mode switch** (already modelled). Invest in:

1. Server blocks on self-dealing (accept / pay / review)  
2. Clear UX that mode is workspace, not a second login  
3. Ratings that label role context (`as poster` / `as tasker`)  

**Cost now:** Mostly UX + trigger verification (days).  
**Cost after launch:** Migrating split accounts or re-educating users is much higher — do not split accounts post-launch.

---

## Appendix A — Live probe commands (reproducible)

```bash
# Anon key from supabase-db.js (public)
curl -s -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  "$URL/rest/v1/tasks?select=task_id&limit=1"
# Expect until fixed: 42P17
```

## Appendix B — Key files reviewed

- `sql/schema.sql`, `supabase/firebase-rls-uid-fix.sql`, `supabase/security-lockdown.sql`, `supabase/rls-drop-open-policies.sql`, `supabase/rls-fix-tasks-apps-recursion.sql`, `supabase/storage-beta-fix.sql`  
- `supabase-db.js`, `qg-config.js`, `qg-admin-gate.js`, `qg-location.js`, `feeBreakdown.js`  
- `browsetask.html`, `posttask.html`, `messages.html`, `admin.html`, `mytasks.html`  
- `supabase/functions/create-checkout/index.ts`

---

### Parallel deep-dives (merged above)

Additional detail came from parallel read-only passes: [Audit RLS and money paths](769ec98e-e76b-42d5-962e-e1ef1c88bc6f), [Audit schema and geography](38d835c5-c7e6-48cb-b0ee-8459a151e07d), [Audit dead weight and modes](e2dd6723-8e06-49fc-a85b-f4af97f8dca9).

*End of audit. Application code was not modified.*
