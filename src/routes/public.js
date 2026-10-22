const express = require('express');
const cfg = require('../config');
const C = require('../config/constants');
const listings = require('../repositories/listings');
const areasRepo = require('../repositories/areas');
const placesRepo = require('../repositories/places');
const adsRepo = require('../repositories/ads');
const adsSvc = require('../services/ads');
const marketRepo = require('../repositories/market');
const welcome = require('../services/welcome');
const reviews = require('../repositories/reviews');
const act = require('../repositories/activity');
const { clean, toInt, isUid } = require('../lib/util');
const { isBot, waLimiter, reportLimiter } = require('../middleware/security');
const { wrap } = require('../middleware/core');
const { notify, audit } = require('../services/notify');
const { mediaSrc, absolute } = require('../lib/images');
const site = require('../services/site');

const router = express.Router();
const PAGE_SIZE = 12;
const isPublic = (s) => C.PUBLIC_STATUSES.includes(s);

const { savedSetFor } = require('../services/saved');

router.get('/', wrap((req, res) => {
  const q = clean(req.query.q, 60);
  // Each list only offers what fits the one before it, and a stale value (an area from another state) is dropped.
  const states = placesRepo.listStates({ activeOnly: true });
  const stateDoc = states.find((s) => s.slug === clean(req.query.state, 60));
  const campuses = placesRepo.listCampuses({ activeOnly: true, stateId: stateDoc && stateDoc.id });
  const campusDoc = campuses.find((c) => c.slug === clean(req.query.campus, 60));
  const areas = areasRepo.list({ activeOnly: true, stateId: stateDoc && stateDoc.id });
  const areaDoc = areas.find((a) => a.slug === clean(req.query.area, 60));
  const type = C.PROPERTY_TYPES.find((t) => t.value === req.query.type);
  const min = toInt(req.query.min, 0, 1e9) || 0;
  const max = toInt(req.query.max, 0, 1e9) || 0;
  const roommate = req.query.roommate === '1';
  const amenities = [].concat(req.query.amenities || []).filter((a) => C.AMENITIES.some((x) => x.value === a));
  const sort = ['new', 'price_asc', 'price_desc'].includes(req.query.sort) ? req.query.sort : 'new';
  const page = Math.max(1, toInt(req.query.page, 1, 500) || 1);

  const { total, rows } = listings.browse({ stateId: stateDoc && stateDoc.id, campusId: campusDoc && campusDoc.id, areaId: areaDoc && areaDoc.id, propertyType: type && type.value, min, max, roommate, amenities, q, sort, page, size: PAGE_SIZE });
  const keep = new URLSearchParams();
  Object.entries(req.query).forEach(([k, v]) => { if (k !== 'page' && k !== 'partial') [].concat(v).forEach((x) => keep.append(k, x)); });
  const link = (p) => { const s = new URLSearchParams(keep); if (p > 1) s.set('page', p); const str = s.toString(); return '/' + (str ? '?' + str : ''); };
  const hasMore = page * PAGE_SIZE < total;
  const data = { listings: rows, savedSet: savedSetFor(req.user, rows), total, page, hasMore, nextUrl: hasMore ? link(page + 1) : null, prevUrl: page > 1 ? link(page - 1) : null };
  if (req.query.partial === '1') return res.render('partials/cards-more', data);
  // Ads appear inside the first page of an ordinary browse (not while someone is searching for words).
  let adList = [];
  if (page === 1 && !q) {
    adList = adsRepo.forPlacement('lodges', { stateId: (stateDoc || campusDoc || {}).stateId || (stateDoc && stateDoc.id), campusId: campusDoc && campusDoc.id });
    if (adList.length) { adsRepo.seen(adList.map((a) => a.id)); data.mixed = adsSvc.mix(rows, adList); }
  }
  res.render('home', {
    ...data, states, campuses, areas, q, amenities, sort, activeFilters: !!(stateDoc || campusDoc || areaDoc || type || min || max || amenities.length || roommate || q),
    f: { state: stateDoc ? stateDoc.slug : '', campus: campusDoc ? campusDoc.slug : '', area: areaDoc ? areaDoc.slug : '', type: type ? type.value : '', min: min || '', max: max || '', roommate },
    showStateOnAreas: states.length > 1 && !stateDoc,
    nav: 'browse',
    // The title follows the place being browsed, so it stays right as new states and campuses are added.
    title: campusDoc ? 'Student lodges near ' + campusDoc.name : stateDoc ? 'Student lodges in ' + stateDoc.name : 'Student lodges near UNIZIK, Awka',
    description: campusDoc || stateDoc ? 'Find student lodges, self-contains and room-shares ' + (campusDoc ? 'near ' + campusDoc.name : 'in ' + stateDoc.name) + '. See the full move-in cost before you call.'
      : 'Find student lodges, self-contains and room-shares near UNIZIK in Ifite, Amansea and Awka. See the full move-in cost before you call.'
  });
}));

