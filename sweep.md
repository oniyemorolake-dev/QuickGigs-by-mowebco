# QuickGigs Pre-Launch Sweep

**Date:** 27 Aug 2026  
**Scope:** Read-only diagnosis of all 33 HTML pages and shared front-end scripts, plus edge-function call paths referenced from the client. Builds on `audit.md` (security/data); assumes its critical RLS/storage/admin items were addressed in subsequent migrations.  
**Method:** Code review only — no files were modified in this pass except this report.

---

## Blockers (fix before real users)

Priority order. **Effort:** Quick = hours; **Work** = multi-day / cross-cutting.

| # | Severity | Issue | Primary location | Effort |
|---|----------|--------|------------------|--------|
| 1 | **Blocker** | Email/password login never checks ban, blocked, or missing `users` row — goes straight to dashboard | `login.html:314-344` | Quick |
| 2 | **Blocker** | Google login with cached onboarding flag skips all DB gate checks (including ban) | `login.html:218-224` | Quick |
| 3 | **Blocker** | `markComplete` shows “Completed” UI when server fails — escrow may never release | `mytasks.html:2438-2451` | Quick |
| 4 | **Blocker** | Paid launch mismatch: `paymentsEnabled: true` but `chatUnlockAfter: 'accept'` — chat unlocks before escrow; contradicts Terms §4.3–4.4 | `qg-config.js:5-6`, `qg-config.js:40`, `terms.html:75-76`, `mytasks.html:594-598` | Quick (config) / Work (retest full pay flow) |
| 5 | **Blocker** | Teen tasker flow: server requires guardian Stripe payout **before first apply**; product copy says apply then guardian reviews per gig | `submit-application/index.ts:104-118`, `browsetask.html:440`, `signup.html:173` | Work |
| 6 | **Blocker** | Legal: Privacy lists **Oracle** for database; stack is **Supabase** | `privacy.html:111` | Quick |
| 7 | **Blocker** | Legal: Terms/Privacy describe parent-created teen accounts; code is teen self-signup + guardian email consent | `terms.html:58`, `privacy.html:142`, `signup.html:174-176`, `register-account/index.ts:123-131` | Work (legal + copy alignment) |
| 8 | **Blocker** | Public copy says payments not live; config and pay UI are live (test Stripe) | `faq.html:28`, `dispute-resolution.html:24`, `how-it-works.html:43`, `qg-config.js:40` | Quick |
| 9 | **High→Blocker** | `review.html` / `profile.html` write light/dark to `qg-mode`, corrupting poster/tasker mode | `review.html:289-296`, `profile.html:730-733` | Quick |
| 10 | **High→Blocker** | Poster can tap **Accept** on teen applications still `pending_guardian` — no UI guard; server/trigger may reject but UX is broken | `mytasks.html:601-657` (no `guardian_status` check); teen side shows wait badge at `mytasks.html:1732-1733` | Medium |

---

## 1. Broken or blocking (core flows)

### Signup & login

| File:line | Sev | What's wrong | Fix |
|-----------|-----|--------------|-----|
| `login.html:314-344` | **Blocker** | Email login: after `signInWithEmailAndPassword`, redirects to dashboard with no `getUserLoginGate`, no ban/blocked check, no “finish signup” redirect | Mirror `finishGoogleLogin` gate (`login.html:237-255`, `267-280`) before redirect |
| `login.html:218-224` | **Blocker** | Cached `qgIsOnboardingDoneCached` short-circuits to dashboard with **zero** Supabase queries | Always run ban/blocked gate; use cache only for non-security routing |
| `dashboard.html:470-477` | **High** | `runEarlyLoginGate`: if `getUserLoginGate` returns null, dashboard still renders — Firebase session without `users` row | Redirect to `signup.html?oauth=continue` or onboarding |
| `signup.html:697-700` | **High** | OAuth registration failure does not delete/sign out Firebase user (email path deletes user) | Sign out OAuth user on `register-account` failure |
| `signup.html:770-776` | **Medium** | Teen `pending_guardian` redirected to photo setup before guardian approves | Route to dashboard with guardian banner first |
| `register-account/index.ts:176-178` | **Medium** | Guardian email failure swallowed; account created with `email_sent: false` | Ops: verify `RESEND_API_KEY` + `FROM_EMAIL` in Supabase secrets; client already retries resend (`signup.html:708-719`) |

