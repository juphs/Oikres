const express = require('express');
const path = require('path');
const C = require('../config/constants');
const cfg = require('../config');
const listings = require('../repositories/listings');
const listers = require('../repositories/listers');
const users = require('../repositories/users');
const areasRepo = require('../repositories/areas');
const placesRepo = require('../repositories/places');
const market = require('../repositories/market');
const flags = require('../repositories/flags');
const reviewsRepo = require('../repositories/reviews');
const adsRepo = require('../repositories/ads');
const act = require('../repositories/activity');
const svc = require('../services/listings');
const media = require('../services/media');
const { requireAuth, requireAdmin, wrap } = require('../middleware/core');
const { notify, audit } = require('../services/notify');
const { isUid, isNum, clean, toInt, normalisePhone, safeReturnTo } = require('../lib/util');
const site = require('../services/site');
const auth = require('../services/auth');
const userSvc = require('../services/users');
const { setImpersonationCookie } = require('../middleware/core');

const router = express.Router();
router.use(requireAuth, requireAdmin);
router.use((req, res, next) => { res.locals.area = 'admin'; res.locals.noindex = true; next(); });
router.use('/market', require('./adminMarket'));
router.use('/ads', require('./adminAds'));

const DAY = 86400000;
const PER_PAGE = 30;
const fail = (req, res, msg, to) => { req.flash('error', msg); res.redirect(to); };

router.get('/', wrap((req, res) => {
  const days = act.dailyCounts(7);
  const statusCounts = {};
  listings.statusCounts().forEach((r) => { statusCounts[r.status] = r.n; });
  res.render('admin/dashboard', { title: 'Admin', nav: 'dashboard', pending: listings.countStatus('pending'), listersWaiting: listers.waitingCount(), openReports: act.openReportCount() + flags.openTotal(),
    itemsLive: market.countStatus('live'), itemsPending: market.countStatus('pending'), reviewTotal: reviewsRepo.total(), adsActive: adsRepo.countActive(),
    live: listings.countPublic(), users: users.countActive(), uc: users.counts(), statusCounts, top: listings.topByViews(5), recentUsers: users.recent(6),
    days, recent: listings.pendingOldest(8), maxDay: Math.max(1, ...days.map((d) => d.views)) });
}));

router.get('/listings', wrap((req, res) => {
  const status = Object.keys(C.LISTING_STATUS_LABELS).includes(req.query.status) ? req.query.status : req.query.status === 'all' ? 'all' : 'pending';
  const q = clean(req.query.q, 60);
  const page = Math.max(1, toInt(req.query.page, 1, 1000) || 1);
  const { total, rows } = listings.adminList({ status, q, page, size: PER_PAGE });
  res.render('admin/listings', { title: 'Listings', nav: 'listings', listings: rows, status, q, page, total, pages: Math.ceil(total / PER_PAGE) });
}));

router.get('/listings/:id', wrap((req, res, next) => {
  if (!isUid(req.params.id)) return next();
  const l = listings.byUid(req.params.id);
  if (!l) return next();
  const lister = users.byId(l.listerId);
  res.render('admin/listing', { title: l.title, nav: 'listings', l: { ...l, lister: { name: lister.name, email: lister.email, status: lister.status } }, comp: listings.comparable(l.area && l.area.id, l.propertyType, l.id), reports: act.reportsForListing(l.id) });
}));

router.get('/listings/:id/edit', wrap((req, res, next) => {
  if (!isUid(req.params.id)) return next();
  const l = listings.byUid(req.params.id);
  if (!l) return next();
  res.render('lister/form', { title: 'Edit lodge (admin)', nav: 'listings', hideNav: true, states: placesRepo.listStates(), campuses: placesRepo.listCampuses(), areas: areasRepo.list(), state: svc.stateFrom(l), errors: {}, listing: l, uploadsEnabled: true,
    formAction: '/admin/listings/' + l._id + '/edit', backUrl: '/admin/listings/' + l._id, adminMode: true, noindex: true });
}));
router.post('/listings/:id/edit', wrap((req, res, next) => {
  if (!isUid(req.params.id)) return next();
  const l = listings.byUid(req.params.id);
  if (!l) return next();
  const owner = users.byId(l.listerId);
  const r = svc.saveFromForm({ user: owner, profile: listers.byUserId(owner.id), existing: l, body: req.body, adminEdit: true, actor: req.user });
  if (!r.ok) return res.status(422).render('lister/form', { title: 'Edit lodge (admin)', nav: 'listings', hideNav: true, states: placesRepo.listStates(), campuses: placesRepo.listCampuses(), areas: areasRepo.list(), state: r.state, errors: r.errors, listing: l, uploadsEnabled: true,
    formAction: '/admin/listings/' + l._id + '/edit', backUrl: '/admin/listings/' + l._id, adminMode: true, noindex: true });
  audit(req.user, 'listing.admin_edit', 'Listing', l.id, l.title);
  req.flash('success', 'Lodge updated.');
  res.redirect('/admin/listings/' + l._id);
}));

