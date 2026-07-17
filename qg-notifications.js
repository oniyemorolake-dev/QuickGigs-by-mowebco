/* QuickGigs — email notification queue (apply, accept, complete) */
(function () {
  var TEMPLATES = {
    application_received: {
      subject: function (p) { return 'New applicant for “' + (p.taskTitle || 'your task') + '”'; },
      body: function (p) {
        return (p.workerName || 'A tasker') + ' applied to your task “' + (p.taskTitle || '') + '”' +
          (p.offer ? ' with an offer of $' + p.offer : '') + '.\n\nOpen QuickGigs to review applicants:\n' +
          (p.link || 'https://quickgigs.ca/mytasks.html?tab=posted');
      }
    },
    application_accepted: {
      subject: function (p) { return 'You were hired for “' + (p.taskTitle || 'a task') + '” 🎉'; },
      body: function (p) {
        return 'Great news — ' + (p.posterName || 'The poster') + ' accepted your application for “' +
          (p.taskTitle || '') + '”.\n\nHead to My Tasks to message them and get started:\n' +
          (p.link || 'https://quickgigs.ca/mytasks.html?tab=inprogress');
      }
    },
    task_completed: {
      subject: function (p) { return 'Task complete: “' + (p.taskTitle || 'your task') + '”'; },
      body: function (p) {
        return '“' + (p.taskTitle || 'Your task') + '” was marked complete on QuickGigs.\n\n' +
          'Please leave a review to help the community:\n' +
          (p.link || 'https://quickgigs.ca/mytasks.html?tab=completed');
      }
    },
    new_message: {
      subject: function (p) { return 'New message from ' + (p.senderName || 'QuickGigs'); },
      body: function (p) {
        return (p.senderName || 'Someone') + ' sent you a message about “' + (p.taskTitle || 'a task') + '”:\n\n' +
          '“' + (p.preview || 'Open QuickGigs to read') + '”\n\n' +
          (p.link || 'https://quickgigs.ca/messages.html');
      }
    },
    guardian_consent: {
      subject: function (p) { return 'Approve ' + (p.teenName || 'your teen') + '\'s QuickGigs account'; },
      body: function (p) {
        return 'Hi,\n\n' + (p.teenName || 'Your teen') + ' signed up for QuickGigs and listed you as their parent/guardian.\n\n' +
          'Because they are 16 or 17, we need your approval before they can post or apply to tasks.\n\n' +
          'Approve their account here:\n' + (p.consentUrl || 'https://quickgigs.ca/parent-consent.html') + '\n\n' +
          'If you did not authorize this, ignore this email or contact support@quickgigs.ca.\n\n— QuickGigs';
      }
    },
    waitlist_invite: {
      subject: function () { return 'You\'re invited to QuickGigs beta 🎉'; },
      body: function (p) {
        return 'Hi,\n\nYou\'re on the QuickGigs waitlist — we\'re ready for you to join the beta.\n\n' +
          'QuickGigs is Canada\'s marketplace for everyday tasks. Post a gig or earn helping others in your community.\n\n' +
          'Create your free account here:\n' + (p.link || 'https://quickgigs.ca/signup.html') + '\n\n' +
          'See you on QuickGigs,\n— The QuickGigs team';
      }
    },
    waitlist_reminder: {
      subject: function () { return 'Reminder: your QuickGigs beta invite is waiting'; },
      body: function (p) {
        return 'Hi,\n\nJust a friendly reminder — your QuickGigs beta invite is still open.\n\n' +
          'Sign up free and start posting tasks or browsing gigs:\n' + (p.link || 'https://quickgigs.ca/signup.html') + '\n\n' +
          '— QuickGigs';
      }
    }
  };

  async function queueEmailNotification(opts) {
    if (!opts || !opts.type) return { success: false };
    var isWaitlist = opts.type.indexOf('waitlist_') === 0;
    if (!opts.userId && !isWaitlist) return { success: false };
    var payload = opts.payload || {};

    var inAppTypes = {
      application_received: 1,
      application_accepted: 1,
      task_completed: 1,
      new_message: 1
    };
    if (inAppTypes[opts.type] && typeof pushInAppNotification === 'function') {
      try {
        await pushInAppNotification({
          userId: opts.userId,
          type: opts.type,
          payload: payload,
          link: payload.link
        });
        if (typeof window.QG_refreshNotifications === 'function') {
          window.QG_refreshNotifications();
        }
      } catch (err) {
        console.warn('In-app notification failed:', err);
      }
    }

    if (!opts.forceEmail && window.QG_CONFIG && window.QG_CONFIG.emailNotificationsEnabled === false) {
      return { success: true, skipped: true };
    }

    var tmpl = TEMPLATES[opts.type];
    if (!tmpl) return { success: false, error: 'unknown_type' };

    var subject = tmpl.subject(payload);
    var bodyText = tmpl.body(payload);
    var email = opts.email || '';

    var row = {
      user_id: opts.userId || ('waitlist:' + (email || 'unknown')),
      email: email,
      type: opts.type,
      subject: subject,
      body_text: bodyText,
      payload: payload
    };

    var result;
    if (typeof sbPostReturn === 'function') {
      result = await sbPostReturn('notification_queue', row);
    } else if (typeof sbPost === 'function') {
      result = await sbPost('notification_queue', row);
    } else {
      return { success: false, error: 'no_db' };
    }

    var fnUrl = window.QG_CONFIG && window.QG_CONFIG.notificationFunctionUrl;
    if (result.success && fnUrl) {
      try {
        var nid = result.data && (result.data.notification_id || result.data.id);
        await fetch(fnUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notification_id: nid, type: opts.type, email: email, subject: subject, body: bodyText })
        });
      } catch (err) {
        console.warn('Notification function call failed (queued in DB):', err);
      }
    }

    return result;
  }

  async function notifyPosterNewApplication(posterId, posterEmail, task, application) {
    if (!posterId) return;
    var taskId = task && (task.task_id || task.TASK_ID);
    return queueEmailNotification({
      type: 'application_received',
      userId: posterId,
      email: posterEmail,
      payload: {
        taskTitle: task && (task.title || task.TITLE),
        taskId: taskId,
        workerName: application && (application.worker_name || application.WORKER_NAME),
        offer: application && (application.price || application.PRICE),
        link: 'https://quickgigs.ca/mytasks.html?tab=posted' + (taskId ? '&expand=' + encodeURIComponent(taskId) : '')
      }
    });
  }

  async function notifyWorkerAccepted(workerId, workerEmail, task, posterName) {
    if (!workerId) return;
    return queueEmailNotification({
      type: 'application_accepted',
      userId: workerId,
      email: workerEmail,
      payload: {
        taskTitle: task && (task.title || task.TITLE),
        posterName: posterName,
        link: 'https://quickgigs.ca/mytasks.html?tab=inprogress'
      }
    });
  }

  async function notifyTaskCompleted(userId, email, task, role) {
    if (!userId) return;
    return queueEmailNotification({
      type: 'task_completed',
      userId: userId,
      email: email,
      payload: {
        taskTitle: task && (task.title || task.TITLE),
        role: role,
        link: 'https://quickgigs.ca/mytasks.html?tab=completed'
      }
    });
  }

  async function notifyNewChatMessage(recipientId, recipientEmail, payload) {
    if (!recipientId) return { success: false };
    payload = payload || {};
    return queueEmailNotification({
      type: 'new_message',
      userId: recipientId,
      email: recipientEmail,
      payload: {
        senderName: payload.senderName,
        taskTitle: payload.taskTitle,
        preview: payload.preview,
        link: payload.link || 'https://quickgigs.ca/messages.html'
      }
    });
  }

  async function sendWaitlistEmail(email, type) {
    if (!email) return { success: false, error: 'missing_email' };
    var base = (window.QG_CONFIG && window.QG_CONFIG.shareBaseUrl) || 'https://quickgigs.ca';
    return queueEmailNotification({
      type: type,
      userId: 'waitlist:' + email,
      email: email,
      forceEmail: true,
      payload: {
        link: base + '/signup.html?ref=waitlist'
      }
    });
  }

  async function queueGuardianConsentEmail(opts) {
    if (!opts || !opts.guardianEmail) return { success: false };
    return queueEmailNotification({
      type: 'guardian_consent',
      userId: opts.userId || 'guardian',
      email: opts.guardianEmail,
      payload: {
        teenName: opts.teenName,
        consentUrl: opts.consentUrl
      }
    });
  }

  window.queueEmailNotification = queueEmailNotification;
  window.sendWaitlistEmail = sendWaitlistEmail;
  window.queueGuardianConsentEmail = queueGuardianConsentEmail;
  window.notifyPosterNewApplication = notifyPosterNewApplication;
  window.notifyWorkerAccepted = notifyWorkerAccepted;
  window.notifyTaskCompleted = notifyTaskCompleted;
  window.notifyNewChatMessage = notifyNewChatMessage;
})();