**Verified OK:** Signup wizard validation, terms checkbox (recent fix), guardian DOM sync (`qg-onboarding.js:299-307`, `376-378`), teen poster blocked server-side (`register-account/index.ts:81-86`).

### Post task

| File:line | Sev | What's wrong | Fix |
|-----------|-----|--------------|-----|
| `qg-config.js:5-6` + `mytasks.html:594-598` | **Blocker** | Escrow gating off while payments on — “Post & fund” / Terms say pay before chat | Set `chatUnlockAfter: 'payment'` and regression-test accept → pay → chat → complete |
| `getAccountActionPermission` `supabase-db.js:2392-2398` | **Medium** | Teen poster blocked client-side; server `post-task` also enforces | Map server error codes in `posttask.html` banners |

### Browse & apply

| File:line | Sev | What's wrong | Fix |
|-----------|-----|--------------|-----|
| `submit-application/index.ts:104-118` | **Blocker** | Teens need `guardian_stripe_payouts_enabled` **before** apply — conflicts with “guardian reviews each application” (`browsetask.html:440`, `parent-consent.html:90-91`) | Defer payout gate to accept/hire, or rewrite all teen copy + onboarding |
| `submit-application/index.ts:79-83` | **High** | `account_not_active` for `pending_guardian` teens — correct server-side; browse may still show Apply | Ensure `getAccountActionPermission` runs before modal (`browsetask.html:2225+`) |
| `browsetask.html:2318-2330` | **High** | Apply errors missing handlers for `account_not_active`, `guardian_consent_required`, `guardian_payout_setup_required`, `worker_payout_setup_required`, `profile_photo_required` | Add branches with specific copy per error code |
| `browsetask.html:2385-2387` | **OK** | Guardian-pending apply shows correct success message | — |

### Get hired (poster accept)

| File:line | Sev | What's wrong | Fix |
|-----------|-----|--------------|-----|
| `mytasks.html:649-656` | **High** | `renderApplicantAction` always renders Accept for pending apps — no `guardian_status` check | If `pending_guardian`, show “Waiting for guardian” and disable Accept |
| `mytasks.html:1732-1733` | **Info** | Tasker “Applied” tab correctly shows guardian wait badge | Poster side should match |

### Chat

| File:line | Sev | What's wrong | Fix |
|-----------|-----|--------------|-----|
| `chat.html:11-16` | **Low** | Redirect stub to `messages.html` — extra hop from `payment.html` / `mytasks.html` links | Update links to `messages.html` directly |
| `messages.html` (send path) | **Low** | Silent return when thread locked (per prior trace) | Toast explaining unlock rules |

### Pay

| File:line | Sev | What's wrong | Fix |
|-----------|-----|--------------|-----|
| `payment.html:267-270` | **High** | If `QG_paymentsLive()` false, dead-end “Setup required” | Ensure prod Stripe keys + `paymentsEnabled` aligned |
| `payment.html:281-284` | **Medium** | Non-poster opening `?task=` gets static error only | Redirect to `mytasks.html` |
| `mytasks.html:611-612` | **Medium** | Pay modal failure only toasts; poster may think job started | Keep prominent “Pay & fund escrow” on card |

### Complete & review

| File:line | Sev | What's wrong | Fix |
|-----------|-----|--------------|-----|
| `mytasks.html:2438-2451` | **Blocker** | On `completeTask` failure or throw, still calls `showCompletedUi` + optimistic toast | Only update UI when `result.success === true` |
| `review.html:331-335` | **Medium** | Default placeholder task/reviewee (“Deep clean…”, “Sarah K.”) shown without URL params | Empty state until `taskId`/`revieweeId` validated |
| `review.html:420-424` | **Low** | Submit blocks missing IDs but user already saw fake demo data | Load real task/reviewee on init |

### Guardian consent (16–17)

| File:line | Sev | What's wrong | Fix |
|-----------|-----|--------------|-----|
| `signup.html:173` | **Medium** | Copy: “email them a one-click consent link” — depends on Resend env | Monitor `email_sent`; dashboard resend (`dashboard.html:442-457`) |
| `parent-consent.html:135-138` | **Medium** | Payout setup failure: `alert()` only | Inline error + retry |
| `parent-consent.html:90-91` | **Info** | Per-gig approval copy matches `guardian_status` on applications | Align with account-level + payout gates |
| `register-account/index.ts:167-168` | **Info** | Consent URL → `parent-consent.html?token=` | Verify `SITE_URL` secret |
| `dashboard.html:448-450` | **Low** | Resend uses `callVerifiedFunction(url, {})` without explicit user arg | Pass `live` Firebase user |