router.post('/listings/:id/:action', wrap(async (req, res, next) => {
  if (!isUid(req.params.id)) return next();
  const l = listings.byUid(req.params.id);
  if (!l) return next();
  const back = '/admin/listings/' + l._id;
  const { action } = req.params;
  const lister = users.byId(l.listerId);
  if (action === 'approve') {
    if (l.status !== 'pending') return fail(req, res, 'Only pending listings can be approved.', back);
    if (!lister || lister.status !== 'active') return fail(req, res, 'The lister account is not active.', back);
    svc.goLive(l);
    await notify(lister.id, { type: 'listing', title: 'Your lodge is live', body: '"' + l.title + '" was approved and can now be found on Oikres.', link: '/lodges/' + l.slug });
  } else if (action === 'reject') {
    const reason = C.REJECTION_REASONS.find((r) => r.value === req.body.reason);
    if (!reason) return fail(req, res, 'Choose a reason.', back);
    const note = clean(req.body.note, 300);
    const text = reason.label + (note ? ': ' + note : '');
    listings.update(l.id, { status: 'rejected', rejectionReason: text });
    await notify(lister.id, { type: 'listing', title: 'Your lodge needs changes', body: '"' + l.title + '": ' + text, link: '/lister/lodges/' + l._id + '/edit' });
  } else if (action === 'hide' || action === 'suspend') {
    listings.update(l.id, { status: action === 'hide' ? 'hidden' : 'suspended', hiddenReason: 'admin' });
    await notify(lister.id, { type: 'listing', title: 'Your lodge was ' + (action === 'hide' ? 'hidden' : 'suspended'), body: '"' + l.title + '" was removed from search by the Oikres team. Contact support if you think this is a mistake.', link: '/lister/lodges' });
  } else if (action === 'restore') {
    if (!['hidden', 'suspended'].includes(l.status)) return fail(req, res, 'Nothing to restore.', back);
    if (l.publishedAt) svc.goLive(l); else listings.update(l.id, { status: 'pending', hiddenReason: null });
  } else if (action === 'visited') {
    listings.update(l.id, { visitedDone: 1, visitedAt: Date.now(), visitedBy: req.user.id, visitedNote: clean(req.body.note, 300) });
  } else if (action === 'unvisited') {
    listings.update(l.id, { visitedDone: 0, visitedAt: null, visitedBy: null, visitedNote: null });
  } else if (action === 'feature' || action === 'unfeature') {
    listings.update(l.id, { isFeatured: action === 'feature' ? 1 : 0 });
  } else if (action === 'rented') {
    listings.update(l.id, { status: 'rented', rentedAt: Date.now() });
  } else if (action === 'confirm') {
    svc.reconfirm(l);
  } else if (action === 'delete') {
    svc.removeListing(l);
    audit(req.user, 'listing.deleted', 'Listing', l.id, l.title);
    req.flash('success', 'Lodge deleted for good.');
    return res.redirect('/admin/listings');
  } else return next();
  audit(req.user, 'listing.' + action, 'Listing', l.id, l.title);
  req.flash('success', 'Done.');
  res.redirect(back);
}));

router.get('/listers', wrap((req, res) => {
  const q = clean(req.query.q, 60);
  const waiting = req.query.filter !== 'all';
  res.render('admin/listers', { title: 'Listers', nav: 'listers', listers: listers.listForAdmin({ waiting, q }), q, waiting });
}));

