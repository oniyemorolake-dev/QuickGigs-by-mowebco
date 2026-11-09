# SwiftGigs

Canadian task marketplace (quickgigs.ca). Operated by MoTechCo.

Static site on GitHub Pages · Firebase Auth · Supabase (Postgres + Edge Functions) ·
Stripe Connect · Resend.

## Where things are

| Path | What |
|---|---|
| `*.html` (root) | Every page. GitHub Pages serves from the root, so pages cannot move into a folder. |
| `qg-*.js`, `sg-*.js`, `supabase-db.js`, `supabaseClient.js` | Front-end logic. `qg-config.js` holds the public config (fee %, Stripe publishable key, function URLs). |
| `qg-*.css`, `sg-app.css` | Styles. Design tokens live in `qg-tokens.css`. |
| `sw.js`, `sg-sw-register.js`, `manifest.json` | The installable app: caching and automatic updates. |
| `supabase/functions/` | Edge Functions (payments, messaging, tasks, admin). Shared code in `_shared/`. |
| `supabase/migrations/` | Database changes, in order. Older one-off SQL files sit beside them in `supabase/`. |
| `sql/` | Reference schema and seed/reset scripts. |
| `scripts/` | Developer tools and tests (not loaded by the site). |
| `docs/` | Launch checklist, backend decisions, setup guides, audits, design references. |
| `archive/` | Code no page loads any more, kept for reference. |
| `.github/workflows/` | CI: stamps the app version on every push to `main`. |

## Start here

- **Launching:** [docs/LAUNCH-PREP.md](docs/LAUNCH-PREP.md)
- **How it works and how it is secured:** [docs/BACKEND-DECISIONS.md](docs/BACKEND-DECISIONS.md)
- **Working in this repo (two agents share it):** [AGENTS.md](AGENTS.md)

## Shipping a change

1. Commit and push to `main`. GitHub Pages publishes in 2–5 minutes.
2. Open apps pick the change up on their own: the service worker refreshes changed
   files in the background and either reloads quietly or shows "New version ready".
3. Database changes: add a file to `supabase/migrations/` and run it in the Supabase SQL Editor.
4. Edge Function changes: `supabase functions deploy <name> --no-verify-jwt`.

## Tests

```
node scripts/test-off-platform-parity.mjs   # chat contact filter: browser and server agree
node scripts/test-listing-contact.mjs       # task/application contact filter
```

## Never commit

Stripe secret keys, the Supabase service-role key, `.env` files, `motechco-master-plan.html`.
This repository is public: anything in it, including `docs/`, can be read by anyone.
