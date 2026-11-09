# Fix Google login — “The requested action is invalid”

This error means **Google OAuth is not wired to Firebase yet**. The QuickGigs code is fine; Firebase/Google Cloud needs one manual setup.

Project: **quickgigs-7b12d**  
Live site: **https://quickgigs.ca**

---

## Step A — Authorized domain (Firebase)

1. [Firebase Console](https://console.firebase.google.com) → **quickgigs-7b12d**
2. **Authentication** → **Settings** → **Authorized domains**
3. **Add domain** → `quickgigs.ca` (and `www.quickgigs.ca` if you use www)

You should see at least: `localhost`, `quickgigs-7b12d.firebaseapp.com`, `quickgigs-7b12d.web.app`, **`quickgigs.ca`**

---

## Step B — OAuth consent screen (Google Cloud)

1. Firebase ⚙️ **Project settings** → **Integrations** → **Google Cloud Platform** (opens GCP)
2. Or go directly: [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent?project=quickgigs-7b12d)
3. Choose **External** → Create
4. **App name:** QuickGigs  
   **User support email:** mowebsiteco@gmail.com  
   **Developer contact:** mowebsiteco@gmail.com  
5. **Save and continue** through Scopes (defaults OK) and Test users
6. Under **Test users** → **Add users** → add `mowebsiteco@gmail.com` (and any emails you test with)
7. **Save**

*(When ready for public beta, click **Publish app** on the consent screen.)*

---

## Step C — Create OAuth Web client (Google Cloud)

1. [Credentials](https://console.cloud.google.com/apis/credentials?project=quickgigs-7b12d)
2. **+ Create credentials** → **OAuth client ID**
3. Application type: **Web application**
4. Name: `QuickGigs Web`

**Authorized JavaScript origins** — add each:

```
https://quickgigs.ca
https://www.quickgigs.ca
https://quickgigs-7b12d.firebaseapp.com
https://quickgigs-7b12d.web.app
http://localhost
```

**Authorized redirect URIs** — add:

```
https://quickgigs-7b12d.firebaseapp.com/__/auth/handler
```

5. **Create** → copy the **Client ID** (ends in `.apps.googleusercontent.com`)

---

## Step D — Paste into Firebase

1. Firebase → **Authentication** → **Sign-in method** → **Google**
2. Expand **Web SDK configuration**
3. Paste the **Web client ID** from Step C
4. **Save**

The Web client ID field should **not** be empty after Save.

---

## Step E — Test

1. Hard refresh: https://quickgigs.ca/login.html  
2. Click **Continue with Google**  
3. You should see Google’s account picker (not “The requested action is invalid”)

---

## Still broken?

1. Firebase → Google → toggle **OFF** → Save → toggle **ON** → paste Client ID again → Save  
2. Try incognito (disable ad blockers for quickgigs.ca)  
3. Confirm you’re testing with an email listed under OAuth **Test users** (if app is still in Testing)

---

## Your side reminder

| Task | |
|------|---|
| Steps A–E above | ⏳ |
| `git push origin main` (latest auth code) | ⏳ |
| Resend emails | after Google works |
| Stripe | skip |
