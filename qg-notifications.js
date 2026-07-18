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
    },
    counter_offer_received: {
      subject: function (p) { return 'Counter offer: $' + (p.amount || '') + ' on “' + (p.taskTitle || 'a task') + '”'; },
      body: function (p) {
        return (p.posterName || 'The poster') + ' countered your application at $' + (p.amount || '?') +
          ' for “' + (p.taskTitle || '') + '”.\n\nAccept, decline, or counter back in My Tasks:\n' +
          (p.link || 'https://quickgigs.ca/mytasks.html?tab=applied');
      }
    },
    counter_offer_reply: {
      subject: function (p) { return 'Counter back: $' + (p.amount || '') + ' on “' + (p.taskTitle || 'a task') + '”'; },
      body: function (p) {
        return (p.workerName || 'A tasker') + ' countered back at $' + (p.amount || '?') +
          ' on “' + (p.taskTitle || '') + '”.\n\nReview in My Tasks → Posted:\n' +
          (p.link || 'https://quickgigs.ca/mytasks.html?tab=posted');
      }
    },
    counter_offer_accepted: {
      subject: function (p) { return 'Price agreed: $' + (p.amount || '') + ' on “' + (p.taskTitle || 'a task') + '”'; },
      body: function (p) {
        return (p.partyName || 'They') + ' accepted $' + (p.amount || '?') +
          ' for “' + (p.taskTitle || '') + '”.\n\nOpen QuickGigs to continue:\n' +
          (p.link || 'https://quickgigs.ca/mytasks.html');
      }
    },
    task_removed_admin: {
      subject: function (p) { return 'Your task was removed: “' + (p.taskTitle || 'task') + '”'; },
      body: function (p) {
        return 'Hi,\n\nYour task “' + (p.taskTitle || '') + '” was removed by a QuickGigs moderator.\n\nReason:\n' +
          (p.reason || 'Not specified') + '\n\nIf you believe this was a mistake, reply to support@quickgigs.ca.\n\n— QuickGigs';
      }
    },
    task_removed_applicant: {
      subject: function (p) { return 'Task removed: “' + (p.taskTitle || 'a task') + '”'; },
      body: function (p) {
        return 'Hi,\n\nA task you applied to was removed by QuickGigs moderation.\n\nTask: “' + (p.taskTitle || '') +
          '”\nReason: ' + (p.reason || 'Not specified') + '\n\nBrowse other gigs:\n' +
          (p.link || 'https://quickgigs.ca/browsetask.html') + '\n\n— QuickGigs';
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
      new_message: 1,
      counter_offer_received: 1,
      counter_offer_reply: 1,
      counter_offer_accepted: 1,
      task_removed_admin: 1,
      task_removed_applicant: 1
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

  async function notifyWorkerCounterOffer(workerId, workerEmail, task, payload) {
    if (!workerId) return;
    payload = payload || {};
    var taskId = payload.taskId || (task && (task.task_id || task.TASK_ID));
    var type = payload.accepted ? 'counter_offer_accepted' : 'counter_offer_received';
    return queueEmailNotification({
      type: type,
      userId: workerId,
      email: workerEmail,
      payload: {
        taskTitle: task && (task.title || task.TITLE),
        taskId: taskId,
        amount: payload.amount,
        posterName: payload.posterName,
        partyName: payload.posterName || 'The poster',
        link: 'https://quickgigs.ca/mytasks.html?tab=applied' + (taskId ? '&expand=' + encodeURIComponent(taskId) : '')
      }
    });
  }

  async function notifyPosterCounterReply(posterId, posterEmail, task, payload) {
    if (!posterId) return;
    payload = payload || {};
    var taskId = payload.taskId || (task && (task.task_id || task.TASK_ID));
    var type = payload.action === 'accept' ? 'counter_offer_accepted' : 'counter_offer_reply';
    return queueEmailNotification({
      type: type,
      userId: posterId,
      email: posterEmail,
      payload: {
        taskTitle: task && (task.title || task.TITLE),
        taskId: taskId,
        amount: payload.amount,
        workerName: payload.workerName,
        partyName: payload.workerName || 'The tasker',
        link: 'https://quickgigs.ca/mytasks.html?tab=posted' + (taskId ? '&expand=' + encodeURIComponent(taskId) : '')
      }
    });
  }

  async function notifyAdminTaskRemoved(task, applications, reason) {
    if (!task) return { success: false };
    reason = String(reason || '').trim();
    var taskTitle = task.title || task.TITLE || 'Task';
    var posterId = task.posted_by || task.POSTED_BY;
    var posterUser = posterId && typeof getUserByFirebaseUid === 'function'
      ? await getUserByFirebaseUid(posterId)
      : null;

    if (posterId) {
      await queueEmailNotification({
        type: 'task_removed_admin',
        userId: posterId,
        email: posterUser && posterUser.email,
        payload: {
          taskTitle: taskTitle,
          reason: reason,
          link: 'https://quickgigs.ca/mytasks.html?tab=posted'
        }
      });
    }

    var seen = {};
    var apps = applications || [];
    for (var i = 0; i < apps.length; i++) {
      var app = apps[i];
      var st = String(app.status || app.STATUS || 'pending').toLowerCase();
      if (st === 'cancelled' || st === 'declined') continue;
      var wid = app.worker_id || app.WORKER_ID;
      if (!wid || seen[wid]) continue;
      seen[wid] = true;
      var workerUser = typeof getUserByFirebaseUid === 'function' ? await getUserByFirebaseUid(wid) : null;
      await queueEmailNotification({
        type: 'task_removed_applicant',
        userId: wid,
        email: workerUser && workerUser.email,
        payload: {
          taskTitle: taskTitle,
          reason: reason,
          link: 'https://quickgigs.ca/mytasks.html?tab=applied'
        }
      });
    }
    return { success: true };
  }

  window.notifyWorkerCounterOffer = notifyWorkerCounterOffer;
  window.notifyPosterCounterReply = notifyPosterCounterReply;
  window.notifyAdminTaskRemoved = notifyAdminTaskRemoved;
  window.queueEmailNotification = queueEmailNotification;
  window.sendWaitlistEmail = sendWaitlistEmail;
  window.queueGuardianConsentEmail = queueGuardianConsentEmail;
  window.notifyPosterNewApplication = notifyPosterNewApplication;
  window.notifyWorkerAccepted = notifyWorkerAccepted;
  window.notifyTaskCompleted = notifyTaskCompleted;
  window.notifyNewChatMessage = notifyNewChatMessage;
})();
