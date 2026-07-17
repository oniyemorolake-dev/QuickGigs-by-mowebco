# QuickGigs — Your side (owner checklist)

**Pin this file.** Until these are done, some features work in code but not in production.

---

## Deploy often

Push local commits so [quickgigs.ca](https://quickgigs.ca) updates (GitHub Pages, ~2–5 min lag):

```powershell
cd "c:\QuickGigs by mowebco"
git status
git push origin main
```

After deploy: hard refresh or incognito (service worker cache).

---

## One-time: Firebase — Google sign-in

Code is ready (`login.html`, `signup.html`). You must enable it in Firebase:

1. [Firebase Console](https://console.firebase.google.com) → project **quickgigs-7b12d**
2. **Authentication** → **Sign-in method** → **Google** → Enable
3. **Authentication** → **Settings** → **Authorized domains** → add:
   - `quickgigs.ca`
   - `localhost` (for local testing)

**Test:** Login page → **Continue with Google**

---

## One-time: Resend — waitlist + notification emails

Code + Edge Function are in the repo. Emails send only after deploy + secrets.

1. [Resend](https://resend.com) → verify domain for `notify@quickgigs.ca` (or your from-address)
2. Supabase → **Edge Functions** → deploy `supabase/functions/send-notification`
3. Set secrets (Supabase CLI or dashboard):

```bash
supabase functions deploy send-notification --no-verify-jwt
supabase secrets set RESEND_API_KEY=re_your_key_here FROM_EMAIL="QuickGigs <notify@quickgigs.ca>"
```

4. `qg-config.js` already has `notificationFunctionUrl` — no change needed if project URL matches.

**Test:** [quickgigs.ca/admin.html](https://quickgigs.ca/admin.html) → Waitlist → **Send invite**

Transactional emails (apply, accept, complete, chat) use the same function.

---

## Optional: Google Ads conversion

GA4 is live (`G-82SPKK654N` in `qg-config.js`).

When you run Google Ads, paste your conversion label:

```js
ga4ConversionLabel: 'YOUR_LABEL_HERE',
```

---

## Supabase SQL (run once if a feature is broken)

In **Supabase → SQL Editor**, run any you haven’t yet:

| File | For |
|------|-----|
| `supabase/beta-setup-all.sql` | Full beta base (or re-run new sections) |
| `supabase/user-notifications.sql` | Notification bell |
| `supabase/saved-tasks.sql` | Saved tasks ☆ |
| `supabase/admin-tools.sql` | Admin notes / flags |
| `supabase/waitlist-banner.sql` | Waitlist + announcement banner |
| `supabase/storage-beta-fix.sql` | Photo upload 403 fix |

---

## Not yet — Stripe / payments

**Intentionally off for beta.** Chat unlocks on accept (`chatUnlockAfter: 'accept'` in `qg-config.js`).

When you’re ready for launch: Stripe Connect, then switch config to `chatUnlockAfter: 'payment'`.

---

## Quick test after deploy

- [ ] Notification bell on dashboard / browse
- [ ] Saved tasks ☆ on browse cards
- [ ] Chat photos + review button on completed chat
- [ ] Confetti on **Mark complete** and signup welcome
- [ ] Admin waitlist **Send invite** (after Resend)
- [ ] Google login (after Firebase enable)