router.get('/listers/:id', wrap((req, res, next) => {
  if (!isNum(req.params.id)) return next();
  const p = listers.byId(Number(req.params.id));
  if (!p) return next();
  const u = users.byId(p.userId);
  const doc = p.verification.idDocument;
  res.render('admin/lister', { title: p.displayName, nav: 'listers', p: { ...p, user: { name: u.name, email: u.email, status: u.status, emailVerifiedAt: u.emailVerifiedAt } },
    listings: listings.forListerProfile(p.userId), idUrl: doc ? '/admin/listers/' + p._id + '/id-document' : null });
}));

// ID documents are never public: only an administrator can stream one.
router.get('/listers/:id/id-document', wrap((req, res, next) => {
  if (!isNum(req.params.id)) return next();
  const p = listers.byId(Number(req.params.id));
  const file = p && p.verification.idDocument && p.verification.idDocument.publicId;
  if (!file || !media.FILE_RE.test(file)) return next();
  audit(req.user, 'id_document.viewed', 'ListerProfile', p.id, '');
  res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
  res.sendFile(file, { root: cfg.privateDir, dotfiles: 'deny' }, (err) => { if (err && !res.headersSent) next(); });
}));

router.post('/listers/:id/:action', wrap(async (req, res, next) => {
  if (!isNum(req.params.id)) return next();
  const p = listers.byId(Number(req.params.id));
  if (!p) return next();
  const back = '/admin/listers/' + p._id;
  const v = p.verification;
  const purge = Date.now() + C.RULES.idRetentionDays * DAY;
  switch (req.params.action) {
    case 'phone_verify': listers.update(p.id, { phoneVerified: 1, phoneVerifiedAt: Date.now(), phoneVerifiedBy: req.user.id }); break;
    case 'phone_unverify': listers.update(p.id, { phoneVerified: 0, phoneVerifiedAt: null }); break;
    case 'id_approve':
      if (!v.idDocument) return fail(req, res, 'No ID document was uploaded.', back);
      listers.update(p.id, { idChecked: 1, idCheckedAt: Date.now(), idCheckedBy: req.user.id, idStatus: 'approved', idPurgeAfter: purge });
      await notify(p.userId, { type: 'verification', title: 'ID checked', body: 'Your identity document was checked. The ID checked badge now shows on your lodges.', link: '/lister/profile' });
      break;
    case 'id_reject': {
      const note = clean(req.body.note, 300);
      listers.update(p.id, { idChecked: 0, idStatus: 'rejected', idNote: note, idPurgeAfter: v.idDocument ? purge : null });
      await notify(p.userId, { type: 'verification', title: 'ID could not be checked', body: note || 'Upload a clear photo of a valid ID.', link: '/lister/profile' });
      break;
    }
    case 'notes': listers.update(p.id, { adminNotes: clean(req.body.notes, 1000) }); break;
    case 'suspend_user': users.update(p.userId, { status: 'suspended' }); listings.suspendFor(p.userId); market.hideAllFor(p.userId, 'admin'); users.deleteSessionsFor(p.userId); break;
    case 'unsuspend_user': if (users.byId(p.userId).bannedAt) return fail(req, res, 'This account is banned. Lift the ban from the Users page.', back); users.update(p.userId, { status: 'active' }); break;
    default: return next();
  }
  audit(req.user, 'lister.' + req.params.action, 'ListerProfile', p.id, p.displayName);
  req.flash('success', 'Saved.');
  res.redirect(back);
}));

router.get('/reports', wrap((req, res) => {
  const type = ['lodge', 'item', 'user', 'review'].includes(req.query.type) ? req.query.type : 'lodge';
  const status = ['open', 'dismissed', 'actioned'].includes(req.query.status) ? req.query.status : 'open';
  const counts = { ...flags.openCounts(), lodge: act.openReportCount() };
  res.render('admin/reports', { title: 'Reports', nav: 'reports', type, status, counts, reports: type === 'lodge' ? act.listReports(status) : flags.list(type, status) });
}));

