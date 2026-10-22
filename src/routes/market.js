const express = require('express');
const C = require('../config/constants');
const cfg = require('../config');
const market = require('../repositories/market');
const placesRepo = require('../repositories/places');
const listers = require('../repositories/listers');
const reviews = require('../repositories/reviews');
const flags = require('../repositories/flags');
const adsRepo = require('../repositories/ads');
const adsSvc = require('../services/ads');
const svc = require('../services/market');
const placesSvc = require('../services/places');
const site = require('../services/site');
const { clean, toInt } = require('../lib/util');
const { isBot, waLimiter, reportLimiter, postLimiter } = require('../middleware/security');
const { savedItemsFor } = require('../services/saved');
const { requireAuth, requireVerified, wrap } = require('../middleware/core');
const { notify, audit } = require('../services/notify');
const { mediaSrc, absolute } = require('../lib/images');

const router = express.Router();
const PAGE_SIZE = 12;
const slugOf = (req) => clean(req.params.slug, 100);
const visitorKey = (req) => (req.user ? 'u' + req.user.id : 'a' + req.anonId);

router.get('/', wrap((req, res) => {
  const q = clean(req.query.q, 60);
  const states = placesRepo.listStates({ activeOnly: true });
  const stateDoc = states.find((s) => s.slug === clean(req.query.state, 60));
  const campuses = placesRepo.listCampuses({ activeOnly: true, stateId: stateDoc && stateDoc.id });
  const campusDoc = campuses.find((c) => c.slug === clean(req.query.campus, 60));
  const category = C.MARKET_CATEGORIES.find((c) => c.value === req.query.category);
  const condition = C.MARKET_CONDITIONS.find((c) => c.value === req.query.condition);
  const min = toInt(req.query.min, 0, 1e9) || 0;
  const max = toInt(req.query.max, 0, 1e9) || 0;
  const sort = ['new', 'price_asc', 'price_desc'].includes(req.query.sort) ? req.query.sort : 'new';
  const page = Math.max(1, toInt(req.query.page, 1, 500) || 1);
  const { total, rows } = market.browse({ stateId: stateDoc && stateDoc.id, campusId: campusDoc && campusDoc.id, category: category && category.value, condition: condition && condition.value, min, max, q, sort, page, size: PAGE_SIZE });
  const keep = new URLSearchParams();
  Object.entries(req.query).forEach(([k, v]) => { if (k !== 'page' && k !== 'partial') [].concat(v).forEach((x) => keep.append(k, x)); });
  const link = (p) => { const s = new URLSearchParams(keep); if (p > 1) s.set('page', p); const str = s.toString(); return '/market' + (str ? '?' + str : ''); };
  const hasMore = page * PAGE_SIZE < total;
  const data = { items: rows, savedItems: savedItemsFor(req.user, rows), total, page, hasMore, nextUrl: hasMore ? link(page + 1) : null, prevUrl: page > 1 ? link(page - 1) : null };
  if (req.query.partial === '1') return res.render('partials/item-cards-more', data);
  if (page === 1 && !q) {
    const adList = adsRepo.forPlacement('market', { stateId: (stateDoc || campusDoc || {}).stateId || (stateDoc && stateDoc.id), campusId: campusDoc && campusDoc.id });
    if (adList.length) { adsRepo.seen(adList.map((a) => a.id)); data.mixed = adsSvc.mix(rows, adList); }
  }
  res.render('market/index', { ...data, states, campuses, q, sort, nav: 'market', title: campusDoc ? 'Student market near ' + campusDoc.name : stateDoc ? 'Student market in ' + stateDoc.name : 'Student market',
    description: 'Buy and sell books, phones, laptops, furniture and more with students' + (campusDoc ? ' near ' + campusDoc.name : ' near you') + '. Contact sellers on WhatsApp.',
    activeFilters: !!(stateDoc || campusDoc || category || condition || min || max || q),
    f: { state: stateDoc ? stateDoc.slug : '', campus: campusDoc ? campusDoc.slug : '', category: category ? category.value : '', condition: condition ? condition.value : '', min: min || '', max: max || '' } });
}));

// ---- Selling: any signed-in person with a verified email
function form(res, { state, errors = {}, item = null, status = 200 }) {
  const f = placesSvc.forForm();
  res.status(status).render('market/form', { title: item ? 'Edit item' : 'Sell an item', nav: 'sell', hideNav: true, states: f.states, campuses: f.campuses, state, errors, item, noindex: true, scripts: ['places.js', 'uploader.js', 'market-form.js'] });
}
router.get('/sell', requireAuth, requireVerified, (req, res) => {
  const f = placesSvc.forForm();
  form(res, { state: svc.blankState(req.user, listers.byUserId(req.user.id), placesSvc.defaultState(f)) });
});
router.post('/sell', requireAuth, requireVerified, postLimiter, wrap((req, res) => {
  const r = svc.saveFromForm({ user: req.user, existing: null, body: req.body });
  if (!r.ok) return form(res, { state: r.state, errors: r.errors, status: 422 });
  req.flash('success', r.needsReview ? 'Submitted for review. We will let you know when it is live.' : 'Your item is live.');
  res.redirect('/market/mine');
}));

