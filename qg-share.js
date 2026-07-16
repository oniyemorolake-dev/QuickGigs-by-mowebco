/* QuickGigs — share task / profile (Web Share API + clipboard fallback) */
(function () {
  function getShareBaseUrl() {
    if (window.QG_CONFIG && window.QG_CONFIG.shareBaseUrl) {
      return window.QG_CONFIG.shareBaseUrl.replace(/\/$/, '');
    }
    return window.location.origin;
  }

  function buildTaskShareUrl(taskId) {
    return getShareBaseUrl() + '/browsetask.html?task=' + encodeURIComponent(taskId);
  }

  function buildProfileShareUrl(userId) {
    return getShareBaseUrl() + '/profile.html?user=' + encodeURIComponent(userId);
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    }
  }

  async function shareContent(opts) {
    var title = opts.title || 'QuickGigs';
    var text = opts.text || '';
    var url = opts.url || window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({ title: title, text: text, url: url });
        return { success: true, method: 'share' };
      } catch (err) {
        if (err.name === 'AbortError') return { success: false, cancelled: true };
      }
    }

    var copied = await copyToClipboard(url);
    if (copied) {
      if (typeof showToast === 'function') showToast('Link copied to clipboard');
      else alert('Link copied!');
      return { success: true, method: 'clipboard' };
    }
    prompt('Copy this link:', url);
    return { success: true, method: 'prompt' };
  }

  async function shareTask(task) {
    if (!task) return { success: false };
    var id = task.task_id || task.TASK_ID || task.id;
    var title = task.title || task.TITLE || 'QuickGigs task';
    var price = task.price || task.PRICE;
    var text = price ? title + ' — $' + price + ' on QuickGigs' : title + ' on QuickGigs';
    return shareContent({
      title: title,
      text: text,
      url: buildTaskShareUrl(id)
    });
  }

  async function shareProfile(userId, displayName) {
    return shareContent({
      title: (displayName || 'QuickGigs profile'),
      text: 'Check out this tasker on QuickGigs',
      url: buildProfileShareUrl(userId)
    });
  }

  function shareButtonHtml(kind, id, label) {
    return '<button type="button" class="qg-chip-btn qg-share-trigger" ' +
      'data-share-kind="' + (kind || 'task') + '" ' +
      'data-share-id="' + (id || '') + '" ' +
      'data-share-label="' + (label || '').replace(/"/g, '&quot;') + '" ' +
      'aria-label="Share ' + (label || 'link') + '">↗ Share</button>';
  }

  function bindShareTriggers(root, getTaskById) {
    var scope = root || document;
    scope.querySelectorAll('.qg-share-trigger').forEach(function (btn) {
      if (btn._qgShareBound) return;
      btn._qgShareBound = true;
      btn.onclick = async function () {
        var kind = btn.getAttribute('data-share-kind');
        var id = btn.getAttribute('data-share-id');
        var label = btn.getAttribute('data-share-label');
        if (kind === 'profile') {
          await shareProfile(id, label);
        } else if (kind === 'task' && typeof getTaskById === 'function') {
          var task = getTaskById(id);
          await shareTask(task || { task_id: id, title: label });
        } else {
          await shareTask({ task_id: id, title: label });
        }
      };
    });
  }

  window.buildTaskShareUrl = buildTaskShareUrl;
  window.buildProfileShareUrl = buildProfileShareUrl;
  window.shareTask = shareTask;
  window.shareProfile = shareProfile;
  window.shareButtonHtml = shareButtonHtml;
  window.bindShareTriggers = bindShareTriggers;
})();
