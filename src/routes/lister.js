const express = require('express');
const C = require('../config/constants');
const cfg = require('../config');
const listings = require('../repositories/listings');
const listers = require('../repositories/listers');
const placesSvc = require('../services/places');
const act = require('../repositories/activity');
const svc = require('../services/listings');
const media = require('../services/media');
const { isUid, clean, normalisePhone } = require('../lib/util');
const { requireAuth, requireVerified, wrap } = require('../middleware/core');
const { audit } = require('../services/notify');

const router = express.Router();
router.use(requireAuth);
router.use((req, res, next) => {
  const profile = listers.byUserId(req.user.id);
  if (!profile) return res.redirect('/account/become-lister');
  req.profile = profile;
  res.locals.profile = profile;
  res.locals.area = 'lister';
  next();
});

const own = (req) => (isUid(req.params.id) ? listings.ownByUid(req.params.id, req.user.id) : null);

function form(res, { state, errors = {}, listing = null, status = 200 }) {
  const f = placesSvc.forForm();
  if (!state.state && !listing) state.state = placesSvc.defaultState(f);
  res.status(status).render('lister/form', { title: listing ? 'Edit lodge' : 'Add a lodge', nav: 'lodges', hideNav: true, ...f, state, errors, listing, noindex: true, uploadsEnabled: true });
}

router.get('/', wrap((req, res) => {
  const list = listings.forLister(req.user.id);
  const ids = list.map((l) => l.id);
  const days = act.dailyCounts(7, ids);
  const fb = act.feedbackFor(ids);
  const feedback = {};
  list.forEach((l) => { if (fb[l.id]) feedback[l._id] = { total: fb[l.id].total, replied: fb[l.id].replied }; });
  const totals = list.reduce((t, l) => ({ views: t.views + l.counters.views, clicks: t.clicks + l.counters.contactClicks, saves: t.saves + l.counters.saves }), { views: 0, clicks: 0, saves: 0 });
  res.render('lister/stats', { title: 'Your stats', nav: 'stats', listings: list, totals, days, feedback, liveCount: list.filter((l) => C.PUBLIC_STATUSES.includes(l.status)).length, maxDay: Math.max(1, ...days.map((d) => d.views)), noindex: true });
}));

router.get('/lodges', (req, res) => res.render('lister/lodges', { title: 'Your lodges', nav: 'lodges', listings: listings.forLister(req.user.id), noindex: true }));
router.get('/lodges/new', requireVerified, (req, res) => form(res, { state: svc.blankState(req.profile) }));

function persist(req, res, existing) {
  const r = svc.saveFromForm({ user: req.user, profile: req.profile, existing, body: req.body });
  if (!r.ok) return form(res, { state: r.state, errors: r.errors, listing: existing, status: 422 });
  req.flash('success', r.autoLive ? 'Your lodge is live.' : r.needsReview ? 'Submitted for review. We will email you when it is approved.' : 'Draft saved. Submit it when you are ready.');
  res.redirect('/lister/lodges');
}
router.post('/lodges', requireVerified, wrap((req, res) => persist(req, res, null)));

router.get('/lodges/:id/edit', wrap((req, res, next) => {
  const l = own(req);
  if (!l || !svc.EDITABLE.includes(l.status)) return next();
  form(res, { state: svc.stateFrom(l), listing: l });
}));
router.post('/lodges/:id', requireVerified, wrap((req, res, next) => {
  const l = own(req);
  if (!l || !svc.EDITABLE.includes(l.status)) return next();
  persist(req, res, l);
}));

router.post('/lodges/:id/reconfirm', wrap((req, res) => {
  const l = own(req);
  if (!l || !svc.canReconfirm(l)) req.flash('error', 'This lodge cannot be reconfirmed right now.');
  else { svc.reconfirm(l); req.flash('success', 'Thanks. "' + l.title + '" is confirmed as available.'); }
  res.redirect('/lister/lodges');
}));
router.post('/lodges/:id/rented', wrap((req, res) => {
  const l = own(req);
  if (l && (C.PUBLIC_STATUSES.includes(l.status) || l.status === 'hidden')) { listings.update(l.id, { status: 'rented', rentedAt: Date.now() }); req.flash('success', 'Marked as rented. It no longer appears in search.'); }
  res.redirect('/lister/lodges');
}));
router.post('/lodges/:id/relist', wrap((req, res) => {
  const l = own(req);
  if (l && l.status === 'rented') {
    if (!l.publishedAt) { req.flash('error', 'Submit this lodge for review first.'); return res.redirect('/lister/lodges/' + l._id + '/edit'); }
    svc.reconfirm(l);
    req.flash('success', 'Available again. Update the spaces that are free.');
    return res.redirect('/lister/lodges/' + l._id + '/availability');
  }
  res.redirect('/lister/lodges');
}));
router.post('/lodges/:id/delete', wrap((req, res) => {
  const l = own(req);
  if (l) { listings.update(l.id, { status: 'deleted' }); req.flash('success', 'Lodge deleted.'); }
  res.redirect('/lister/lodges');
}));

router.get('/lodges/:id/availability', wrap((req, res, next) => {
  const l = own(req);
  if (!l) return next();
  res.render('lister/availability', { title: 'Update availability', nav: 'lodges', l, noindex: true });
}));
router.post('/lodges/:id/availability', wrap((req, res, next) => {
  const l = own(req);
  if (!l) return next();
  svc.updateAvailability(l, (uid) => req.body['spaces_' + uid]);
  req.flash('success', 'Availability updated.');
  res.redirect('/lister/lodges');
}));

router.get('/profile', (req, res) => res.render('lister/profile', { title: 'Lister profile', nav: 'profile', errors: {}, noindex: true }));
router.post('/profile', wrap((req, res) => {
  const p = req.profile;
  const errors = {};
  const displayName = clean(req.body.displayName, 60);
  const whatsappNumber = normalisePhone(req.body.whatsapp);
  if (displayName.length < 2) errors.displayName = 'Enter the name tenants will see.';
  if (!whatsappNumber) errors.whatsapp = 'Enter a valid Nigerian WhatsApp number.';
  if (Object.keys(errors).length) return res.status(422).render('lister/profile', { title: 'Lister profile', nav: 'profile', errors, noindex: true });
  const patch = { displayName, businessName: clean(req.body.businessName, 60) || null, type: req.body.type === 'landlord' ? 'landlord' : 'agent' };
  if (whatsappNumber !== p.whatsappNumber) Object.assign(patch, { whatsappNumber, phoneVerified: 0, phoneVerifiedAt: null }); // a new number must be verified again
  const newId = media.claimIdDocument(clean(req.body.idPublicId, 20), req.user);
  if (newId) {
    if (p.verification.idDocument) media.removePrivateFile(p.verification.idDocument.publicId);
    Object.assign(patch, { idFile: newId, idUploadedAt: Date.now(), idPurgeAfter: null, idStatus: 'submitted', idChecked: 0, idType: C.ID_TYPES.some((t) => t.value === req.body.idType) ? req.body.idType : 'nin' });
  }
  listers.update(p.id, patch);
  audit(req.user, 'lister.profile_updated', 'ListerProfile', p.id, '');
  req.flash('success', 'Profile saved.');
  res.redirect('/lister/profile');
}));

module.exports = router;
