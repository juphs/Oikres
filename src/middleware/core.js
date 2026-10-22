const crypto = require('crypto');
const cfg = require('../config');
const C = require('../config/constants');
const U = require('../lib/util');
const cost = require('../lib/cost');
const IMG = require('../lib/images');
const users = require('../repositories/users');
const act = require('../repositories/activity');
const log = require('../lib/log');
const { HttpError } = require('../lib/errors');
const site = require('../services/site');
const welcome = require('../services/welcome');

const secure = () => cfg.isProd;
const hmac = (s) => crypto.createHmac('sha256', cfg.sessionSecret).update(s).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const find = (list, v) => (list.find((x) => x.value === v) || {}).label || '';

function requestLog(req, res, next) {
  const t = Date.now();
  res.on('finish', () => { if (req.path !== '/healthz') log.info(req.method + ' ' + req.path + ' ' + res.statusCode + ' ' + (Date.now() - t) + 'ms'); });
  next();
}

// Page defaults and the helper functions every template can use.
function locals(req, res, next) {
  res.set('Cache-Control', 'private, no-cache');
  Object.assign(res.locals, {
    user: null, unread: 0, csrfToken: () => '', flash: [], cfg, C,
    welcomeVersion: welcome.activeVersion(), site: site.get(), themeCss: site.themeCss(), themeMeta: site.themeMeta(), supportLink: site.whatsappLink, impersonating: null,
    naira: U.naira, timeAgo: U.timeAgo, formatDate: U.formatDate,
    mediaSrc: IMG.mediaSrc, mediaSet: IMG.mediaSet, videoSrc: IMG.videoSrc, posterSrc: IMG.posterSrc,
    breakdown: cost.breakdown, feeText: cost.feeText, labelOf: find,
    icon: (n, cls) => '<svg class="i ' + (cls || '') + '" aria-hidden="true" focusable="false"><use href="#i-' + n + '"/></svg>',
    payeeWord: (p) => ({ agent: 'the agent', landlord: 'the landlord', oikres: 'Oikres' }[p] || ''),
    periodLabel: (p) => (C.PERIODS.find((x) => x.value === p) || C.PERIODS[0]).label,
    statusLabel: (s) => C.LISTING_STATUS_LABELS[s] || s,
    path: req.path, url: cfg.baseUrl + req.originalUrl.split('?')[0],
    area: 'public', nav: '', title: '', description: '', ogImage: '', hideNav: false, noindex: false, errorRef: ''
  });
  next();
}

// Anonymous visitor id for view counts, de-duplication and abuse limits. Not tied to a person.
function anon(req, res, next) {
  let id = req.cookies.oid;
  if (!id || !/^[a-f0-9]{32}$/.test(id)) {
    id = crypto.randomBytes(16).toString('hex');
    res.cookie('oid', id, { httpOnly: true, sameSite: 'lax', secure: secure(), maxAge: 365 * 86400000 });
  }
  req.anonId = id;
  next();
}

// Signed double-submit CSRF token: the cookie value must be signed by us and must match the submitted value.
function csrf(req, res, next) {
  let token = req.cookies.oikres_csrf;
  const valid = (t) => typeof t === 'string' && /^[a-f0-9]{36}\.[a-f0-9]{24}$/.test(t) && safeEq(t.split('.')[1], hmac('csrf:' + t.split('.')[0]).slice(0, 24));
  if (!valid(token)) {
    const rand = crypto.randomBytes(18).toString('hex');
    token = rand + '.' + hmac('csrf:' + rand).slice(0, 24);
    res.cookie('oikres_csrf', token, { httpOnly: true, sameSite: 'lax', secure: secure(), maxAge: 30 * 86400000 });
    req.csrfFresh = true;
  }
  res.locals.csrfToken = () => token;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = String((req.body && req.body._csrf) || req.get('x-csrf-token') || '');
  if (req.csrfFresh || !safeEq(sent, token)) return next(new HttpError(403, 'Your session expired. Reload the page and try again.'));
  next();
}

