/* Admin > Site settings: theme presets, live preview with contrast hints, and logo uploads. */
(function () {
  'use strict';
  var C = window.OikresColor;
  var form = document.getElementById('theme-form');

  function field(name) { return form && form.querySelector('[name="' + name + '"]'); }
  function val(name) { var f = field(name); return f ? f.value : ''; }

  function preview() {
    if (!form || !C) return;
    ['light', 'dark'].forEach(function (mode) {
      var box = document.querySelector('.tp[data-mode="' + mode + '"]');
      if (!box) return;
      var bg = C.parse(val(mode + '_bg')), surface = C.parse(val(mode + '_surface')), text = C.parse(val(mode + '_text')), primary = C.parse(val(mode + '_primary'));
      var muted = val(mode + '_muted'), border = val(mode + '_border');
      if (!bg || !surface || !text || !primary) return;
      var white = { r: 255, g: 255, b: 255, a: 1 };
      var bgO = C.blend(bg, white), surfO = C.blend(surface, bgO), primO = C.blend(primary, surfO), textO = C.blend(text, bgO);
      var s = box.style;
      s.setProperty('--tp-bg', C.toCss(bg)); s.setProperty('--tp-surface', C.toCss(surface)); s.setProperty('--tp-text', C.toCss(text));
      s.setProperty('--tp-muted', muted); s.setProperty('--tp-border', border); s.setProperty('--tp-primary', C.toCss(primary));
      s.setProperty('--tp-on', C.readableOn(primO)); s.setProperty('--tp-radius', val('radius') || 14);
      [['text', C.contrast(textO, bgO), 4.5, 'Text is hard to read on this background.'], ['primary', C.contrast(primO, bgO), 3, 'This brand colour is faint on the background.']].forEach(function (chk) {
        var input = field(mode + '_' + chk[0]);
        var holder = input && input.closest('.color-field');
        if (!holder) return;
        var warn = holder.parentNode.querySelector('.contrast-warn[data-for="' + mode + '_' + chk[0] + '"]');
        if (!warn) { warn = document.createElement('div'); warn.className = 'contrast-warn'; warn.setAttribute('data-for', mode + '_' + chk[0]); holder.insertAdjacentElement('afterend', warn); }
        warn.textContent = chk[1] < chk[2] ? chk[3] : '';
      });
    });
  }
  if (form) {
    form.addEventListener('input', preview);
    Array.prototype.forEach.call(document.querySelectorAll('[data-preset]'), function (b) {
      b.addEventListener('click', function () {
        var p = JSON.parse(b.getAttribute('data-preset'));
        ['light', 'dark'].forEach(function (mode) {
          var f = field(mode + '_primary');
          if (f) { f.value = p[mode]; f.dispatchEvent(new Event('input', { bubbles: true })); }
        });
        preview();
      });
    });
    preview();
  }

  /* Logo and icon uploads */
  Array.prototype.forEach.call(document.querySelectorAll('.js-site-upload'), function (box) {
    var input = box.querySelector('input[type=file]');
    var hidden = box.querySelector('input[type=hidden]');
    var status = box.querySelector('.js-status');
    var prev = box.querySelector('.logo-preview');
    var name = box.querySelector('.pick-name');
    function show() {
      prev.innerHTML = '';
      if (hidden.value) { var im = document.createElement('img'); im.src = hidden.value; im.alt = ''; prev.appendChild(im); }
      else { var t = document.createElement('span'); t.className = 'muted small'; t.textContent = box.getAttribute('data-empty') || 'Using the default'; prev.appendChild(t); }
    }
    show();
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { status.textContent = 'Use a PNG, JPG or WebP image.'; return; }
      if (name) name.textContent = f.name;
      status.textContent = 'Uploading... 0%';
      window.OikresUpload.upload(f, 'site_image', function (p) { status.textContent = 'Uploading... ' + Math.round(p * 100) + '%'; })
        .then(function (r) { hidden.value = r.url; status.textContent = 'Uploaded. Press Save to use it.'; show(); })
        .catch(function (err) { status.textContent = err.message; });
    });
    var rm = box.querySelector('.js-remove');
    if (rm) rm.addEventListener('click', function () { hidden.value = ''; status.textContent = 'Removed. Press Save to apply.'; show(); });
  });
})();
