/* Custom dropdowns: replaces the browser's pop-up list with one that lines up under its control.
   On phones it opens as a bottom sheet. The real <select> stays in the page, so forms and scripts keep working. */
(function () {
  'use strict';
  var current = null;
  var CHEVRON = '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-chevron-down"/></svg>';
  var CHECK = '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-check"/></svg>';
  var uid = 0;

  function closePop(refocus) {
    if (!current) return;
    var c = current;
    current = null;
    c.pop.parentNode && c.pop.parentNode.removeChild(c.pop);
    c.bd.parentNode && c.bd.parentNode.removeChild(c.bd);
    c.btn.setAttribute('aria-expanded', 'false');
    window.removeEventListener('scroll', c.onScroll, true);
    window.removeEventListener('resize', c.onResize);
    document.removeEventListener('keydown', c.onKey, true);
    if (refocus) c.btn.focus();
  }

  function labelFor(sel) {
    var l = sel.id && document.querySelector('label[for="' + sel.id + '"]');
    return (l && l.textContent.trim()) || sel.getAttribute('aria-label') || '';
  }

  function openPop(sel, btn) {
    closePop(false);
    var sheet = window.innerWidth < 720;
    var items = Array.prototype.map.call(sel.options, function (o, i) { return { i: i, value: o.value, text: o.textContent, disabled: o.disabled }; });
    var active = Math.max(0, sel.selectedIndex);
    var bd = document.createElement('div');
    bd.className = 'ui-backdrop' + (sheet ? ' is-sheet' : '');
    var pop = document.createElement('div');
    pop.className = 'ui-pop' + (sheet ? ' is-sheet' : '');
    pop.setAttribute('role', 'listbox');
    pop.tabIndex = -1;
    var id = 'uipop' + (++uid);
    pop.id = id;
    if (sheet) {
      var head = document.createElement('div');
      head.className = 'ui-pop-head';
      head.textContent = labelFor(sel) || 'Choose';
      pop.appendChild(head);
    }
    var els = items.map(function (it) {
      var d = document.createElement('div');
      d.className = 'ui-opt';
      d.id = id + '-' + it.i;
      d.setAttribute('role', 'option');
      d.setAttribute('aria-selected', it.i === sel.selectedIndex ? 'true' : 'false');
      if (it.disabled) d.setAttribute('aria-disabled', 'true');
      d.innerHTML = '<span></span>' + (it.i === sel.selectedIndex ? CHECK : '');
      d.firstChild.textContent = it.text;
      d.addEventListener('mousemove', function () { setActive(it.i); });
      d.addEventListener('click', function () { choose(it.i); });
      pop.appendChild(d);
      return d;
    });
    function setActive(i) {
      if (els[active]) els[active].classList.remove('is-active');
      active = i;
      if (els[i]) { els[i].classList.add('is-active'); pop.setAttribute('aria-activedescendant', els[i].id); els[i].scrollIntoView({ block: 'nearest' }); }
    }
    function choose(i) {
      if (items[i].disabled) return;
      sel.selectedIndex = i;
      closePop(true);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    var typed = '';
    var typedTimer;
    function onKey(e) {
      var k = e.key;
      if (k === 'Escape') { e.preventDefault(); closePop(true); }
      else if (k === 'ArrowDown') { e.preventDefault(); setActive(Math.min(items.length - 1, active + 1)); }
      else if (k === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, active - 1)); }
      else if (k === 'Home') { e.preventDefault(); setActive(0); }
      else if (k === 'End') { e.preventDefault(); setActive(items.length - 1); }
      else if (k === 'Enter' || k === ' ') { e.preventDefault(); choose(active); }
      else if (k === 'Tab') { closePop(false); }
      else if (k.length === 1 && !e.ctrlKey && !e.metaKey) {
        typed += k.toLowerCase();
        clearTimeout(typedTimer);
        typedTimer = setTimeout(function () { typed = ''; }, 700);
        for (var n = 0; n < items.length; n++) { if (items[n].text.toLowerCase().indexOf(typed) === 0) { setActive(n); break; } }
      }
    }
    var onScroll = function (e) { if (!pop.contains(e.target)) closePop(false); };
    var onResize = function () { closePop(false); };
    current = { pop: pop, bd: bd, btn: btn, onScroll: onScroll, onResize: onResize, onKey: onKey };
    bd.addEventListener('click', function () { closePop(true); });
    document.body.appendChild(bd);
    document.body.appendChild(pop);
    btn.setAttribute('aria-expanded', 'true');
    if (!sheet) {
      var r = btn.getBoundingClientRect();
      var w = Math.max(r.width, 200);
      pop.style.minWidth = r.width + 'px';
      pop.style.width = w + 'px';
      var below = window.innerHeight - r.bottom - 12;
      var above = r.top - 12;
      var want = Math.min(pop.scrollHeight, 320);
      var useAbove = below < want && above > below;
      var h = Math.max(120, Math.min(want, useAbove ? above : below));
      pop.style.maxHeight = h + 'px';
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
      pop.style.top = (useAbove ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
    }
    setActive(active);
    pop.focus({ preventScroll: true });
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKey, true);
  }

  function enhance(sel) {
    if (sel._ui || sel.multiple || sel.hasAttribute('data-native') || sel.closest('.ui-pop')) return;
    sel._ui = true;
    var wrap = document.createElement('div');
    wrap.className = 'ui-select' + (sel.getAttribute('data-ui') ? ' ' + sel.getAttribute('data-ui') : '');
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.classList.add('ui-native');
    sel.tabIndex = -1;
    sel.setAttribute('aria-hidden', 'true');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ui-select-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    var text = document.createElement('span');
    text.className = 'ui-select-text';
    btn.appendChild(text);
    btn.insertAdjacentHTML('beforeend', CHEVRON);
    wrap.insertBefore(btn, sel);
    var aria = sel.getAttribute('aria-label') || labelFor(sel);
    if (aria) btn.setAttribute('aria-label', aria + ': ' + (sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : ''));
    function sync() {
      var o = sel.options[sel.selectedIndex];
      text.textContent = o ? o.textContent : '';
      btn.classList.toggle('is-placeholder', !sel.value);
      btn.classList.toggle('invalid', sel.classList.contains('invalid'));
      btn.disabled = sel.disabled;
      var a = sel.getAttribute('aria-label') || labelFor(sel);
      if (a) btn.setAttribute('aria-label', a + ': ' + (o ? o.textContent : ''));
    }
    sel.addEventListener('change', sync);
    sel.addEventListener('ui:refresh', sync);
    new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'class'] });
    btn.addEventListener('click', function () { if (current && current.btn === btn) closePop(true); else openPop(sel, btn); });
    btn.addEventListener('keydown', function (e) {
      if (['ArrowDown', 'ArrowUp'].indexOf(e.key) > -1) { e.preventDefault(); openPop(sel, btn); }
    });
    var lab = sel.id && document.querySelector('label[for="' + sel.id + '"]');
    if (lab) lab.addEventListener('click', function (e) { e.preventDefault(); btn.focus(); });
    sync();
  }

  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.tagName === 'SELECT') enhance(root);
    else Array.prototype.forEach.call(root.querySelectorAll('select'), enhance);
  }
  function start() {
    scan(document.body);
    new MutationObserver(function (list) { list.forEach(function (m) { Array.prototype.forEach.call(m.addedNodes, scan); }); }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
