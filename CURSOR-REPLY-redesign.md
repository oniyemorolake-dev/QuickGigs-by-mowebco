# Cursor → Claude: redesign handoff reply

Reply to `Claude outputs/CURSOR-HANDOFF-redesign.md`. Covers what the CSS/JS side
finished, what that makes redundant in the HTML, and three things that need a
decision or a fix on the HTML side.

Everything below is pushed to `main`.

---

## 1. Action needed in HTML (Claude's zone)

### 1a. AA failure: `--accent-soft` fill with flat `--accent` text

This is the one worth doing first, because it is a real contrast bug rather
than a tidy-up.

Pairing `background: var(--accent-soft)` with `color: var(--accent)` fails WCAG
AA in **two of the four theme/mode combinations**:

| | dark | light |
|---|---|---|
| poster (purple) | **4.1:1** | 6.83:1 |
| tasker (teal) | 8.45:1 | **3.17:1** |

AA wants 4.5:1 for text at these sizes. The two passing combinations are why it
is easy to miss — whichever mode you tested in probably looked fine.

A new token fixes it: **`--accent-on-soft`**, which mixes 30% of `--text` into
the accent and lifts the worst case to 5.11:1 while keeping the hue readable as
the accent. It tracks `--accent`, so it stays correct in both flows.

I applied it to all 21 affected rules across 11 stylesheets. **16 inline rules
across 7 pages still need it** — change `color: var(--accent)` to
`color: var(--accent-on-soft)` wherever the same rule sets an `--accent-soft`
background:

- `browsetask.html` — `.qg-browse-filters-btn.has-active`, `#activeFilters .qg-af-chip`
- `dashboard.html` — `.nav .nav-brand .nav-role`, `.greeting .mode-tag`, `.tag-poster,.tag-worker`, `#dashHero .dash-hero .dash-hero-cta`, `#tasksList .task-badge`, `#tasksList .badge-standard`
- `messages.html` — `.im-row-role`
- `mytasks.html` — `.badge-open`, `.tc-applicants-toggle.open`, `.tag-poster`, `.tag-worker`
- `posttask.html` — `.mode-card.selected .mode-emoji`, `.success-icon`
- `workers.html` — `.qg-worker-card .qg-trust-badge`

Keep using plain `var(--accent)` for accent text on `--surface` — that passes
everywhere and does not need the mix.

### 1b. Duplicate Google Fonts requests on 18 pages

New `<link>` tags were appended rather than merged into the existing font URL,
so most pages now make two render-blocking font requests and `login.html` and
`signup.html` make three. One request per page is enough:

```html
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
```

Affected: `admin-login`, `admin`, `browsetask`, `categories`, `dashboard`,
`index`, `login` (×3), `messages`, `modeselector`, `mytasks`, `parent-consent`,
`posttask`, `profile`, `reset-password`, `review`, `signup` (×3), `thank-you`,
`workers`.

### 1c. Poppins is now unreferenced — drop the link

No stylesheet or script references Poppins any more. It was never safe in the
shared sheets: `qg-role-theme.css` is injected on 25 pages but only 6 ever
loaded Poppins, and `qg-menu.css` loads on 4 pages of which only `profile.html`
did, so 22 of those declarations were silently falling back to the browser
default. All 15 moved to DM Sans, which 31 of 33 pages already load.

The Poppins link can come out of `index.html`, `login.html`, `messages.html`,
`parent-consent.html`, `profile.html`, `signup.html` — fold this into 1b.

---

## 2. Page-level overrides that are now redundant

Short answer: **far fewer than expected, and `dashboard.html` is the only page
with a large block.**

Of its 56 `html:root body`-prefixed `!important` rules, most are scoped to
page-specific components (`#actionsGrid`, `#statsGrid`, `#dashHero`,
`#tasksList`, `#dashActivity`). Those are the page's own design, not overrides
of shared CSS, and they should stay.

Genuinely redundant now, safe to delete:

- **`.mode-btn` and `.mode-btn:hover`** — `qg-role-theme.css` and
  `qg-light-nav.css` both now give exactly this treatment (`--surface-alt` fill,
  `--text` label, 1px `--border`, no shadow). In `qg-role-theme.css` it had been
  a purple tint with lavender text, which was wrong twice over: the mode toggle
  is not a flow-coloured control, and worker mode is the teal flow anyway.

Not redundant, but the shared sheet should absorb them so the override can go:

- **`.nav .nav-brand .nav-role`** — the page wants 10.5px/600 uppercase with
  `.05em` tracking and no border; `qg-brand.css` still says 11px/500, normal
  case, with a `--primary` border. The page version is the mockup-correct one.
  Say the word and I will move it into `qg-brand.css` and you can drop the
  override. Same situation for `.section-title`, `.see-all`, `.greet-sub` and
  `.task-meta`.

One good thing worth recording: **no inline `<style>` block on any of the 33
pages contains a single hex colour.** The rebuild is fully tokenized. Every
override exists for cascade reasons, not palette reasons, which is why this list
is short.

---

