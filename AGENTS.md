# AGENTS.md

Two agents work in this repo **concurrently, in the same working tree**: Cursor and
the Claude desktop app. There is no branch isolation between them. Read the
coordination rules before editing anything.

---

## 1. File ownership

Stay inside your zone. If a task needs a file you do not own, **stop and flag it**
rather than editing it — the other agent may have that file open with unsaved
context, and a write from you will silently destroy its work.

> **TEMPORARY TRANSFER — six app pages are Cursor's, assigned by Morolake.**
> For the SwiftGigs data-wiring pass, Cursor owns `dashboard.html`,
> `browsetask.html`, `posttask.html`, `messages.html`, `profile.html` and
> `mytasks.html`, plus their `*-legacy.html` rollback copies and the new
> `sg-app.css`. The finished layout already exists in
> `Claude outputs/sg-design/templates/`; this task is wiring real data into it,
> not design. **Claude must not touch those six files or their legacy copies
> until Cursor reports back and this block is removed.** The other 27 root HTML
> files remain Claude's and are not frozen.

| Zone | Owner |
| --- | --- |
| `*.html` (33 files at repo root) | Claude desktop — **six suspended, see above** |
| `qg-icons.js` | Claude desktop (append-only, see below) |
| `*.css` (38 files at repo root) | Cursor |
| `*.js` at root, except `qg-icons.js` | Cursor |
| `*.md` at root (`AGENTS.md`, `sweep.md`, …) | Cursor |
| `supabase/`, `sql/`, `scripts/`, `docs/`, `.github/`, `.githooks/` | Cursor |

Notes:

- An inline `<style>` or `<script>` block inside an HTML file belongs to whoever
  owns that HTML file, not to the CSS/JS owner.
- `qg-icons.js` is shared by exception, because icon work accompanies screen work.
  **Append new entries to the `ICONS` map only.** Do not reorder, reformat, or
  change `svg()` / `qgIcon()`.
- `index.html`, `login.html`, and `signup.html` carry inline `--qg-*` colour
  palettes that still need migrating onto the design tokens. That is a CSS task
  living inside HTML-owned files, so it needs an explicit handoff — do not start
  it unilaterally.

## 2. Never hand-edit generated values

`scripts/stamp-cache-version.js` writes exactly three files, re-stamped on every
push to `main` by `.github/workflows/stamp-cache-version.yml`:

- the `BUILD_ID` constant in `sw.js`
- the `SHEET_VER` / `BUILD_ID` constant in `qg-pwa.js`
- `qg-build-id.json`

Those three are Cursor's zone and CI owns their values. Do not hand-edit them.

**The HTML cache values are frozen and no longer auto-corrected.** The stamp
script used to rewrite `<!-- qg-build:... -->` and `qg-pwa.js?v=...` across all 33
root HTML files, so CI landed a commit touching every HTML file on every push.
That was the single largest source of merge conflicts here, because any edit made
near a stamped line got pulled into the conflict. The script no longer touches
HTML at all.

The practical consequence: a hand-edit to those HTML values now **sticks**. Nothing
will correct it. Leave both exactly as found. To check which build is live, read
`qg-build-id.json` or the active `CACHE_NAME`, not the HTML comment.

Cache invalidation is unaffected — `BUILD_ID` feeds `sw.js`'s `CACHE_NAME`, so a
bump makes the service worker install a fresh cache and refetch every asset,
`qg-pwa.js` included, whatever its `?v=` string says.

## 3. Editing rules

1. **Re-read a file immediately before editing it.** Never write from a snapshot
   cached earlier in your context — the other agent may have changed it since.
   This is the single most common failure mode here.
2. **Prefer targeted edits over whole-file writes.** A whole-file write inside a
   shared tree clobbers the other agent with no merge conflict and no marker, so
   git cannot warn anyone.
3. **Commit only your own files, by explicit path.** Never `git add -A`, never
   `git add .` — a sweep will capture the other agent's half-finished work and
   push it to `main`.
4. Commit small and push often, so the other agent's base stays current.
5. Avoid history rewrites (`rebase`, `commit --amend`, force-push) while the other
   agent is active; they invalidate its git state.
6. **Never check out over work you do not own.** `git pull`, `git rebase`, `git
   stash`, `git restore` and `git checkout` all rewrite files on disk, and unlike
   a save they ignore whatever is currently in the file. Re-reading before writing
   does not protect against them. Before any of these: run `git status`, never
   suppress its output, and if dirty files in the other agent's zone appear,
   commit them by explicit path or ask — do not checkout across them.

## 4. Handoff protocol

Only the Claude desktop app edits files; only Cursor can run git. An edit is not
safe until it is a commit — until then it is one checkout away from being gone.

1. Claude desktop finishes a batch and **names the exact files that are done**.
2. Cursor commits **those paths only**, immediately, and pushes.
3. Only then may Cursor run anything that checks out files (pull, rebase, stamp).

Pushing to `main` triggers `.github/workflows/stamp-cache-version.yml`, so the
remote is left permanently one commit ahead and the *next* pull rewrites the
build-ID lines in all 33 HTML files. That is the recurring source of collisions
here, and step 1 above is what makes it harmless.

For files outside its zone, Claude desktop hands Cursor the diff rather than
editing (`qg-categories.js` and `qg-theme.js` are the current live examples), or
ownership is transferred explicitly and recorded in the table above.