---

## 2. Visual and design consistency

**Canonical palette** (index/login/signup): `--qg-bg #0D0716`, `--qg-surface #140F24`, `--qg-border #2A2140`, `--qg-purple #6B21A8`, `--qg-heading #F2EFF8`, `--qg-body #9C93B5`, `--qg-muted #7B7194`, `--qg-link #B69BE0` (`index.html:35-43`, `qg-auth.css:3-11`).

### Pages that do **not** use the canonical palette

| Page / layer | Background / tokens | File:line |
|--------------|---------------------|-----------|
| **Auto-injected refine layer** | `--qg-bg: #06000f !important` on `body` | `qg-refine.css:4-29`, loaded by `qg-brand-init.js:281-286` |
| **Design tokens (app-wide)** | `--bg: #0d0b1a`, poster accent **teal** `#2dd4bf` | `qg-tokens.css:13-20` |
| **Dashboard** | `--bg:#0b0118`, translucent cards | `dashboard.html:50-64` |
| **Browse** | `--bg:#0b0118`, modal `#150830` | `browsetask.html:46-55` |
| **My Tasks** | `--bg:#0b0118` | `mytasks.html:54` |
| **Profile** | `--bg:#0b0118` | `profile.html:43` |
| **Messages** | `--surface:rgba(255,255,255,0.04)` | `messages.html:28` |
| **Post task** | `#0b0118` dark body | `posttask.html:41` |
| **Review** | `--bg:#0b0118` | `review.html:38` |
| **Workers** | `#0b0118` fallback | `workers.html:20` |
| **Mode selector** (orphan) | `#0b0118` | `modeselector.html:35` |
| **Admin** | `#06000f` / `#0b0118` | `admin.html:31`, `admin-login.html:14` |
| **Reset password** | `#0d0520` | `reset-password.html:12` |

**Pages aligned with canonical palette:** `index.html`, `login.html`, `signup.html` (via `qg-auth.css`).

### Typography

| Pattern | Where | File:line |
|---------|-------|-----------|
| **Poppins** | Landing, auth, parts of dashboard CTAs | `index.html:31`, `qg-auth.css:14`, `dashboard.html:219` |
| **DM Sans + Playfair** | Dashboard, browse, profile, mytasks, messages | `dashboard.html:84`, `browsetask.html:68`, `profile.html:20` |
| **Playfair on signup cards** | Conflicts with auth Poppins | `qg-signup.css:48` |

### Modal / overlay backgrounds (≥5 variants)

| Surface | Background | File:line |
|---------|------------|-----------|
| Auth confirm (shared) | `#140F24` | `qg-polish.css:99`, `mytasks.html:140` |
| Browse apply modal | `#150830` | `browsetask.html:55`, `287` |
| Profile edit sheet | Gradient `#1a0a38` → `#0e021f` | `profile.html:200` |
| Report/dispute sheets | Same gradient family | `qg-sheet.css:38`, `qg-features.css:148` |
| Admin modal | `#120228` | `admin.html:191` |
| Dashboard avatar menu | `#150830` | `dashboard.html:255` |
| Cookie banner | `#150830` | `qg-cookies.css:5` |
| Browse overlay | `rgba(0,0,0,0.65)` | `browsetask.html:285` |
| Profile overlay | `rgba(5,0,15,0.78)` + blur | `profile.html:190` |

### Buttons, radii, icons

| Issue | File:line |
|-------|-----------|
| Legacy purple gradient CTAs (`#6b3fa0 → #9b6fc4`) vs flat `#6B21A8` auth buttons | `qg-polish.css:89-93`, `posttask.html` inline, `browsetask.html:329` |
| Border radius mix: 8px auth, 14–18px app cards, 22–26px sheets | `qg-auth.css:41`, `dashboard.html` cards, `profile.html:200` |
| Emoji in nav/UI vs SVG icon system | `dashboard.html:253`, `browsetask.html:380`, `workers.html:38`, `admin.html:227+` |
| Poster/tasker **teal** accent on tokens (`--accent-poster: #2dd4bf`) | `qg-tokens.css:13` — reads as mint/teal on dashboard role chrome |

