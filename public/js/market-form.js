/* Sell-an-item form: photo uploads (same uploader as lodges, but photos only). */
(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('form-data').textContent);
  var LIMITS = data.limits;
  var $ = function (s) { return document.querySelector(s); };
  var toast = function (m) { if (window.Oikres) window.Oikres.toast(m); else alert(m); };
  var media = (data.media || []).slice();
  var pending = 0, pendingPhotos = 0, pendingVideo = false;
  var grid = $('#uploads');
  var form = $('#item-form');

  function isVideo(m) { return m.type === 'video'; }
  function images() { return media.filter(function (m) { return !isVideo(m); }); }
  function thumbUrl(m) {
    if (m.thumbUrl) return m.thumbUrl;
    if (isVideo(m)) return m.url.indexOf('/upload/') === -1 ? '' : m.url.replace('/upload/', '/upload/so_0,c_fill,w_240,h_240/').replace(/\.\w+$/, '.jpg');
    if (m.url.indexOf('/upload/') === -1) return m.url;
    return m.url.replace('/upload/', '/upload/c_fill,w_240,h_240,f_auto,q_auto/');
  }
  function render() {
    grid.innerHTML = '';
    // The video is always shown, and saved, first.
    media = media.filter(isVideo).concat(images());
    var n = 0;
    media.forEach(function (m, i) {
      var t = document.createElement('div');
      t.className = 'thumb';
      var src = thumbUrl(m);
      if (src) { var im = document.createElement('img'); im.src = src; im.alt = isVideo(m) ? 'Video' : 'Photo ' + (n + 1); t.appendChild(im); }
      else { var ph = document.createElement('div'); ph.className = 'pct'; ph.style.width = '100%'; t.appendChild(ph); }
      var x = document.createElement('button');
      x.type = 'button'; x.className = 'x'; x.setAttribute('aria-label', isVideo(m) ? 'Remove video' : 'Remove photo'); x.textContent = '\u00D7';
      x.addEventListener('click', function () { media.splice(i, 1); render(); });
      t.appendChild(x);
      if (isVideo(m)) { var v = document.createElement('span'); v.className = 'tag tag-info cover-tag'; v.textContent = 'Video'; t.appendChild(v); }
      else {
        n++;
        if (n === 1) { var c = document.createElement('span'); c.className = 'tag tag-ok cover-tag'; c.textContent = 'Cover'; t.appendChild(c); }
        else {
          var mk = document.createElement('button');
          mk.type = 'button'; mk.className = 'tag cover-tag'; mk.textContent = 'Make cover'; mk.style.border = '0'; mk.style.cursor = 'pointer';
          mk.addEventListener('click', function () { var it = media.splice(i, 1)[0]; var firstImg = media.findIndex(function (q) { return !isVideo(q); }); media.splice(firstImg < 0 ? media.length : firstImg, 0, it); render(); });
          t.appendChild(mk);
        }
      }
      grid.appendChild(t);
    });
    var count = images().length;
    $('#photo-count').textContent = count + ' of ' + LIMITS.maxPhotos + ' photos' + (count < LIMITS.minPhotos ? ' (add at least ' + LIMITS.minPhotos + ')' : '');
  }
  function placeholder() {
    var t = document.createElement('div');
    t.className = 'thumb';
    t.innerHTML = '<div class="pct"></div>';
    grid.appendChild(t);
    return t.firstChild;
  }
  $('#photo-input').addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files);
    e.target.value = '';
    var room = LIMITS.maxPhotos - images().length - pendingPhotos;
    if (files.length > room) toast('Only ' + Math.max(room, 0) + ' more photos fit. The rest were skipped.');
    files.slice(0, Math.max(room, 0)).forEach(function (f) {
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return toast(f.name + ' is not a JPG, PNG or WebP photo.');
      if (f.size > 30 * 1024 * 1024) return toast(f.name + ' is too large.');
      var bar = placeholder();
      pending++; pendingPhotos++;
      window.OikresUpload.upload(f, 'market_image', function (p) { bar.style.width = Math.round(p * 100) + '%'; })
        .then(function (m) { media.push(m); })
        .catch(function (err) { toast(err.message); })
        .then(function () { pending--; pendingPhotos--; render(); });
    });
  });
  $('#video-input').addEventListener('change', function (e) {
    var f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (media.some(isVideo) || pendingVideo) return toast('Remove the current video first.');
    if (!/^video\/(mp4|quicktime)$/.test(f.type)) return toast('Use an MP4 or MOV video.');
    if (f.size > LIMITS.maxVideoMb * 1024 * 1024) return toast('The video is larger than ' + LIMITS.maxVideoMb + ' MB. Record a shorter one.');
    var bar = placeholder(); var note = $('#video-note');
    pending++; pendingVideo = true;
    window.OikresUpload.upload(f, 'market_video', function (p) { bar.style.width = Math.round(p * 100) + '%'; note.textContent = 'Uploading video... ' + Math.round(p * 100) + '%'; })
      .then(function (m) { media.unshift(m); note.textContent = ''; })
      .catch(function (err) { note.textContent = ''; toast(err.message); })
      .then(function () { pending--; pendingVideo = false; render(); });
  });
  form.addEventListener('submit', function (e) {
    if (pending > 0) { e.preventDefault(); return toast('Wait for the uploads to finish.'); }
    $('#mediaJson').value = JSON.stringify(media.map(function (m) { return { type: m.type === 'video' ? 'video' : 'image', id: m.id, url: m.url, publicId: m.publicId, width: m.width, height: m.height }; }));
    setTimeout(function () { $('#save-item').disabled = true; }, 0);
  });
  render();

  /* ---- Draft saving: a phone may reload this page while someone is away taking a photo or answering a message.
     What they typed (and the photos already uploaded) is kept on this device and put back when they return. New items only. ---- */
  (function () {
    if (form.getAttribute('action') !== '/market/sell') return;
    var KEY = 'oikres.sell.draft', NAMES = ['title', 'category', 'condition', 'price', 'description', 'state', 'campus', 'pickup', 'whatsapp'];
    function field(n) { return form.elements[n]; }
    function setSel(el, v) { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('ui:refresh')); }
    function read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
    var dropped = false;   // once cleared (posted, or "start again"), nothing may write the draft back while the page unloads
    function clear() { dropped = true; try { localStorage.removeItem(KEY); } catch (e) { /* storage unavailable */ } }
    function save() {
      if (dropped) return;
      var d = { at: Date.now(), f: {}, neg: !!(field('negotiable') && field('negotiable').checked), media: media };
      NAMES.forEach(function (n) { if (field(n)) d.f[n] = field(n).value; });
      var empty = !d.f.title && !d.f.description && !d.f.price && !media.length;
      try { if (empty) localStorage.removeItem(KEY); else localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* storage full or off: carry on without drafts */ }
    }
    var d = read();
    var blank = !field('title').value && !field('description').value && !media.length;
    if (d && blank && Date.now() - d.at < 7 * 86400000) {
      ['title', 'price', 'description', 'pickup', 'whatsapp'].forEach(function (n) { if (field(n) && d.f[n] && !field(n).value) field(n).value = d.f[n]; });
      if (d.f.category) setSel(field('category'), d.f.category);
      if (d.f.condition) setSel(field('condition'), d.f.condition);
      if (d.f.state) setSel(field('state'), d.f.state);
      if (d.f.campus) setSel(field('campus'), d.f.campus);
      if (field('negotiable')) field('negotiable').checked = !!d.neg;
      if (Date.now() - d.at < 6 * 3600000 && d.media && d.media.length) { media = d.media.slice(); render(); }  // uploads are kept for a few hours
      var note = document.createElement('div'); note.className = 'alert alert-info'; note.setAttribute('role', 'status'); note.id = 'draft-note';
      note.innerHTML = 'We put back what you were typing. <button type="button" class="btn btn-ghost btn-sm" id="draft-clear">Start again</button>';
      form.parentNode.insertBefore(note, form);
      document.getElementById('draft-clear').addEventListener('click', function () { clear(); location.reload(); });
    }
    var t; function later() { clearTimeout(t); t = setTimeout(save, 400); }
    form.addEventListener('input', later); form.addEventListener('change', later);
    var origRender = render; render = function () { origRender(); later(); };
    form.addEventListener('submit', function () { clear(); });
    window.addEventListener('pagehide', save);
  })();
})();
