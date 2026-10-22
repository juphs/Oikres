const express = require('express');
const users = require('../repositories/users');
const listers = require('../repositories/listers');
const listings = require('../repositories/listings');
const act = require('../repositories/activity');
const db = require('../db');
const auth = require('../services/auth');
const media = require('../services/media');
const C = require('../config/constants');
const { clean, normalisePhone } = require('../lib/util');
const { requireAuth, requireVerified, setSessionCookie, wrap } = require('../middleware/core');
const { authLimiter } = require('../middleware/security');
const { audit } = require('../services/notify');

const router = express.Router();
router.use(requireAuth);

router.get('/', wrap((req, res) => {
  res.render('account/profile', { title: 'Your account', nav: 'profile', saved: act.savedCount(req.user.id), savedItemCount: require('../repositories/market').savedCount(req.user.id), profile: listers.byUserId(req.user.id), errors: {}, noindex: true });
}));

router.post('/profile', (req, res) => {
  const name = clean(req.body.name, 60);
  const phoneRaw = clean(req.body.phone, 20);
  const phone = phoneRaw ? normalisePhone(phoneRaw) : null;
  if (name.length < 2 || (phoneRaw && !phone)) {
    req.flash('error', name.length < 2 ? 'Enter your name.' : 'Enter a valid Nigerian phone number, for example 0801 234 5678.');
    return res.redirect('/account');
  }
  users.update(req.user.id, { name, phone, notifyEmail: req.body.emailNotifications === 'on' ? 1 : 0 });
  req.flash('success', 'Profile saved.');
  res.redirect('/account');
});

router.post('/password', authLimiter, wrap(async (req, res) => {
  try {
    await auth.changePassword(req.user, req.body.current, String(req.body.password || ''), null);
    setSessionCookie(res, auth.startSession(req.user.id)); // every old session was ended, so this device gets a new one
    req.flash('success', 'Password changed. Other devices were signed out.');
  } catch (err) { req.flash('error', err.message); }
  res.redirect('/account');
}));

router.get('/notifications', (req, res) => {
  const items = act.listNotifications(req.user.id);
  act.markAllRead(req.user.id);
  res.render('account/notifications', { title: 'Notifications', nav: 'profile', items, noindex: true });
});

router.get('/become-lister', (req, res) => {
  if (listers.byUserId(req.user.id)) return res.redirect('/lister');
  res.render('account/become-lister', { title: 'List your lodges', nav: 'profile', form: {}, errors: {}, noindex: true });
});

router.post('/become-lister', requireVerified, wrap((req, res) => {
  if (listers.byUserId(req.user.id)) return res.redirect('/lister');
  const form = { displayName: clean(req.body.displayName, 60), businessName: clean(req.body.businessName, 60), type: req.body.type === 'landlord' ? 'landlord' : 'agent',
    whatsapp: clean(req.body.whatsapp, 20), idType: C.ID_TYPES.some((t) => t.value === req.body.idType) ? req.body.idType : 'nin' };
  const errors = {};
  const whatsappNumber = normalisePhone(form.whatsapp);
  if (form.displayName.length < 2) errors.displayName = 'Enter the name tenants will see.';
  if (!whatsappNumber) errors.whatsapp = 'Enter a valid Nigerian WhatsApp number, for example 0801 234 5678.';
  if (req.body.agree !== 'on') errors.agree = 'Please confirm to continue.';
  if (Object.keys(errors).length) return res.status(422).render('account/become-lister', { title: 'List your lodges', nav: 'profile', form, errors, noindex: true });
  const idFile = media.claimIdDocument(clean(req.body.idPublicId, 20), req.user);
  listers.create({ userId: req.user.id, displayName: form.displayName, businessName: form.businessName, type: form.type, whatsappNumber, idFile, idType: form.idType });
  audit(req.user, 'lister.registered', 'User', req.user.id, form.displayName);
  req.flash('success', 'Your lister account is ready. Add your first lodge.');
  res.redirect('/lister/lodges/new');
}));

router.post('/delete', authLimiter, wrap(async (req, res) => {
  const user = req.user;
  if (user.isAdmin) { req.flash('error', 'Admin accounts cannot be deleted here.'); return res.redirect('/account'); }
  if (!(await auth.verifyPassword(String(req.body.password || ''), user.passwordHash))) { req.flash('error', 'Password not correct. Your account was not deleted.'); return res.redirect('/account'); }
  require('../services/users').anonymise(user);
  res.clearCookie('oikres_sid');
  res.redirect('/');
}));

module.exports = router;