// Reports about items, people and reviews. (Banning is done from the Users routes, so one rule applies everywhere.)
router.post('/flags/:id/:action', wrap(async (req, res, next) => {
  if (!isNum(req.params.id)) return next();
  const f = flags.byId(Number(req.params.id));
  if (!f) return next();
  const back = '/admin/reports?type=' + f.targetType + (req.query.status ? '&status=' + encodeURIComponent(req.query.status) : '');
  const note = clean(req.body.note, 300);
  const { action } = req.params;
  if (action === 'dismiss') flags.setStatus(f.id, 'dismissed', req.user.id, note);
  else if (action === 'hide_item' && f.targetType === 'item') {
    const item = market.byId(f.targetId);
    if (item && ['live', 'pending'].includes(item.status)) {
      market.update(item.id, { status: 'hidden', hiddenReason: 'admin' });
      await notify(item.sellerId, { type: 'item', title: 'Your item was hidden', body: '"' + item.title + '" was hidden after a report. Contact support if you think this is a mistake.', link: '/market/mine' });
    }
    flags.closeOpenFor('item', f.targetId, req.user.id, 'Item hidden');
  } else if (action === 'remove_review' && f.targetType === 'review') {
    reviewsRepo.setStatus(f.targetId, 'removed');
    flags.closeOpenFor('review', f.targetId, req.user.id, 'Review removed');
  } else if (action === 'remove') {
    flags.removeResolved(f.id);
    req.flash('success', 'Report removed.');
    return res.redirect(back);
  } else return next();
  audit(req.user, 'flag.' + action, 'Report', f.id, f.targetType);
  req.flash('success', 'Report updated.');
  res.redirect(back);
}));

router.post('/reports/:id/:action', wrap(async (req, res, next) => {
  if (!isNum(req.params.id)) return next();
  const r = act.reportById(Number(req.params.id));
  if (!r) return next();
  const note = clean(req.body.note, 300);
  const { action } = req.params;
  if (action === 'dismiss') act.setReport(r.id, 'dismissed', req.user.id, note);
  else if (action === 'hide') {
    listings.update(r.listingId, { status: 'hidden', hiddenReason: 'admin' });
    act.closeOpenReports(r.listingId, req.user.id, 'Listing hidden');
    await notify(r.listing.listerId, { type: 'listing', title: 'Your lodge was hidden', body: '"' + r.listing.title + '" was hidden after a report. Contact support if you think this is a mistake.', link: '/lister/lodges' });
  } else if (action === 'remove') {
    act.removeReport(r.id);
    req.flash('success', 'Report removed.');
    return res.redirect('/admin/reports?status=' + (req.query.status || 'dismissed'));
  } else if (action === 'suspend_lister') {
    users.update(r.listing.listerId, { status: 'suspended' });
    listings.suspendFor(r.listing.listerId);
    market.hideAllFor(r.listing.listerId, 'admin');
    users.deleteSessionsFor(r.listing.listerId);
    act.setReport(r.id, 'actioned', req.user.id, note);
  } else return next();
  audit(req.user, 'report.' + action, 'Report', r.id, r.listing.title);
  req.flash('success', 'Report updated.');
  res.redirect('/admin/reports');
}));

