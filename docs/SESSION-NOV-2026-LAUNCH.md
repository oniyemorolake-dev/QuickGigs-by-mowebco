# SwiftGigs launch work: 12 to 15 November 2026

Written by Claude at the end of the session. Everything listed under "Shipped"
is on `main`. "Live" means users get it today; several items are on `main` but
wait on a deploy, a secret, or a database approval. Those are marked.

Nothing here has been through a full two-phone test after the final changes.
Code was syntax-checked and the database pieces were queried directly; the
screens were not opened in a browser by Claude.

Rules that stayed in force throughout:

- Stripe stays in test mode. `STRIPE_LIVE_MODE` is not set and the Stripe keys
  were not touched.
- No secret values were printed, committed or put in frontend files.
- No force-push, amend or history rewrite. Commits by explicit path only.
- `BUILD_ID` files were never hand-edited.

---

## 1. What is waiting on Morolake

Do these in order. Until 1 and 2 are done, payouts, tips, teens and languages
are not live.

### 1.1 Deploy the edge functions (Cursor terminal)

```
npx supabase functions deploy release-payout stripe-webhook confirm-checkout sync-payment create-escrow-intent register-account guardian-consent tip translate --project-ref nuyfqsxstsrbloztzgau --no-verify-jwt
```

Earlier in the session these were also changed and should be redeployed if they
have not been since 13 November: `create-connect-link`, `sync-connect-status`,
`submit-application`, `secure-messaging`, `post-task`, `admin-console`,
`send-notification`, `refund-payment`, `email-code`.

### 1.2 Add secrets (Supabase, Edge Functions, Secrets)

| Secret | What it unlocks | Value |
| --- | --- | --- |
| `GUARDIAN_CONSENT_SECRET` | Teen sign-up and parent approval links | Any random string, 32+ characters |
| `GOOGLE_TRANSLATE_API_KEY` | Language switch | Google Cloud, enable Cloud Translation API, create an API key |

Optional: `TRANSLATE_MONTHLY_CHAR_CAP` (default 400000).

### 1.3 Approve one database change

`supabase/migrations/20261115031500_reviews_integrity.sql` is written but NOT
applied. Supabase asked for confirmation twice and the prompt timed out. It
limits reviews to one per person per gig and to the other person on that gig.
Reviews work without it; it closes a loophole.

### 1.4 Stripe dashboard

- Settings, Payment methods: turn on Apple Pay, Google Pay, Link.
- Settings, Payment method domains: add `quickgigs.ca` (needed for Apple Pay).

### 1.5 Tests to run on two phones (test mode)

1. Admin, Launch control, Needs attention: **Pay the tasker** on Box braids.
   Expect $29.75 (85% of the real $35 charge).
2. Full gig: post, apply, accept, pay, chat, mark complete, rate, tip $5
   (card 4242 4242 4242 4242). Check the tasker's Available balance.
3. Teen: sign up with a 16-year-old birth date and a second email as parent;
   approve from that inbox.
4. Set a phone to French and open the site.
5. Google sign-in (never confirmed after the API key restriction fix).

### 1.6 Go-live, only on Morolake's word

Live Stripe keys, `STRIPE_LIVE_MODE=true`, `pk_live_` in `qg-config.js`, a real
$20 gig, turn off soft close, email the waitlist.

---

## 2. Shipped, by area

### Sign-in and landing

- Google sign-in uses a popup on every device (the redirect flow lost the
  session on iOS Safari and current Chrome). In-app browsers get a message.
- Firebase API key website restriction: added
  `quickgigs-7b12d.firebaseapp.com/*` (fixes "The requested action is invalid").
- Signed-in visitors on the landing page go straight to the dashboard.
- Email confirmation by 6-digit code (`email-code` function).
- Invite-only sign-up while soft close is on (`register-account` checks the
  waitlist invite).
- Placeholder testimonials removed; QuickGigs strings renamed to SwiftGigs.

### Finding gigs

- Bottom nav has a **My gigs** tab on all five app pages; "Gigs" is now "Browse".
- My gigs opens on In progress when a gig is live and shows an in-progress
  banner on every tab.
- Location: the saved city follows the device when permission is granted, so a
  tasker in Toronto gets Toronto. Browse has **Change city**. Gigs without a
  map pin match on city name. The header only names the person's own city.
- Maps: remote gigs no longer crash the Browse map, pins sharing a spot fan
  out, the map starts on the person's area, and the active-gig map rebuilds
  each time.

### Times

- Post saved the chosen time with no timezone, so it was read as UTC and shown
  hours off. It now saves the real instant, refuses a past time, and saves a
  dated label instead of "Today".
- The 7 existing gigs were corrected, treated as Calgary time.

### Applying, accepting, completing

- Apply: removed five or more client checks the server repeats; the sheet
  closes when the offer is saved; chat and email run in the background.
- Accept: the tasker email and declining other applicants no longer block.
- Every server call gives up after 30 seconds instead of spinning.
- Mark complete: only the poster confirms. The tasker sees "Waiting for
  poster". Server refusals stop instead of retrying through client writes.

### Money

- **Payout bug found:** Box braids recorded $70 but the Stripe charge was $35,
  so the transfer of $59.50 was refused. Likely cause: the pay sheet was opened
  at one price, the price changed, and the older payment was the one paid.
  Not confirmed in the Stripe dashboard.
- Fixes (need deploy): the payout follows the real charge; every "held" write
  records what Stripe collected; one live payment per gig; no matching a
  payment across gigs.
- Live now: the price locks once a gig is funded (database trigger).
- `sync-payment` reads the database first instead of scanning Stripe (was 5 to
  9 seconds).
- My gigs shows the tasker's Available, Pending and Total earned with a
  Withdraw link. "Earned" appears only after release.
