/* SwiftGigs — visit streak.
 *
 * Extracted from qg-wave2.js so the rebuilt pages can read the streak without
 * loading an injector. Same localStorage key and same stored shape, so a
 * streak started on an injector page continues here and vice versa.
 *
 * One deliberate difference: the day boundary is local, not UTC. qg-wave2.js
 * used toISOString().slice(0,10), which rolls over at 6pm in Calgary and 5pm
 * in BC, so an evening visit counted as the next day and could break a streak
 * the user had actually kept. This is the same trap qg-utils.js documents for
 * parseQgTimestamp.
 */
(function () {
  'use strict';

  var STREAK_KEY = 'qg-streak';

  function localDay(d) {
    d = d || new Date();
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
  }

  function read() {
    try {
      var raw = localStorage.getItem(STREAK_KEY);
      if (!raw) return { lastDate: '', count: 0 };
      var p = JSON.parse(raw);
      return p && typeof p === 'object' ? p : { lastDate: '', count: 0 };
    } catch (e) {
      return { lastDate: '', count: 0 };
    }
  }

  function write(data) {
    try { localStorage.setItem(STREAK_KEY, JSON.stringify(data)); } catch (e) {}
  }

  /* Records today's visit and returns { lastDate, count }. Safe to call more
     than once a day: the second call is a no-op that returns the same count. */
  window.qgTouchStreak = function () {
    var today = localDay();
    var data = read();
    if (data.lastDate === today) return data;

    var y = new Date();
    y.setDate(y.getDate() - 1);
    if (data.lastDate === localDay(y)) data.count = (data.count || 0) + 1;
    else data.count = 1;

    data.lastDate = today;
    write(data);

    if ([3, 7, 14, 30].indexOf(data.count) >= 0 && typeof window.qgCelebrate === 'function') {
      window.qgCelebrate({ count: 40 });
    }
    return data;
  };

  /* Reads the count without recording a visit. */
  window.qgStreakCount = function () {
    return read().count || 0;
  };
})();
