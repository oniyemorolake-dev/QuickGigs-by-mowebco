/* QuickGigs — device notifications (browser / PWA on phone) */
(function () {
  var POLL_MS = 45000;
  var timer = null;
  var lastUnreadKey = 'qg-push-unread';
  var lastAcceptedKey = 'qg-push-accepted';
  var promptedKey = 'qg-push-prompted';

  function canNotify() {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  }

  function showPush(opts) {
    opts = opts || {};
    if (!canNotify()) return;
    try {
      var n = new Notification(opts.title || 'QuickGigs', {
        body: opts.body || '',
        icon: '/QuickGigsLogo.png',
        badge: '/QuickGigsLogo.png',
        tag: opts.tag || 'quickgigs',
        renotify: true
      });
      n.onclick = function () {
        window.focus();
        if (opts.url) window.location.href = opts.url;
        n.close();
      };
    } catch (e) { /* ignore */ }
  }

  window.showQuickGigsPush = showPush;

  async function pollUnreadMessages() {
    var user = window._currentUser;
    if (!user || typeof getConversationsForUser !== 'function') return;
    var rows = await getConversationsForUser(user.uid).catch(function () { return []; });
    var total = 0;
    var latest = null;
    (rows || []).forEach(function (conv) {
      var lastRead = user.uid === conv.poster_id ? conv.poster_last_read_at : conv.worker_last_read_at;
      if (!conv.last_message_at) return;
      var unread = !lastRead || new Date(conv.last_message_at) > new Date(lastRead);
      if (!unread) return;
      total += 1;
      if (!latest || new Date(conv.last_message_at) > new Date(latest.at)) {
        latest = {
          at: conv.last_message_at,
          body: conv.last_message || 'New message',
          url: 'chat.html?conv=' + encodeURIComponent(conv.conv_id)
        };
      }
    });
    var prev = parseInt(localStorage.getItem(lastUnreadKey) || '0', 10);
    if (canNotify() && total > prev && latest) {
      showPush({
        title: total === 1 ? 'New message on QuickGigs' : total + ' new messages',
        body: latest.body,
        url: latest.url,
        tag: 'qg-msg'
      });
    }
    localStorage.setItem(lastUnreadKey, String(total));
  }

  async function pollAcceptedJobs() {
    var user = window._currentUser;
    if (!user || typeof getApplicationsByWorker !== 'function') return;
    var apps = await getApplicationsByWorker(user.uid).catch(function () { return []; });
    var accepted = (apps || []).filter(function (a) {
      return String(a.status || a.STATUS || '').toLowerCase() === 'accepted';
    });
    var ids = accepted.map(function (a) { return String(a.app_id || a.APP_ID || a.task_id || a.TASK_ID); }).sort().join(',');
    var prev = localStorage.getItem(lastAcceptedKey) || '';
    if (canNotify() && ids && ids !== prev && accepted.length > (prev ? prev.split(',').length : 0)) {
      showPush({
        title: 'You were hired on QuickGigs 🎉',
        body: 'A poster accepted your application — open My Jobs to get started.',
        url: 'mytasks.html?tab=inprogress',
        tag: 'qg-accept'
      });
    }
    localStorage.setItem(lastAcceptedKey, ids);
  }

  function startPolling() {
    if (timer) return;
    pollUnreadMessages();
    pollAcceptedJobs();
    timer = setInterval(function () {
      pollUnreadMessages();
      pollAcceptedJobs();
    }, POLL_MS);
  }

  function stopPolling() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  window.requestQuickGigsNotifications = async function () {
    if (typeof Notification === 'undefined') {
      alert('Notifications are not supported in this browser. Add QuickGigs to your home screen and use email alerts instead.');
      return false;
    }
    var perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm === 'granted') {
      localStorage.setItem(promptedKey, '1');
      startPolling();
      showPush({ title: 'QuickGigs notifications on', body: 'We will alert you for new messages and accepted jobs.', tag: 'qg-on' });
      return true;
    }
    return false;
  };

  function maybePrompt() {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'default') {
      if (Notification.permission === 'granted') startPolling();
      return;
    }
    if (localStorage.getItem(promptedKey) === '1') return;
    var banner = document.createElement('div');
    banner.id = 'qgPushBanner';
    banner.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:250;background:#150830;border:1px solid rgba(200,168,233,0.25);border-radius:14px;padding:12px 14px;box-shadow:0 8px 32px rgba(0,0,0,0.35);font-family:DM Sans,sans-serif;font-size:13px;color:rgba(255,255,255,0.9);display:flex;align-items:center;justify-content:space-between;gap:10px;';
    banner.innerHTML = '<span>🔔 Get notified for messages &amp; accepted jobs</span>' +
      '<button type="button" style="flex-shrink:0;padding:8px 12px;border-radius:10px;border:none;background:#9b6fc4;color:#fff;font-weight:500;cursor:pointer;font-size:12px;">Enable</button>';
    banner.querySelector('button').onclick = function () {
      window.requestQuickGigsNotifications();
      banner.remove();
    };
    document.body.appendChild(banner);
    setTimeout(function () { if (banner.parentNode) banner.remove(); }, 12000);
    localStorage.setItem(promptedKey, '1');
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && canNotify()) {
      pollUnreadMessages();
      pollAcceptedJobs();
    }
  });

  function initWhenReady() {
    if (!window._currentUser) return;
    maybePrompt();
    if (canNotify()) startPolling();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(initWhenReady, 1500); });
  } else {
    setTimeout(initWhenReady, 1500);
  }

  window.addEventListener('beforeunload', stopPolling);
})();