// Ads go through here so clicks can be counted, then on to wherever the administrator pointed them.
router.get('/ads/:uid/go', wrap((req, res, next) => {
  if (!isUid(req.params.uid)) return next();
  const ad = adsRepo.byUid(req.params.uid);
  if (!ad || !ad.isActive || ad.linkType === 'none') return next();
  if (!isBot(req)) adsRepo.clicked(ad.id);
  if (ad.linkType === 'whatsapp') return res.redirect('https://wa.me/' + ad.linkValue.replace(/\D/g, '') + '?text=' + encodeURIComponent('Hi, I saw your ad on ' + site.get().name + '.'));
  res.redirect(ad.linkValue);
}));

router.get('/lodges/:slug', wrap((req, res, next) => {
  const l = listings.bySlug(clean(req.params.slug, 100));
  if (!l) return next();
  const isOwner = !!req.user && l.listerId === req.user.id;
  const isAdmin = !!req.user && req.user.isAdmin;
  if (!isPublic(l.status) && l.status !== 'rented' && !isOwner && !isAdmin) return next();
  if (isPublic(l.status) && !isBot(req) && !isOwner && !isAdmin && !act.eventSince('view', l.id, req.anonId, 6 * 3600 * 1000)) act.recordEvent('view', l.id, req.anonId, req.user && req.user.id);
  const similar = listings.similar(l.area && l.area.id, l.id, 4);
  const cover = l.media.find((m) => m.type === 'image');
  const where = [l.junction, l.area && l.area.name].filter(Boolean).join(', ');
  res.render('listing', {
    l, similar, listerRating: reviews.summary(l.listerId), savedSet: savedSetFor(req.user, [l, ...similar]), isOwner, isAdmin,
    typeLabel: (C.PROPERTY_TYPES.find((t) => t.value === l.propertyType) || {}).label || 'Lodge', where,
    nav: 'browse', hideNav: true, title: l.title,
    description: 'From ' + res.locals.naira(l.priceFrom) + ' ' + res.locals.periodLabel(l.periodFrom) + ' in ' + where + '. Move-in total ' + res.locals.naira(l.moveInFrom) + '.',
    ogImage: cover ? absolute(mediaSrc(cover, 'og')) : '', noindex: !isPublic(l.status)
  });
}));

// Records the click, then opens WhatsApp with a prefilled message containing the listing link.
router.get('/lodges/:slug/whatsapp', waLimiter, wrap((req, res, next) => {
  const l = listings.bySlug(clean(req.params.slug, 100));
  if (!l) return next();
  if (!isPublic(l.status)) return res.redirect('/lodges/' + l.slug);
  const isOwner = !!req.user && l.listerId === req.user.id;
  if (!isBot(req) && !isOwner && !act.eventSince('contact_click', l.id, req.anonId, 3600 * 1000)) act.recordEvent('contact_click', l.id, req.anonId, req.user && req.user.id);
  const unit = isUid(String(req.query.unit)) ? l.units.find((u) => u._id === req.query.unit) : null;
  const msg = "Hi, I'm interested in this lodge you listed on " + site.get().name + (unit ? ' (' + unit.label + ')' : '') + '. ' + cfg.baseUrl + '/lodges/' + l.slug;
  res.redirect('https://wa.me/' + l.listerProfile.whatsappNumber.replace(/\D/g, '') + '?text=' + encodeURIComponent(msg));
}));

router.get('/lodges/:slug/report', wrap((req, res, next) => {
  const l = listings.bySlug(clean(req.params.slug, 100));
  if (!l || !isPublic(l.status)) return next();
  res.render('report', { l, title: 'Report this lodge', noindex: true, nav: 'browse', hideNav: true });
}));

router.post('/lodges/:slug/report', reportLimiter, wrap((req, res, next) => {
  const l = listings.bySlug(clean(req.params.slug, 100));
  if (!l || !isPublic(l.status)) return next();
  const reason = C.REPORT_REASONS.find((r) => r.value === req.body.reason);
  if (!reason) { req.flash('error', 'Choose a reason for your report.'); return res.redirect('/lodges/' + l.slug + '/report'); }
  const key = req.user ? 'u:' + req.user.id : 'a:' + req.anonId;
  if (act.reportExists(l.id, key)) { req.flash('info', 'You already reported this lodge. Our team will look at it.'); return res.redirect('/lodges/' + l.slug); }
  const distinct = act.addReport({ listingId: l.id, reporterId: req.user && req.user.id, reporterKey: key, reason: reason.value, note: clean(req.body.note, 500) });
  listings.update(l.id, { reportCount: distinct });
  if (distinct >= site.rules().reportsToAutoHide) {
    listings.update(l.id, { status: 'hidden', hiddenReason: 'reports' });
    audit(null, 'listing.auto_hidden', 'Listing', l.id, distinct + ' open reports');
    notify(l.listerId, { type: 'listing', title: 'Your lodge was hidden for review', body: '"' + l.title + '" received several reports and is hidden while our team checks it.', link: '/lister/lodges' });
  }
  req.flash('success', 'Thank you. Our team will review your report.');
  res.redirect('/lodges/' + l.slug);
}));