router.get('/mine', requireAuth, wrap((req, res) => {
  res.render('market/mine', { title: 'Your items', nav: 'myitems', items: market.forSeller(req.user.id), noindex: true });
}));

const own = (req) => { const i = market.bySlug(slugOf(req)); return i && i.sellerId === req.user.id && i.status !== 'deleted' ? i : null; };

router.get('/:slug/edit', requireAuth, wrap((req, res, next) => {
  const i = own(req);
  if (!i) return next();
  form(res, { state: svc.stateFrom(i), item: i });
}));
router.post('/:slug/edit', requireAuth, requireVerified, postLimiter, wrap((req, res, next) => {
  const i = own(req);
  if (!i) return next();
  const r = svc.saveFromForm({ user: req.user, existing: i, body: req.body });
  if (!r.ok) return form(res, { state: r.state, errors: r.errors, item: i, status: 422 });
  req.flash('success', r.needsReview ? 'Saved. It will show again once the team has looked at it.' : 'Item updated.');
  res.redirect('/market/mine');
}));
router.post('/:slug/sold', requireAuth, wrap((req, res, next) => {
  const i = own(req);
  if (!i) return next();
  if (i.status === 'live') {
    market.update(i.id, { status: 'sold', soldAt: Date.now() });
    market.saversOf(i.id).filter((uid) => uid !== req.user.id).forEach((uid) => notify(uid, { type: 'item', title: 'An item you saved was sold', body: '"' + i.title + '" is no longer available.', link: '/saved?tab=items', emailToo: false }));
    req.flash('success', 'Marked as sold. It no longer appears in the market.');
  }
  res.redirect('/market/mine');
}));
router.post('/:slug/relist', requireAuth, wrap((req, res, next) => {
  const i = own(req);
  if (!i) return next();
  if (i.status === 'sold') {
    const review = site.marketReviewRequired() && !req.user.isAdmin;
    market.update(i.id, { status: review ? 'pending' : 'live', soldAt: null, publishedAt: Date.now(), expiresAt: svc.expiryFromNow(), expiryNotifiedAt: null });
    req.flash('success', review ? 'Sent for review.' : 'It is for sale again.');
  }
  res.redirect('/market/mine');
}));
router.post('/:slug/renew', requireAuth, wrap((req, res, next) => {
  const i = own(req);
  if (!i) return next();
  if (i.status === 'live') { market.renew(i.id, C.RULES.marketExpireDays); req.flash('success', 'Renewed. It stays in the market for another ' + C.RULES.marketExpireDays + ' days.'); }
  res.redirect('/market/mine');
}));
router.post('/:slug/delete', requireAuth, wrap((req, res, next) => {
  const i = own(req);
  if (!i) return next();
  svc.removeItem(i);
  req.flash('success', 'Item deleted.');
  res.redirect('/market/mine');
}));

// ---- Detail, contact and reports
router.get('/:slug', wrap((req, res, next) => {
  const i = market.bySlug(slugOf(req));
  if (!i) return next();
  const isOwner = !!req.user && i.sellerId === req.user.id;
  const isAdmin = !!req.user && req.user.isAdmin;
  const expiredLive = i.status === 'live' && i.expired && i.seller.status === 'active';
  const visible = svc.isPublic(i) || (i.status === 'sold' && i.seller.status === 'active') || expiredLive;
  if (!visible && !isOwner && !isAdmin) return next();
  const seller = require('../repositories/users').byId(i.sellerId);
  const lp = listers.byUserId(i.sellerId);
  const similar = svc.isPublic(i) ? market.similar(i.category, i.id, 4) : [];
  if (svc.isPublic(i) && !isOwner && !isAdmin && !isBot(req)) market.recordEvent(i.id, 'view', visitorKey(req));
  const where = [i.pickup, i.campus && i.campus.name, i.state && i.state.name].filter(Boolean).join(', ');
  const abs = (m) => absolute(mediaSrc(m, 'og'));
  const images = i.media.filter((m) => m.type !== 'video');
  // Product data for search engines (only for items that are public).
  const jsonLd = svc.isPublic(i) || i.status === 'sold' ? { '@context': 'https://schema.org', '@type': 'Product', name: i.title, description: (i.description || '').slice(0, 300), category: (C.MARKET_CATEGORIES.find((c) => c.value === i.category) || {}).label,
    image: images.map(abs), itemCondition: 'https://schema.org/' + (i.condition === 'new' ? 'NewCondition' : 'UsedCondition'),
    offers: { '@type': 'Offer', price: i.price, priceCurrency: 'NGN', availability: 'https://schema.org/' + (i.status === 'sold' ? 'SoldOut' : 'InStock'), url: cfg.baseUrl + '/market/' + i.slug } } : null;
  res.render('market/item', { i, similar, jsonLd, expiredLive, savedItems: savedItemsFor(req.user, [i, ...similar]), isOwner, isAdmin, where, sellerRating: reviews.summary(i.sellerId), sellerVerified: !!seller.emailVerifiedAt, lister: lp,
    live: svc.isPublic(i), categoryLabel: (C.MARKET_CATEGORIES.find((c) => c.value === i.category) || {}).label || '', conditionLabel: (C.MARKET_CONDITIONS.find((c) => c.value === i.condition) || {}).label || '',
    nav: 'market', hideNav: true, title: i.title, description: res.locals.naira(i.price) + ' - ' + (where || 'Student market') + '. ' + (i.description || '').slice(0, 120),
    ogImage: (function () { const img = i.media.find((m) => m.type !== 'video'); return img ? absolute(mediaSrc(img, 'og')) : ''; })(), noindex: !svc.isPublic(i) });
}));