// Looks up the signed-in user from the session cookie. Sessions older than a password change are rejected.
function sessionLoader(req, res, next) {
  const token = req.cookies.oikres_sid;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return next();
  const s = users.findSession(token);
  const bad = !s || s.expiresAt < Date.now() || s.user.status !== 'active' || (s.user.passwordChangedAt && s.user.passwordChangedAt > s.createdAt);
  if (bad) { if (s) users.deleteSession(token); res.clearCookie('oikres_sid'); return next(); }
  if (Date.now() - s.lastSeenAt > 24 * 3600 * 1000) users.touchSession(s.sid);
  req.user = s.user;
  req.sessionToken = token;
  res.locals.user = s.user;
  res.locals.unread = act.unreadCount(s.user.id);
  next();
}
const setSessionCookie = (res, token) => res.cookie('oikres_sid', token, { httpOnly: true, sameSite: 'lax', secure: secure(), maxAge: 30 * 86400000 });

// Flash messages travel in a short-lived signed cookie, so they work for guests too.
function flash(req, res, next) {
  const raw = req.cookies.oikres_flash;
  if (raw) {
    res.clearCookie('oikres_flash');
    const [body, sig] = String(raw).split('.');
    if (body && sig && safeEq(sig, hmac('flash:' + body).slice(0, 24))) {
      try { res.locals.flash = JSON.parse(Buffer.from(body, 'base64url').toString()).slice(0, 3); } catch (e) { /* ignore a damaged cookie */ }
    }
  }
  const pending = [];
  req.flash = (type, msg) => pending.push({ type, msg: String(msg).slice(0, 300) });
  const redirect = res.redirect.bind(res);
  res.redirect = (...a) => {
    if (pending.length) { const body = Buffer.from(JSON.stringify(pending)).toString('base64url'); res.cookie('oikres_flash', body + '.' + hmac('flash:' + body).slice(0, 24), { httpOnly: true, sameSite: 'lax', secure: secure(), maxAge: 60000 }); }
    return redirect(...a);
  };
  next();
}

// ---- guards
function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.method !== 'GET') return res.status(401).json({ error: 'Please sign in.' });
  res.redirect('/login?returnTo=' + encodeURIComponent(req.originalUrl));
}
function requireVerified(req, res, next) {
  if (req.user.emailVerifiedAt) return next();
  req.flash('warn', 'Verify your email address first. We sent you a link when you registered.');
  res.redirect('/account');
}
function requireAdmin(req, res, next) {
  if (req.user && req.user.isAdmin) return next();
  res.status(404).render('404', { title: 'Page not found', noindex: true });
}
// When an administrator is viewing the site as another user, show a banner with a way back.
function impersonation(req, res, next) {
  const c = req.cookies.oikres_admin_return;
  if (c && req.user) {
    const [tok, sig] = String(c).split('.');
    if (tok && sig && safeEq(sig, hmac('imp:' + tok).slice(0, 24))) {
      const s = users.findSession(tok);
      if (s && s.expiresAt > Date.now() && s.user.isAdmin && s.user.status === 'active' && s.user.id !== req.user.id) {
        req.impersonator = s.user;
        req.adminReturnToken = tok;
        res.locals.impersonating = { by: s.user.name };
      }
    }
  }
  next();
}
const setImpersonationCookie = (res, token) => res.cookie('oikres_admin_return', token + '.' + hmac('imp:' + token).slice(0, 24), { httpOnly: true, sameSite: 'lax', secure: secure(), maxAge: 8 * 3600 * 1000 });

// Maintenance mode: everyone except administrators sees a friendly pause page.
function maintenance(req, res, next) {
  const m = site.get().maintenance;
  if (!m.enabled || (req.user && (req.user.isAdmin || req.impersonator))) return next();
  if (/^\/(login|logout|forgot|reset\/|healthz|stop-impersonating)/.test(req.path)) return next();
  res.status(503).set('Retry-After', '3600').render('maintenance', { title: 'Be right back', noindex: true, message: m.message });
}

const wrap = (fn) => (req, res, next) => { try { Promise.resolve(fn(req, res, next)).catch(next); } catch (e) { next(e); } };

module.exports = { impersonation, setImpersonationCookie, maintenance, requestLog, locals, anon, csrf, sessionLoader, setSessionCookie, flash, requireAuth, requireVerified, requireAdmin, wrap, hmac };
