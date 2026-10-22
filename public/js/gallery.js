/* Galleries on lodge and item pages, and videos in ads.
   - Videos start by themselves (muted, the only way phones allow it) and the gallery moves on when a video finishes.
   - Photos stay for a few seconds, then the gallery slides to the next one, and starts over after the last.
   - Touching, swiping or using the keyboard pauses the automatic movement for a while. Pausing a video stops it for good until played again.
   - Nothing moves while the gallery is off screen or the tab is in the background.
   - People who asked their phone for less motion, or turned on Data Saver, get no autoplay and no automatic sliding.
   - Tapping a photo opens it full screen, where it can be swiped and pinched. */
(function () {
  'use strict';
  var reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var saveData = !!(navigator.connection && navigator.connection.saveData);
  var canAuto = !reduce && !saveData;
  var DWELL = 4500, PAUSE_AFTER_TOUCH = 12000;

  function play(v) {
    try { var p = v.play(); if (p && p.catch) p.catch(function () { v._blocked = true; }); } catch (e) { v._blocked = true; }
  }

  /* ---- ad videos (and any other video marked data-autoplay-view): play while visible, pause when not ---- */
  (function () {
    var vids = [].slice.call(document.querySelectorAll('video[data-autoplay-view]'));
    if (!vids.length || !canAuto) return;
    vids.forEach(function (v) { v.muted = true; v.setAttribute('playsinline', ''); });
    if (!('IntersectionObserver' in window)) { vids.forEach(play); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) play(e.target); else e.target.pause(); });
    }, { threshold: 0.5 });
    vids.forEach(function (v) { io.observe(v); });
  })();

  /* ---- full-screen photo viewer ---- */
  var viewerOpen = false;
  function openViewer(figs, start, onClose) {
    var opener = document.activeElement;
    var box = document.createElement('div');
    box.className = 'lb'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Photo viewer');
    var track = document.createElement('div'); track.className = 'lb-track';
    figs.forEach(function (f, i) {
      var fig = document.createElement('figure'); fig.className = 'lb-slide';
      var im = document.createElement('img'); im.src = f.getAttribute('data-full'); im.alt = (f.querySelector('img') || {}).alt || 'Photo ' + (i + 1); fig.appendChild(im); track.appendChild(fig);
    });
    var close = document.createElement('button'); close.type = 'button'; close.className = 'lb-close'; close.setAttribute('aria-label', 'Close photo viewer'); close.innerHTML = '&times;';
    var count = document.createElement('div'); count.className = 'lb-count'; count.setAttribute('aria-live', 'polite');
    var prev = document.createElement('button'); prev.type = 'button'; prev.className = 'lb-nav lb-prev'; prev.setAttribute('aria-label', 'Previous photo'); prev.innerHTML = '&lsaquo;';
    var next = document.createElement('button'); next.type = 'button'; next.className = 'lb-nav lb-next'; next.setAttribute('aria-label', 'Next photo'); next.innerHTML = '&rsaquo;';
    box.appendChild(track); box.appendChild(close); box.appendChild(count);
    if (figs.length > 1) { box.appendChild(prev); box.appendChild(next); }
    document.body.appendChild(box); document.documentElement.classList.add('lb-open'); viewerOpen = true;
    var at = start;
    function idx() { return Math.round(track.scrollLeft / Math.max(1, track.clientWidth)); }
    function go(i) { i = Math.max(0, Math.min(figs.length - 1, i)); track.scrollTo({ left: i * track.clientWidth, behavior: reduce ? 'auto' : 'smooth' }); }
    function label() { count.textContent = (at + 1) + ' / ' + figs.length; }
    track.scrollLeft = start * track.clientWidth; label();
    var st; track.addEventListener('scroll', function () { clearTimeout(st); st = setTimeout(function () { at = idx(); label(); }, 60); }, { passive: true });
    prev.addEventListener('click', function () { go(at - 1); }); next.addEventListener('click', function () { go(at + 1); });
    function shut() {
      document.removeEventListener('keydown', onKey, true); box.remove(); document.documentElement.classList.remove('lb-open'); viewerOpen = false;
      if (opener && opener.focus) opener.focus();
      if (onClose) onClose();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); shut(); }
      else if (e.key === 'ArrowLeft') go(at - 1);
      else if (e.key === 'ArrowRight') go(at + 1);
      else if (e.key === 'Tab') {   // keep keyboard focus inside the viewer
        var f = [close].concat(figs.length > 1 ? [prev, next] : []); var i = f.indexOf(document.activeElement);
        e.preventDefault(); f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
      }
    }
    document.addEventListener('keydown', onKey, true);
    close.addEventListener('click', shut);
    box.addEventListener('click', function (e) { if (e.target === box || e.target.classList.contains('lb-slide')) shut(); });
    close.focus();
  }

  /* ---- one gallery ---- */
  function Gallery(el) {
    var slides = [].slice.call(el.querySelectorAll('.g-item'));
    var n = slides.length;
    if (!n) return;
    var wrap = document.createElement('div'); wrap.className = 'g-wrap';
    el.parentNode.insertBefore(wrap, el); wrap.appendChild(el);
    var counter = null, dotsBox = null, dots = [];
    if (n > 1) {
      counter = document.createElement('span'); counter.className = 'g-counter'; counter.setAttribute('aria-hidden', 'true'); wrap.appendChild(counter);
      ['prev', 'next'].forEach(function (d) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'g-arrow g-' + d; b.setAttribute('aria-label', d === 'prev' ? 'Previous' : 'Next'); b.innerHTML = d === 'prev' ? '&lsaquo;' : '&rsaquo;';
        b.addEventListener('click', function () { stopFor(PAUSE_AFTER_TOUCH); go(cur + (d === 'prev' ? -1 : 1)); }); wrap.appendChild(b);
      });
    }
    if (n > 1 && n <= 8) {
      dotsBox = document.createElement('div'); dotsBox.className = 'g-dots'; wrap.parentNode.insertBefore(dotsBox, wrap.nextSibling);
      slides.forEach(function (s, i) {
        var d = document.createElement('button'); d.type = 'button'; d.className = 'g-dot'; d.setAttribute('aria-label', 'Show ' + (i + 1) + ' of ' + n);
        d.addEventListener('click', function () { stopFor(PAUSE_AFTER_TOUCH); go(i); }); dotsBox.appendChild(d); dots.push(d);
      });
    }

    var cur = 0, timer = null, inView = false, userStop = false, resumeT = null, manualPause = false;
    function vid(i) { return slides[i].querySelector('video'); }
    function active() { return canAuto && n > 1 && inView && !document.hidden && !userStop && !viewerOpen; }
    function indexNow() {
      var c = el.scrollLeft + el.clientWidth / 2, best = 0, bd = 1e9;
      slides.forEach(function (s, i) { var d = Math.abs(s.offsetLeft + s.offsetWidth / 2 - c); if (d < bd) { bd = d; best = i; } });
      return best;
    }
    function go(i) {
      i = (i + n) % n; var s = slides[i];
      el.scrollTo({ left: s.offsetLeft - (el.clientWidth - s.offsetWidth) / 2, behavior: reduce ? 'auto' : 'smooth' });
    }
    function pauseAll(except) { slides.forEach(function (s, i) { var v = vid(i); if (v && i !== except && !v.paused) { v._prog = true; v.pause(); } }); }
    function paint() {
      if (counter) counter.textContent = (cur + 1) + ' / ' + n;
      dots.forEach(function (d, i) { if (i === cur) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
    }
    function schedule() {
      clearTimeout(timer); timer = null;
      var v = vid(cur);
      if (v) {                                     // a video moves the gallery on when it finishes
        if (v.ended && active()) timer = setTimeout(function () { go(cur + 1); }, 300);
        else if (v.error && active()) timer = setTimeout(function () { go(cur + 1); }, DWELL);
        return;
      }
      if (active()) timer = setTimeout(function () { if (active()) go(cur + 1); }, DWELL);
    }
    function show(i) {
      cur = i; paint(); pauseAll(i);
      var nx = slides[(i + 1) % n].querySelector('img'); if (nx) nx.loading = 'eager';   // the next photo is ready when we get there
      var v = vid(i);
      if (v && canAuto && inView && !manualPause) { v.muted = true; if (v.ended) v.currentTime = 0; play(v); }
      schedule();
    }
    function stopFor(ms) {
      userStop = true; clearTimeout(timer); clearTimeout(resumeT);
      resumeT = setTimeout(function () { userStop = false; schedule(); }, ms);
    }

    slides.forEach(function (s, i) {
      var v = s.querySelector('video'); if (!v) return;
      v.muted = true; v.setAttribute('playsinline', ''); if (n === 1) v.loop = true;
      v.addEventListener('ended', schedule);
      v.addEventListener('pause', function () { if (v._prog) { v._prog = false; return; } if (!v.ended && inView && !document.hidden) manualPause = true; });
      v.addEventListener('play', function () { manualPause = false; v._blocked = false; schedule(); });
    });

    var st; el.addEventListener('scroll', function () { clearTimeout(st); st = setTimeout(function () { var i = indexNow(); if (i !== cur) show(i); }, 90); }, { passive: true });
    ['touchstart', 'pointerdown', 'wheel'].forEach(function (ev) { el.addEventListener(ev, function () { stopFor(PAUSE_AFTER_TOUCH); }, { passive: true }); });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { stopFor(PAUSE_AFTER_TOUCH); go(cur - 1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { stopFor(PAUSE_AFTER_TOUCH); go(cur + 1); e.preventDefault(); }
    });
    el.addEventListener('click', function (e) {          // a photo opens full screen
      var fig = e.target.closest('.g-item');
      if (!fig || fig.querySelector('video') || !fig.getAttribute('data-full')) return;
      var photos = slides.filter(function (s) { return s.getAttribute('data-full'); });
      clearTimeout(timer); openViewer(photos, photos.indexOf(fig), schedule);
    });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        inView = es[0].isIntersecting;
        if (inView) show(cur); else { pauseAll(-1); clearTimeout(timer); }
      }, { threshold: 0.5 }).observe(el);
    } else { inView = true; show(0); }
    document.addEventListener('visibilitychange', function () { if (document.hidden) { pauseAll(-1); clearTimeout(timer); } else if (inView) show(cur); });
    paint();
    el._gallery = { go: go, current: function () { return cur; }, count: n };
  }

  [].forEach.call(document.querySelectorAll('.gallery[data-gallery]'), Gallery);
})();
