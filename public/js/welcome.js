/* The introduction popup. Shown once per visitor per version (the version changes when an administrator asks everyone to see it again),
   never on forms or admin pages. On a phone it is a bottom sheet; anywhere a link has data-open-welcome it opens on demand. */
(function () {
  'use strict';
  var body = document.body, ver = body.getAttribute('data-welcome') || '';   // empty when the popup is switched off (admins can still preview)
  var KEY = 'oikres.welcome', box = null, opener = null;
  function seen() { try { return localStorage.getItem(KEY) === ver; } catch (e) { try { return sessionStorage.getItem(KEY) === ver; } catch (e2) { return true; } } }
  function mark() { try { localStorage.setItem(KEY, ver); } catch (e) { try { sessionStorage.setItem(KEY, ver); } catch (e2) { /* nothing more to try */ } } }

  function shut(remember) {
    if (!box) return;
    document.removeEventListener('keydown', onKey, true);
    box.remove(); box = null; document.documentElement.classList.remove('welcome-open');
    if (remember) mark();
    if (opener && opener.focus) { try { opener.focus(); } catch (e) { /* element is gone */ } }
  }
  function onKey(e) {
    if (!box) return;
    if (e.key === 'Escape') { e.preventDefault(); shut(true); return; }
    if (e.key !== 'Tab') return;
    var f = [].slice.call(box.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])')).filter(function (x) { return !x.disabled && x.offsetParent !== null; });
    if (!f.length) return;
    var i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
  }
  function build(html, preview) {
    box = document.createElement('div'); box.className = 'welcome-backdrop';
    var dlg = document.createElement('div'); dlg.className = 'welcome'; dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-labelledby', 'welcome-title');
    var x = document.createElement('button'); x.type = 'button'; x.className = 'welcome-x'; x.setAttribute('aria-label', 'Close'); x.innerHTML = '&times;';
    dlg.appendChild(x); dlg.insertAdjacentHTML('beforeend', html); box.appendChild(dlg);
    document.body.appendChild(box); document.documentElement.classList.add('welcome-open');
    document.addEventListener('keydown', onKey, true);
    x.addEventListener('click', function () { shut(!preview); });
    box.addEventListener('click', function (e) { if (e.target === box) shut(!preview); });
    [].forEach.call(box.querySelectorAll('[data-welcome-close]'), function (b) { b.addEventListener('click', function () { shut(!preview); }); });
    var primary = box.querySelector('[data-welcome-close]'); (primary || x).focus();
  }
  function open(preview) {
    if (box) return;
    opener = document.activeElement;
    fetch('/welcome' + (preview ? '?preview=1' : ''), { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('none'); return r.text(); })
      .then(function (html) { if (!box) build(html, preview); })
      .catch(function () { /* the popup is switched off or unreachable: carry on quietly */ });
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-open-welcome]');
    if (t) { e.preventDefault(); open(t.hasAttribute('data-preview')); }
  });
  var quiet = /^\/(login|register|forgot|reset|verify|account\/become|logout)/.test(location.pathname);
  if (ver && body.getAttribute('data-welcome-auto') === '1' && !quiet && !seen()) {
    setTimeout(function () { if (!document.querySelector('.lb, .sheet.open, .welcome-backdrop')) open(false); }, 1200);
  }
})();