## 5. Project facts

- **Static site, no build step.** Plain HTML/CSS/JS loaded directly.
- **GitHub Pages serves from the repo root** (see `CNAME` and `.nojekyll`).
  Root HTML files therefore **cannot** be moved into a subfolder without breaking
  the live site.
- **Backend is Supabase** (Postgres, RLS, edge functions) with **Firebase Auth**
  for identity and **Stripe** for escrow payments.

### Theme vs. role — do not conflate

- `qg-theme` (localStorage) = light/dark theme. Owned by `qg-theme.js`.
- `qg-mode` (localStorage) = poster/tasker role.

Read and write the theme **only** through `window.QG_applyTheme(isDark, modeBtnId)`
and `window.QG_isDarkTheme()`. Do not touch `qg-theme` directly, and never store
theme state in `qg-mode`. Do not repaint by assigning `document.body.className`
wholesale — it strips page-level classes. (Writing theme into `qg-mode` was a real
bug, fixed in `75a149f`.)

### Two page architectures — know which one you are in

The six rebuilt pages (`dashboard`, `browsetask`, `posttask`, `messages`,
`profile`, `mytasks`) are **self-contained**. They load `qg-tokens.css`,
`sg-app.css` and data/auth/logic scripts only. They deliberately do **not** load
`qg-brand-init.js`, any legacy visual stylesheet, or any UI-injector
(`qg-ux.js`, `qg-bigtech.js`, `qg-wave2.js`, `qg-help.js`, `qg-onboarding.js`,
`qg-nav.js`, `qg-menu.js`, `qg-bell.js`). That is the whole point: those
injectors were adding streak cards, goal cards, stat tiles, tips and banners
back onto screens the design does not have them on. Do not add them back. Their
markup is written into the page and their chrome comes from `sg-app.css`.

If one of those pages needs a function that lives inside an injector, call it
directly or extract it — do not load the injector. Already done this way:
`readTasksCache` and `readAppsCache` come from `supabase-db.js` rather than
`qg-wave2.js`, and logout uses the inline `signOut` path rather than
`qgLogout` from `qg-menu.js`.

The remaining 27 pages still use the old injector architecture described below.

### App chrome on injector-architecture pages

On the 27 pages that still load the injectors, four pieces of chrome are
injected and removed by shared scripts. A page that hand-writes them will get
duplicates, and a page that expects them to persist will lose them:

- **Footer.** `ensureTrustFooter()` in `qg-ux.js` keeps a `FOOTERLESS` map of app
  pages it skips. Among app pages the footer renders on `profile.html` only.
  Content and marketing pages still get theirs. To change which pages have one,
  edit that map — do not add `<footer>` markup to a page.
- **Tab bar.** `renderQuickGigsTabBar(activeId)` in `qg-nav.js` renders four
  tabs: Home, Gigs, Messages, Profile. My Tasks and Applicants no longer own a
  tab and are reached from Home's current-task card and the person menu. Old
  five-way ids still resolve through `TAB_ALIAS`; anything without a tab maps to
  `''` and the bar renders with nothing highlighted. Pass the id matching the
  page you are on.
- **Person menu.** `qg-menu.js` owns the round person button and the drawer. The
  theme toggle, poster/tasker switch, notifications, search, quick help, install
  prompt, feedback and log out all live in there now. Pages should not render
  their own copies of those controls in the header.
- **Mode banner.** Both `qg-nav.js` and `qg-brand-init.js` strip
  `.qg-mode-banner` on load, so static mode strips left in markup will vanish.
  Three pages still carry dead `<span class="nav-role">` markup
  (`browsetask.html`, `mytasks.html`, `posttask.html`) plus a stale mode strip in
  `mytasks.html`; remove them when you next touch those files.

### UI conventions

- **No emoji in the UI.** Use `qgIcon()` where possible, otherwise an inline
  outline SVG: stroke-based, `stroke-width="1.5"`, rounded caps and joins, on a
  `0 0 24 24` viewBox.

  1.5px is set once, in `svg()` inside `qg-icons.js` — do not change it there, and
  match it when hand-writing an inline SVG. (This doc previously specified
  1.8–1.9px, which matched nothing that ever shipped.) Two exceptions exist and
  are not worth chasing: a legacy 1.75px cluster on `index.html`, `payment.html`
  and `qg-stripe.js`, and `.edit-progress-ring` in `profile.html`, which is a
  progress ring rather than an icon and is correctly heavier.
- **Money amounts are always `var(--green)`**, weight 700.
- Design tokens live in `qg-tokens.css`; SwiftGigs component primitives (`.sg-*`)
  live in `qg-swift.css`.
- Posting flow uses `var(--primary)` (purple); earning flow uses `var(--teal)`.

### Rebrand in progress: QuickGigs to SwiftGigs

User-facing strings become "SwiftGigs". **Do not rename** any of:

- Supabase table or column names
- Firebase project IDs
- the GitHub repo name
- env vars and config keys
- the `promptQuickGigsInstall()` function and other internal identifiers
- `QuickGigsLogo.png` and other asset filenames

The production domain is still `quickgigs.ca` and that decision is unresolved, so
`canonical` and `og:url` values stay pointed at it for now. Expect user-facing
copy and URLs to disagree until the domain question is settled.
