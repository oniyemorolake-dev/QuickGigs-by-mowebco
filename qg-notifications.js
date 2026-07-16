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
    }
  };

  async function queueEmailNotification(opts) {
    if (!opts || !opts.type || !opts.userId) return { success: false };
    if (window.QG_CONFIG && window.QG_CONFIG.emailNotificationsEnabled === false) {
      return { success: false, skipped: true };
    }

    var tmpl = TEMPLATES[opts.type];
    if (!tmpl) return { success: false, error: 'unknown_type' };

    var payload = opts.payload || {};
    var subject = tmpl.subject(payload);
    var bodyText = tmpl.body(payload);
    var email = opts.email || '';

    var row = {
      user_id: opts.userId,
      email: email,
      type: opts.type,
      subject: subject,
      body_text: bodyText,
      payload: payload
    };

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
    return queueEmailNotification({
      type: 'application_received',
      userId: posterId,
      email: posterEmail,
      payload: {
        taskTitle: task && (task.title || task.TITLE),
        taskId: task && (task.task_id || task.TASK_ID),
        workerName: application && (application.worker_name || application.WORKER_NAME),
        offer: application && (application.price || application.PRICE),
        link: 'https://quickgigs.ca/mytasks.html?tab=posted'
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

  window.queueEmailNotification = queueEmailNotification;
  window.notifyPosterNewApplication = notifyPosterNewApplication;
  window.notifyWorkerAccepted = notifyWorkerAccepted;
  window.notifyTaskCompleted = notifyTaskCompleted;
  window.notifyNewChatMessage = notifyNewChatMessage;
})();
