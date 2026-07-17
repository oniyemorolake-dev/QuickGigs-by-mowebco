/* QuickGigs — shared Google sign-in helpers */
(function () {
  window.qgGoogleAuthErrorMessage = function (error) {
    if (!error || !error.code) return 'Google sign-in failed. Try again.';
    if (error.code === 'auth/popup-closed-by-user') return '';
    if (error.code === 'auth/cancelled-popup-request') return '';
    if (error.code === 'auth/account-exists-with-different-credential') {
      return 'This email is already registered with a password. Log in with email first.';
    }
    return 'Google sign-in failed. Try again.';
  };

  window.qgGetDashboardRedirect = function () {
    return typeof getDashboardUrl === 'function'
      ? getDashboardUrl()
      : ('dashboard.html?mode=' + (localStorage.getItem('qg-session-mode') || localStorage.getItem('qg-role') || 'poster'));
  };

  window.qgUserNeedsOnboarding = function (dbUser) {
    if (!dbUser) return true;
    return !dbUser.date_of_birth;
  };

  window.qgInitOAuthSignupFields = function (user) {
    var nameEl = document.getElementById('name');
    var emailEl = document.getElementById('email');
    if (nameEl && user.displayName) nameEl.value = user.displayName;
    if (emailEl && user.email) {
      emailEl.value = user.email;
      emailEl.readOnly = true;
    }
    document.querySelectorAll('#password, #confirmPassword').forEach(function (el) {
      var field = el.closest('.signup-field');
      if (field) field.style.display = 'none';
    });
    var secSub = document.querySelector('[data-step="security"] .qg-step-sub');
    if (secSub) secSub.textContent = 'We need your phone number so posters and taskers can reach you about tasks.';
  };
})();
