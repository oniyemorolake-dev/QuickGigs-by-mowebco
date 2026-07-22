/* QuickGigs — payment history rendering (dashboard, profile) */
(function () {
  function payField(row, key) {
    if (!row) return '';
    var lower = key.toLowerCase();
    for (var k in row) {
      if (Object.prototype.hasOwnProperty.call(row, k) && k.toLowerCase() === lower) return row[k];
    }
    return '';
  }

  function paymentStatusLabel(status) {
    var st = String(status || '').toLowerCase();
    if (st === 'held') return { text: 'In escrow', cls: 'pay-st-held' };
    if (st === 'paid') return { text: 'Paid out', cls: 'pay-st-paid' };
    if (st === 'pending') return { text: 'Processing', cls: 'pay-st-pending' };
    if (st === 'refunded') return { text: 'Refunded', cls: 'pay-st-refunded' };
    if (st === 'completed') return { text: 'Completed', cls: 'pay-st-paid' };
    return { text: st || 'Unknown', cls: 'pay-st-pending' };
  }

  function formatMoney(n) {
    var v = parseFloat(n);
    if (isNaN(v)) return '—';
    return '$' + v.toFixed(2);
  }

  function formatPayDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return '—'; }
  }

  function buildTaskTitleMap(tasks) {
    var map = {};
    (tasks || []).forEach(function (t) {
      var id = t.task_id || t.TASK_ID || t.id;
      if (id != null && id !== '') {
        map[String(id)] = t.title || t.TITLE || ('Task #' + id);
      }
    });
    return map;
  }

  function sumPayments(payments, opts) {
    opts = opts || {};
    var role = opts.role || 'poster';
    var held = 0;
    var paid = 0;
    var refunded = 0;
    (payments || []).forEach(function (p) {
      var st = String(payField(p, 'status') || '').toLowerCase();
      if (st === 'refunded') {
        refunded += parseFloat(payField(p, 'amount')) || 0;
        return;
      }
      if (st === 'held') {
        held += role === 'worker'
          ? (parseFloat(payField(p, 'worker_payout')) || 0)
          : (parseFloat(payField(p, 'amount')) || 0);
      }
      if (st === 'paid' || st === 'completed') {
        paid += role === 'worker'
          ? (parseFloat(payField(p, 'worker_payout')) || 0)
          : (parseFloat(payField(p, 'amount')) || 0);
      }
    });
    return { held: held, paid: paid, refunded: refunded };
  }

  function renderPaymentHistoryList(payments, opts) {
    opts = opts || {};
    var role = opts.role || 'poster';
    var taskMap = opts.taskMap || {};
    var esc = typeof window.escapeHtml === 'function' ? window.escapeHtml : function (s) { return String(s || ''); };
    var list = (payments || []).slice().sort(function (a, b) {
      return String(payField(b, 'created_at')).localeCompare(String(payField(a, 'created_at')));
    });
    if (!list.length) {
      return '<div class="pay-history-empty">' +
        (role === 'worker'
          ? 'No earnings yet — get hired and complete a paid task to see payouts here.'
          : 'No payments yet — pay through QuickGigs after you accept a tasker.') +
        '</div>';
    }
    return list.map(function (p) {
      var tid = payField(p, 'task_id');
      var title = taskMap[String(tid)] || ('Task #' + tid);
      var st = paymentStatusLabel(payField(p, 'status'));
      var amount = role === 'worker' ? payField(p, 'worker_payout') : payField(p, 'amount');
      var sub = role === 'worker'
        ? ('Platform fee ' + formatMoney(payField(p, 'platform_fee')))
        : ('Tasker gets ' + formatMoney(payField(p, 'worker_payout')));
      var href = tid ? ('mytasks.html?tab=inprogress&expand=' + encodeURIComponent(String(tid))) : 'mytasks.html';
      return '<a class="pay-history-row" href="' + href + '">' +
        '<div class="pay-history-main">' +
          '<div class="pay-history-title">' + esc(title) + '</div>' +
          '<div class="pay-history-meta">' + esc(formatPayDate(payField(p, 'created_at'))) + ' · ' + esc(sub) + '</div>' +
        '</div>' +
        '<div class="pay-history-right">' +
          '<div class="pay-history-amt">' + esc(formatMoney(amount)) + '</div>' +
          '<span class="pay-history-st ' + st.cls + '">' + esc(st.text) + '</span>' +
        '</div></a>';
    }).join('');
  }

  window.QG_payField = payField;
  window.QG_paymentStatusLabel = paymentStatusLabel;
  window.QG_formatPayMoney = formatMoney;
  window.QG_renderPaymentHistoryList = renderPaymentHistoryList;
  window.QG_buildTaskTitleMap = buildTaskTitleMap;
  window.QG_sumPayments = sumPayments;
})();