router.get('/:slug/whatsapp', waLimiter, wrap((req, res, next) => {
  const i = market.bySlug(slugOf(req));
  if (!i) return next();
  if (!svc.isPublic(i)) return res.redirect('/market/' + i.slug);
  if (!isBot(req) && !(req.user && req.user.id === i.sellerId)) market.recordEvent(i.id, 'contact', visitorKey(req));
  const msg = "Hi, I'm interested in your item \"" + i.title + '" (' + res.locals.naira(i.price) + ') on ' + site.get().name + ' Market. ' + cfg.baseUrl + '/market/' + i.slug;
  res.redirect('https://wa.me/' + i.whatsappNumber.replace(/\D/g, '') + '?text=' + encodeURIComponent(msg));
}));

// Save or un-save an item (the heart). Answers JSON for the page script, or goes back for a plain form post.
router.post('/:slug/save', requireAuth, wrap((req, res, next) => {
  const i = market.bySlug(slugOf(req));
  if (!i || !(svc.isPublic(i) || i.status === 'sold')) return next();
  const saved = market.toggleSaved(req.user.id, i.id);
  if (req.accepts(['json', 'html']) === 'json') return res.json({ saved });
  res.redirect(req.get('referer') || '/market/' + i.slug);
}));

router.get('/:slug/report', wrap((req, res, next) => {
  const i = market.bySlug(slugOf(req));
  if (!i || !svc.isPublic(i)) return next();
  res.render('report-flag', { title: 'Report this item', heading: 'Report this item', subject: i.title, reasons: C.ITEM_REPORT_REASONS, action: '/market/' + i.slug + '/report', back: '/market/' + i.slug, hint: 'Reports are reviewed by the ' + site.get().name + ' team. We never share who reported.', noindex: true, nav: 'market', hideNav: true });
}));
router.post('/:slug/report', reportLimiter, wrap((req, res, next) => {
  const i = market.bySlug(slugOf(req));
  if (!i || !svc.isPublic(i)) return next();
  const reason = C.ITEM_REPORT_REASONS.find((r) => r.value === req.body.reason);
  if (!reason) { req.flash('error', 'Choose a reason for your report.'); return res.redirect('/market/' + i.slug + '/report'); }
  const key = req.user ? 'u:' + req.user.id : 'a:' + req.anonId;
  if (flags.exists('item', i.id, key)) { req.flash('info', 'You already reported this item. Our team will look at it.'); return res.redirect('/market/' + i.slug); }
  const distinct = flags.add({ targetType: 'item', targetId: i.id, subjectUserId: i.sellerId, reporterId: req.user && req.user.id, reporterKey: key, reason: reason.value, note: clean(req.body.note, 500) });
  market.update(i.id, { reportCount: distinct });
  if (distinct >= site.rules().reportsToAutoHide) {
    market.update(i.id, { status: 'hidden', hiddenReason: 'reports' });
    audit(null, 'item.auto_hidden', 'MarketItem', i.id, distinct + ' open reports');
    notify(i.sellerId, { type: 'item', title: 'Your item was hidden for review', body: '"' + i.title + '" received several reports and is hidden while our team checks it.', link: '/market/mine' });
  }
  req.flash('success', 'Thank you. Our team will review your report.');
  res.redirect('/market/' + i.slug);
}));

module.exports = router;
