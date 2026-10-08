# Cursor handoff — SwiftGigs redesign, shared CSS/JS layer

From: Claude (HTML zone). Date: Oct 8, 2026.

## What already landed on the HTML side (commit these 32 paths first)

All 32 root HTML pages were rebuilt to the approved mockup (`Claude outputs/swiftgigs-mockup-v3.html`):
each page's inline `<style>` was rewritten onto qg-tokens.css, every `.dark`/`.light` duplicate pair collapsed
into one token rule, token redeclarations removed, gradients/glows/pulses removed, flat CTAs, 14px cards,
pill chips, uppercase muted labels, green money, teal-active tab bar. Zero old-palette literals remain in any
HTML file. Safety guarantees (machine-checked per file): every `<script>` line byte-identical except colour
literals inside strings, every original `id` and class kept, visible text unchanged (except payment.html and
guardian-portal.html brand text `Quick<span>Gigs</span>` → `Swift<span>Gigs</span>`), build markers untouched.

404 admin-login admin browsetask categories chat contractor-agreement dashboard dispute-resolution faq
feedback guardian-portal guidelines how-it-works index login messages modeselector mytasks parent-consent
payment poster-terms posttask privacy profile reset-password review safety signup terms thank-you workers
(all `.html`)

**What still makes pages look old is now entirely in shared CSS/JS (your zone).** Several pages carry
page-level overrides to beat your `!important` rules (e.g. dashboard.html rules prefixed `html:root body`);
they become removable once the items below are fixed.

## ⚠️ Correction to the Step 3 "dead file" check

`qg-brand-init.js` injects 14 stylesheets at runtime (L247–366): qg-role-theme, qg-chrome, qg-tokens,
**qg-light-nav**, **qg-refine**, qg-states, qg-light-fix, qg-shell, qg-dashboard, qg-flows, qg-browse-views,
qg-guardian, qg-trust-profile, qg-safety. `qg-announcement.js` injects qg-announcement.css. So
"referenced by zero HTML files" does NOT mean dead — `qg-light-nav.css`, `qg-refine.css` and
`qg-announcement.css` are live on most pages. Do not delete them; fix them.

## P0 — blocks the redesign everywhere (do first)

1. **qg-role-theme.css ~L271–311**: `html[data-qg-mode="worker"]:not(.light)` and `html.light[data-qg-mode="worker"]`
   redeclare `--bg --surface --border --text --text-muted --purple* --lavender` with the old palette
   (`#0e061c`, `#2d1b4e`, `#f8f6ff`…). They beat qg-tokens.css, so **every page in tasker mode still renders
   the old colours**. Delete both token blocks. (Four agents independently confirmed: with this removed,
   browsetask matched the mockup.)
2. **qg-ux.css ~L439**: `:root, body { --text-muted: rgba(255,255,255,.68) … }` + `body.light` twin shadow the
   token. Delete.
3. **qg-role-theme.css ~L868–885**: `body` background `#0b0718` / `#faf8ff` / `#f5fcfb` + radial glows, all
   `!important` → `background: var(--bg) !important; background-image: none !important;`
4. **qg-role-theme.css**: `--qg-mode-header` / `--qg-mode-page-tint` gradients and `html[data-qg-mode] .nav`
   gradient header → `var(--surface)` with `1px solid var(--border)` bottom. Poster mode in the `--qg-mode-*`
   vars still maps to teal — must be purple (posting = purple, earning = teal).
