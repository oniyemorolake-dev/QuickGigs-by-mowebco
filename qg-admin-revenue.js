/* SwiftGigs admin: Revenue and money records.
 *
 * Replaces the old four-number Revenue screen. Built for two jobs:
 *   1. Bookkeeping and taxes: totals for any date range, a month-by-month
 *      table, and one CSV with every column an accountant needs.
 *   2. Investigating a single payment: who paid whom, for which gig, what
 *      SwiftGigs kept, and the Stripe ID to look it up in Stripe.
 *
 * Reads window.payments, window.tasks and window.users, which admin.html
 * already loads, plus tips and cash-outs (loaded here if the admin feed does
 * not include them yet).
 *
 * Note: Stripe's own processing fees are not stored in SwiftGigs. They are on
 * the Stripe dashboard (Balance > Transactions) and are needed for the books.
 */
(function () {
  'use strict';

  var TZ = 'America/Edmonton';
  var state = { range: 'month', from: '', to: '', kind: 'all', search: '' };
  var extra = { tips: null, payouts: null, loading: false };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function money(n) {
    var v = Math.round(num(n) * 100) / 100;
    return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2);
  }
  function field(row, key) {
    if (!row) return '';
    if (row[key] != null) return row[key];
    var lower = key.toLowerCase();
    for (var k in row) { if (k.toLowerCase() === lower) return row[k]; }
    return '';
  }
  function toDate(v) { if (!v) return null; var d = new Date(v); return isNaN(d) ? null : d; }

  // Calendar parts in Alberta time, so a payment at 11 pm lands on the right day.
  var partFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  function ymd(d) {
    if (!d) return '';
    var p = {};
    partFmt.formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  }
  function ym(d) { return ymd(d).slice(0, 7); }
  function stamp(d) {
    if (!d) return '';
    return d.toLocaleString('en-CA', { timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function monthLabel(key) {
    var parts = key.split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, 15).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
  }

  function userName(uid) {
    if (!uid) return '';
    var u = (window.users || []).find(function (x) { return String(x.firebase_uid || x.user_id) === String(uid); });
    return u ? (u.name || u.email || String(uid).slice(0, 8)) : String(uid).slice(0, 8) + '…';
  }
  function userEmail(uid) {
    var u = (window.users || []).find(function (x) { return String(x.firebase_uid || x.user_id) === String(uid); });
    return u ? (u.email || '') : '';
  }
  function taskTitle(id) {
    var t = (window.tasks || []).find(function (x) { return String(x.task_id || x.id) === String(id); });
    return t ? (t.title || 'Untitled gig') : (id ? 'Gig ' + String(id).slice(0, 8) : '');
  }
  function taskCity(id) {
    var t = (window.tasks || []).find(function (x) { return String(x.task_id || x.id) === String(id); });
    return t ? (t.location || '') : '';
  }

  /* Every money movement as one row. Gig payments, tips and cash-outs share
     the same columns so they sort, filter and export together. */
  function ledger() {
    var rows = [];
    (window.payments || []).forEach(function (p) {
      var st = String(field(p, 'status') || '').toLowerCase();
      var gross = num(field(p, 'amount'));
      var fee = num(field(p, 'platform_fee'));
      var payout = num(field(p, 'worker_payout'));
      var created = toDate(field(p, 'created_at'));
      var done = toDate(field(p, 'completed_at'));
      var taskId = field(p, 'task_id');
      rows.push({
        kind: 'gig',
        id: field(p, 'payment_id'),
        date: created,
        settled: done,
        status: st,
        statusLabel: st === 'held' ? 'In escrow' : st === 'paid' || st === 'completed' ? 'Paid to tasker'
          : st === 'refunded' ? 'Refunded' : st === 'pending' ? 'Not paid yet' : st || 'Unknown',
        taskId: taskId,
        gig: taskTitle(taskId),
        city: taskCity(taskId),
        posterId: field(p, 'poster_id'),
        workerId: field(p, 'worker_id'),
        gross: st === 'pending' ? 0 : gross,
        fee: st === 'paid' || st === 'completed' ? fee : 0,
        feePending: st === 'held' ? fee : 0,
        toTasker: st === 'paid' || st === 'completed' ? payout : 0,
        refunded: st === 'refunded' ? gross : 0,
        tip: 0,
        stripe: field(p, 'stripe_id'),
        transfer: field(p, 'transfer_id'),
        dispute: field(p, 'dispute_id')
      });
    });
    (extra.tips || []).forEach(function (t) {
      var st = String(t.status || '').toLowerCase();
      var amt = num(t.amount_cents) / 100;
      var counted = st === 'paid' || st === 'collected';
      rows.push({
        kind: 'tip',
        id: t.tip_id,
        date: toDate(t.collected_at || t.created_at),
        settled: toDate(t.paid_at),
        status: st,
        statusLabel: st === 'paid' ? 'Tip paid to tasker' : st === 'collected' ? 'Tip collected' : 'Tip ' + (st || 'started'),
        taskId: t.task_id,
        gig: taskTitle(t.task_id),
        city: taskCity(t.task_id),
        posterId: t.poster_id,
        workerId: t.worker_id,
        gross: 0, fee: 0, feePending: 0, toTasker: 0, refunded: 0,
        tip: counted ? amt : 0,
        stripe: t.stripe_pi || t.stripe_session_id || '',
        transfer: t.transfer_id || '',
        dispute: ''
      });
    });
    (extra.payouts || []).forEach(function (p) {
      var st = String(p.status || '').toLowerCase();
      rows.push({
        kind: 'cashout',
        id: p.payout_id,
        date: toDate(p.created_at),
        settled: toDate(p.updated_at),
        status: st,
        statusLabel: 'Cash-out ' + (st || ''),
        taskId: '', gig: 'Tasker cash-out' + (p.destination_label ? ' to ' + p.destination_label : ''), city: '',
        posterId: '', workerId: p.worker_id,
        gross: 0, fee: 0, feePending: 0, toTasker: 0, refunded: 0, tip: 0,
        cashout: num(p.amount_cents) / 100,
        stripe: p.stripe_payout_id || '',
        transfer: '',
        dispute: '',
        note: p.failure_reason || p.note || ''
      });
    });
    rows.sort(function (a, b) { return (b.date || 0) - (a.date || 0); });
    return rows;
  }

  function rangeBounds() {
    var today = ymd(new Date());
    var y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    if (state.range === 'month') return [y + '-' + pad(m) + '-01', today];
    if (state.range === 'lastmonth') {
      var ly = m === 1 ? y - 1 : y, lm = m === 1 ? 12 : m - 1;
      var last = new Date(ly, lm, 0).getDate();
      return [ly + '-' + pad(lm) + '-01', ly + '-' + pad(lm) + '-' + pad(last)];
    }
    if (state.range === 'year') return [y + '-01-01', today];
    if (state.range === 'lastyear') return [(y - 1) + '-01-01', (y - 1) + '-12-31'];
    if (state.range === 'custom') return [state.from || '0000-01-01', state.to || '9999-12-31'];
    return ['0000-01-01', '9999-12-31'];
  }
  function inRange(row) {
    var b = rangeBounds();
    var d = ymd(row.date);
    return d && d >= b[0] && d <= b[1];
  }
  function visibleRows() {
    var q = state.search.toLowerCase().trim();
    return ledger().filter(function (r) {
      if (!inRange(r)) return false;
      if (state.kind !== 'all' && r.kind !== state.kind) return false;
      if (!q) return true;
      var hay = [r.gig, r.city, userName(r.posterId), userName(r.workerId), r.id, r.stripe, r.taskId, r.statusLabel].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function totals(rows) {
    var t = { gross: 0, fee: 0, feePending: 0, toTasker: 0, refunded: 0, tip: 0, cashout: 0, gigs: 0, paidGigs: 0 };
    rows.forEach(function (r) {
      t.gross += r.gross; t.fee += r.fee; t.feePending += r.feePending; t.toTasker += r.toTasker;
      t.refunded += r.refunded; t.tip += r.tip; t.cashout += r.cashout || 0;
      if (r.kind === 'gig' && r.status !== 'pending') t.gigs += 1;
      if (r.kind === 'gig' && (r.status === 'paid' || r.status === 'completed')) t.paidGigs += 1;
    });
    return t;
  }

  /* ── Drawing ─────────────────────────────────────────────────────────── */
  var CSS = '' +
    '.rv-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px}' +
    '.rv-bar select,.rv-bar input{background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:8px 10px;font:inherit;font-size:13px}' +
    '.rv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin-bottom:16px}' +
    '.rv-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 14px}' +
    '.rv-card b{display:block;font-size:20px;font-weight:700}' +
    '.rv-card span{display:block;font-size:12.5px;font-weight:600;margin-top:2px}' +
    '.rv-card small{display:block;font-size:11.5px;color:var(--text-muted);margin-top:3px;line-height:1.35}' +
    '.rv-card.main b{color:var(--green)}' +
    '.rv-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:12px;background:var(--surface);margin-bottom:16px}' +
    '.rv-wrap table{border-collapse:collapse;width:100%;font-size:12.5px;min-width:760px}' +
    '.rv-wrap th,.rv-wrap td{padding:9px 10px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top;white-space:nowrap}' +
    '.rv-wrap th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);font-weight:700;position:sticky;top:0;background:var(--surface)}' +
    '.rv-wrap td.n,.rv-wrap th.n{text-align:right;font-variant-numeric:tabular-nums}' +
    '.rv-wrap tr.click{cursor:pointer}.rv-wrap tr.click:hover td{background:rgba(127,127,127,.07)}' +
    '.rv-wrap tfoot td{font-weight:700}' +
    '.rv-h{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:4px 0 8px}' +
    '.rv-h h3{margin:0;font-size:14px}' +
    '.rv-note{font-size:12px;color:var(--text-muted);line-height:1.45;margin:0 0 14px}' +
    '.rv-pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:rgba(127,127,127,.15)}' +
    '.rv-pill.paid{background:rgba(52,199,89,.16);color:var(--green)}.rv-pill.held{background:rgba(255,179,0,.16)}.rv-pill.refunded{background:rgba(229,72,77,.16)}' +
    '.rv-detail{position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '.rv-detail>div{background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:16px;max-width:520px;width:100%;max-height:85vh;overflow:auto;padding:18px}' +
    '.rv-detail dl{display:grid;grid-template-columns:150px 1fr;gap:6px 12px;font-size:13px;margin:12px 0}' +
    '.rv-detail dt{color:var(--text-muted)}.rv-detail dd{margin:0;word-break:break-all}';

  function ensureCss() {
    if ($('rvStyles')) return;
    var s = document.createElement('style');
    s.id = 'rvStyles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function card(val, label, sub, main) {
    return '<div class="rv-card' + (main ? ' main' : '') + '"><b>' + esc(val) + '</b><span>' + esc(label) + '</span>' +
      (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>';
  }

  function pill(r) {
    var cls = r.status === 'paid' || r.status === 'completed' ? 'paid' : r.status === 'held' ? 'held' : r.status === 'refunded' ? 'refunded' : '';
    return '<span class="rv-pill ' + cls + '">' + esc(r.statusLabel) + '</span>';
  }

  function render() {
    var host = $('section-revenue');
    if (!host) return;
    ensureCss();
    loadExtras();
    var b = rangeBounds();
    var rows = visibleRows();
    var gigRows = rows.filter(function (r) { return r.kind === 'gig'; });
    var t = totals(rows);
    var feePct = (window.QG_CONFIG && Number(window.QG_CONFIG.taskerFeePercent)) || 15;
    var rangeText = state.range === 'all' ? 'all time' : (b[0] + ' to ' + b[1]);

    var html = '<div class="rv-bar">' +
      '<select id="rvRange" aria-label="Date range">' +
        opt('month', 'This month') + opt('lastmonth', 'Last month') + opt('year', 'This year') +
        opt('lastyear', 'Last year') + opt('all', 'All time') + opt('custom', 'Pick dates') +
      '</select>' +
      (state.range === 'custom'
        ? '<input type="date" id="rvFrom" value="' + esc(state.from) + '" aria-label="From"><input type="date" id="rvTo" value="' + esc(state.to) + '" aria-label="To">'
        : '') +
      '<select id="rvKind" aria-label="Type">' +
        kopt('all', 'Everything') + kopt('gig', 'Gig payments') + kopt('tip', 'Tips') + kopt('cashout', 'Cash-outs') +
      '</select>' +
      '<input id="rvSearch" type="search" placeholder="Search gig, person, Stripe ID" value="' + esc(state.search) + '" style="flex:1 1 200px">' +
      '<button class="action-pill pill-export" id="rvCsv">Export transactions (CSV)</button>' +
      '<button class="action-pill pill-export" id="rvCsvMonths">Export monthly summary (CSV)</button>' +
    '</div>';

    html += '<p class="rv-note">Showing ' + esc(rangeText) + ', Alberta time. ' +
      'SwiftGigs earns a ' + feePct + '% fee from the tasker when a gig is completed. Tips go 100% to the tasker. ' +
      'Stripe\'s own processing fees are not stored here; see Stripe dashboard, Balance, Transactions.</p>';

    html += '<div class="rv-grid">' +
      card(money(t.fee), 'SwiftGigs fees earned', 'Your revenue on gigs completed in this period', true) +
      card(money(t.feePending), 'Fees still in escrow', 'Earned when those gigs are completed') +
      card(money(t.gross), 'Gross paid by posters', 'Held and paid gig payments, before refunds') +
      card(money(t.toTasker), 'Paid to taskers', 'Gig earnings released to taskers') +
      card(money(t.tip), 'Tips', 'Collected for taskers, not SwiftGigs revenue') +
      card(money(t.refunded), 'Refunded to posters', 'Gig payments returned') +
      card(String(t.paidGigs) + ' of ' + t.gigs, 'Gigs completed', 'Completed out of all paid gigs') +
      card(t.paidGigs ? money(t.fee / t.paidGigs) : '$0.00', 'Average fee per gig', '') +
    '</div>';

    html += monthsTable(rows);

    html += '<div class="rv-h"><h3>Transactions (' + rows.length + ')</h3>' +
      (extra.loading ? '<span class="rv-note" style="margin:0">Loading tips and cash-outs…</span>' : '') + '</div>';
    if (!rows.length) {
      html += '<p class="rv-note">Nothing in this period. Try another date range.</p>';
    } else {
      html += '<div class="rv-wrap"><table><thead><tr>' +
        '<th>Date</th><th>Type</th><th>Gig</th><th>Poster</th><th>Tasker</th>' +
        '<th class="n">Poster paid</th><th class="n">SwiftGigs fee</th><th class="n">To tasker</th><th class="n">Tip</th><th class="n">Refund</th>' +
        '<th>Status</th><th>Stripe ID</th></tr></thead><tbody>' +
        rows.map(function (r, i) {
          return '<tr class="click" data-rv-row="' + i + '">' +
            '<td>' + esc(stamp(r.date)) + '</td>' +
            '<td>' + (r.kind === 'gig' ? 'Gig' : r.kind === 'tip' ? 'Tip' : 'Cash-out') + '</td>' +
            '<td>' + esc(r.gig) + (r.city ? '<br><small style="color:var(--text-muted)">' + esc(r.city) + '</small>' : '') + '</td>' +
            '<td>' + esc(userName(r.posterId)) + '</td>' +
            '<td>' + esc(userName(r.workerId)) + '</td>' +
            '<td class="n">' + (r.kind === 'gig' ? money(r.gross || r.refunded) : '') + '</td>' +
            '<td class="n">' + (r.fee ? money(r.fee) : r.feePending ? '<span style="color:var(--text-muted)">' + money(r.feePending) + ' pending</span>' : '') + '</td>' +
            '<td class="n">' + (r.toTasker ? money(r.toTasker) : r.cashout ? money(r.cashout) : '') + '</td>' +
            '<td class="n">' + (r.tip ? money(r.tip) : '') + '</td>' +
            '<td class="n">' + (r.refunded ? money(r.refunded) : '') + '</td>' +
            '<td>' + pill(r) + '</td>' +
            '<td style="font-family:ui-monospace,monospace;font-size:11px">' + esc(String(r.stripe || '').slice(0, 22)) + (String(r.stripe || '').length > 22 ? '…' : '') + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody><tfoot><tr><td colspan="5">Total</td>' +
          '<td class="n">' + money(t.gross + t.refunded) + '</td><td class="n">' + money(t.fee) + '</td>' +
          '<td class="n">' + money(t.toTasker) + '</td><td class="n">' + money(t.tip) + '</td><td class="n">' + money(t.refunded) + '</td><td colspan="2"></td>' +
        '</tr></tfoot></table></div>';
    }

    host.innerHTML = html;
    host._rvRows = rows;
    wire(host);
  }

  function opt(v, label) { return '<option value="' + v + '"' + (state.range === v ? ' selected' : '') + '>' + label + '</option>'; }
  function kopt(v, label) { return '<option value="' + v + '"' + (state.kind === v ? ' selected' : '') + '>' + label + '</option>'; }

  function monthBuckets(rows) {
    var map = {};
    rows.forEach(function (r) {
      var k = ym(r.date);
      if (!k) return;
      var m = map[k] || (map[k] = { key: k, gigs: 0, gross: 0, fee: 0, feePending: 0, toTasker: 0, tip: 0, refunded: 0 });
      if (r.kind === 'gig' && r.status !== 'pending') m.gigs += 1;
      m.gross += r.gross; m.fee += r.fee; m.feePending += r.feePending; m.toTasker += r.toTasker;
      m.tip += r.tip; m.refunded += r.refunded;
    });
    return Object.keys(map).sort().reverse().map(function (k) { return map[k]; });
  }

  function monthsTable(rows) {
    var months = monthBuckets(rows);
    if (!months.length) return '';
    return '<div class="rv-h"><h3>By month</h3></div><div class="rv-wrap"><table style="min-width:620px"><thead><tr>' +
      '<th>Month</th><th class="n">Paid gigs</th><th class="n">Poster paid</th><th class="n">SwiftGigs fees</th>' +
      '<th class="n">Fees in escrow</th><th class="n">To taskers</th><th class="n">Tips</th><th class="n">Refunds</th></tr></thead><tbody>' +
      months.map(function (m) {
        return '<tr><td>' + esc(monthLabel(m.key)) + '</td><td class="n">' + m.gigs + '</td><td class="n">' + money(m.gross) +
          '</td><td class="n"><b>' + money(m.fee) + '</b></td><td class="n">' + money(m.feePending) + '</td><td class="n">' + money(m.toTasker) +
          '</td><td class="n">' + money(m.tip) + '</td><td class="n">' + money(m.refunded) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function wire(host) {
    var range = $('rvRange');
    if (range) range.onchange = function () { state.range = range.value; render(); };
    var from = $('rvFrom'), to = $('rvTo');
    if (from) from.onchange = function () { state.from = from.value; render(); };
    if (to) to.onchange = function () { state.to = to.value; render(); };
    var kind = $('rvKind');
    if (kind) kind.onchange = function () { state.kind = kind.value; render(); };
    var search = $('rvSearch');
    if (search) {
      var timer = null;
      search.oninput = function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          state.search = search.value;
          render();
          var again = $('rvSearch');
          if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
        }, 250);
      };
    }
    var csv = $('rvCsv');
    if (csv) csv.onclick = exportTransactions;
    var csvM = $('rvCsvMonths');
    if (csvM) csvM.onclick = exportMonths;
    host.querySelectorAll('[data-rv-row]').forEach(function (tr) {
      tr.onclick = function () { openDetail(host._rvRows[Number(tr.getAttribute('data-rv-row'))]); };
    });
  }

  function openDetail(r) {
    if (!r) return;
    var ov = document.createElement('div');
    ov.className = 'rv-detail';
    var items = [
      ['Type', r.kind === 'gig' ? 'Gig payment' : r.kind === 'tip' ? 'Tip' : 'Tasker cash-out'],
      ['Status', r.statusLabel],
      ['Date', stamp(r.date)],
      ['Completed / paid out', stamp(r.settled)],
      ['Gig', r.gig],
      ['Location', r.city],
      ['Poster', r.posterId ? userName(r.posterId) + (userEmail(r.posterId) ? ' (' + userEmail(r.posterId) + ')' : '') : ''],
      ['Tasker', r.workerId ? userName(r.workerId) + (userEmail(r.workerId) ? ' (' + userEmail(r.workerId) + ')' : '') : ''],
      ['Poster paid', r.kind === 'gig' ? money(r.gross || r.refunded) : ''],
      ['SwiftGigs fee', r.fee ? money(r.fee) : r.feePending ? money(r.feePending) + ' (pending)' : ''],
      ['To tasker', r.toTasker ? money(r.toTasker) : ''],
      ['Tip', r.tip ? money(r.tip) : ''],
      ['Refunded', r.refunded ? money(r.refunded) : ''],
      ['Cash-out amount', r.cashout ? money(r.cashout) : ''],
      ['Note', r.note || ''],
      ['Record ID', r.id],
      ['Gig ID', r.taskId],
      ['Stripe payment', r.stripe],
      ['Stripe transfer', r.transfer],
      ['Dispute', r.dispute]
    ].filter(function (x) { return x[1] !== '' && x[1] != null; });
    ov.innerHTML = '<div role="dialog" aria-modal="true" aria-label="Transaction details">' +
      '<div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0;font-size:16px">Transaction details</h3>' +
      '<button class="action-pill" data-x>Close</button></div>' +
      '<dl>' + items.map(function (x) { return '<dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd>'; }).join('') + '</dl>' +
      (r.stripe ? '<p class="rv-note">Look up the Stripe ID in your Stripe dashboard search bar to see the card charge, fees and payout.</p>' : '') +
      '</div>';
    ov.onclick = function (e) { if (e.target === ov || e.target.closest('[data-x]')) ov.remove(); };
    document.body.appendChild(ov);
  }

  /* ── CSV ─────────────────────────────────────────────────────────────── */
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;                 // spreadsheet formula guard
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function download(lines, name) {
    var blob = new Blob(['﻿' + lines.map(function (l) { return l.map(csvCell).join(','); }).join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    if (typeof showToast === 'function') showToast('Downloaded ' + name, 'green');
  }
  function rangeTag() {
    var b = rangeBounds();
    return state.range === 'all' ? 'all-time' : b[0] + '_to_' + b[1];
  }
  function fixed(n) { return n ? (Math.round(n * 100) / 100).toFixed(2) : '0.00'; }

  function exportTransactions() {
    var rows = visibleRows();
    var lines = [[
      'Date (Alberta)', 'Completed or paid out (Alberta)', 'Type', 'Status', 'Gig', 'Location',
      'Poster name', 'Poster email', 'Tasker name', 'Tasker email',
      'Poster paid (CAD)', 'SwiftGigs fee earned (CAD)', 'SwiftGigs fee pending (CAD)', 'Paid to tasker (CAD)',
      'Tip (CAD)', 'Refunded (CAD)', 'Cash-out (CAD)',
      'Record ID', 'Gig ID', 'Stripe payment ID', 'Stripe transfer ID', 'Dispute ID', 'Note'
    ]];
    rows.forEach(function (r) {
      lines.push([
        stamp(r.date), stamp(r.settled), r.kind === 'gig' ? 'Gig payment' : r.kind === 'tip' ? 'Tip' : 'Cash-out', r.statusLabel,
        r.gig, r.city,
        r.posterId ? userName(r.posterId) : '', r.posterId ? userEmail(r.posterId) : '',
        r.workerId ? userName(r.workerId) : '', r.workerId ? userEmail(r.workerId) : '',
        r.kind === 'gig' ? fixed(r.gross || r.refunded) : '', fixed(r.fee), fixed(r.feePending), fixed(r.toTasker),
        fixed(r.tip), fixed(r.refunded), fixed(r.cashout || 0),
        r.id, r.taskId, r.stripe, r.transfer, r.dispute, r.note || ''
      ]);
    });
    download(lines, 'swiftgigs-transactions_' + rangeTag() + '.csv');
  }

  function exportMonths() {
    var months = monthBuckets(visibleRows());
    var lines = [['Month', 'Paid gigs', 'Poster paid (CAD)', 'SwiftGigs fees earned (CAD)', 'Fees in escrow (CAD)', 'Paid to taskers (CAD)', 'Tips (CAD)', 'Refunds (CAD)']];
    months.forEach(function (m) {
      lines.push([monthLabel(m.key), m.gigs, fixed(m.gross), fixed(m.fee), fixed(m.feePending), fixed(m.toTasker), fixed(m.tip), fixed(m.refunded)]);
    });
    download(lines, 'swiftgigs-monthly-summary_' + rangeTag() + '.csv');
  }

  /* ── Tips and cash-outs ──────────────────────────────────────────────── */
  function loadExtras() {
    if (Array.isArray(window.adminTips)) extra.tips = window.adminTips;
    if (Array.isArray(window.adminPayouts)) extra.payouts = window.adminPayouts;
    if (extra.tips || extra.loading) return;
    // Older admin feed without tips: admins can read tips directly.
    if (typeof sbGetOrThrow !== 'function') { extra.tips = []; return; }
    extra.loading = true;
    sbGetOrThrow('tips', 'select=*', 'created_at.desc', 1000)
      .then(function (rows) { extra.tips = Array.isArray(rows) ? rows : []; })
      .catch(function () { extra.tips = []; })
      .then(function () {
        extra.loading = false;
        var sec = $('section-revenue');
        if (sec && sec.style.display !== 'none') render();
      });
  }

  window.QG_renderRevenueV2 = render;
})();