- Payout setup prefills name, email, phone and date of birth to shorten
  Stripe's questions. Profile shows connected status and bank last four.

### Tips (needs deploy of `tip` and `stripe-webhook`)

- Poster can tip on a finished, paid gig: $2 to $200, up to 3 per gig.
- 100% goes to the tasker (the guardian's account for a 16 or 17 year old).
  Stripe's card fee on the tip comes out of the platform balance.
- Tips have their own table and their own Stripe metadata project
  (`quickgigs_tip`) so escrow handlers ignore them. The webhook settles a tip
  if the app is closed. The tasker's balance counts tips.
- Not built: charging a tip before the gig. A cancelled gig would leave the
  tasker holding the tip.

### Reviews

- Reviews never worked: My gigs linked with ids the review page did not read,
  so it showed sample data ("Sarah K.") and refused to save. Zero reviews
  existed.
- New pop-up (`qg-review.js`): opens when the poster marks complete, and for
  either side on opening the app with an unrated finished gig. "Not now" skips
  it for that gig. The poster's sheet includes the tip step.
- `review.html` loads the real gig, amount, date and name.

### Messages

- No redraw every few seconds when nothing changed; no overlap; paused while
  the app is hidden; a sending message is not wiped by a refresh.
- The inbox refreshes itself. Opening a chat clears the previous one first.
- Thread time shows the last message time, not always "Now".
- A blocked draft no longer locks the send button.

### Teens (needs the secret and a deploy)

- Flow: 16 to 17 signs up with a parent's name, email and phone; the account is
  locked until the parent approves by emailed link; the parent sets up payouts
  in their own Stripe account; each application goes to the parent first;
  money goes to the parent.
- The real proof of a parent is Stripe's identity check on the adult. A teen
  cannot apply to any paid gig until that passes.
- Added: the parent email cannot be the teen's inbox (including `+tag` and
  Gmail-dot variants) or belong to another under-18 account; parent phone is
  required and cannot be the teen's; the parent signs with their legal name and
  confirms 18+; each decision is recorded with time, IP and browser
  (`guardian_consents`).
- Open: one existing under-18 account (created 30 July) is active with no
  parent on file. Decide whether to lock it.
- Open: the daily "teen turns 18" job fails because its URL and secret were
  never saved in the vault.

### Languages (needs the key and a deploy)

- Google's free website translator was retired on 1 October 2026, so
  translation goes through the `translate` function: each phrase is translated
  once per language and cached, with a monthly character cap.
- The app asks once in the device language (French and 14 others), remembers
  the choice, and adds a Language row to Home, Profile and the landing footer.
- Chat messages and typed text are never sent for translation.
- Hidden entirely until the key is set.

### Admin (Launch control)

- Needs attention: stuck payments, disputes, unpaid-after-accept, failed
  emails, teens waiting on a parent. Pay the tasker / Refund buttons.
- Invite a tester by email. Tester progress through six stages.
- System health: app errors, scheduled jobs, emails, payments, 24-hour activity.
- Failed actions: 7 days, per-occurrence detail, a plain "What to do" line.
  Code errors on any screen are captured. Lost connections are not logged.
- Alert email to admins, at most hourly: 3+ server errors in 10 minutes,
  several people hitting errors, emails stuck or failing, a finished gig left
  unpaid for an hour.
- Queued emails: 13 had never been sent; a per-minute job now drains the queue.

### Security

- Table grants trimmed. Applications and disputes can only be created through
  their functions. Completion is server-only.
- User email must match the signed-in email. Role, verification and review
  flags are protected by triggers.
- Unescaped values fixed in the admin dispute view, evidence photos and
  notification links.

---

## 3. Database migrations from this session

Applied unless marked.

| File | What |
| --- | --- |
| `20261113061500_security_hardening_grants_disputes_email.sql` | Grants, disputes, email match |
| `20261113063000_security_server_only_apply_and_complete.sql` | Server-only apply and complete |
| `20261113070000_admin_error_log_and_email_sender.sql` | `error_log`, email queue job |
| `20261114012000_admin_health_and_alerts.sql` | `qg_admin_health()`, alert job |
| `20261114014500_lock_price_after_payment.sql` | Price lock trigger |
| `20261114021000_guardian_consent_records.sql` | `guardian_consents` |
| `20261114150000_tips.sql` | `tips`, wallet counts tips |
| `20261115021500_translations.sql` | `translations`, `translate_usage` |
| `20261115031500_reviews_integrity.sql` | **NOT APPLIED.** One review per gig, right person only |

One data fix was run directly: `scheduled_at` on 7 gigs shifted from UTC wall
time to America/Edmonton.

## 4. New files

`qg-admin-ops.js`, `qg-tips.js`, `qg-review.js`, `qg-lang.js`,
`supabase/functions/tip/`, `supabase/functions/translate/`,
`supabase/functions/_shared/tips.ts`.

`qg-lang.js` is loaded on every root page except `admin.html`, legacy copies
and the Google verification file.

## 5. Zone note for Cursor

`AGENTS.md` assigns the six app screens, root JS and `supabase/` to Cursor.
Morolake directed Claude to edit them in this session. All edits were targeted
and committed by explicit path; the tree was clean before each one.

## 6. Ideas discussed, not built

- Hourly true-up: tasker enters actual hours, poster confirms, the difference
  is charged or refunded.
- "Asked to pay cash?" report button; on-platform-only protection wording at
  pay and accept; confirm the exact address is hidden until the gig is funded.
- Lower fee when a poster rebooks the same tasker.
- Real French for the main screens and emails (hand-written, not machine).
- Password-reset emails through Resend.
- Clean out test data (probe account, old test gigs, the $250 test payment).