router.get('/reference', (req, res) => res.render('admin/reference', { title: 'Places', nav: 'reference', states: placesRepo.listStates(), campuses: placesRepo.listCampuses(), areas: areasRepo.list() }));
const refBack = (res) => res.redirect('/admin/reference');
router.post('/reference/state', wrap((req, res) => {
  try { const id = placesRepo.createState(clean(req.body.name, 60), toInt(req.body.order, 0, 1000) ?? 100); audit(req.user, 'state.create', 'State', id, req.body.name); req.flash('success', 'State added. It now shows in the lodge form and the filters.'); }
  catch (err) { req.flash('error', err.message); }
  refBack(res);
}));
router.post('/reference/state/:id/:action', wrap((req, res, next) => {
  if (!isNum(req.params.id)) return next();
  const st = placesRepo.stateById(Number(req.params.id));
  if (!st) return next();
  if (req.params.action === 'toggle') placesRepo.toggleState(st.id);
  else if (req.params.action === 'order') placesRepo.setStateOrder(st.id, toInt(req.body.order, 0, 1000) ?? st.order);
  else return next();
  audit(req.user, 'state.' + req.params.action, 'State', st.id, st.name);
  refBack(res);
}));
router.post('/reference/campus', wrap((req, res) => {
  try { const id = placesRepo.createCampus(toInt(req.body.state, 1, 1e9), clean(req.body.name, 60), toInt(req.body.order, 0, 1000) ?? 100); audit(req.user, 'campus.create', 'Campus', id, req.body.name); }
  catch (err) { req.flash('error', err.message); }
  refBack(res);
}));
router.post('/reference/campus/:id/:action', wrap((req, res, next) => {
  if (!isNum(req.params.id)) return next();
  const c = placesRepo.campusById(Number(req.params.id));
  if (!c) return next();
  if (req.params.action === 'toggle') placesRepo.toggleCampus(c.id);
  else if (req.params.action === 'order') placesRepo.setCampusOrder(c.id, toInt(req.body.order, 0, 1000) ?? c.order);
  else return next();
  audit(req.user, 'campus.' + req.params.action, 'Campus', c.id, c.name);
  refBack(res);
}));
router.post('/reference/area', wrap((req, res) => {
  try {
    const st = placesRepo.stateById(toInt(req.body.state, 1, 1e9));
    if (!st) throw new Error('Choose the state this area is in.');
    const id = areasRepo.create(clean(req.body.name, 60), toInt(req.body.order, 0, 1000) ?? 100, [], st.id);
    audit(req.user, 'area.create', 'Area', id, req.body.name + ' (' + st.name + ')');
  } catch (err) { req.flash('error', err.message); }
  refBack(res);
}));
router.post('/reference/area/:id/:action', wrap((req, res, next) => {
  if (!isNum(req.params.id)) return next();
  const a = areasRepo.byId(Number(req.params.id));
  if (!a) return next();
  const { action } = req.params;
  if (action === 'toggle') areasRepo.toggle(a.id);
  else if (action === 'order') areasRepo.setOrder(a.id, toInt(req.body.order, 0, 1000) ?? a.order);
  else if (action === 'add_junction') { const j = clean(req.body.junction, 60); if (j) areasRepo.addJunction(a.id, j); }
  else if (action === 'remove_junction') areasRepo.removeJunction(a.id, clean(req.body.junction, 60));
  else return next();
  audit(req.user, 'area.' + action, 'Area', a.id, a.name);
  res.redirect('/admin/reference');
}));

