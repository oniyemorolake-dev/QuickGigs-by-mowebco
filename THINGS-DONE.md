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

- **`admin.html`** — live console at [quickgigs.ca/admin.html](https://quickgigs.ca/admin.html) (login as `mowebsiteco@gmail.com`)
- **User drawer** — edit name/role/status, flag for review, warn/ban, internal notes
- **Task drawer** — edit title/budget/description/status, applicant list, expire/remove
- **Moderation queue** — reports with resolve/dismiss
- **Fraud alerts** — temp email detection, review flags, high apply volume
- **Admin action log** — security tab + CSV export
- **Run SQL:** `supabase/admin-tools.sql` for `admin_notes`, `admin_actions`, `review_flag`

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
| In-app notification bell | ✅ 🔔 in nav, unread badge, slide-out panel | `qg-bell.js`, `qg-bell.css`, `supabase/user-notifications.sql` |
| Saved tasks (bookmarks) | ✅ ☆ Save on browse cards + ★ Saved filter tab | `qg-saved.js`, `supabase/saved-tasks.sql` |
| PWA installable app | ✅ `manifest.json`, `sw.js`, install banner | `qg-pwa.js` |
| Report button | ✅ Modal on tasks & profiles | `qg-report.js`, browse + profile |
| Search polish | ✅ Title, category, location, poster + nearest sort | `browsetask.html` |
| Categories page | ✅ `categories.html` | Grid with live open-task counts |
| Share task / profile | ✅ Web Share API + clipboard | `qg-share.js` |

### Dashboard & role switch (latest)
- **Role switch moved to Profile** — animated “I need help / I’m available” flip toggle
- **Dashboard hero** — contextual next action (applicants waiting, browse gigs, post task, etc.)
- **Avatar menu** — quick “Switch to Tasker/Poster” shortcut

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

## Not built yet (backlog — prioritized July 2026)

### ✅ Already shipped (from your list)

| Item | Where |
|------|--------|
| FAQ page | `faq.html` |
| Safety tips | `safety.html` |
| How it works | `how-it-works.html` |
| Dispute resolution | `dispute-resolution.html` |
| PWA installable | `manifest.json`, `sw.js`, `qg-pwa.js` |
| Hamburger menu | `qg-menu.js` |
| Profile progress ring | Profile Studio edit modal |
| Report button | `qg-report.js` |
| Share task / profile | `qg-share.js` |
| Cookie consent | `qg-cookies.js` |
| Tap-to-enlarge task photos | `qg-lightbox.js`, browse cards |
| Thank-you / conversion page | `thank-you.html` (poster signup) |
| Google Analytics hook | `qg-analytics.js` — paste `G-XXXXXXXXXX` in `qg-config.js` |

---

### 🔴 P0 — Do next (beta trust + growth)

| Feature | Why | Effort |
|---------|-----|--------|
| **Push all pending changes live** | Menu, lightbox, login fix not on quickgigs.ca yet | 10 min |
| **Google Analytics ID** | Ads conversion tracking — set `ga4MeasurementId` in `qg-config.js` | 10 min |
| **Stripe / payments** | Core launch blocker; chat rule switches to `payment` | Large |
| **Photo sharing in chat** | Posters/taskers share task progress photos | 2–4 hrs |
| **Repost expired task** | Posters one-click repost after 30 days | 1–2 hrs |
| **Social login (Google)** | Faster signup, fewer drop-offs | 4–8 hrs |
| **Sentry error tracking** | Know when prod breaks | 1–2 hrs |

---

### 🟡 P1 — Strong beta polish (weeks 2–4)

| Feature | Notes |
|---------|--------|
| Read receipts in chat | `read_at` column + UI ticks |
| Typing indicator | Supabase realtime or polling |
| Confetti on task complete | Small delight moment |
| Pull to refresh (browse) | Mobile-native feel |
| Infinite scroll (browse) | Replace load-all |
| Task card load animations | Subtle fade/slide |
| Recommended tasks | Match worker skills |
| Recently viewed tasks | localStorage or DB |
| Task alerts by category | Push/email when new match |
| Favourite workers | Poster saves go-to taskers |
| Task templates | Repost same format |
| Task analytics (views/apps) | Poster dashboard stats |
| Online / last active dot | Green dot on profiles |
| Haptic feedback (mobile) | `navigator.vibrate` on key taps |
| SMS notifications | Twilio for urgent tasks |
| Weekly digest email | Monday summary |

---

### 🟢 P2 — Post-launch / nice-to-have

| Feature | Notes |
|---------|--------|
| Map view of tasks | Calgary first, then Canada-wide |
| Earnings dashboard | After Stripe live |
| Schedule / calendar view | Upcoming tasks |
| Invoice generator | Worker tax helpers |
| Mileage tracker | Niche — defer |
| Voice messages in chat | Storage + moderation |
| Message reactions | Emoji on messages |
| Two-factor auth | All users |
| Photo ID verification | Verified badge |
| Video intro (30s) | Worker profiles |
| Background checks | Partner integration |
| Skills assessment tests | Trust layer |
| Corporate accounts | B2B lane |
| Gift cards | Revenue feature |
| API / white label | Platform play |
| Hotjar heatmaps | UX research |
| Mixpanel funnels | Product analytics |
| WhatsApp notifications | Business API cost |
| Price drop alerts | Worker retention |
| Bulk task posting | Power posters |
| Task history PDF export | Worker admin |
| Smooth page transitions | SPA or View Transitions API |
| Resume analyser thank-you | **Not QuickGigs** — ignore |

---

## Suggested next quick wins

1. **Deploy** — commit + push saved tasks + notification bell
2. **Run SQL** — `supabase/user-notifications.sql` and `supabase/saved-tasks.sql` in Supabase (if not already)
3. **Paste GA4 ID** in `qg-config.js` + set Google Ads conversion on `thank-you.html`
4. **Repost task** on expired My Tasks rows (~1 hr)
5. **Photo sharing in chat** (~2–4 hrs)
6. **Social login (Google)** (~4–8 hrs)

---

| Event | Today |
|-------|--------|
| Someone applies to your task | ✅ In-app bell + email queue (`application_received`) |
| Application accepted | ✅ In-app bell + email queue (`application_accepted`) |
| Task marked complete | ✅ In-app bell + email queue (`task_completed`) |
| New chat message | ✅ In-app bell (`new_message`); email if Edge Function configured |
| Password reset | ✅ Firebase |

## Email notifications — expected vs today

- **Poster:** post tasks, review applicants, accept, message after accept
- **Tasker:** browse, apply (photo required), work in progress, message after accept
- **Chat:** unlocks on accept in beta
- **Payments:** not live — `chatUnlockAfter: 'accept'` in `qg-config.js`
- **Security:** open anon RLS in beta — run `rls-secure.sql` before public launch
