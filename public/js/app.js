/* Oikres site script. Plain JavaScript, no dependencies. Everything works without it except saving for guests, uploads and the filter sheet. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var meta = $('meta[name=csrf-token]');
  var csrf = meta ? meta.getAttribute('content') : '';
  var authed = document.body.getAttribute('data-auth') === '1';

  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { /* storage can be blocked; the site still works */ }
    return null;
  }
  function post(url, data) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify(data || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.');
        return j;
      });
    });
  }
  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  window.Oikres = { post: post, toast: toast, csrf: csrf };

  /* Saved lodges: account when signed in, this device when not */
  var SAVED = 'oikres:saved';
  function localSaved() { return store(SAVED) || []; }
  function setHeart(btn, on) {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', on ? 'Remove from saved' : 'Save lodge');
  }
  function markHearts(root) {
    if (authed) return;
    var ids = localSaved();
    $$('[data-heart]', root).forEach(function (b) { setHeart(b, ids.indexOf(b.getAttribute('data-heart')) > -1); });
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-heart]');
    if (!btn) return;
    e.preventDefault();
    var id = btn.getAttribute('data-heart');
    if (authed) {
      post('/api/wishlist/' + id + '/toggle').then(function (r) {
        $$('[data-heart="' + id + '"]').forEach(function (b) { setHeart(b, r.saved); });
        toast(r.saved ? 'Saved' : 'Removed from saved');
        if (r.saved) maybeInstall();
      }).catch(function (err) { toast(err.message); });
    } else {
      var ids = localSaved();
      var at = ids.indexOf(id);
      if (at > -1) ids.splice(at, 1); else ids.push(id);
      store(SAVED, ids);
      $$('[data-heart="' + id + '"]').forEach(function (b) { setHeart(b, at === -1); });
      toast(at === -1 ? 'Saved on this device' : 'Removed from saved');
      if (at === -1) maybeInstall();
    }
  });
  /* Saved market items: always an account feature, so a visitor is sent to sign in first */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-item-heart]');
    if (!btn) return;
    e.preventDefault();
    if (!authed) { location.href = '/login?returnTo=' + encodeURIComponent(location.pathname + location.search); return; }
    var slug = btn.getAttribute('data-item-heart');
    post('/market/' + slug + '/save').then(function (r) {
      $$('[data-item-heart="' + slug + '"]').forEach(function (b) { b.setAttribute('aria-pressed', r.saved ? 'true' : 'false'); b.setAttribute('aria-label', r.saved ? 'Remove from saved' : 'Save item'); });
      toast(r.saved ? 'Saved' : 'Removed from saved');
    }).catch(function (err) { toast(err.message); });
  });
  markHearts(document);
  if (authed && localSaved().length) {
    post('/api/wishlist/merge', { ids: localSaved() }).then(function () { store(SAVED, []); }).catch(function () {});
  }

  /* Filter sheet (mobile) */
  var lastFocus;
  function sheet(id, open) {
    var s = document.getElementById(id);
    var bd = $('.sheet-backdrop[data-close="' + id + '"]');
    if (!s) return;
    s.classList.toggle('open', open);
    if (bd) bd.classList.toggle('open', open);
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) { lastFocus = document.activeElement; var f = $('input,select,button', s); if (f) f.focus(); }
    else if (lastFocus) lastFocus.focus();
  }
  document.addEventListener('click', function (e) {
    var o = e.target.closest('[data-open]');
    if (o) { e.preventDefault(); sheet(o.getAttribute('data-open'), true); return; }
    var c = e.target.closest('[data-close]');
    if (c) { e.preventDefault(); sheet(c.getAttribute('data-close'), false); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') $$('.filters.open').forEach(function (s) { sheet(s.id, false); });
  });

  /* Auto-submit quick filters */
  document.addEventListener('change', function (e) {
    var el = e.target.closest('[data-autosubmit]');
    if (el && el.form) el.form.submit();
  });

  /* Show more lodges without a full page load */
  function inject(html, grid) {
    var t = document.createElement('template');
    t.innerHTML = html;
    var marker = t.content.querySelector('[data-next]');
    var next = marker ? marker.getAttribute('data-next') : '';
    if (marker) marker.parentNode.removeChild(marker);
    grid.appendChild(t.content);
    markHearts(grid);
    return next;
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-load-more]');
    var grid = $('#grid');
    if (!a || !grid) return;
    e.preventDefault();
    a.setAttribute('aria-busy', 'true');
    var u = new URL(a.href, location.href);
    u.searchParams.set('partial', '1');
    fetch(u.toString(), { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error(); return r.text(); })
      .then(function (html) {
        var next = inject(html, grid);
        var pager = $('#pager');
        var prev = $('[data-prev]');
        if (prev) prev.hidden = true;
        if (next) { a.href = next; a.removeAttribute('aria-busy'); } else if (pager) pager.hidden = true;
      })
      .catch(function () { a.removeAttribute('aria-busy'); location.href = a.href; });
  });

  /* Saved page for guests */
  var guestGrid = $('#saved-guest');
  if (guestGrid) {
    var ids = localSaved();
    var empty = $('#saved-empty');
    if (!ids.length) { if (empty) empty.hidden = false; }
    else {
      fetch('/api/saved-cards?ids=' + encodeURIComponent(ids.join(',')), { credentials: 'same-origin' })
        .then(function (r) { return r.text(); })
        .then(function (html) {
          inject(html, guestGrid);
          if (!guestGrid.children.length && empty) empty.hidden = false;
        }).catch(function () { if (empty) empty.hidden = false; });
    }
  }

  /* Share, back, confirm */
  document.addEventListener('click', function (e) {
    var s = e.target.closest('[data-share]');
    if (s) {
      e.preventDefault();
      var data = { title: document.title, url: s.getAttribute('data-share') || location.href };
      if (navigator.share) navigator.share(data).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(data.url).then(function () { toast('Link copied'); });
      return;
    }
    var b = e.target.closest('[data-back]');
    if (b && history.length > 1 && document.referrer && new URL(document.referrer).origin === location.origin) {
      e.preventDefault();
      history.back();
    }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.hasAttribute && f.hasAttribute('data-confirm') && !window.confirm(f.getAttribute('data-confirm'))) e.preventDefault();
  });

  /* "Did the agent reply?" after returning from WhatsApp */
  var prompt = $('#reply-prompt');
  document.addEventListener('click', function (e) {
    var w = e.target.closest('.js-wa');
    if (w) store('oikres:wa', { id: w.getAttribute('data-listing'), t: Date.now() });
  });
  function checkReply() {
    if (!prompt) return;
    var w = store('oikres:wa');
    if (!w || w.id !== prompt.getAttribute('data-listing')) return;
    var age = Date.now() - w.t;
    if (age > 8000 && age < 3600000) prompt.hidden = false;
  }
  if (prompt) {
    document.addEventListener('visibilitychange', function () { if (!document.hidden) checkReply(); });
    window.addEventListener('pageshow', checkReply);
    prompt.addEventListener('click', function (e) {
      var b = e.target.closest('[data-reply]');
      if (!b) return;
      post('/api/lodges/' + prompt.getAttribute('data-listing') + '/feedback', { replied: b.getAttribute('data-reply') === 'yes' }).catch(function () {});
      store('oikres:wa', null);
      prompt.hidden = true;
      toast('Thanks for letting us know');
    });
  }

  /* Install prompt: only after the third visit or the first saved lodge, never on first load */
  var deferred;
  var banner = $('#install');
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  try {
    if (!sessionStorage.getItem('oikres:counted')) {
      sessionStorage.setItem('oikres:counted', '1');
      store('oikres:visits', (store('oikres:visits') || 0) + 1);
    }
  } catch (e) {}
  function dismissed() { var t = store('oikres:install-no'); return t && Date.now() - t < 14 * 86400000; }
  function maybeInstall() {
    if (!banner || standalone || dismissed() || document.body.hasAttribute('data-no-install')) return;
    var eligible = (store('oikres:visits') || 0) >= 3 || localSaved().length > 0;
    if (!eligible) return;
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (deferred) { banner.hidden = false; }
    else if (ios) {
      $('#install-text').textContent = 'To install Oikres, tap Share, then Add to Home Screen.';
      $('#install-yes').hidden = true;
      banner.hidden = false;
    }
  }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; maybeInstall(); });
  window.addEventListener('appinstalled', function () { if (banner) banner.hidden = true; store('oikres:install-no', Date.now() + 365 * 86400000); });
  if (banner) {
    $('#install-yes').addEventListener('click', function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.then(function () { deferred = null; banner.hidden = true; });
    });
    $('#install-no').addEventListener('click', function () { banner.hidden = true; store('oikres:install-no', Date.now()); });
  }
  maybeInstall();

  /* Time-of-day greeting in the visitor's own time */
  Array.prototype.forEach.call(document.querySelectorAll('[data-greeting]'), function (el) {
    var h = new Date().getHours();
    el.textContent = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  });

  /* Offline support: static assets and an offline page (see /sw.js) */
  if ('serviceWorker' in navigator) {
    if (document.body.hasAttribute('data-dev')) {
      // While developing, never keep a service worker or its saved copies: they hide your latest changes.
      navigator.serviceWorker.getRegistrations().then(function (regs) {
        regs.forEach(function (r) { r.unregister(); });
        if (regs.length && window.caches) caches.keys().then(function (ks) { ks.forEach(function (k) { caches.delete(k); }); }).then(function () { if (regs.length) location.reload(); });
      }).catch(function () {});
    } else if (location.protocol === 'https:' || location.hostname === 'localhost') {
      window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(function () {}); });
    }
  }
})();


/* Tables: label each cell with its column heading so the table can reflow into rows on a phone */
(function () {
  'use strict';
  Array.prototype.forEach.call(document.querySelectorAll('.table-wrap table'), function (t) {
    var heads = Array.prototype.map.call(t.querySelectorAll('thead th'), function (th) { return th.textContent.trim(); });
    if (!heads.length) return;
    Array.prototype.forEach.call(t.querySelectorAll('tbody tr'), function (tr) {
      Array.prototype.forEach.call(tr.children, function (td, i) { if (heads[i]) td.setAttribute('data-label', heads[i]); });
    });
    t.classList.add('stack');
  });
  /* A tab strip scrolls sideways: bring the current tab into view so people can see where they are */
  Array.prototype.forEach.call(document.querySelectorAll('.tabs, .admin-tabs'), function (tabs) {
    var cur = tabs.querySelector('[aria-current="page"]');
    if (cur && tabs.scrollWidth > tabs.clientWidth) tabs.scrollLeft = Math.max(0, cur.offsetLeft - 16);
  });
})();
