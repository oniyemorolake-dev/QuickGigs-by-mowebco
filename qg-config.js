// QuickGigs — platform rules (single place to change launch behaviour)
window.QG_CONFIG = {
  // When chat unlocks: 'payment' (launch) | 'accept' (beta) | 'apply' (internal testing only)
  chatUnlockAfter: 'payment',
  // Set true ONLY after Supabase Auth → Firebase is enabled AND rls-secure.sql is applied
  supabaseFirebaseAuth: false,
  blockOffPlatformContact: true,
  posterOnlyChatImages: false,
  maxTaskPhotos: 3,
  maxPhotoSizeMb: 5,
  // P1 — email queue (requires notification_queue table + optional Edge Function)
  emailNotificationsEnabled: true,
  notificationFunctionUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/send-notification',
  shareBaseUrl: 'https://quickgigs.ca',
  // Google Analytics 4 — paste your Measurement ID (G-XXXXXXXXXX) to enable
  ga4MeasurementId: 'G-82SPKK654N',
  ga4ConversionLabel: '',
  // P2 — trust & moderation
  autoBanAfterWarnings: 3,
  paymentsEnabled: true,
  // Paste pk_test_... for testing (must match sk_test_ in Supabase secrets — not pk_live_ until launch)
  stripePublishableKey: 'pk_test_51Tlh7hCPjV7Oq67QZsRZgVeZMY0AgYDwl0YgOtV33gXPdDhJF7tMzw0BfjTZkVE3hcIXkhsx6XNJZCM1lSTVpfk200OajLTBz9',
  createCheckoutUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/create-checkout',
  connectLinkUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/create-connect-link',
  releasePayoutUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/release-payout',
  platformFeePercent: 25,
  adminEmail: 'mowebsiteco@gmail.com'
};

// Returns whether a new conversation should start unlocked.
window.resolveChatUnlockedOnCreate = function(stage) {
  var rule = (window.QG_CONFIG && window.QG_CONFIG.chatUnlockAfter) || 'payment';
  if (rule === 'apply') return true;
  if (rule === 'accept' && (stage === 'in_progress' || stage === 'accepted')) return true;
  return false;
};

/** Beta: unlock chat when task is accepted even if conv row still says "application". */
window.shouldUnlockChatNow = function(convStatus, taskStatus) {
  var rule = (window.QG_CONFIG && window.QG_CONFIG.chatUnlockAfter) || 'payment';
  if (rule === 'apply') return (convStatus || '').toLowerCase() !== 'completed';
  if (rule === 'accept') {
    var cs = (convStatus || '').toLowerCase();
    var ts = (taskStatus || '').toLowerCase();
    if (cs === 'completed') return false;
    if (cs === 'in_progress' || cs === 'accepted') return true;
    if (ts === 'in_progress') return true;
    return false;
  }
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
