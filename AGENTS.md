# AGENTS.md

Two agents work in this repo **concurrently, in the same working tree**: Cursor and
the Claude desktop app. There is no branch isolation between them. Read the
coordination rules before editing anything.

---

## 1. File ownership

Stay inside your zone. If a task needs a file you do not own, **stop and flag it**
rather than editing it — the other agent may have that file open with unsaved
context, and a write from you will silently destroy its work.

| Zone | Owner |
| --- | --- |
| `*.html` (33 files at repo root) | Claude desktop |
| `qg-icons.js` | Claude desktop (append-only, see below) |
| `*.css` (38 files at repo root) | Cursor |
| `*.js` at root, except `qg-icons.js` | Cursor |
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

These are written by `scripts/stamp-cache-version.js` and re-stamped on every push
to `main` by `.github/workflows/stamp-cache-version.yml`:

- `<!-- qg-build:... -->` comments in HTML
- `qg-pwa.js?v=...` query strings
- the version constant in `sw.js`
- `qg-build-id.json`

Hand-editing them produces guaranteed merge conflicts and can roll the PWA cache
version *backwards*. Leave them exactly as found; CI corrects them.

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

## 4. Project facts

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

### UI conventions

- **No emoji in the UI.** Use `qgIcon()` or an inline outline SVG: stroke-based,
  1.8–1.9px stroke width, rounded caps and joins.
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
