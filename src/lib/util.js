const crypto = require('crypto');

const ALPHA = 'abcdefghjkmnpqrstvwxyz23456789';
const uid = (n = 12) => { const b = crypto.randomBytes(n); let s = ''; for (let i = 0; i < n; i++) s += ALPHA[b[i] % ALPHA.length]; return s; };
const isUid = (v) => typeof v === 'string' && /^[a-z0-9]{12}$/.test(v);
const isNum = (v) => typeof v === 'string' && /^\d{1,12}$/.test(v);
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
const escapeLike = (s) => String(s).replace(/[\\%_]/g, '\\$&');
const naira = (n) => '\u20A6' + Number(n || 0).toLocaleString('en-NG');
const clean = (v, max = 200) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const toInt = (v, min = 0, max = 1e9) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null; };
const safeJson = (s, fallback) => { try { const v = JSON.parse(s); return v == null ? fallback : v; } catch (e) { return fallback; } };
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const now = () => Date.now();

function timeAgo(date) {
  if (!date) return '';
  const s = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (s < 90) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' min ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.floor(h / 24);
  if (d < 30) return d + (d === 1 ? ' day ago' : ' days ago');
  const mo = Math.floor(d / 30);
  return mo + (mo === 1 ? ' month ago' : ' months ago');
}
const formatDate = (date) => (date ? new Date(date).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// Nigerian mobile numbers -> +234XXXXXXXXXX, or null when invalid.
function normalisePhone(input) {
  let d = String(input || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('0')) d = '234' + d.slice(1);
  else if (/^[789]\d{9}$/.test(d)) d = '234' + d;
  return /^234[789]\d{9}$/.test(d) ? '+' + d : null;
}
function safeReturnTo(url, fallback = '/') {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//') || url.includes('\\')) return fallback;
  return url;
}

module.exports = { uid, isUid, isNum, slugify, escapeLike, naira, clean, toInt, safeJson, hashToken, now, timeAgo, formatDate, normalisePhone, safeReturnTo };
