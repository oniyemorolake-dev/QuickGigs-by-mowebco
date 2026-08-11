/* QuickGigs — shared Google sign-in helpers */
(function () {
  window.qgGoogleAuthErrorMessage = function (error) {
    if (!error) return 'Google sign-in failed. Try again.';
    var code = String(error.code || '');
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return 'Google sign-in was cancelled. Tap Continue with Google to try again.';
    }
    if (code === 'auth/popup-blocked') {
      return 'Your browser blocked the Google window. Allow popups for quickgigs.ca, or try again on mobile.';
    }
    if (code === 'auth/account-exists-with-different-credential') {
      return 'This email already has a password account. Log in with email and password instead.';
    }
    if (code === 'auth/credential-already-in-use') {
      return 'This Google account is already linked to another QuickGigs user. Try a different Google account or log in with email.';
    }
    if (code === 'auth/email-already-in-use') {
      return 'This email is already registered. Log in with email and password, or use the same Google account you signed up with.';
    }
    if (code === 'auth/network-request-failed') {
      return 'Network error — check your connection and try Google sign-in again.';
    }
    if (code === 'auth/too-many-requests') {
      return 'Too many sign-in attempts. Wait a minute and try again.';
    }
    if (code === 'auth/user-disabled') {
      return 'This account has been disabled. Contact support@quickgigs.ca.';
    }
    if (code === 'auth/operation-not-allowed') {
      return 'Google sign-in is temporarily unavailable. Try email login, or contact support@quickgigs.ca.';
    }
    if (code === 'auth/unauthorized-domain') {
      return 'This domain is not authorized for Google sign-in. Add quickgigs.ca under Firebase → Authentication → Settings → Authorized domains.';
    }
    if (
      code === 'auth/invalid-credential' ||
      code === 'auth/invalid-oauth-client-id' ||
      code === 'auth/internal-error' ||
      code === 'auth/invalid-api-key'
    ) {
      return window.qgGoogleFirebaseSetupHint;
    }
    // Avoid dumping raw Firebase strings to the UI
    return 'Google sign-in failed. Try again.';
  };

  window.qgGoogleFirebaseSetupHint =
    'Google sign-in could not complete. Confirm Google is enabled in Firebase Authentication, ' +
    'quickgigs.ca is an authorized domain, and try again. If it keeps failing, use email signup or contact support@quickgigs.ca.';

  window.qgResetGoogleBtn = function (btnId) {
    var btn = document.getElementById(btnId || 'googleLoginBtn');
    if (!btn) return;
    btn.disabled = false;
    btn.innerHTML = '<span class="signup-google-icon" aria-hidden="true">G</span> Continue with Google';
  };

  /** Prefer redirect on phones — popups are unreliable on iOS Safari / in-app browsers. */
  window.qgGooglePreferRedirect = function () {
    try {
      if (window.matchMedia('(max-width:768px)').matches) return true;
      var ua = String(navigator.userAgent || '');
      if (/iPhone|iPad|iPod/i.test(ua)) return true;
      if (/Android/i.test(ua) && /wv\)|; wv/i.test(ua)) return true;
    } catch (e) {}
    return false;
  };

  window.qgGetDashboardRedirect = function () {
    return typeof getDashboardUrl === 'function'
      ? getDashboardUrl()
      : 'dashboard.html';
  };

  /**
   * True only when there is NO users row for this Firebase uid.
   * Missing date_of_birth on an existing row must NOT count as "new" —
   * that wrongly sent long-time users to signup.html after login.
   * New Google users have no row yet → wizard collects DOB + teen guardian.
   */
  window.qgUserNeedsOnboarding = function (dbUser) {
    return !dbUser;
  };

  window.qgMarkOnboardingDone = function (uid) {
    if (!uid) return;
    try { localStorage.setItem('qg-onboarding-done:' + String(uid), '1'); } catch (e) {}
  };

  window.qgIsOnboardingDoneCached = function (uid) {
    if (!uid) return false;
    try { return localStorage.getItem('qg-onboarding-done:' + String(uid)) === '1'; } catch (e) { return false; }
  };

  window.qgInitOAuthSignupFields = function (user) {
    var nameEl = document.getElementById('name');
    var emailEl = document.getElementById('email');
    if (nameEl && user && user.displayName) nameEl.value = user.displayName;
    if (emailEl && user && user.email) {
      emailEl.value = user.email;
      emailEl.readOnly = true;
    }
    document.querySelectorAll('#password, #confirmPassword').forEach(function (el) {
      var field = el.closest('.signup-field');
      if (field) field.style.display = 'none';
    });
    var secSub = document.querySelector('[data-step="security"] .qg-step-sub');
    if (secSub) secSub.textContent = 'We need your phone number so posters and taskers can reach you about tasks.';
    // Hide the Google CTA once OAuth is already connected.
    var footer = document.getElementById('signupFooter');
    if (footer) footer.style.display = 'none';
  };

  /** Shared GoogleAuthProvider (scopes + account picker). */
  window.qgBuildGoogleProvider = function (GoogleAuthProviderCtor) {
    if (typeof GoogleAuthProviderCtor !== 'function') {
      throw new Error('GoogleAuthProvider_required');
    }
    var provider = new GoogleAuthProviderCtor();
    provider.addScope('profile');
    provider.addScope('email');
    provider.setCustomParameters({ prompt: 'select_account' });
    return provider;
  };
})();