5. **qg-role-theme.css**: `:is(.submit-btn,.im-send,.btn-primary,.accept-btn,.empty-btn,…)` forces `#fff` +
   glow → `box-shadow:none; color: var(--accent-text)`. Active tab colour → `var(--teal)`.
   ~L995 recolours every `<a>` (made button-style links' text invisible on 404/guardian) — scope it to text links.
   Also old-palette `.avatar`, `.mode-btn`, `.task-card`, `.cat-active`, `.mpill.active-all`, `.search-box`,
   worker `.tab-bar`/`.tab-item.active`, mobile-poster `.dash-hero`/`.dash-hero-cta`, `.greet-note-icon #2dd4bf`,
   `.nav-role` poster teal hex.
6. **qg-tokens.css — add two tokens** (white on teal is ~1.9:1 in dark mode, fails AA):
   ```css
   :root { --teal-text: #06231f; --accent-text: var(--teal-text); }
   html.light, html[data-qg-theme="light"], body.light { --teal-text: #FFFFFF; }
   html[data-qg-mode="worker"], html[data-mode="tasker"], body.qg-mode-worker { --accent-text: var(--teal-text); }
   html[data-qg-mode="poster"], html[data-mode="poster"], body.qg-mode-poster { --accent-text: var(--primary-text); }
   ```
   The HTML already uses `var(--accent-text, var(--primary-text))`, so it upgrades automatically.
   Then switch `qg-swift.css .sg-btn--teal` / `.sg-pill--teal.is-selected` to `color: var(--teal-text)`.

## P0 — "QuickGigs" is still shown to users (rebrand blocker)

~90 user-visible string literals in shared JS still say QuickGigs. Replace with **SwiftGigs** in user-facing
text only — NOT identifiers (`renderQuickGigsTabBar`, `showQuickGigsPush`), console tags (`[QuickGigs …]`),
`quickgigs.ca` URLs/emails, `QuickGigsLogo.png`, storage keys or event names. Review each hit.
Counts per file: qg-notifications.js 29, qg-ux.js 14 (incl. footer L182 + meta descriptions L27–40),
qg-share.js 6, qg-push.js 5, qg-utils.js 5, supabase-db.js 4 ("a QuickGigs member"), qg-config.js 3,
qg-onboarding.js 3, qg-role-switch.js 3, qg-safety.js 3, feeBreakdown.js 2 ("% QuickGigs fee"),
qg-menu.js 2, qg-payments-ui.js 2, qg-report.js 2, and 1 each in contentModeration, qg-announcement,
qg-auth-google, qg-bell, qg-bigtech, qg-help, qg-nav, qg-site (footer L8), qg-stats, qg-wave2 (L8 banner).
Find them with: `grep -noE "['\"\`][^'\"\`]*QuickGigs[^'\"\`]*['\"\`]" *.js`

qg-wave2.js L8 banner `'🎉 QuickGigs beta is live — payments live via Stripe.'` → `'SwiftGigs beta is live — payments live via Stripe.'`
(no emoji), and style that banner as the mockup strip: `background: var(--surface-alt)`, small teal icon, teal
"Feedback" link, no gradient.

## P1 — old palette / off-spec in shared files

- **qg-brand.css** `.nav` 3px primary underline → `border-bottom: 1px solid var(--border)`, no box-shadow (mockup has a hairline).
- **qg-refine.css**: `body:not(.light) .nav{background:#0a0014}` → `var(--surface)`; drop the `!important`
  size forcing on `.page-title` 28px, `.section-title` 20px, `.greet-name` 28px, `.task-name` 15px,
  `.task-card` radius 16px/padding 20px (mockup: 14px radius).
- **qg-polish.css**: `.nav` `rgba(11,1,24,.85)` / `rgba(200,168,233,.1)`, `.task-card`, `.review-card`,
  `.confirm-box`, `.btn-primary` gradient, `body.light .mini-card` purple shadow + `#f0eeff` border,
  `input:focus` purple shadow, `.modal-confirm.purple` gradient.
- **qg-flows.css**: posttask `.selected` states, `.cat-chip.selected` → solid `var(--accent)`;
  `.schedule-preview`/`.hint-box` → `var(--surface)` (not accent-soft); `#submitBtn` shadow → none; focus ring →
  `var(--accent)`; review `.tag.selected` solid accent, `.tag` text `var(--text)`; `.rev-avatar` → `var(--surface-alt)` + primary initials.
- **qg-bigtech.css**: `.qg-post-progress`/`.qg-post-step` (L73–91), `.qg-tl-step*`, `.btn-danger` hex,
  `.qg-new-pill`, `.qg-activity-card/-row/-time`.
- **qg-features.css**: `.qg-chip-btn` light `#f8f7ff/#e8e2ff`, `.qg-trust-badge`, `.qg-worker-avatar`,
  `.qg-worker-skill`, `.qg-cat-card:hover`, `.qg-page-kicker`, `.qg-role-flip*` slider/track fallbacks.
- **qg-wave2.css**: `.qg-bchip.active`, `.qg-af-chip`, range thumb, `.qg-inline-edit:hover rgba(107,63,160,.12)`.
- **qg-ux.css**: `.tc-cat` `!important` rgba; `.tc-info`/`.results-txt`/`.field-hint`/`.tab-lbl` forced to
  white 55% `!important` (unreadable in light mode); L426 `.qg-beta-free-note #6b6580`.
- **qg-mobile.css**: `.tab-bar` active → `var(--teal)`; L142 `.hint-box{flex-direction:column}` at ≤480px → remove.
- **qg-light-fix.css**: `html.light .im-row` card shadow → none.
- **qg-layout.css**: `body.light .btn-secondary` / `.tab-btn`.
- **qg-cookies.css**: `#qgCookieBanner` (`#150830`, `rgba(200,168,233,…)`) → `var(--surface)` + `var(--border)`;
  `#qgCookieAccept` gradient → flat `var(--primary)`; L20 light link `#6b3fa0` → `var(--primary)`.
- **qg-help.js**: help button purple gradient → flat `var(--primary)` (or `var(--surface-alt)` + border).
- **qg-auth.css** (login/signup): `'Poppins'` → `'DM Sans'` everywhere (HTML already loads DM Sans);
  radii 8px → 12px on `.signup-field input`, `.qg-custom-input`, `.signup-btn`, `.signup-google-btn`,
  `.signup-terms-check`, `.qg-guardian-note`; `.signup-card` 12px → 14px; `.signup-title`/`.qg-step-title`
  weight 700; focus `border-color: var(--accent); outline: 2px solid color-mix(in srgb, var(--accent) 30%, transparent)`;
  `.qg-chip` radius 100px, `.selected` solid `var(--accent)`.
- **qg-signup.css**: whole file still old palette (~40 hits: mesh, orbs, glow, button gradient) → tokens, no decoration.
- **qg-payment.css**: card radius 20 → 14, title/total weight 700, `.pay-summary` unboxed, button radius 12.
- **qg-guardian.css**: body radial glow, `.gp-live` light `#fff` mix, `qgGpPulse` animation → remove;
  radii 16–20 → 14; consent `h2` not Playfair; parent-consent `!important` accent overrides on labels/info box.
- **qg-admin.css** (~40 old literals) → tokens; **qg-admin-console.css**: delete
  `body.page-admin .logo-text{color:var(--brand)!important}` (breaks gradient wordmark), card radius 12 → 14,
  `.nav-badge #111` → danger + token text, `.role-pill` neutral override, `.s-progress` → teal.
- **qg-content.css**: full spec in `Claude outputs/qg-content-spec.md` (content/legal pages).
- **JS colour literals**: qg-utils.js `renderUserAvatarHtml` gradient → `var(--surface-alt)` + `var(--primary)` initials;
  `attachPasswordToggle` old hex → tokens; qg-admin-dash.js L306/L359 `'#9b6fc4'` → `'var(--primary)'`.

## Order

P0 items 1–6 and the QuickGigs strings first (biggest visible change, small diffs), then qg-role-theme.css's
remaining Step 4 sweep, then the P1 list. Commit + push after each file. Report which page-level overrides in the
HTML are now redundant and Claude will remove them.
