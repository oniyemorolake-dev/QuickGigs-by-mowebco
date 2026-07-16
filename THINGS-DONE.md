# QuickGigs — Things We've Done (Beta)

Last updated: July 2026  
Platform: [quickgigs.ca](https://quickgigs.ca)  
Stack: Firebase Auth + Supabase + static HTML/JS frontend

---

## One-liner summary

**QuickGigs beta:** Full task marketplace — post, browse, apply, accept, chat, complete, and review. Public profiles with photos, bio, skills, and reviews. Supabase backend, Firebase auth, mobile-friendly UI, fraud protection in chat, and beta database setup. Payments, email alerts, in-app notifications, and production security (RLS) planned for launch.

---

## Core marketplace

- **Post tasks** — categories, budget, location, animated schedule/date picker, optional task photos
- **Browse & apply** — task cards, Quick/Standard mode filters, category pills, apply modal with fraud checks
- **My Tasks** — Posted / Applied / In progress / Completed tabs
- **Applicant flow** — accept, decline, withdraw applications
- **In progress** — message tasker/poster, mark complete, change tasker, cancel task
- **Real posted times** — replaced generic “Recently” with actual relative times on browse and My Tasks
- **Task caching** — offline/stale fallback when Supabase is slow

---

## Profiles

- **Modern profile page** — animated avatar ring, stats, bio, skills, reviews
- **Profile Studio** — redesigned edit flow (not task-form style), progress ring, animated skill chips, live bio counter
- **View anyone’s profile** — `profile.html?user=FIREBASE_UID`
- **Profile links** — from browse (poster name), My Tasks (applicants/posters/taskers), messages, chat header, review names
- **Photo rules** — taskers must have a photo to apply; posters optional
- **Bio & skills in Supabase** — sync across devices (not only browser localStorage)
- **Reviews on profiles** — persist with DB + local cache fallback
- **Auto-migrate** — existing bio/skills in localStorage upload to Supabase on next visit

---

## Messaging & chat

- **Chat unlocks on accept** — beta config (`chatUnlockAfter: 'accept'`)
- **Chat fixes** — poster ↔ tasker messaging after accept, conversation lookup, unlock on open
- **Fraud blocking** — phone numbers, emails, and social handles blocked in chat
- **Poster-only image attach** — reference photos in chat (no IDs/personal documents)
- **Messages list** — active/completed sections, unread indicators, profile links on avatar/name

---

## Photos & storage

- **Profile photo uploads** — `profile-photos` bucket + RLS
- **Task photo uploads** — `task-photos` bucket + RLS
- **Chat photo uploads** — `chat-photos` bucket + RLS
- **Human-readable upload errors** — `formatUploadError()` for 403 and other failures
- **Post without photos fallback** — task can still post if photo upload fails

---

## Auth & signup

- **Firebase auth** — login, signup, password reset
- **Role-based signup** — poster vs tasker
- **Mode selector** — poster/tasker session modes
- **Auto-capitalize names** on signup
- **Tasker photo setup** — redirect to profile after worker signup; posters go to dashboard

---

## Database (Supabase)

Run in **Supabase → SQL Editor** (safe to re-run where noted):

| File | Purpose |
|------|---------|
| `supabase/beta-setup-all.sql` | **Main beta setup** — tasks, applications, users, chat, reviews RLS, storage |
| `supabase/profile-bio-skills.sql` | Bio + skills columns on users |
| `supabase/messaging.sql` | Creates `conversations` + `messages` tables (if missing) |
| `supabase/storage-beta-fix.sql` | Photo upload 403 fix alone |
| `supabase/rls-secure.sql` | **Launch only** — do NOT run until Firebase is enabled in Supabase |

### Tables covered in beta

- `tasks` — poster name, status, schedule, photo URLs
- `applications` — worker name, status (pending/accepted/declined)
- `users` — firebase_uid, avatar_url, bio, skills, name, role
- `conversations` + `messages` — chat
- `reviews` — ratings and comments on profiles
- Storage buckets — profile-photos, task-photos, chat-photos

---

## Mobile & UX

- **Mobile bottom nav** on main app pages
- **Keyboard dismiss** and responsive chat layout
- **Light/dark mode** on main app pages (some light-mode issues still flagged by tester)
- **Post task contrast** and validation fixes
- **Completed tab fix** — stays on Completed after mark complete; URL `?tab=completed`

---

## Legal & landing (partial)

- **`terms.html`** and **`privacy.html`** — full legal pages
- **Footer links** on: index, login, dashboard, feedback
- **`index.html`** — beta live landing with poster/tasker CTAs (not pure “coming soon”)

---

## Admin

- **`admin.html`** — dashboard UI shell (users, tasks, disputes, analytics)
- **Demo data** — disputes, revenue, some stats are placeholders
- **Manual warn/ban** in UI — not automated, not fully wired to live DB

---

## Partially done

| Feature | Status |
|---------|--------|
| Search tasks by keyword | On Browse only (title, category, description) — no global search |
| Task categories | Filter pills on browse — no dedicated categories page |
| Terms/privacy footer | On landing, login, dashboard, feedback — missing on browse, post task, My Tasks, chat, messages, profile |
| Light mode | Theme exists; tester-reported issues not fully fixed |

---

## P1 & P2 features (shipped)

### Priority 1 — beta polish

| Feature | Status | Where |
|---------|--------|--------|
| Email notifications (queue) | ✅ Queued in `notification_queue` on apply / accept / complete | `qg-notifications.js`, `supabase/priority-features.sql`, Edge Function template |
| PWA installable app | ✅ `manifest.json`, `sw.js`, install banner | `qg-pwa.js` |
| Report button | ✅ Modal on tasks & profiles | `qg-report.js`, browse + profile |
| Search polish | ✅ Title, category, location, poster + nearest sort | `browsetask.html` |
| Categories page | ✅ `categories.html` | Grid with live open-task counts |
| Share task / profile | ✅ Web Share API + clipboard | `qg-share.js` |

### Priority 2 — pre-launch

| Feature | Status | Where |
|---------|--------|--------|
| Location nearest-first | ✅ City/region proximity sort | `qg-location.js`, browse sort |
| Worker discovery | ✅ `workers.html` with skills + trust badges | Posters from dashboard |
| Completion rate on profiles | ✅ Trust badges | `qg-stats.js`, `profile.html` |
| Response rate on profiles | ✅ Trust badges | `qg-stats.js` |
| Auto-ban after 3 warnings | ✅ `user_warnings` + `users.status` | `qg-stats.js`, login ban check |
| Payments | ⏳ Config flag only — Stripe not live | `QG_CONFIG.paymentsEnabled` |

**Run in Supabase SQL Editor:** `supabase/beta-setup-all.sql` (includes P1/P2 tables) or `supabase/priority-features.sql` alone.

**Optional email send:** Deploy `supabase/functions/send-notification`, set `RESEND_API_KEY`, add URL to `QG_CONFIG.notificationFunctionUrl`.

---

## Not built yet (backlog)

| Feature | Notes |
|---------|--------|
| Notification bell (in-app) | Email queue exists; no in-app bell UI yet |
| Google Analytics | Not installed |
| Resume analyser thank you page | Not in this repo |
| Stripe / payments live | Hooks + config flag; checkout not wired |
| Real admin backend | Admin demo UI; wire `addUserWarning` for live warns |
| `rls-secure.sql` | Production lockdown — after Firebase JWT in Supabase |

---

## Email notifications — expected vs today

| Event | Today |
|-------|--------|
| Someone applies to your task | ✅ Queued (`application_received`) — sends if Edge Function + Resend configured |
| Application accepted | ✅ Queued (`application_accepted`) |
| Task marked complete | ✅ Queued (`task_completed`) |
| New chat message | ❌ No email |
| Password reset | ✅ Firebase |

---

## Suggested next quick wins

1. Footer terms/privacy on all app pages (~30 min)
2. Google Analytics (~30 min)
3. Update index / launch announcement copy (~1 hr)
4. Light mode fixes from tester feedback (~1–2 hrs)
5. Notification bell + DB table (~2–4 hrs)
6. Report button (~1 hr)
7. Categories landing page (~1 hr)
8. Email notifications (separate sprint — 4–8 hrs)

---

## Beta product rules (reminder)

- **Poster:** post tasks, review applicants, accept, message after accept
- **Tasker:** browse, apply (photo required), work in progress, message after accept
- **Chat:** unlocks on accept in beta
- **Payments:** not live — `chatUnlockAfter: 'accept'` in `qg-config.js`
- **Security:** open anon RLS in beta — run `rls-secure.sql` before public launch
