// Small colour toolkit for the admin theme editor. Accepts #rgb, #rrggbb, #rrggbbaa, rgb() and rgba().
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const hex2 = (n) => n.toString(16).padStart(2, '0');

function parse(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length === 6) h += 'ff';
    if (h.length !== 8) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: Math.round((parseInt(h.slice(6, 8), 16) / 255) * 100) / 100 };
  }
  m = s.match(/^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*(\d*\.?\d+%?)\s*)?\)$/);
  if (!m) return null;
  let a = 1;
  if (m[4] !== undefined) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (!Number.isFinite(a)) return null;
  return { r: clamp(+m[1], 0, 255), g: clamp(+m[2], 0, 255), b: clamp(+m[3], 0, 255), a: Math.round(clamp(a, 0, 1) * 100) / 100 };
}
function toCss(c) {
  const a = Math.round(c.a * 100) / 100;
  return a >= 1 ? '#' + hex2(c.r) + hex2(c.g) + hex2(c.b) : 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + a + ')';
}
const normalise = (input, fallback) => { const c = parse(input); return c ? toCss(c) : fallback; };

// Colour a (with its alpha) laid over an opaque background.
function blend(fg, bg) {
  const a = fg.a;
  return { r: Math.round(fg.r * a + bg.r * (1 - a)), g: Math.round(fg.g * a + bg.g * (1 - a)), b: Math.round(fg.b * a + bg.b * (1 - a)), a: 1 };
}
const mix = (a, b, t) => ({ r: Math.round(a.r * t + b.r * (1 - t)), g: Math.round(a.g * t + b.g * (1 - t)), b: Math.round(a.b * t + b.b * (1 - t)), a: 1 });
function luminance(c) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function contrast(a, b) { const x = luminance(a); const y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
// White or near-black, whichever reads better on the colour.
function readableOn(c) {
  const white = { r: 255, g: 255, b: 255, a: 1 };
  const dark = { r: 15, g: 23, b: 42, a: 1 };
  return contrast(c, white) >= contrast(c, dark) ? '#FFFFFF' : '#0F172A';
}

module.exports = { parse, toCss, normalise, blend, mix, luminance, contrast, readableOn };