---

## 3. Mobile (320 / 375 / 414px — from CSS/code review)

| File:line | Sev | Issue | Fix |
|-----------|-----|-------|-----|
| `qg-browse-views.css:480-485` | **High** | Filters button **36×36px** at ≤420px (below 44px guideline) | Restore 44px min or add padding hit area |
| `browsetask.html:293` | **Medium** | Modal close **36×36px** | Increase to 44px |
| `profile.html:207` | **Medium** | Edit sheet close **34×34px** | Increase to 44px |
| `mytasks.html:130` | **Medium** | Decline button `padding:6px 12px`, 11px font — not in 44px min-height list | Add `min-height:44px` |
| `mytasks.html:141` | **Medium** | Confirm close **32×32px** | Increase to 44px |
| `workers.html:28` | **Medium** | Filter pills 8×14 padding only | `min-height:44px` |
| `browsetask.html:74` | **Medium** | Mode/theme header buttons `padding:5px 12px` | Bump touch target |
| `mytasks.html:72` | **Low** | Horizontal scroll tab row (intentional) | Ensure fade/scroll hint |
| `browsetask.html:131` | **Low** | Category chips horizontal scroll | Same |
| `qg-mobile.css:3-16` | **OK** | Tab bar safe-area + 44px tab items | — |
| `qg-auth.css:695-698` | **OK** | Only explicit **320px** auth breakpoint | Add app-page 320 rules or test manually |

**Fixed recently (verify in QA):** Browse filters oversize → 36px (may now be *too* small — see above). Poster/tasker switch lives in avatar menu (`dashboard.html:257`, `638-644`); unused `.mode-switcher` CSS at `dashboard.html:93-103`.

---

## 4. Dead, duplicate, and half-built

| Item | Sev | Evidence | Fix |
|------|-----|----------|-----|
| `modeselector.html` | **High** | No in-app `href`; `robots: index,follow` (`modeselector.html:9`); superseded by signup role + header switch | 301 to signup/dashboard or `noindex` + redirect |
| `profileCompletion.js` | **High** | “Single source of truth” (`profileCompletion.js:2`) — **never script-loaded**; `profile.html:948+` duplicates logic | Wire one module or delete |
| `qg-abuse.js` | **Medium** | Config references (`qg-config.js:108`) — never loaded in HTML | Wire client UX or remove |
| `chat.html` | **Low** | Redirect stub only (`chat.html:11-16`) | Point callers to `messages.html` |
| `workers.html` | **Medium** | Parallel browse surface; linked from dashboard (`dashboard.html:1254`) but separate Firebase init (`workers.html:64+`) | Merge into browsetask or deprecate |
| Escrow copy split | **Blocker** | `paymentsEnabled: true` (`qg-config.js:40`) vs FAQ/dispute/how-it-works “not live” | Single source of truth in copy + config |
| `qg-wave2.js:8` | **Low** | Announce bar: “payments coming soon” | Update or gate on `paymentsEnabled` |
| Admin demo metrics | **Medium** | Hard-coded health/activity (`admin.html:312-315`, `877-879`, `1057-1059`) | Label “demo” or fetch real data |
| Cache-bust sprawl | **Low** | e.g. `qg-utils.js` different versions per page | Standardize BUILD_ID stamp |
| `savePayment()` | **Info** | Removed from `supabase-db.js` (audit item resolved) | — |
| Duplicate completion systems | **Medium** | `profileCompletion.js` vs `profile.html` `calcProfileProgress` vs hidden `qg-bigtech.js` card (`qg-bigtech.js:618-620`) | Consolidate |

---

## 5. Copy and legal

