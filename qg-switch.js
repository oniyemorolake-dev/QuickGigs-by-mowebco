/* SwiftGigs — the "switching" moment between Poster and Tasker.
   A short full-screen card so there is no doubt which side you are on now:
   shown the instant you switch, and it carries across the page change. */
(function () {
  'use strict';

  var FLAG = 'qg-switching';
  var COPY = {
    tasker: { name: 'Tasker', line: 'Find gigs near you and get paid.', from: 'Poster' },
    poster: { name: 'Poster', line: 'Post a gig and get it done.', from: 'Tasker' }
  };

  function css() {
    if (document.getElementById('qgSwitchCss')) return;
    var s = document.createElement('style');
    s.id = 'qgSwitchCss';
    s.textContent =
      '.qg-sw{position:fixed;inset:0;z-index:13000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;text-align:center;color:#fff;opacity:0;transition:opacity .14s ease;}' +
      '.qg-sw.in{opacity:1;}' +
      '.qg-sw[data-to="tasker"]{background:linear-gradient(160deg,#0f766e,#14b8a6);}' +
      '.qg-sw[data-to="poster"]{background:linear-gradient(160deg,#5b21b6,#8b5cf6);}' +
      '.qg-sw-logo{width:92px;height:92px;border-radius:26px;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 14px 36px rgba(0,0,0,.25);animation:qgSwHop .7s ease-in-out infinite;}' +
      '.qg-sw-logo img{width:64px;height:64px;object-fit:contain;}' +
      '.qg-sw-shadow{width:60px;height:8px;border-radius:50%;background:rgba(0,0,0,.22);margin-top:-8px;animation:qgSwShadow .7s ease-in-out infinite;}' +
      '.qg-sw-pill{position:relative;display:flex;width:220px;height:44px;border-radius:22px;background:rgba(255,255,255,.2);font-size:14px;font-weight:700;}' +
      '.qg-sw-pill span{flex:1;display:flex;align-items:center;justify-content:center;position:relative;z-index:1;transition:color .2s ease;}' +
      '.qg-sw-pill i{position:absolute;top:4px;left:4px;width:106px;height:36px;border-radius:18px;background:#fff;transition:transform .28s cubic-bezier(.3,1.4,.5,1);}' +
      '.qg-sw-pill.right i{transform:translateX(106px);}' +
      '.qg-sw-pill .on{color:#1f1147;}' +
      '.qg-sw h2{margin:0;font-size:24px;font-weight:700;}' +
      '.qg-sw p{margin:-8px 0 0;font-size:15px;opacity:.92;}' +
      '@keyframes qgSwHop{0%,100%{transform:translateY(0) rotate(0)}40%{transform:translateY(-16px) rotate(-5deg)}60%{transform:translateY(-16px) rotate(5deg)}}' +
      '@keyframes qgSwShadow{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.7);opacity:.6}}' +
      '@media (prefers-reduced-motion:reduce){.qg-sw-logo,.qg-sw-shadow{animation:none}.qg-sw-pill i{transition:none}}';
    document.head.appendChild(s);
  }

  function build(to, arrived) {
    css();
    var c = COPY[to];
    var el = document.createElement('div');
    el.className = 'qg-sw';
    el.setAttribute('data-to', to);
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    // Poster sits on the left of the pill, Tasker on the right.
    var startRight = arrived ? to === 'tasker' : to !== 'tasker';
    el.innerHTML =
      '<div class="qg-sw-logo"><img src="/QuickGigsLogo.png" alt=""></div><div class="qg-sw-shadow"></div>' +
      '<div class="qg-sw-pill' + (startRight ? ' right' : '') + '"><i></i>' +
        '<span data-side="poster">Poster</span><span data-side="tasker">Tasker</span></div>' +
      '<h2>' + (arrived ? 'You are now a ' + c.name : 'Switching to ' + c.name) + '</h2>' +
      '<p>' + c.line + '</p>';
    document.body.appendChild(el);
    function mark(side) {
      el.querySelectorAll('[data-side]').forEach(function (s) { s.classList.toggle('on', s.getAttribute('data-side') === side); });
    }
    mark(startRight ? 'tasker' : 'poster');
    requestAnimationFrame(function () {
      el.classList.add('in');
      if (!arrived) setTimeout(function () {
        el.querySelector('.qg-sw-pill').classList.toggle('right', to === 'tasker');
        mark(to);
      }, 90);
    });
    return el;
  }
  function leave(el, after) {
    setTimeout(function () {
      el.classList.remove('in');
      setTimeout(function () { el.remove(); }, 160);
    }, after);
  }

  /**
   * Show the switching card. With opts.navigate the card stays up while the
   * next page loads, and that page finishes the moment. Without it (switching
   * in place) it plays once and fades. Resolves when it is safe to continue.
   */
  var current = null;
  function show(next, opts) {
    opts = opts || {};
    var to = next === 'tasker' || next === 'worker' ? 'tasker' : 'poster';
    // Already showing (opened on tap, before the server answered): reuse it.
    if (current && current.to === to && current.el.isConnected) {
      if (opts.navigate) { try { sessionStorage.setItem(FLAG, to); } catch (e) {} }
      var wait = Math.max(0, 380 - (Date.now() - current.at));
      return new Promise(function (r) { setTimeout(r, wait); });
    }
    var el = build(to, false);
    current = { el: el, to: to, at: Date.now() };
    if (typeof window.haptic === 'function') { try { window.haptic([8, 30, 8]); } catch (e) {} }
    return new Promise(function (resolve) {
      if (opts.navigate) {
        try { sessionStorage.setItem(FLAG, to); } catch (e) {}
        setTimeout(resolve, 380);
      } else if (opts.hold) {
        resolve();                                   // caller finishes it with show(..., {navigate}) or cancel()
      } else {
        setTimeout(function () {
          el.querySelector('h2').textContent = 'You are now a ' + COPY[to].name;
          leave(el, 450);
          current = null;
          resolve();
        }, 420);
      }
    });
  }

  // Arriving from a switch: finish it on the new page.
  function landed() {
    var to = null;
    try { to = sessionStorage.getItem(FLAG); sessionStorage.removeItem(FLAG); } catch (e) {}
    if (to !== 'tasker' && to !== 'poster') return;
    leave(build(to, true), 550);
  }

  /** The switch failed: take the card away and forget it. */
  function cancel() {
    try { sessionStorage.removeItem(FLAG); } catch (e) {}
    if (current && current.el.isConnected) leave(current.el, 0);
    current = null;
  }

  window.QG_modeSwitchScreen = show;
  window.QG_modeSwitchCancel = cancel;
  if (document.body) landed(); else document.addEventListener('DOMContentLoaded', landed);
})();
