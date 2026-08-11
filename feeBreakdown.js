/**
 * QuickGigs — platform fee math (SINGLE SOURCE OF TRUTH for the client).
 * Route ALL fee display / commitment math through feeBreakdown() — never hardcode rates.
 * Server mirror: supabase/functions/_shared/fee.ts + create-checkout / create-escrow-intent.
 *
 * Model (beta):
 *   • Poster pays the agreed task amount into escrow — no platform fee added on top.
 *   • Tasker pays the platform fee, deducted from their payout.
 *   • Rate: QG_CONFIG.taskerFeePercent (default 15). Change that one value to raise/lower.
 *
 * Future (not charged yet): QG_CONFIG.posterFeePercent — optional poster-side fee on top.
 * Do NOT process charges here. Never store card/bank numbers — Stripe hosts that.
 */
(function (global) {
  var DEFAULT_TASKER_FEE_PERCENT = 15;
  var DEFAULT_POSTER_FEE_PERCENT = 0;

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  /** Read beta tasker fee % from config — single knob for all UI + client math. */
  function getTaskerFeePercent() {
    var cfg = global.QG_CONFIG || {};
    var pct = Number(cfg.taskerFeePercent);
    if (!isFinite(pct) || pct < 0) pct = DEFAULT_TASKER_FEE_PERCENT;
    return pct;
  }

  /** Future poster-side fee % (0 = off). Not applied to Stripe charge yet. */
  function getPosterFeePercent() {
    var cfg = global.QG_CONFIG || {};
    var pct = Number(cfg.posterFeePercent);
    if (!isFinite(pct) || pct < 0) pct = DEFAULT_POSTER_FEE_PERCENT;
    return pct;
  }

  function feeRate(/* opts */) {
    return getTaskerFeePercent() / 100;
  }

  /**
   * @param {number} amount — agreed task amount (what poster funds into escrow)
   * @param {{ isRecurring?: boolean, isSubscriber?: boolean }} [opts] — kept for API compat; rate is config-only
   * @returns {{
   *   total, fee, payout, rate, ratePct, percent,
   *   posterFee, posterPays, taskerFeePercent, posterFeePercent
   * }}
   */
  function feeBreakdown(amount, opts) {
    opts = opts || {};
    var total = round2(amount);
    if (!isFinite(total) || total < 0) total = 0;

    var taskerPct = getTaskerFeePercent();
    var rate = taskerPct / 100;
    var fee = round2(total * rate);
    var payout = round2(total - fee);

    // Future-proof: poster fee field present but not charged while posterFeePercent === 0
    var posterPct = getPosterFeePercent();
    var posterFee = round2(total * (posterPct / 100));
    var posterPays = round2(total + posterFee);

    return {
      total: total,
      fee: fee,
      payout: payout,
      rate: rate,
      ratePct: Math.round(taskerPct),
      percent: Math.round(taskerPct),
      posterFee: posterFee,
      posterPays: posterPays,
      taskerFeePercent: taskerPct,
      posterFeePercent: posterPct
    };
  }

  /** Cost of one recurring/hourly period. */
  function periodTotal(hourlyRate, hours) {
    return round2((Number(hourlyRate) || 0) * (Number(hours) || 0));
  }

  /** Build opts from a task + optional worker/user row (period labels / compat). */
  function feeOptsFromTask(task, userOrWorker) {
    task = task || {};
    userOrWorker = userOrWorker || {};
    var mode = String(task.task_mode || task.TASK_MODE || '').toLowerCase();
    var recurring = !!(task.is_recurring || task.IS_RECURRING || task.is_recurring === 1 || mode === 'recurring');
    var sub = !!(userOrWorker.is_subscriber || userOrWorker.IS_SUBSCRIBER ||
      userOrWorker.is_subscriber === 1);
    return { isRecurring: recurring, isSubscriber: sub };
  }

  /** Charge amount for a task (fixed budget, or hourly_rate × est_hours). */
  function taskChargeAmount(task, fallbackAmount) {
    task = task || {};
    var rateType = String(task.rate_type || task.RATE_TYPE || 'fixed').toLowerCase();
    if (rateType === 'hourly') {
      var hr = Number(task.hourly_rate != null ? task.hourly_rate : task.HOURLY_RATE);
      var hours = Number(task.est_hours != null ? task.est_hours : task.EST_HOURS);
      if (hr > 0 && hours > 0) return periodTotal(hr, hours);
    }
    var budget = task.budget != null ? task.budget : (task.BUDGET != null ? task.BUDGET : fallbackAmount);
    return round2(budget);
  }

  function taskIsRecurring(task) {
    if (!task) return false;
    if (task.is_recurring === true || task.IS_RECURRING === true || task.is_recurring === 1) return true;
    var mode = String(task.task_mode || task.TASK_MODE || '').toLowerCase();
    return mode === 'recurring';
  }

  function taskFrequency(task) {
    var f = String((task && (task.frequency || task.FREQUENCY)) || '').toLowerCase();
    if (f === 'weekly' || f === 'biweekly' || f === 'monthly') return f;
    return taskIsRecurring(task) ? 'weekly' : '';
  }

  /** "per week" | "per biweek" | "per month" | "" */
  function frequencyPeriodLabel(frequency) {
    var f = String(frequency || '').toLowerCase();
    if (f === 'weekly') return 'per week';
    if (f === 'biweekly') return 'per biweek';
    if (f === 'monthly') return 'per month';
    return '';
  }

  /** Card / list price: "$30/hr · Weekly" or "$120" */
  function formatTaskPriceLabel(task, opts) {
    opts = opts || {};
    task = task || {};
    var rateType = String(task.rate_type || task.RATE_TYPE || 'fixed').toLowerCase();
    var recurring = taskIsRecurring(task);
    var freq = taskFrequency(task);
    var neg = !!(task.budget_negotiable || task.BUDGET_NEGOTIABLE);
    var prefix = neg ? 'Around ' : '';
    var suffix = opts.cad === false ? '' : ' CAD';
    if (rateType === 'hourly') {
      var hr = Number(task.hourly_rate != null ? task.hourly_rate : task.HOURLY_RATE);
      if (!(hr > 0)) hr = Number(task.budget || task.BUDGET || 0);
      var label = prefix + '$' + round2(hr) + '/hr';
      if (recurring && freq) {
        var cap = freq.charAt(0).toUpperCase() + freq.slice(1);
        if (freq === 'biweekly') cap = 'Biweekly';
        label += ' · ' + cap;
      }
      return label + suffix;
    }
    var amount = taskChargeAmount(task);
    return prefix + '$' + round2(amount) + suffix + (neg ? ', open to offers' : '');
  }

  function periodSuffix(opts, task) {
    opts = opts || {};
    if (!(opts.isRecurring != null ? opts.isRecurring : taskIsRecurring(task))) return '';
    var pl = opts.periodLabel || frequencyPeriodLabel(taskFrequency(task)) || 'per period';
    return '/' + String(pl).replace(/^per\s+/i, '');
  }

  /**
   * Poster-facing: "You pay $TOTAL — the full amount goes into escrow."
   * (No added fee line. Tasker fee is deducted from their payout, not charged to poster.)
   */
  function formatPosterPayLine(amountOrTask, opts) {
    opts = opts || {};
    var task = opts.task || (amountOrTask && typeof amountOrTask === 'object' ? amountOrTask : null);
    var amount = typeof amountOrTask === 'number'
      ? amountOrTask
      : (opts.amount != null ? opts.amount : taskChargeAmount(task));
    var b = feeBreakdown(amount, opts);
    var period = periodSuffix(opts, task);
    return 'You pay $' + b.total.toFixed(2) + period +
      ' — the full amount goes into escrow.';
  }

  /**
   * Tasker-facing: "You'll receive $TOTAL minus the N% QuickGigs fee ($FEE) = $PAYOUT."
   */
  function formatTaskerPayoutLine(amountOrTask, opts) {
    opts = opts || {};
    var task = opts.task || (amountOrTask && typeof amountOrTask === 'object' ? amountOrTask : null);
    var amount = typeof amountOrTask === 'number'
      ? amountOrTask
      : (opts.amount != null ? opts.amount : taskChargeAmount(task));
    var b = feeBreakdown(amount, opts);
    var period = periodSuffix(opts, task);
    return "You'll receive $" + b.total.toFixed(2) + period +
      ' minus the ' + b.ratePct + '% QuickGigs fee ($' + b.fee.toFixed(2) + ')' +
      ' = $' + b.payout.toFixed(2) + period + '.';
  }

  /**
   * Legacy commitment line — routes by audience.
   * Prefer formatPosterPayLine / formatTaskerPayoutLine for new UI.
   */
  function formatCommitmentBreakdown(amountOrTask, opts) {
    opts = opts || {};
    if (opts.taskerFacing) return formatTaskerPayoutLine(amountOrTask, opts);
    if (opts.posterFacing !== false) return formatPosterPayLine(amountOrTask, opts);
    // Neutral / admin: show both sides explicitly
    var task = opts.task || (amountOrTask && typeof amountOrTask === 'object' ? amountOrTask : null);
    var amount = typeof amountOrTask === 'number'
      ? amountOrTask
      : (opts.amount != null ? opts.amount : taskChargeAmount(task));
    var b = feeBreakdown(amount, opts);
    var period = periodSuffix(opts, task);
    return 'Poster pays $' + b.total.toFixed(2) + period +
      ' into escrow · Tasker net $' + b.payout.toFixed(2) + period +
      ' after ' + b.ratePct + '% fee ($' + b.fee.toFixed(2) + ')';
  }

  function currentUserIsSubscriber() {
    if (typeof window === 'undefined') return false;
    if (window._qgIsSubscriber === true || window._qgIsSubscriber === 1) return true;
    var u = window._qgCurrentDbUser || window._currentDbUser;
    return !!(u && (u.is_subscriber === true || u.is_subscriber === 1 || u.IS_SUBSCRIBER === true));
  }

  // Compat export — no longer used (single rate). Kept empty so old concatenations don't crash.
  var RECURRING_FEE_NOTE = '';

  var FEE = {
    get tasker() { return feeRate(); },
    get oneoff() { return feeRate(); },
    get recurring() { return feeRate(); },
    get oneoff_sub() { return feeRate(); },
    get recurring_sub() { return feeRate(); }
  };

  global.QG_FEE = FEE;
  global.RECURRING_FEE_NOTE = RECURRING_FEE_NOTE;
  global.feeRate = feeRate;
  global.getTaskerFeePercent = getTaskerFeePercent;
  global.getPosterFeePercent = getPosterFeePercent;
  global.feeBreakdown = feeBreakdown;
  global.periodTotal = periodTotal;
  global.feeOptsFromTask = feeOptsFromTask;
  global.taskChargeAmount = taskChargeAmount;
  global.taskIsRecurring = taskIsRecurring;
  global.taskFrequency = taskFrequency;
  global.frequencyPeriodLabel = frequencyPeriodLabel;
  global.formatTaskPriceLabel = formatTaskPriceLabel;
  global.formatPosterPayLine = formatPosterPayLine;
  global.formatTaskerPayoutLine = formatTaskerPayoutLine;
  global.formatCommitmentBreakdown = formatCommitmentBreakdown;
  global.currentUserIsSubscriber = currentUserIsSubscriber;

  if (global.QG_CONFIG) {
    if (global.QG_CONFIG.taskerFeePercent == null) {
      global.QG_CONFIG.taskerFeePercent = DEFAULT_TASKER_FEE_PERCENT;
    }
    if (global.QG_CONFIG.posterFeePercent == null) {
      global.QG_CONFIG.posterFeePercent = DEFAULT_POSTER_FEE_PERCENT;
    }
    global.QG_CONFIG.platformFeePercent = getTaskerFeePercent();
    var r = feeRate();
    global.QG_CONFIG.feeRates = {
      oneoff: r,
      recurring: r,
      oneoff_sub: r,
      recurring_sub: r,
      tasker: r,
      poster: getPosterFeePercent() / 100
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      FEE: FEE, feeRate: feeRate, feeBreakdown: feeBreakdown, periodTotal: periodTotal,
      getTaskerFeePercent: getTaskerFeePercent, getPosterFeePercent: getPosterFeePercent,
      feeOptsFromTask: feeOptsFromTask, taskChargeAmount: taskChargeAmount,
      taskIsRecurring: taskIsRecurring, taskFrequency: taskFrequency,
      frequencyPeriodLabel: frequencyPeriodLabel, formatTaskPriceLabel: formatTaskPriceLabel,
      formatPosterPayLine: formatPosterPayLine, formatTaskerPayoutLine: formatTaskerPayoutLine,
      formatCommitmentBreakdown: formatCommitmentBreakdown,
      RECURRING_FEE_NOTE: RECURRING_FEE_NOTE
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