| File:line | Sev | Issue | Fix |
|-----------|-----|-------|-----|
| `privacy.html:111` | **Blocker** | **Oracle** listed as database provider | Replace with **Supabase** (Postgres) |
| `privacy.html:109-112` | **High** | Lists Firebase, Stripe, Oracle, GitHub Pages — **omits Supabase** | Add Supabase; verify hosting (GitHub Pages vs actual) |
| `terms.html:58` | **Blocker** | Teen eligibility: parent **creates** account | Rewrite to match teen signup + guardian approval |
| `privacy.html:142` | **Blocker** | “18 and older”; teens via “guardian **account**” | Match `pending_guardian` teen-owned accounts |
| `faq.html:28` vs `terms.html:75-76` | **Blocker** | FAQ: payments not live; Terms: live Stripe escrow | Align all public legal/marketing copy |
| `dispute-resolution.html:24` | **Blocker** | “Payments are not live yet” | Update for launch mode |
| `how-it-works.html:43` | **High** | “payments coming soon” | Same |
| `index.html:693-706` | **Medium** | Placeholder testimonials with `REPLACE_WITH_REAL_BETA_QUOTES` comment; Calgary/Edmonton cities shown | Real quotes or remove section |
| `index.html:8`, `708` | **Low** | Meta/scope: Calgary, Edmonton + Canada-wide (intentional origin story) | Ensure consistent with “nationwide” hero |
| `signup.html:8` | **Low** | Meta description still says “Calgary, Edmonton, and beyond” | Optional SEO update |
| `terms.html:51`, `privacy.html:88` | **Low** | Legal copy uses “Workers”; product uses “Taskers” | Harmonize terminology |
| `faq.html:34` | **OK** | 16+ guardian email approval — matches `getAccountActionPermission` | — |

---

## 6. Accessibility

| File:line | Sev | Issue | Fix |
|-----------|-----|-------|-----|
| `signup.html:174-176` | **Medium** | Guardian labels lack `for=` / input `id` pairing | Add `id` + `for` |
| `qg-onboarding.js:82-92` | **High** | DOB wheel: no `role`, `aria-label`, keyboard alternative | `role="listbox"`, arrow keys, live region for selection |
| `signup.html:113-118`, `131-136` | **Medium** | Pronoun/gender chips: buttons without `aria-pressed` / group label | `role="group"` + `aria-pressed` on chips |
| `browsetask.html:90-101` | **High** | Search/location inputs: `outline:none !important` on focus — no replacement ring | Add `:focus-visible` box-shadow on wrapper |
| `qg-onboarding.css:13-15` | **Medium** | Chips: hover only, no `:focus-visible` | Add focus ring |
| `review.html:289-296` | **High** | Theme toggle sets `body.className` wholesale — can strip page classes | Use `classList.toggle('light')` + `qg-theme` key |
| `browsetask.html:1988` | **Medium** | Modal avatar `alt=""` when photo present | Meaningful alt from name |
| `login.html:55`, `signup.html:51` | **Low** | Logo `alt=""` (decorative; link has `aria-label` on login) | OK if parent labeled |
| `index.html:42`, `qg-auth.css:10` | **Medium** | `--qg-muted #7B7194` on `#0D0716` at 11–12px (legal footer, step meta) — likely below WCAG AA for small text | Lighten muted or bump size/weight |
| `signup.html:188-189` | **OK** | Terms checkbox `id`/`for` paired (recent fix) | — |
| `qg-nav.js:185-198` | **OK** | Header mode switch: `role="group"` + `aria-pressed` | — |

---

## 7. Performance

| File:line | Sev | Issue | Fix |
|-----------|-----|-------|-----|
| `index.html:865` | **High** | Hero feed fetches **80** open tasks with full `SELECT_TASKS_BROWSE` to show **4** cards | `limit=8` + slim select, or dedicated edge endpoint |
| `index.html:881-883` | **High** | **N+1**: 4× `sbCount('applications', …)` after list fetch | Single aggregate query or include count in list API |
| `index.html:818-832` | **Low** | `pickSpread` scans 80 rows twice | Negligible vs network; fix with smaller fetch |
| `supabase-db.js:620-646` | **Medium** | `expireStaleOpenTasksOnce` may PATCH up to 50 tasks on first `getTasks()` (browse/dashboard) | Move to cron/edge; don’t run on every client load |
| `supabase-db.js:439-456` | **Info** | `sbGetTasksList` default limit 200 | Browse uses 20 (`supabase-db.js:158`); landing is the outlier |
| `qg-brand-init.js:281-286` | **Medium** | Injects `qg-refine.css` on every app page — extra CSS + palette override | Merge into main bundle or gate by page |
| `index.html:747-761` | **Low** | Hero phrase `setInterval` rotator | Fine; prefer `prefers-reduced-motion` guard |

---

## 8. Consistency of state

