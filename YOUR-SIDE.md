# QuickGigs — Your side (owner checklist)

**Pin this file.** Until these are done, some features work in code but not in production.

---

## CRITICAL — Security lockdown (do before more UI)

Production is **not** launch-safe until these are applied. Code is ready; Supabase must be updated.

1. **Supabase → Authentication → Third-party → Firebase**  
   Enable for project **quickgigs-7b12d** (required for RLS `auth.uid()`).
2. Run **`supabase/security-lockdown.sql`** in the SQL Editor (idempotent).  
   - Drops anon `USING (true)` policies  
   - Locks `users.role` / privileged columns via trigger  
   - Payments mutate only via service_role  
   - Blocks client `conversations.is_unlocked = true`  
   - Messages require unlocked conversation
3. Insert your admin UID:  
   `INSERT INTO public.admins (user_id) VALUES ('<your-firebase-uid>');`
4. Redeploy Edge Functions (JWT verify can stay **off** — functions verify Firebase JWKS themselves):

```text
refund-payment, complete-task, confirm-checkout, sync-payment,
release-payout, secure-messaging, send-notification,
create-checkout, create-escrow-intent, sync-connect-status
```

5. Set secret **`NOTIFICATION_SEND_SECRET`** (16+ chars) for `send-notification`.  
   Callers must send header `x-qg-notification-secret`.
6. Only then set **`supabaseFirebaseAuth: true`** in `qg-config.js` and push.
7. Run role-matrix tests: **`supabase/SECURITY-UNAUTHORIZED-TESTS.md`**

Do **not** treat frontend checks as a fix. Authorization is Edge Function + RLS + triggers.

### If you see “Your session needs a refresh” after enabling Firebase auth

Firebase UIDs are **not** UUIDs, and Firebase tokens lack `role: authenticated` by default.
Run this **after** `security-lockdown.sql`:

**`supabase/firebase-rls-uid-fix.sql`** (entire file in SQL Editor)

Then: Log in again → hard refresh (Ctrl+Shift+R).

Optional later (official Supabase docs): set Firebase custom claim `role: 'authenticated'` on all users via Admin SDK / Cloud Function.

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

### If you see “The requested action is invalid”

This means Google OAuth is not fully wired yet. Do **all** of these:

1. **Firebase → Authentication → Sign-in method → Google**
   - Enable is ON → click **Save**
   - Re-open Google — **Web client ID** must show a value (not empty). If empty: toggle OFF, Save, toggle ON, Save again.

2. **Firebase → Authentication → Settings → Authorized domains**
   - Add **`quickgigs.ca`** (and **`www.quickgigs.ca`** if you use www)

3. **Google Cloud Console** (same project — open via Firebase ⚙️ → Project settings → “Google Cloud Platform” link)
   - **APIs & Services → OAuth consent screen**
   - App name: **QuickGigs**, support email: your email
   - If status is **Testing**: add **`mowebsiteco@gmail.com`** (and any test emails) under **Test users**
   - Or click **Publish app** for production (External users)

4. Hard refresh quickgigs.ca and try again (popup may fall back to full-page redirect automatically)

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

**Run first if tasks vanish or chat won't unlock after pay:** `supabase/launch-stabilize.sql` (one file — tasks, apps, payments, chat).

In **Supabase → SQL Editor**, run any you haven’t yet:

| File | For |
|------|-----|
| **`supabase/launch-stabilize.sql`** | **Launch fix — tasks + pay + chat (start here)** |
| `supabase/beta-setup-all.sql` | Full beta base (or re-run new sections) |
| `supabase/user-notifications.sql` | Notification bell |
| `supabase/saved-tasks.sql` | Saved tasks ☆ |
| `supabase/admin-tools.sql` | Admin notes / flags |
| `supabase/waitlist-banner.sql` | Waitlist + announcement banner |
| `supabase/storage-beta-fix.sql` | Photo upload 403 fix |
| `supabase/negotiation.sql` | Negotiable budgets + counter-offers |
| `supabase/payments.sql` | **Before launch** — escrow payment records |
| `supabase/stripe-connect.sql` | Worker Stripe Connect accounts |
| **[STRIPE-SETUP.md](STRIPE-SETUP.md)** | Deploy Checkout + webhook (Phase 4) |

---

## Beta complete → launch prep

**You’re done with closed beta** (2 completed gigs, engineers OK).  
Full checklist: **[LAUNCH-PREP.md](LAUNCH-PREP.md)**

**Your next steps (in order):**

1. **Hard refresh** quickgigs.ca (Ctrl+Shift+R) — service worker **v47+**
2. Run **`supabase/launch-stabilize.sql`** in Supabase SQL Editor (if not done)
3. Deploy Edge Functions via Supabase Dashboard (JWT **off** on each):
   - `create-checkout`, `confirm-checkout`, `stripe-webhook`
4. Run **`supabase/payments-release.sql`** in Supabase SQL Editor (if not done)
5. **Test the money loop** with 2 accounts (poster + tasker):
   - Post → accept → **Pay & unlock chat** → message → **Mark complete** → worker sees earnings
   - Stripe test card: `4242 4242 4242 4242`
6. When that works: Resend emails (`send-notification`), then open sign-ups (Admin → soft close off)

---

## Payments (live in code)

`chatUnlockAfter: 'payment'` in `qg-config.js`. Stripe test keys are set.  
Setup details: **[STRIPE-SETUP.md](STRIPE-SETUP.md)**

---

## Quick test after deploy

- [ ] Notification bell on dashboard / browse
- [ ] Saved tasks ☆ on browse cards
- [ ] Chat photos + review button on completed chat
- [ ] Confetti on **Mark complete** and signup welcome
- [ ] Admin waitlist **Send invite** (after Resend)
- [ ] Google login (after Firebase enable)