// ---- Users: full control over every account
router.get('/users', wrap((req, res) => {
  const filter = ['admins', 'listers', 'suspended', 'banned', 'unverified', 'deleted'].includes(req.query.filter) ? req.query.filter : 'all';
  const q = clean(req.query.q, 60);
  const page = Math.max(1, toInt(req.query.page, 1, 1000) || 1);
  const { total, rows } = users.list({ q, filter, page, size: 30 });
  res.render('admin/users', { title: 'Users', nav: 'users', users: rows, filter, q, page, total, pages: Math.ceil(total / 30) });
}));
router.get('/users/:uid', wrap((req, res, next) => {
  if (!isUid(req.params.uid)) return next();
  const u = users.byUidAny(req.params.uid);
  if (!u) return next();
  res.render('admin/user', { title: u.name, nav: 'users', u, profile: listers.byUserId(u.id), lodges: listings.forListerProfile(u.id), items: market.forSeller(u.id), saved: act.savedCount(u.id), isSelf: u.id === req.user.id,
    reviewsAbout: reviewsRepo.aboutUser(u.id), reviewsBy: reviewsRepo.writtenBy(u.id), reviewSummary: reviewsRepo.summary(u.id), openReports: flags.openAgainstUser(u.id), rating: reviewsRepo.summary(u.id) });
}));
router.post('/users/:uid/:action', wrap(async (req, res, next) => {
  if (!isUid(req.params.uid)) return next();
  const u = users.byUidAny(req.params.uid);
  if (!u) return next();
  const back = '/admin/users/' + u.uid;
  const { action } = req.params;
  try {
    switch (action) {
      case 'verify_email': users.update(u.id, { emailVerifiedAt: Date.now() }); break;
      case 'unverify_email': users.update(u.id, { emailVerifiedAt: null }); break;
      case 'suspend': userSvc.guardAdminChange(req.user, u); users.update(u.id, { status: 'suspended' }); listings.suspendFor(u.id); market.hideAllFor(u.id, 'admin'); users.deleteSessionsFor(u.id); break;
      case 'unsuspend': if (u.bannedAt) throw new Error('This account is banned. Use Lift ban instead.'); users.update(u.id, { status: 'active' }); break;
      case 'ban': {
        const reason = C.BAN_REASONS.find((r) => r.value === req.body.reason);
        if (!reason) throw new Error('Choose a reason for the ban.');
        const note = clean(req.body.note, 300);
        userSvc.ban(req.user, u, reason.label + (note ? ': ' + note : ''));
        audit(req.user, 'user.ban', 'User', u.id, u.email + ' - ' + reason.label + (note ? ': ' + note : ''));
        req.flash('success', u.name + ' was banned. They are signed out and everything they posted is hidden.');
        return res.redirect(safeReturnTo(req.body.next, back));
      }
      case 'unban': userSvc.unban(u); break;
      case 'make_admin': if (u.status !== 'active') throw new Error('Only active accounts can become administrators.'); users.update(u.id, { isAdmin: 1 }); break;
      case 'remove_admin': userSvc.guardAdminChange(req.user, u); users.update(u.id, { isAdmin: 0 }); break;
      case 'notes': users.update(u.id, { adminNotes: clean(req.body.notes, 1000) }); break;
      case 'edit': {
        const name = clean(req.body.name, 60); const email = clean(req.body.email, 120).toLowerCase();
        const phoneRaw = clean(req.body.phone, 25); const phone = phoneRaw ? normalisePhone(phoneRaw) : null;
        if (name.length < 2) throw new Error('Enter a name.');
        if (!auth.EMAIL.test(email)) throw new Error('Enter a valid email address.');
        if (phoneRaw && !phone) throw new Error('Enter a valid Nigerian phone number.');
        const other = users.byEmail(email);
        if (other && other.id !== u.id) throw new Error('Another account already uses that email.');
        users.update(u.id, { name, email, phone });
        break;
      }
      case 'set_password': {
        const pw = String(req.body.password || '');
        const err = auth.checkPassword(pw, { admin: u.isAdmin });
        if (err) throw new Error(err);
        users.update(u.id, { passwordHash: await auth.hashPassword(pw), passwordChangedAt: Date.now(), failedLogins: 0, lockedUntil: null });
        users.deleteSessionsFor(u.id);
        break;
      }
      case 'send_reset': await auth.requestReset(u.email); req.flash('info', 'If email is set up, a reset link was sent to ' + u.email + '.'); break;
      case 'delete':
        userSvc.guardAdminChange(req.user, u);
        if (req.body.confirm !== 'DELETE') throw new Error('Type DELETE to confirm.');
        userSvc.anonymise(u);
        audit(req.user, 'user.deleted', 'User', u.id, u.email);
        req.flash('success', 'Account deleted. Personal details were removed.');
        return res.redirect('/admin/users');
      case 'purge':
        userSvc.guardAdminChange(req.user, u);
        if (req.body.confirm !== 'DELETE') throw new Error('Type DELETE to confirm.');
        userSvc.purge(u);
        audit(req.user, 'user.purged', 'User', u.id, u.email);
        req.flash('success', 'Account and everything it owned were erased.');
        return res.redirect('/admin/users');
      case 'impersonate': {
        if (u.isAdmin || u.status !== 'active') throw new Error('You can only view the site as an active, non-admin user.');
        const token = auth.startSession(u.id);
        setImpersonationCookie(res, req.sessionToken);
        res.cookie('oikres_sid', token, { httpOnly: true, sameSite: 'lax', secure: cfg.isProd, maxAge: 8 * 3600 * 1000 });
        audit(req.user, 'user.impersonate_start', 'User', u.id, u.email);
        return res.redirect('/');
      }
      default: return next();
    }
  } catch (err) { req.flash('error', err.message); return res.redirect(back); }
  audit(req.user, 'user.' + action, 'User', u.id, u.email);
  req.flash('success', 'Done.');
  res.redirect(back);
}));

// ---- Reviews: remove or restore one (soft: the author cannot simply post it again)
router.post('/reviews/:ruid/:action', wrap((req, res, next) => {
  const r = isUid(req.params.ruid) ? reviewsRepo.byUid(req.params.ruid) : null;
  if (!r || !['remove', 'restore'].includes(req.params.action)) return next();
  reviewsRepo.setStatus(r.id, req.params.action === 'remove' ? 'removed' : 'visible');
  audit(req.user, 'review.' + req.params.action, 'Review', r.id, r.author.name + ' about ' + r.subject.name);
  req.flash('success', req.params.action === 'remove' ? 'Review removed.' : 'Review restored.');
  res.redirect(safeReturnTo(req.body.next, '/admin/users/' + r.subject.uid));
}));