| Concept | Divergence | Risk | File:line |
|---------|------------|------|-----------|
| **worker vs tasker** | DB `role: 'worker'`; UI `qg-mode: 'tasker'`; signup `roleInput: 'worker'` | Wrong dashboard/browse routing | `register-account/index.ts:117`, `signup.html:79`, `198`, `qg-brand-init.js:4` |
| **qg-mode vs qg-theme** | Profile/review store **theme** in `qg-mode` | Corrupts poster/tasker mode | `review.html:289-296`, `profile.html:730-733` |
| **qg-theme migration** | `qg-theme.js:22-29` migrates legacy theme from `qg-mode` | Masks bug until mode switch breaks | `qg-theme.js` |
| **is_tasker / is_poster vs role string** | Permissions use booleans; some paths use `role === 'worker'` | Edge cases if booleans desync | `supabase-db.js:2400-2414`, `register-account/index.ts:118-119` |
| **Uppercase aliases** | `TASK_ID`, `WORKER_ID`, etc. alongside lowercase | Defensive reads everywhere; easy to miss one path | `supabase-db.js:256+`, `mytasks.html:1093-1108`, `index.html:882` |
| **account_status vs guardian_consent_status** | Both gate teens | Redundant checks can disagree if data wrong | `supabase-db.js:2376`, `submit-application/index.ts:75-83` |
| **chatUnlockAfter** | Config vs Terms vs FAQ disagree on when chat opens | User trust / support burden | `qg-config.js:5`, `faq.html:29`, `terms.html:75` |

---

## Nice to have (post-launch or polish)

- Unify all pages onto canonical `#0D0716` / `#140F24` palette; remove `#06000f` refine override (`qg-refine.css:28-29`).
- Single font stack (Poppins everywhere, or DM Sans everywhere).
- Standardize modal/sheet backgrounds to `#140F24` + one overlay opacity.
- Replace remaining emoji UI with `qg-icons.js` SVGs.
- Wire or delete `modeselector.html`, `profileCompletion.js`, `qg-abuse.js`.
- Remove `chat.html` hop; update internal links.
- Consolidate `workers.html` into `browsetask.html`.
- Real beta testimonials on `index.html:693-706`.
- Admin console: replace placeholder metrics with live queries.
- `review.html` / `profile.html`: load review context from API, drop Sarah K. defaults.
- Landing `?postal=` hero field → wire into posttask geocode flow.
- `prefers-reduced-motion` on animations (`qg-polish.css`, hero rotator).
- Global BUILD_ID cache stamp across all assets.
- `expireStaleOpenTasksOnce` server-side cron.
- Poster terms ICA vs in-app role-enable version drift check (`qg-config.js:54-57`).

---

## Pages inventoried (33 HTML)

`index.html`, `login.html`, `signup.html`, `dashboard.html`, `browsetask.html`, `workers.html`, `posttask.html`, `mytasks.html`, `messages.html`, `chat.html` (redirect), `profile.html`, `review.html`, `payment.html`, `parent-consent.html`, `guardian-portal.html`, `modeselector.html` (orphan), `categories.html`, `how-it-works.html`, `faq.html`, `terms.html`, `privacy.html`, `poster-terms.html`, `contractor-agreement.html`, `dispute-resolution.html`, `safety.html`, `guidelines.html`, `feedback.html`, `thank-you.html`, `reset-password.html`, `admin.html`, `admin-login.html`, `404.html`, `google13a14307604310d2.html` (verification).

**Shared scripts reviewed (representative):** `qg-config.js`, `qg-theme.js`, `qg-brand-init.js`, `qg-nav.js`, `qg-onboarding.js`, `qg-utils.js`, `supabase-db.js`, `qg-notifications.js`, `qg-polish.css`, `qg-auth.css`, `qg-tokens.css`, `qg-refine.css`, `qg-browse-views.css`, `profileCompletion.js`, `qg-abuse.js`, `qg-bigtech.js`.

---

## Recommended launch sequence

1. **Same day:** Blockers #1–4, #6, #8–9 (login gate, complete UI honesty, config/chat/payments alignment, Oracle fix, copy payment stance, `qg-mode` theme bug).
2. **Before teen marketing:** Blockers #5, #7, #10 + teen apply error handling + legal teen-account wording.
3. **Before scale:** Landing feed performance (#7), palette unification (#2), mobile touch targets (#3).
4. **Ongoing:** Nice-to-have list.

*End of sweep.*
