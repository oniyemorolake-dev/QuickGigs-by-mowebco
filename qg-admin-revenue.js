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
    s.textContent = CSS + DASH_CSS;
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

    html += dashboardHtml(rows);

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
    wireTips(host);
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

  /* ── Dashboard charts ────────────────────────────────────────────────
     Plain SVG, no chart library. Colours are the validated categorical set
     (checked for colour-blind separation in light and dark); every mark has
     a hover tooltip and every chart carries its numbers as text too. */
  var DASH_CSS = '' +
    '.rv-dash{--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--s5:#d55181;--sOther:#8a8a85;--grid:rgba(127,127,127,.18)}' +
    'html.light .rv-dash,body.light .rv-dash{--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--s5:#e87ba4;--sOther:#a3a29c}' +
    '.rv-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:12px}' +
    '.rv-kpi{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 14px;text-align:center}' +
    '.rv-kpi h4{margin:0 0 6px;font-size:12.5px;font-weight:600;color:var(--text-muted)}' +
    '.rv-kpi .a{font-size:22px;font-weight:700;color:var(--green);font-variant-numeric:tabular-nums}' +
    '.rv-kpi .al{font-size:10.5px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}' +
    '.rv-kpi .c{font-size:18px;font-weight:700;margin-top:8px;font-variant-numeric:tabular-nums}' +
    '.rv-kpi.hero{border-color:var(--green)}' +
    '.rv-kpi .d{font-size:11px;margin-top:3px;color:var(--text-muted)}.rv-kpi .d.up{color:var(--green)}.rv-kpi .d.down{color:var(--danger,#e5484d)}' +
    '.rv-panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:10px;margin-bottom:16px}' +
    '.rv-panel{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px}' +
    '.rv-panel h4{margin:0 0 2px;font-size:13.5px;font-weight:700}' +
    '.rv-panel p{margin:0 0 10px;font-size:11.5px;color:var(--text-muted)}' +
    '.rv-hbar{display:grid;grid-template-columns:118px 1fr 74px;align-items:center;gap:8px;font-size:12.5px;margin:7px 0}' +
    '.rv-hbar .l{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.rv-hbar .v{text-align:right;font-variant-numeric:tabular-nums;color:var(--text-muted)}' +
    '.rv-hbar .track{height:14px;border-radius:4px;background:var(--grid);position:relative}' +
    '.rv-hbar .fill{position:absolute;left:0;top:0;bottom:0;border-radius:0 4px 4px 0;min-width:3px}' +
    '.rv-legend{list-style:none;margin:0;padding:0;font-size:12.5px}' +
    '.rv-legend li{display:flex;align-items:center;gap:8px;margin:6px 0}' +
    '.rv-legend i{width:10px;height:10px;border-radius:3px;flex:none}' +
    '.rv-legend b{margin-left:auto;font-weight:600;font-variant-numeric:tabular-nums}' +
    '.rv-legend small{color:var(--text-muted);width:40px;text-align:right}' +
    '.rv-donut{display:flex;gap:16px;align-items:center;flex-wrap:wrap}' +
    '.rv-empty{font-size:12.5px;color:var(--text-muted);padding:18px 0;text-align:center}' +
    '.rv-tip{position:fixed;z-index:6000;pointer-events:none;background:#111;color:#fff;font-size:12px;line-height:1.4;padding:6px 9px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.3);max-width:240px;display:none}';

  var SLOTS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];

  function prettyCat(c) {
    var s = String(c || '').trim();
    if (!s) return 'Other';
    s = s.replace(/[_-]+/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function taskOf(id) {
    return (window.tasks || []).find(function (x) { return String(x.task_id || x.id) === String(id); }) || null;
  }
  function cityOf(loc) {
    var c = String(loc || '').split(',')[0].trim();
    return c || 'Unknown';
  }
  function pct(a, b) { return b ? Math.round(a / b * 100) + '%' : '0%'; }

  /* Same-length window just before the selected one, for the "vs previous" line. */
  function prevRows() {
    if (state.range === 'all') return null;
    var b = rangeBounds();
    if (b[0] < '1000' || b[1] > '9000') return null;
    var start = new Date(b[0] + 'T12:00:00'), end = new Date(b[1] + 'T12:00:00');
    var days = Math.round((end - start) / 86400000) + 1;
    if (state.range === 'month' || state.range === 'lastmonth') {
      // compare with the whole previous calendar month
      var pm = new Date(start.getFullYear(), start.getMonth() - 1, 1);
      var pEnd = new Date(start.getFullYear(), start.getMonth(), 0);
      if (state.range === 'month') pEnd = new Date(pm.getFullYear(), pm.getMonth(), Math.min(end.getDate(), pEnd.getDate()));
      return slice(fmtD(pm), fmtD(pEnd));
    }
    if (state.range === 'year' || state.range === 'lastyear') {
      return slice((start.getFullYear() - 1) + b[0].slice(4), (end.getFullYear() - 1) + b[1].slice(4));
    }
    var pe = new Date(start.getTime() - 86400000), ps = new Date(start.getTime() - days * 86400000);
    return slice(fmtD(ps), fmtD(pe));
    function fmtD(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
    function slice(a, z) { return ledger().filter(function (r) { var d = ymd(r.date); return d && d >= a && d <= z; }); }
  }
  function delta(now, before) {
    if (before == null) return '';
    if (!before && !now) return '<div class="d">No change vs previous</div>';
    if (!before) return '<div class="d up">New this period</div>';
    var ch = Math.round((now - before) / before * 100);
    if (!ch) return '<div class="d">Same as previous</div>';
    return '<div class="d ' + (ch > 0 ? 'up' : 'down') + '">' + (ch > 0 ? '+' : '') + ch + '% vs previous</div>';
  }

  function kpi(title, amount, count, countLabel, hero, change) {
    return '<div class="rv-kpi' + (hero ? ' hero' : '') + '"><h4>' + esc(title) + '</h4>' +
      '<div class="a">' + esc(amount) + '</div><div class="al">Amount</div>' + (change || '') +
      '<div class="c">' + esc(count) + '</div><div class="al">' + esc(countLabel || 'Gigs') + '</div></div>';
  }

  function hbars(items, color, fmt) {
    if (!items.length) return '<div class="rv-empty">No data in this period</div>';
    var max = Math.max.apply(null, items.map(function (x) { return x.value; })) || 1;
    return items.map(function (x) {
      var w = Math.max(1, Math.round(x.value / max * 100));
      return '<div class="rv-hbar"><span class="l" title="' + esc(x.label) + '">' + esc(x.label) + '</span>' +
        '<span class="track" data-tip="' + esc(x.label + ': ' + fmt(x.value) + (x.extra ? ' · ' + x.extra : '')) + '">' +
        '<span class="fill" style="width:' + w + '%;background:' + color + '"></span></span>' +
        '<span class="v">' + esc(fmt(x.value)) + '</span></div>';
    }).join('');
  }

  function donut(slices, total) {
    if (!total) return '<div class="rv-empty">No paid gigs in this period</div>';
    var R = 54, r = 34, cx = 64, cy = 64, a0 = -Math.PI / 2;
    var paths = slices.map(function (s, i) {
      var frac = s.value / total;
      var a1 = a0 + frac * Math.PI * 2;
      var d;
      if (frac >= 0.9999) {
        d = 'M' + (cx + R) + ' ' + cy + 'A' + R + ' ' + R + ' 0 1 1 ' + (cx - R) + ' ' + cy + 'A' + R + ' ' + R + ' 0 1 1 ' + (cx + R) + ' ' + cy +
          'M' + (cx + r) + ' ' + cy + 'A' + r + ' ' + r + ' 0 1 0 ' + (cx - r) + ' ' + cy + 'A' + r + ' ' + r + ' 0 1 0 ' + (cx + r) + ' ' + cy + 'Z';
      } else {
        var big = frac > 0.5 ? 1 : 0;
        var p = function (rad, a) { return (cx + rad * Math.cos(a)).toFixed(2) + ' ' + (cy + rad * Math.sin(a)).toFixed(2); };
        d = 'M' + p(R, a0) + 'A' + R + ' ' + R + ' 0 ' + big + ' 1 ' + p(R, a1) + 'L' + p(r, a1) + 'A' + r + ' ' + r + ' 0 ' + big + ' 0 ' + p(r, a0) + 'Z';
      }
      a0 = a1;
      return '<path d="' + d + '" fill="' + s.color + '" stroke="var(--surface)" stroke-width="2" fill-rule="evenodd" data-tip="' +
        esc(s.label + ': ' + money(s.value) + ' (' + pct(s.value, total) + ')') + '"></path>';
    }).join('');
    var svg = '<svg viewBox="0 0 128 128" width="150" height="150" role="img" aria-label="Gross by category">' + paths +
      '<text x="64" y="61" text-anchor="middle" font-size="9" fill="currentColor" opacity=".65">Total</text>' +
      '<text x="64" y="75" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">' + esc(money(total)) + '</text></svg>';
    var legend = '<ul class="rv-legend" style="flex:1;min-width:170px">' + slices.map(function (s) {
      return '<li><i style="background:' + s.color + '"></i>' + esc(s.label) + '<b>' + esc(money(s.value)) + '</b><small>' + pct(s.value, total) + '</small></li>';
    }).join('') + '</ul>';
    return '<div class="rv-donut">' + svg + legend + '</div>';
  }

  function columns(months) {
    if (!months.length) return '<div class="rv-empty">No fees in this period</div>';
    var W = 320, H = 150, padL = 4, padB = 22, padT = 18;
    var max = Math.max.apply(null, months.map(function (m) { return m.fee + m.feePending; })) || 1;
    var slot = (W - padL) / months.length;
    var bw = Math.max(6, Math.min(34, slot * 0.6));
    var plotH = H - padB - padT;
    var bars = months.map(function (m, i) {
      var x = padL + i * slot + (slot - bw) / 2;
      var hEarned = m.fee / max * plotH;
      var hPend = m.feePending / max * plotH;
      var base = H - padB;
      var label = monthLabel(m.key);
      var short = label.split(' ')[0].slice(0, 3);
      var out = '';
      // earned at the baseline, escrow stacked above it with a 2px gap
      if (hEarned > 0) out += '<rect x="' + x.toFixed(1) + '" y="' + (base - hEarned).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hEarned.toFixed(1) +
        '" rx="' + (hPend > 0 ? 0 : 4) + '" fill="var(--s1)" data-tip="' + esc(label + ' · fees earned ' + money(m.fee)) + '"></rect>';
      if (hPend > 0) out += '<rect x="' + x.toFixed(1) + '" y="' + (base - hEarned - hPend - (hEarned > 0 ? 2 : 0)).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hPend.toFixed(1) +
        '" rx="4" fill="var(--s3)" data-tip="' + esc(label + ' · fees in escrow ' + money(m.feePending)) + '"></rect>';
      // invisible, larger hit area for the whole month
      out += '<rect x="' + (padL + i * slot).toFixed(1) + '" y="' + padT + '" width="' + slot.toFixed(1) + '" height="' + plotH + '" fill="transparent" data-tip="' +
        esc(label + ' · earned ' + money(m.fee) + ' · in escrow ' + money(m.feePending) + ' · ' + m.gigs + ' paid gigs') + '"></rect>';
      out += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="currentColor" opacity=".6">' + esc(short) + '</text>';
      if (i === months.length - 1 && m.fee + m.feePending > 0) {
        out += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (base - hEarned - hPend - 6).toFixed(1) + '" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor">' +
          esc(money(m.fee + m.feePending)) + '</text>';
      }
      return out;
    }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" aria-label="Fees by month" style="overflow:visible">' +
      '<line x1="0" x2="' + W + '" y1="' + (H - padB) + '" y2="' + (H - padB) + '" stroke="var(--grid)"></line>' + bars + '</svg>' +
      '<ul class="rv-legend" style="display:flex;gap:16px"><li><i style="background:var(--s1)"></i>Fees earned</li><li><i style="background:var(--s3)"></i>Fees in escrow</li></ul>';
  }

  function funnel() {
    var b = rangeBounds();
    var inR = function (v) { var d = ymd(toDate(v)); return d && d >= b[0] && d <= b[1]; };
    var gigs = (window.tasks || []).filter(function (t) { return inR(t.created_at); });
    var ids = {};
    gigs.forEach(function (t) { ids[String(t.task_id || t.id)] = t; });
    var applied = {}, accepted = {};
    (window.applications || []).forEach(function (a) {
      var id = String(a.task_id);
      if (!ids[id]) return;
      applied[id] = true;
      if (String(a.status || '').toLowerCase() === 'accepted') accepted[id] = true;
    });
    gigs.forEach(function (t) {
      var st = String(t.status || '').toLowerCase();
      if (st === 'in_progress' || st === 'completed') { accepted[String(t.task_id || t.id)] = true; applied[String(t.task_id || t.id)] = true; }
    });
    var paid = {}, done = {};
    (window.payments || []).forEach(function (p) {
      var id = String(p.task_id); var st = String(p.status || '').toLowerCase();
      if (!ids[id]) return;
      if (st === 'held' || st === 'paid' || st === 'completed') paid[id] = true;
      if (st === 'paid' || st === 'completed') done[id] = true;
    });
    var n = gigs.length;
    var steps = [
      ['Posted', n], ['Got applicants', Object.keys(applied).length], ['Tasker accepted', Object.keys(accepted).length],
      ['Paid into escrow', Object.keys(paid).length], ['Completed', Object.keys(done).length]
    ];
    if (!n) return '<div class="rv-empty">No gigs posted in this period</div>';
    return steps.map(function (s) {
      var w = Math.max(1, Math.round(s[1] / n * 100));
      return '<div class="rv-hbar"><span class="l">' + esc(s[0]) + '</span>' +
        '<span class="track" data-tip="' + esc(s[0] + ': ' + s[1] + ' gigs (' + pct(s[1], n) + ' of posted)') + '">' +
        '<span class="fill" style="width:' + w + '%;background:var(--s1)"></span></span>' +
        '<span class="v">' + s[1] + ' · ' + pct(s[1], n) + '</span></div>';
    }).join('');
  }

  function dashboardHtml(rows) {
    var gig = rows.filter(function (r) { return r.kind === 'gig'; });
    function sum(list, f) { return list.reduce(function (a, r) { return a + f(r); }, 0); }
    var held = gig.filter(function (r) { return r.status === 'held'; });
    var done = gig.filter(function (r) { return r.status === 'paid' || r.status === 'completed'; });
    var refunded = gig.filter(function (r) { return r.status === 'refunded'; });
    var live = held.concat(done);
    var tips = rows.filter(function (r) { return r.kind === 'tip' && r.tip; });
    var fees = sum(done, function (r) { return r.fee; });
    var prev = prevRows();
    function was(filterFn, valFn) {
      if (!prev) return null;
      return sum(prev.filter(filterFn), valFn);
    }
    var isGig = function (st) { return function (r) { return r.kind === 'gig' && st.indexOf(r.status) >= 0; }; };

    var html = '<div class="rv-dash"><div class="rv-kpis">' +
      kpi('SwiftGigs fees earned', money(fees), done.length ? money(fees / done.length) : '$0.00', 'Average per gig', true,
        delta(fees, was(isGig(['paid', 'completed']), function (r) { return r.fee; }))) +
      kpi('In escrow', money(sum(held, function (r) { return r.gross; })), held.length, 'Gigs', false,
        delta(sum(held, function (r) { return r.gross; }), was(isGig(['held']), function (r) { return r.gross; }))) +
      kpi('Completed', money(sum(done, function (r) { return r.gross; })), done.length, 'Gigs', false,
        delta(sum(done, function (r) { return r.gross; }), was(isGig(['paid', 'completed']), function (r) { return r.gross; }))) +
      kpi('Refunded', money(sum(refunded, function (r) { return r.refunded; })), refunded.length, 'Gigs', false,
        delta(sum(refunded, function (r) { return r.refunded; }), was(isGig(['refunded']), function (r) { return r.refunded; }))) +
      kpi('Total paid by posters', money(sum(gig, function (r) { return r.gross; })), gig.filter(function (r) { return r.status !== 'pending'; }).length, 'Gigs', false,
        delta(sum(gig, function (r) { return r.gross; }), was(function (r) { return r.kind === 'gig'; }, function (r) { return r.gross; }))) +
      kpi('Tips to taskers', money(sum(tips, function (r) { return r.tip; })), tips.length, 'Tips', false,
        delta(sum(tips, function (r) { return r.tip; }), was(function (r) { return r.kind === 'tip'; }, function (r) { return r.tip; }))) +
    '</div><div class="rv-panels">';

    html += '<div class="rv-panel"><h4>Gig funnel</h4><p>Gigs posted in this period, and how far they got</p>' + funnel() + '</div>';

    // Gross by category: top four + Other, colour fixed to the category's rank in this view.
    var byCat = {};
    live.forEach(function (r) { var t = taskOf(r.taskId); var c = prettyCat(t && t.category); byCat[c] = (byCat[c] || 0) + r.gross; });
    var cats = Object.keys(byCat).map(function (k) { return { label: k, value: byCat[k] }; }).sort(function (a, b) { return b.value - a.value; });
    var slices = cats.slice(0, 4).map(function (c, i) { return { label: c.label, value: c.value, color: SLOTS[i] }; });
    var rest = cats.slice(4).reduce(function (a, c) { return a + c.value; }, 0);
    if (rest > 0) slices.push({ label: 'Other', value: rest, color: 'var(--sOther)' });
    html += '<div class="rv-panel"><h4>By category</h4><p>What posters paid, held and completed gigs</p>' +
      donut(slices, sum(live, function (r) { return r.gross; })) + '</div>';

    var byCity = {}, cityCount = {};
    live.forEach(function (r) { var c = cityOf(r.city); byCity[c] = (byCity[c] || 0) + r.gross; cityCount[c] = (cityCount[c] || 0) + 1; });
    var cities = Object.keys(byCity).map(function (k) { return { label: k, value: byCity[k], extra: cityCount[k] + ' gigs' }; })
      .sort(function (a, b) { return b.value - a.value; }).slice(0, 6);
    html += '<div class="rv-panel"><h4>By city</h4><p>What posters paid, top six cities</p>' + hbars(cities, 'var(--s1)', money) + '</div>';

    var months = monthBuckets(rows).slice().reverse();
    html += '<div class="rv-panel"><h4>Fees by month</h4><p>Your revenue, earned and still in escrow</p>' + columns(months) + '</div>';

    return html + '</div></div>';
  }

  function wireTips(host) {
    var tip = document.getElementById('rvTip');
    if (!tip) { tip = document.createElement('div'); tip.id = 'rvTip'; tip.className = 'rv-tip'; document.body.appendChild(tip); }
    function show(e) {
      var el = e.target.closest && e.target.closest('[data-tip]');
      if (!el || !host.contains(el)) { tip.style.display = 'none'; return; }
      tip.textContent = el.getAttribute('data-tip');
      tip.style.display = 'block';
      var x = e.clientX + 12, y = e.clientY + 12;
      var w = tip.offsetWidth, h = tip.offsetHeight;
      if (x + w > window.innerWidth - 8) x = e.clientX - w - 12;
      if (y + h > window.innerHeight - 8) y = e.clientY - h - 12;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    }
    host.onmousemove = show;
    host.onmouseleave = function () { tip.style.display = 'none'; };
    host.ontouchstart = function (e) { if (e.touches && e.touches[0]) show({ target: e.target, clientX: e.touches[0].clientX, clientY: e.touches[0].clientY }); };
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
