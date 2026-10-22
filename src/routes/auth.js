const express = require('express');
const auth = require('../services/auth');
const users = require('../repositories/users');
const cfg = require('../config');
const { safeReturnTo } = require('../lib/util');
const { authLimiter, mailLimiter } = require('../middleware/security');
const { requireAuth, setSessionCookie, wrap } = require('../middleware/core');
const { ValidationError } = require('../lib/errors');
const site = require('../services/site');
const { audit } = require('../services/notify');

const router = express.Router();
const sign = (res, user) => setSessionCookie(res, auth.startSession(user.id));

const closed = (res) => res.status(403).render('message', { title: 'Registration paused', heading: 'New sign-ups are paused', text: 'Please check back soon, or contact us if you need help.', href: '/', label: 'Back home', noindex: true });
router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  if (!site.get().registrationOpen) return closed(res);
  res.render('register', { title: 'Create an account', form: {}, errors: {}, returnTo: safeReturnTo(req.query.returnTo, '/'), noindex: true });
});

router.post('/register', authLimiter, wrap(async (req, res) => {
  if (!site.get().registrationOpen) return closed(res);
  const returnTo = safeReturnTo(req.body.returnTo, '/');
  try {
    const user = await auth.register(req.body);
    sign(res, user);
    req.flash('success', cfg.emailVerificationRequired ? 'Welcome to Oikres. Check your email to verify your address.' : 'Welcome to Oikres.');
    res.redirect(returnTo);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    res.status(422).render('register', { title: 'Create an account', form: err.form || {}, errors: err.errors, returnTo, noindex: true });
  }
}));

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'Sign in', form: {}, error: '', returnTo: safeReturnTo(req.query.returnTo, '/'), noindex: true });
});

router.post('/login', authLimiter, wrap(async (req, res) => {
  const returnTo = safeReturnTo(req.body.returnTo, '/');
  try {
    const user = await auth.authenticate(req.body.email, req.body.password);
    sign(res, user);
    res.redirect(returnTo);
  } catch (err) {
    res.status(401).render('login', { title: 'Sign in', form: { email: String(req.body.email || '').slice(0, 120) }, error: err.message, returnTo, noindex: true });
  }
}));

router.post('/logout', (req, res) => {
  if (req.sessionToken) users.deleteSession(req.sessionToken);
  res.clearCookie('oikres_sid');
  res.redirect('/');
});

router.post('/stop-impersonating', requireAuth, (req, res) => {
  if (!req.impersonator) return res.redirect('/');
  const target = req.user;
  users.deleteSession(req.sessionToken);
  setSessionCookie(res, req.adminReturnToken);
  res.clearCookie('oikres_admin_return');
  audit(req.impersonator, 'user.impersonate_end', 'User', target.id, target.email);
  res.redirect('/admin/users/' + target.uid);
});

router.get('/verify-email/:token', wrap((req, res) => {
  if (!auth.verifyEmail(req.params.token)) {
    return res.status(400).render('message', { title: 'Link expired', heading: 'This link has expired', text: 'Sign in and request a new verification email from your account page.', href: '/account', label: 'Go to account', noindex: true });
  }
  res.render('message', { title: 'Email verified', heading: 'Email verified', text: 'Thank you. You can now list lodges and receive updates.', href: '/', label: 'Browse lodges', noindex: true });
}));

router.post('/resend-verification', requireAuth, mailLimiter, wrap(async (req, res) => {
  if (!req.user.emailVerifiedAt) { await auth.sendVerification(req.user); req.flash('success', 'Verification email sent. Check your inbox.'); }
  res.redirect('/account');
}));

router.get('/forgot', (req, res) => res.render('forgot', { title: 'Reset your password', sent: false, noindex: true }));
router.post('/forgot', authLimiter, mailLimiter, wrap(async (req, res) => {
  await auth.requestReset(req.body.email);
  res.render('forgot', { title: 'Reset your password', sent: true, noindex: true });
}));

router.get('/reset/:token', (req, res) => {
  if (!auth.resetTokenValid(req.params.token)) return res.status(400).render('message', { title: 'Link expired', heading: 'This link has expired', text: 'Request a new password reset link.', href: '/forgot', label: 'Reset password', noindex: true });
  res.render('reset', { title: 'Choose a new password', token: req.params.token, error: '', noindex: true });
});
router.post('/reset/:token', authLimiter, wrap(async (req, res) => {
  try {
    if (!(await auth.finishReset(req.params.token, String(req.body.password || '')))) return res.redirect('/forgot');
    req.flash('success', 'Password changed. Sign in with your new password.');
    res.redirect('/login');
  } catch (err) {
    res.status(422).render('reset', { title: 'Choose a new password', token: req.params.token, error: err.message, noindex: true });
  }
}));

module.exports = router;