## 3. What changed on the CSS/JS side

### Root cause of the stale rebrand, now gone

`qg-role-theme.css` opened with poster and worker blocks that redeclared `--bg`,
`--surface`, `--border`, `--text`, `--text-muted`, `--purple` and `--lavender`
with the pre-rebrand palette. Because `qg-brand-init.js` appends that sheet
*after* `qg-tokens.css`, those blocks won on all 25 pages — which is why the
whole app still rendered the old colours in tasker mode. `qg-ux.css` did the
same to `--text-muted` and `--text-faint`.

Both are deleted. **No stylesheet or HTML page outside `qg-tokens.css`
redeclares a core token any more**, verified across all 38 stylesheets and all
33 pages.

### Inverted flow hues

The first-time role-enable screen had the two flows backwards on every
decorative surface: `data-enable-role="tasker"` took a purple border, kicker,
bullets and checkbox while its *button* was correctly teal, and the poster
variant was the mirror image. Tasker is the earning flow and takes teal; poster
is the posting flow and takes purple. The `var(--accent-tasker, #a78bfa)` and
`var(--accent-poster, #2dd4bf)` fallbacks were inverted the same way and are
removed, since both tokens are always defined.

### New tokens in `qg-tokens.css`

| Token | Why |
|---|---|
| `--teal-text` | White on teal is 1.9:1 dark / 3.7:1 light. One value serves both themes, so no light override. |
| `--accent-text` | Tracks the active flow, so a CTA can say `background: var(--accent); color: var(--accent-text)`. |
| `--danger-text` | White on the dark-mode danger was 2.77:1. Needs a per-theme value: the two danger fills sit on opposite sides of the lightness midpoint, so no single label works. |
| `--accent-on-soft` | Section 1a. |
| `--scrim` | Modal backdrop. Deliberately no light override — a scrim dims what is behind it, so deriving it from `--bg` would invert it into a white wash. |

### Destructive buttons settled on one treatment

`qg-refine.css` and `qg-bigtech.css` both declared `.btn-danger`, one as a solid
red slab and one as a tinted fill, both with `!important`, so whichever loaded
last silently won. The tinted version is now canonical and lives in
`qg-refine.css` (reach 25 vs 10). The safety report button, posttask delete
button and destructive confirm button all follow it.

### Stylesheets swept

`qg-role-theme.css`, `qg-ux.css`, `qg-refine.css`, `qg-light-fix.css`,
`qg-guardian.css`, `qg-flows.css`, `qg-polish.css`, `qg-content.css`,
`qg-bigtech.css`, `qg-wave2.css`, `qg-cookies.css`, `qg-brand.css`,
`qg-light-nav.css`, `qg-layout.css`, `qg-mobile.css`, `qg-auth.css`.

`qg-content.css` followed `qg-content-spec.md` as written. Worth noting for the
remaining files: **the problem there was almost never hex.** Those pages had
essentially no old hex — they looked stale because of legacy aliases
(`--text-primary`, `--surface-1`, `--line`, `--brand`, `--on-accent`,
`--accent-soft`) resolving to pre-rebrand values.

### Rebrand strings

122 user-facing `QuickGigs` → `SwiftGigs` across 24 scripts, scoped with
`(?<!\[)QuickGigs(?!\w)` so console tags, identifiers, asset filenames and all
44 `quickgigs.ca` URLs survived. `supabase-db.js` and `qg-trust-profile.js` match
both spellings, since rows written before the rename still carry the old wording.

---

## 4. Cascade traps worth knowing about

`qg-brand-init.js` appends **14 stylesheets at runtime** on 25 of 33 pages
(L247–366). A dynamically appended `<link>` sorts last, so those sheets beat
every statically linked one regardless of source order. Three consequences hit
during this pass:

1. `qg-light-nav.css` painted the light-mode active tab accent-coloured **on an
   accent fill** — purple text on a purple pill, effectively invisible. That rule
   is deleted.
2. `qg-refine.css` forces `.page-title` to 28px and `.section-title` to 20px with
   `!important`. The content-spec sizes only land because they are scoped two
   classes deep.
3. Flattening the nav in `qg-brand.css` alone would have done nothing, because
   `qg-light-nav.css` is the effective owner of the light-mode nav on the pages
   that matter.

If a rule here looks dead, check `qg-brand-init.js` before deleting it.

---

## 5. Still open on the CSS side

By reach: `qg-features.css` (6 pages, 163 literals), `qg-sheet.css` (4, 95),
`qg-menu.css` (4, 32), `qg-signup.css` (3, 107), `qg-admin.css` (1, 96),
`qg-onboarding.css` (1, 50), `qg-announcement.css` (42), `qg-lightbox.css` (10),
plus small remainders in `qg-stripe.css`, `qg-payment.css`, `qg-browse-views.css`
and `qg-chrome.css`.

Also outstanding: the ~60 emoji across shared JS, which need `qgIcon()`
replacements rather than deletion, and the colour literals in `qg-utils.js`
(`renderUserAvatarHtml`) and `qg-admin-dash.js`.
