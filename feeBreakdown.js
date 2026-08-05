/**
 * QuickGigs — platform fee math (SINGLE SOURCE OF TRUTH for the client).
 * Route ALL fee display / commitment math through feeBreakdown() — never hardcode 0.25.
 * Server mirror: supabase/functions/_shared/fee.ts + create-checkout.
 *
 * Rates:
 *   one-off                 25%
 *   recurring               10%
 *   one-off + subscriber    20%
 *   recurring + subscriber   8%
 *
 * amount = total for THIS charge (hourly → hourly_rate * est_hours).
 *
 * FUTURE: per-period Stripe billing (subscriptions / scheduled invoices) for recurring
 * jobs — fee applies to each period total. Escrow checkout is live in TEST mode.
 * Do NOT process charges here.
 */
(function (global) {
  var FEE = {
    oneoff: 0.25,
    recurring: 0.10,
    oneoff_sub: 0.20,
    recurring_sub: 0.08
  };

  function feeRate(opts) {
    opts = opts || {};
    var isRecurring = !!opts.isRecurring;
    var isSubscriber = !!opts.isSubscriber;
    if (isRecurring) return isSubscriber ? FEE.recurring_sub : FEE.recurring;
    return isSubscriber ? FEE.oneoff_sub : FEE.oneoff;
  }

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  /**
   * @param {number} amount
   * @param {{ isRecurring?: boolean, isSubscriber?: boolean }} [opts]
   * @returns {{ total, fee, payout, rate, ratePct, percent }}
   *   `percent` is an alias of ratePct for older callers.
   */
  function feeBreakdown(amount, opts) {
    opts = opts || {};
    var total = round2(amount);
    if (!isFinite(total) || total < 0) total = 0;
    var rate = feeRate(opts);
    var fee = round2(total * rate);
    var payout = round2(total - fee);
    var ratePct = Math.round(rate * 100);
    return {
      total: total,
      fee: fee,
      payout: payout,
      rate: rate,
      ratePct: ratePct,
      percent: ratePct
    };
  }

  /** Cost of one recurring/hourly period. */
  function periodTotal(hourlyRate, hours) {
    return round2((Number(hourlyRate) || 0) * (Number(hours) || 0));
  }

  /** Build opts from a task + optional worker/user row. */
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

  /**
   * Commitment / tasker line (exact product copy):
   * "Poster pays $TOTAL/period · You receive $PAYOUT · QuickGigs fee $FEE (RATEPCT%)"
   * Poster-facing uses "Tasker receives" instead of "You receive".
   */
  function formatCommitmentBreakdown(amountOrTask, opts) {
    opts = opts || {};
    var task = opts.task || (amountOrTask && typeof amountOrTask === 'object' ? amountOrTask : null);
    var amount = typeof amountOrTask === 'number'
      ? amountOrTask
      : (opts.amount != null ? opts.amount : taskChargeAmount(task));
    var feeOpts = {
      isRecurring: opts.isRecurring != null ? !!opts.isRecurring : taskIsRecurring(task),
      isSubscriber: opts.isSubscriber != null
        ? !!opts.isSubscriber
        : (typeof currentUserIsSubscriber === 'function' ? currentUserIsSubscriber() : false)
    };
    var b = feeBreakdown(amount, feeOpts);
    var period = '';
    if (feeOpts.isRecurring) {
      var pl = opts.periodLabel || frequencyPeriodLabel(taskFrequency(task)) || 'per period';
      period = '/' + String(pl).replace(/^per\s+/i, '');
    }
    var receiveLabel = opts.taskerFacing ? 'You receive' : 'Tasker receives';
    return 'Poster pays $' + b.total.toFixed(2) + period +
      ' · ' + receiveLabel + ' $' + b.payout.toFixed(2) + period +
      ' · QuickGigs fee $' + b.fee.toFixed(2) + ' (' + b.ratePct + '%)';
  }

  function currentUserIsSubscriber() {
    if (typeof window === 'undefined') return false;
    if (window._qgIsSubscriber === true || window._qgIsSubscriber === 1) return true;
    var u = window._qgCurrentDbUser || window._currentDbUser;
    return !!(u && (u.is_subscriber === true || u.is_subscriber === 1 || u.IS_SUBSCRIBER === true));
  }

  /** Shown near recurring / subscriber fee UI. */
  var RECURRING_FEE_NOTE = 'Recurring jobs have a lower 10% fee — 8% for subscribers.';

  global.QG_FEE = FEE;
  global.RECURRING_FEE_NOTE = RECURRING_FEE_NOTE;
  global.feeRate = feeRate;
  global.feeBreakdown = feeBreakdown;
  global.periodTotal = periodTotal;
  global.feeOptsFromTask = feeOptsFromTask;
  global.taskChargeAmount = taskChargeAmount;
  global.taskIsRecurring = taskIsRecurring;
  global.taskFrequency = taskFrequency;
  global.frequencyPeriodLabel = frequencyPeriodLabel;
  global.formatTaskPriceLabel = formatTaskPriceLabel;
  global.formatCommitmentBreakdown = formatCommitmentBreakdown;
  global.currentUserIsSubscriber = currentUserIsSubscriber;

  // Keep qg-config feeRates in sync when present (display/config only — math uses FEE above)
  if (global.QG_CONFIG) {
    global.QG_CONFIG.feeRates = {
      oneoff: FEE.oneoff,
      recurring: FEE.recurring,
      oneoff_sub: FEE.oneoff_sub,
      recurring_sub: FEE.recurring_sub
    };
  }

  // CommonJS / bundler optional
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      FEE: FEE, feeRate: feeRate, feeBreakdown: feeBreakdown, periodTotal: periodTotal,
      feeOptsFromTask: feeOptsFromTask, taskChargeAmount: taskChargeAmount,
      taskIsRecurring: taskIsRecurring, taskFrequency: taskFrequency,
      frequencyPeriodLabel: frequencyPeriodLabel, formatTaskPriceLabel: formatTaskPriceLabel,
      formatCommitmentBreakdown: formatCommitmentBreakdown,
      RECURRING_FEE_NOTE: RECURRING_FEE_NOTE
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