// ---- Welcome popup
const welcomeSvc = require('../services/welcome');
const popupPage = (res, form, errors = {}, status = 200) => res.status(status).render('admin/popup', { title: 'Welcome popup', nav: 'popup', form, errors, icons: welcomeSvc.ICONS, maxItems: welcomeSvc.MAX_ITEMS });
router.get('/popup', (req, res) => popupPage(res, welcomeSvc.get()));
router.post('/popup', wrap((req, res) => {
  const r = welcomeSvc.parse(req.body);
  if (!r.ok) return popupPage(res, { ...r.data, version: welcomeSvc.get().version }, r.errors, 422);
  const cur = welcomeSvc.get();
  welcomeSvc.save({ ...r.data, version: cur.version + (r.reshow ? 1 : 0) });
  audit(req.user, 'popup.update', 'Popup', 0, (r.data.enabled ? 'on' : 'off') + (r.reshow ? ', shown again to everyone' : ''));
  req.flash('success', r.reshow ? 'Saved. Everyone will see the popup again.' : 'Popup saved.');
  res.redirect('/admin/popup');
}));
router.post('/popup/reset', wrap((req, res) => { welcomeSvc.reset(); audit(req.user, 'popup.reset', 'Popup', 0, ''); req.flash('success', 'The popup is back to the standard wording.'); res.redirect('/admin/popup'); }));

// ---- Site settings: name, logo, colours, contact, rules, notices
router.get('/settings', (req, res) => {
  res.render('admin/settings', { title: 'Site settings', nav: 'settings', cur: site.get(), defaults: site.DEFAULTS, section: ['general', 'branding', 'theme', 'rules', 'notices'].includes(req.query.section) ? req.query.section : 'general',
    envWhatsapp: cfg.supportWhatsapp, scripts: ['uploader.js', 'colorpicker.js', 'settings.js'] });
});
router.post('/settings/:section', wrap((req, res) => {
  const section = req.params.section;
  const back = '/admin/settings?section=' + (section === 'reset-theme' ? 'theme' : section);
  if (section === 'reset-theme') { site.resetTheme(); audit(req.user, 'settings.reset_theme', 'Settings', 'theme', ''); req.flash('success', 'Colours reset to the default theme.'); return res.redirect(back); }
  const { patch, errors } = site.parseSection(section, req.body);
  if (Object.keys(errors).length) { req.flash('error', Object.values(errors)[0]); return res.redirect(back); }
  const warn = patch._warn; delete patch._warn;
  site.save(patch);
  audit(req.user, 'settings.' + section, 'Settings', section, Object.keys(patch).join(', '));
  req.flash('success', 'Saved. The change is live now.');
  if (warn) req.flash('warn', warn);
  res.redirect(back);
}));

// ---- Broadcast an in-app message to a group of people
router.get('/broadcast', (req, res) => res.render('admin/broadcast', { title: 'Broadcast', nav: 'broadcast', form: {}, counts: users.counts() }));
router.post('/broadcast', wrap((req, res) => {
  const form = { audience: ['all', 'listers', 'admins'].includes(req.body.audience) ? req.body.audience : 'all', title: clean(req.body.title, 80), body: clean(req.body.body, 300), link: clean(req.body.link, 120) };
  const errors = [];
  if (form.title.length < 3) errors.push('Write a title (at least 3 characters).');
  if (form.link && (!form.link.startsWith('/') || form.link.startsWith('//'))) errors.push('The link must be a page on this site, like /help.');
  if (errors.length) { req.flash('error', errors[0]); return res.status(422).render('admin/broadcast', { title: 'Broadcast', nav: 'broadcast', form, counts: users.counts() }); }
  const n = act.broadcast(users.idsFor(form.audience), form);
  audit(req.user, 'broadcast.sent', 'Broadcast', form.audience, form.title + ' (' + n + ' people)');
  req.flash('success', 'Sent to ' + n + (n === 1 ? ' person.' : ' people.'));
  res.redirect('/admin/broadcast');
}));

router.get('/audit', wrap((req, res) => {
  const page = Math.max(1, toInt(req.query.page, 1, 1000) || 1);
  const { total, rows } = act.auditPage(page, 50);
  res.render('admin/audit', { title: 'Audit log', nav: 'audit', rows, page, pages: Math.ceil(total / 50) });
}));

module.exports = router;
