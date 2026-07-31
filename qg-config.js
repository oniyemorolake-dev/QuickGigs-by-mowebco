// QuickGigs — platform rules (single place to change launch behaviour)
window.QG_CONFIG = {
  // When chat unlocks: 'payment' (launch) | 'accept' (beta) | 'apply' (internal testing only)
  // When Stripe is live, restore the escrow-gated contact rule — chat unlocks only after
  // escrow is funded. Currently gated on acceptance because payments are off.
  chatUnlockAfter: 'accept',
  // Set true ONLY after Supabase Auth → Firebase is enabled AND rls-secure.sql is applied
  supabaseFirebaseAuth: false,
  blockOffPlatformContact: true,
  posterOnlyChatImages: false,
  maxTaskPhotos: 3,
  maxPhotoSizeMb: 5,
  // P1 — email queue (requires notification_queue table + optional Edge Function)
  emailNotificationsEnabled: true,
  notificationFunctionUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/send-notification',
  registerAccountUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/register-account',
  guardianConsentUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/guardian-consent',
  resendGuardianConsentUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/resend-guardian-consent',
  guardianQueueUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/guardian-queue',
  myApplicationsUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/my-applications',
  graduateAccountUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/graduate-account',
  roleVerificationUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/role-verification',
  roleAccessUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/role-access',
  secureMessagingUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/secure-messaging',
  postTaskUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/post-task',
  submitApplicationUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/submit-application',
  shareBaseUrl: 'https://quickgigs.ca',
  // Google Analytics 4 — set to G-XXXXXXXXXX to disable, or your live Measurement ID
  ga4MeasurementId: 'G-82SPKK654N',
  ga4ConversionLabel: '',
  // P2 — trust & moderation
  autoBanAfterWarnings: 3,
  // Stripe / escrow checkout — OFF until launch (chat still unlocks on accept).
  paymentsEnabled: false,
  // Poster payment-method verification (Setup mode) — ON for publish gate. Uses existing
  // role-verification start_poster + Stripe test keys (sk_test in Supabase secrets).
  posterPaymentVerificationEnabled: true,
  // Paste pk_test_... for testing (must match sk_test_ in Supabase secrets — not pk_live_ until launch)
  stripePublishableKey: 'pk_test_51Tlh7hCPjV7Oq67QZsRZgVeZMY0AgYDwl0YgOtV33gXPdDhJF7tMzw0BfjTZkVE3hcIXkhsx6XNJZCM1lSTVpfk200OajLTBz9',
  createCheckoutUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/create-checkout',
  confirmCheckoutUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/confirm-checkout',
  syncPaymentUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/sync-payment',
  refundPaymentUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/refund-payment',
  syncConnectUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/sync-connect-status',
  connectLinkUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/create-connect-link',
  releasePayoutUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/release-payout',
  completeTaskUrl: 'https://nuyfqsxstsrbloztzgau.supabase.co/functions/v1/complete-task',
  // Legacy single % (one-off default only — DO NOT use for fee math).
  // All fee math must go through feeBreakdown.js:
  // one-off 25% | recurring 10% | one-off sub 20% | recurring sub 8%.
  platformFeePercent: 25,
  feeRates: {
    oneoff: 0.25,
    recurring: 0.10,
    oneoff_sub: 0.20,
    recurring_sub: 0.08
  },
  // UX-only admin allow-list (see qg-admin-gate.js). Prefer adminUids (Firebase UID).
  // Real enforcement: admins table + service-role function / custom claim admin:true.
  adminEmail: 'mowebsiteco@gmail.com',
  adminUids: [
    // 'YOUR_FIREBASE_UID'
  ],
  // Client abuse UX (qg-abuse.js) — NOT real enforcement; server must enforce later
  abuseLimits: {
    minBudget: 20,
    maxTitle: 100,
    maxDescription: 2000,
    maxApplyMessage: 1000,
    maxChatMessage: 2000,
    maxReview: 500,
    maxBio: 160,
    postCooldownMs: 5000,
    applyCooldownMs: 3000,
    chatMinGapMs: 900,
    chatBurstMax: 5,
    chatBurstWindowMs: 12000
  }
};

/**
 * True only when chat must wait for escrow/payment.
 * When Stripe is live, restore the escrow-gated contact rule — chat unlocks only after
 * escrow is funded. Currently gated on acceptance because payments are off.
 */
window.isChatPaymentGated = function () {
  var c = window.QG_CONFIG || {};
  if (!c.paymentsEnabled) return false;
  return c.chatUnlockAfter === 'payment';
};

window.getChatUnlockRule = function () {
  // When payments are disconnected, force accept-mode unlock regardless of stale values.
  if (window.isChatPaymentGated && window.isChatPaymentGated()) return 'payment';
  var rule = (window.QG_CONFIG && window.QG_CONFIG.chatUnlockAfter) || 'accept';
  if (rule === 'payment' && !(window.QG_CONFIG && window.QG_CONFIG.paymentsEnabled)) return 'accept';
  return rule || 'accept';
};

// Returns whether a new conversation should start unlocked.
window.resolveChatUnlockedOnCreate = function (stage) {
  var rule = typeof window.getChatUnlockRule === 'function'
    ? window.getChatUnlockRule()
    : ((window.QG_CONFIG && window.QG_CONFIG.chatUnlockAfter) || 'accept');
  if (rule === 'apply') return true;
  if (rule === 'accept' && (stage === 'in_progress' || stage === 'accepted')) return true;
  return false;
};

/** Unlock chat when tasker is accepted (payments off) or after escrow (payments on). */
window.shouldUnlockChatNow = function (convStatus, taskStatus) {
  var rule = typeof window.getChatUnlockRule === 'function'
    ? window.getChatUnlockRule()
    : ((window.QG_CONFIG && window.QG_CONFIG.chatUnlockAfter) || 'accept');
  if (rule === 'apply') return (convStatus || '').toLowerCase() !== 'completed';
  if (rule === 'accept') {
    var cs = (convStatus || '').toLowerCase();
    var ts = (taskStatus || '').toLowerCase();
    if (cs === 'completed') return false;
    if (cs === 'in_progress' || cs === 'accepted') return true;
    if (ts === 'in_progress' || ts === 'accepted') return true;
    // Opening an existing thread from Messages — unlock unless clearly closed.
    if (cs !== 'completed' && ts !== 'cancelled') return true;
    return false;
  }
  // payment rule: only unlock when caller verified held escrow (or is_unlocked already)
  return false;
};

window.getChatLockMessage = function (isPoster) {
  var rule = typeof window.getChatUnlockRule === 'function'
    ? window.getChatUnlockRule()
    : ((window.QG_CONFIG && window.QG_CONFIG.chatUnlockAfter) || 'accept');
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

window.getMessagesBannerCopy = function () {
  var rule = typeof window.getChatUnlockRule === 'function'
    ? window.getChatUnlockRule()
    : ((window.QG_CONFIG && window.QG_CONFIG.chatUnlockAfter) || 'accept');
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
    // When Stripe is live, restore the escrow-gated contact rule — chat unlocks only after
    // escrow is funded. Currently gated on acceptance because payments are off.
    sub: 'Once a worker is accepted, you can message each other here. Escrow payment is paused while payments are offline.'
  };
};