// The introduction popup, as an HTML fragment for public/js/welcome.js. Administrators can preview it even when it is switched off.
router.get('/welcome', (req, res, next) => {
  const preview = !!(req.user && req.user.isAdmin && req.query.preview === '1');
  if (!welcome.get().enabled && !preview) return next();
  res.set('Cache-Control', 'no-cache').render('partials/welcome', { w: welcome.view(site.get().name) });
});

router.get('/saved', wrap((req, res) => {
  let list = [];
  if (req.user) list = listings.cardsByIds(act.savedListingIds(req.user.id), false);
  const items = req.user ? marketRepo.savedBy(req.user.id) : [];
  const tab = req.query.tab === 'items' ? 'items' : 'lodges';
  res.render('saved', { listings: list, items, tab, savedSet: new Set(list.map((l) => String(l._id))), savedItems: new Set(items.map((i) => i.id)), title: 'Saved', nav: 'saved', noindex: true });
}));

// Generated so its version changes with every server start: browsers then always swap out the old one.
const SW_TEMPLATE = require('fs').readFileSync(require('path').join(__dirname, '..', 'assets', 'sw.js'), 'utf8');
router.get('/sw.js', (req, res) => {
  res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Service-Worker-Allowed': '/' }).type('text/javascript')
    .send(SW_TEMPLATE.replace('__VERSION__', cfg.assetVersion));
});
router.get('/manifest.webmanifest', (req, res) => {
  const s = site.get(); const t = site.themeMeta();
  const mime = (u) => ({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[(u.split('.').pop() || '').toLowerCase()] || 'image/png');
  const icons = s.iconUrl
    ? [{ src: s.iconUrl, sizes: '192x192', type: mime(s.iconUrl), purpose: 'any' }, { src: s.iconUrl, sizes: '512x512', type: mime(s.iconUrl), purpose: 'any' }, { src: s.iconUrl, sizes: '512x512', type: mime(s.iconUrl), purpose: 'maskable' }]
    : [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }];
  res.type('application/manifest+json').set('Cache-Control', 'no-cache').send(JSON.stringify({
    name: s.name, short_name: s.name.slice(0, 12), description: s.description, id: '/', start_url: '/?source=pwa', scope: '/', display: 'standalone', orientation: 'portrait',
    background_color: t.light, theme_color: t.primary, categories: ['lifestyle', 'business'], icons,
    shortcuts: [{ name: 'Browse lodges', url: '/' }, { name: 'Market', url: '/market' }, { name: 'Saved lodges', url: '/saved' }] }));
});
router.get('/offline', (req, res) => res.render('offline', { title: 'You are offline', noindex: true }));
router.get('/privacy', (req, res) => res.render('privacy', { title: 'Privacy policy' }));
router.get('/terms', (req, res) => res.render('terms', { title: 'Terms of use' }));
router.get('/help', (req, res) => res.render('help', { title: 'Help and safety tips', nav: 'help', tour: welcome.get().enabled ? welcome.view(site.get().name) : null }));

router.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /admin\nDisallow: /account\nDisallow: /lister\nDisallow: /api\nDisallow: /login\nDisallow: /register\nDisallow: /lodges/*/whatsapp\nDisallow: /lodges/*/report\nDisallow: /u/\nDisallow: /reviews/\nDisallow: /ads/\nDisallow: /market/sell\nDisallow: /market/mine\nDisallow: /market/*/whatsapp\nDisallow: /market/*/report\nDisallow: /market/*/edit\n\nSitemap: ' + cfg.baseUrl + '/sitemap.xml\n'));
router.get('/sitemap.xml', wrap((req, res) => {
  const urls = ['', '/market', '/help', '/privacy', '/terms'].map((p) => '<url><loc>' + cfg.baseUrl + p + '</loc></url>')
    .concat(listings.sitemap().map((r) => '<url><loc>' + cfg.baseUrl + '/lodges/' + r.slug + '</loc><lastmod>' + new Date(r.updated_at).toISOString() + '</lastmod></url>'))
    .concat(marketRepo.sitemap().map((r) => '<url><loc>' + cfg.baseUrl + '/market/' + r.slug + '</loc><lastmod>' + new Date(r.updated_at).toISOString() + '</lastmod></url>'));
  res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls.join('') + '</urlset>');
}));

module.exports = router;
