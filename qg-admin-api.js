/**
 * QuickGigs — admin console Edge Function client.
 * All privileged reads/writes go through admin-console (service role + admins table).
 */
(function () {
  function url() {
    return (window.QG_CONFIG && window.QG_CONFIG.adminConsoleUrl) || '';
  }

  /**
   * @param {string} action
   * @param {object} [payload]
   * @param {object} [firebaseUser]
   * @returns {Promise<object>}
   */
  async function callAdminConsole(action, payload, firebaseUser) {
    if (typeof callVerifiedFunction !== 'function') {
      return { success: false, ok: false, error: 'admin_api_missing' };
    }
    var endpoint = url();
    if (!endpoint) {
      return { success: false, ok: false, error: 'admin_console_not_configured' };
    }
    var body = Object.assign({ action: action }, payload || {});
    return await callVerifiedFunction(endpoint, body, firebaseUser);
  }

  window.callAdminConsole = callAdminConsole;
})();
