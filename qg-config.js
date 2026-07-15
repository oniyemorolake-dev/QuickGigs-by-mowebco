// QuickGigs — platform rules (single place to change launch behaviour)
window.QG_CONFIG = {
  // When chat unlocks: 'payment' (launch) | 'accept' (beta) | 'apply' (internal testing only)
  chatUnlockAfter: 'accept',
  blockOffPlatformContact: true,
  posterOnlyChatImages: true,
  maxTaskPhotos: 3,
  maxPhotoSizeMb: 5
};

// Returns whether a new conversation should start unlocked.
window.resolveChatUnlockedOnCreate = function(stage) {
  var rule = (window.QG_CONFIG && window.QG_CONFIG.chatUnlockAfter) || 'payment';
  if (rule === 'apply') return true;
  if (rule === 'accept' && (stage === 'in_progress' || stage === 'accepted')) return true;
  return false;
};

window.getChatLockMessage = function(isPoster) {
  var rule = (window.QG_CONFIG && window.QG_CONFIG.chatUnlockAfter) || 'payment';
  if (rule === 'payment') {
    return isPoster
      ? 'Chat unlocks after you accept a worker and complete payment through QuickGigs. This keeps everyone protected and stops off-platform deals.'
      : 'Chat unlocks once the poster accepts you and pays through QuickGigs escrow. Until then, your application is all they need to review.';
  }
  if (rule === 'accept') {
    return 'Chat unlocks once the poster accepts your application.';
  }
  return 'Chat is open for this task.';
};

window.getMessagesBannerCopy = function() {
  var rule = (window.QG_CONFIG && window.QG_CONFIG.chatUnlockAfter) || 'payment';
  if (rule === 'payment') {
    return {
      title: 'Chat locked until payment',
      sub: 'Apply and get accepted first — messaging opens only after the poster pays through QuickGigs. No phone numbers or off-platform contact.'
    };
  }
  if (rule === 'apply') {
    return {
      title: 'Beta testing — chat on apply',
      sub: 'For internal testing only. Switch chatUnlockAfter to "payment" before launch.'
    };
  }
  return {
    title: 'Chat opens after acceptance',
    sub: 'Once a worker is accepted, you can coordinate details here. Payments still required before work begins.'
  };
};
