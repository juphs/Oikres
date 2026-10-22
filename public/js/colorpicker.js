/* A Photoshop-style colour picker with transparency. Attach it to any text input marked .js-color
   (the input holds the value, as #rrggbb or rgba(r, g, b, a)). Beside it, a .swatch button opens the picker. */
(function () {
  'use strict';
  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
  function hex2(n) { n = Math.round(n); return (n < 16 ? '0' : '') + n.toString(16); }
  function parse(s) {
    s = String(s || '').trim().toLowerCase();
    var m = s.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
      var h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split('').map(function (c) { return c + c; }).join('');
      if (h.length === 6) h += 'ff';
      if (h.length !== 8) return null;
      return { r: parseInt(h.substr(0, 2), 16), g: parseInt(h.substr(2, 2), 16), b: parseInt(h.substr(4, 2), 16), a: Math.round(parseInt(h.substr(6, 2), 16) / 255 * 100) / 100 };
    }
    m = s.match(/^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*(\d*\.?\d+%?)\s*)?\)$/);
    if (!m) return null;
    var a = 1;
    if (m[4] !== undefined) a = m[4].slice(-1) === '%' ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: clamp(+m[1], 0, 255), g: clamp(+m[2], 0, 255), b: clamp(+m[3], 0, 255), a: Math.round(clamp(a, 0, 1) * 100) / 100 };
  }
  function toCss(c) { return c.a >= 1 ? '#' + hex2(c.r) + hex2(c.g) + hex2(c.b) : 'rgba(' + Math.round(c.r) + ', ' + Math.round(c.g) + ', ' + Math.round(c.b) + ', ' + Math.round(c.a * 100) / 100 + ')'; }
  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d) { if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return { h: h, s: max ? d / max : 0, v: max };
  }
  function hsv2rgb(h, s, v) {
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
  }
  function lum(c) { function f(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); } return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function blend(fg, bg) { return { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 }; }
  function readableOn(c) { return contrast(c, { r: 255, g: 255, b: 255 }) >= contrast(c, { r: 15, g: 23, b: 42 }) ? '#FFFFFF' : '#0F172A'; }
  window.OikresColor = { parse: parse, toCss: toCss, contrast: contrast, blend: blend, readableOn: readableOn };

  var PRESETS = ['#0369A1', '#0EA5E9', '#2563EB', '#7C3AED', '#C026D3', '#E11D48', '#DC2626', '#EA580C', '#D97706', '#16A34A', '#0D9488', '#475569', '#0F172A', '#FFFFFF'];
  var open = null;

  function paintSwatch(input) {
    var sw = input.closest('.color-field') && input.closest('.color-field').querySelector('.swatch i');
    var c = parse(input.value);
    if (sw) sw.style.background = c ? toCss(c) : 'transparent';
    input.classList.toggle('invalid', !c);
  }

  function close() {
    if (!open) return;
    open.el.parentNode && open.el.parentNode.removeChild(open.el);
    document.removeEventListener('mousedown', open.onDoc, true);
    document.removeEventListener('keydown', open.onKey, true);
    window.removeEventListener('scroll', open.onScroll, true);
    open = null;
  }

  function show(input, anchor) {
    close();
    var c = parse(input.value) || { r: 3, g: 105, b: 161, a: 1 };
    var hsv = rgb2hsv(c.r, c.g, c.b);
    var st = { h: hsv.h, s: hsv.s, v: hsv.v, a: c.a };
    var el = document.createElement('div');
    el.className = 'cp';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Colour picker');
    el.innerHTML = '<canvas class="cp-sv"></canvas><canvas class="cp-bar cp-hue" height="16"></canvas><div class="cp-bar cp-alpha"><canvas class="cp-bar" height="16" style="margin:0;width:100%"></canvas></div>' +
      '<div class="cp-rgba"><div><input class="f-hex" type="text" aria-label="Hex"><label>Hex</label></div><div><input class="f-r" type="text" inputmode="numeric" aria-label="Red"><label>R</label></div><div><input class="f-g" type="text" inputmode="numeric" aria-label="Green"><label>G</label></div><div><input class="f-b" type="text" inputmode="numeric" aria-label="Blue"><label>B</label></div><div><input class="f-a" type="text" inputmode="decimal" aria-label="Opacity"><label>A</label></div></div>' +
      '<div class="cp-presets"></div><button type="button" class="btn btn-primary btn-sm cp-done">Done</button>';
    document.body.appendChild(el);
    var sv = el.querySelector('.cp-sv'), hue = el.querySelector('.cp-hue'), alphaBar = el.querySelector('.cp-alpha canvas');
    var W = 248, dpr = window.devicePixelRatio || 1;
    function size(cv, w, h) { cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + 'px'; cv.style.height = h + 'px'; cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0); }
    size(sv, W, 160); size(hue, W, 16); size(alphaBar, W, 16);
    var f = { hex: el.querySelector('.f-hex'), r: el.querySelector('.f-r'), g: el.querySelector('.f-g'), b: el.querySelector('.f-b'), a: el.querySelector('.f-a') };
    var presets = el.querySelector('.cp-presets');
    PRESETS.forEach(function (p) { var b = document.createElement('button'); b.type = 'button'; b.style.background = p; b.setAttribute('aria-label', p); b.addEventListener('click', function () { var q = parse(p); var h = rgb2hsv(q.r, q.g, q.b); st.h = h.h; st.s = h.s; st.v = h.v; st.a = 1; apply(true); }); presets.appendChild(b); });

    function rgbNow() { return hsv2rgb(st.h, st.s, st.v); }
    function draw() {
      var x = sv.getContext('2d'), base = hsv2rgb(st.h, 1, 1);
      x.clearRect(0, 0, W, 160);
      x.fillStyle = 'rgb(' + Math.round(base.r) + ',' + Math.round(base.g) + ',' + Math.round(base.b) + ')'; x.fillRect(0, 0, W, 160);
      var g1 = x.createLinearGradient(0, 0, W, 0); g1.addColorStop(0, '#fff'); g1.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g1; x.fillRect(0, 0, W, 160);
      var g2 = x.createLinearGradient(0, 0, 0, 160); g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, '#000'); x.fillStyle = g2; x.fillRect(0, 0, W, 160);
      var px = st.s * W, py = (1 - st.v) * 160;
      x.beginPath(); x.arc(px, py, 7, 0, 6.2832); x.strokeStyle = '#fff'; x.lineWidth = 2; x.stroke(); x.beginPath(); x.arc(px, py, 8.5, 0, 6.2832); x.strokeStyle = 'rgba(0,0,0,.45)'; x.lineWidth = 1; x.stroke();
      var h = hue.getContext('2d'), gh = h.createLinearGradient(0, 0, W, 0);
      for (var i = 0; i <= 6; i++) { var q = hsv2rgb(i * 60, 1, 1); gh.addColorStop(i / 6, 'rgb(' + Math.round(q.r) + ',' + Math.round(q.g) + ',' + Math.round(q.b) + ')'); }
      h.fillStyle = gh; h.fillRect(0, 0, W, 16); var hx = st.h / 360 * W; h.fillStyle = '#fff'; h.fillRect(hx - 3, 0, 6, 16); h.strokeStyle = 'rgba(0,0,0,.5)'; h.strokeRect(hx - 3, 0.5, 6, 15);
      var a = alphaBar.getContext('2d'), c0 = rgbNow(), ga = a.createLinearGradient(0, 0, W, 0);
      ga.addColorStop(0, 'rgba(' + Math.round(c0.r) + ',' + Math.round(c0.g) + ',' + Math.round(c0.b) + ',0)'); ga.addColorStop(1, 'rgb(' + Math.round(c0.r) + ',' + Math.round(c0.g) + ',' + Math.round(c0.b) + ')');
      a.clearRect(0, 0, W, 16); a.fillStyle = ga; a.fillRect(0, 0, W, 16); var ax = st.a * W; a.fillStyle = '#fff'; a.fillRect(ax - 3, 0, 6, 16); a.strokeStyle = 'rgba(0,0,0,.5)'; a.strokeRect(ax - 3, 0.5, 6, 15);
    }
    function apply(fromPicker) {
      var c1 = rgbNow(), cur = { r: Math.round(c1.r), g: Math.round(c1.g), b: Math.round(c1.b), a: Math.round(st.a * 100) / 100 };
      draw();
      if (fromPicker) {
        f.hex.value = toCss({ r: cur.r, g: cur.g, b: cur.b, a: 1 }); f.r.value = cur.r; f.g.value = cur.g; f.b.value = cur.b; f.a.value = cur.a;
        input.value = toCss(cur);
        paintSwatch(input);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    function drag(cv, fn) {
      function move(e) { var r = cv.getBoundingClientRect(); fn(clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)); apply(true); }
      cv.addEventListener('pointerdown', function (e) { cv.setPointerCapture(e.pointerId); move(e); cv.onpointermove = move; });
      cv.addEventListener('pointerup', function () { cv.onpointermove = null; });
    }
    drag(sv, function (x, y) { st.s = x; st.v = 1 - y; });
    drag(hue, function (x) { st.h = x * 360; });
    drag(alphaBar, function (x) { st.a = Math.round(x * 100) / 100; });
    function fromFields() {
      var r = +f.r.value, g = +f.g.value, b = +f.b.value, a = parseFloat(f.a.value);
      if ([r, g, b].every(function (n) { return n >= 0 && n <= 255; })) { var h = rgb2hsv(r, g, b); st.h = h.h; st.s = h.s; st.v = h.v; if (a >= 0 && a <= 1) st.a = a; apply(true); }
    }
    ['r', 'g', 'b', 'a'].forEach(function (k) { f[k].addEventListener('input', fromFields); });
    f.hex.addEventListener('input', function () { var q = parse(f.hex.value); if (q) { var h = rgb2hsv(q.r, q.g, q.b); st.h = h.h; st.s = h.s; st.v = h.v; if (/^#([0-9a-f]{4}|[0-9a-f]{8})$/i.test(f.hex.value.trim())) st.a = q.a; apply(true); } });
    el.querySelector('.cp-done').addEventListener('click', close);
    apply(true);
    var r = anchor.getBoundingClientRect(), h = el.offsetHeight, w = el.offsetWidth;
    var top = r.bottom + 8; if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
    el.style.top = top + 'px'; el.style.left = clamp(r.left, 8, window.innerWidth - w - 8) + 'px';
    open = {
      el: el,
      onDoc: function (e) { if (!el.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(); },
      onKey: function (e) { if (e.key === 'Escape') { e.preventDefault(); close(); anchor.focus(); } },
      onScroll: function (e) { if (!el.contains(e.target)) close(); }
    };
    document.addEventListener('mousedown', open.onDoc, true);
    document.addEventListener('keydown', open.onKey, true);
    window.addEventListener('scroll', open.onScroll, true);
  }

  document.addEventListener('click', function (e) {
    var sw = e.target.closest('.color-field .swatch');
    if (!sw) return;
    e.preventDefault();
    show(sw.closest('.color-field').querySelector('input.js-color'), sw);
  });
  document.addEventListener('input', function (e) { if (e.target.classList && e.target.classList.contains('js-color')) paintSwatch(e.target); });
  Array.prototype.forEach.call(document.querySelectorAll('input.js-color'), paintSwatch);
})();
