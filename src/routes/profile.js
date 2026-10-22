// Public profiles (lodges, items, ratings and reviews) and the reports people can make about a person or a review.
const express = require('express');
const C = require('../config/constants');
const users = require('../repositories/users');
const listers = require('../repositories/listers');
const listings = require('../repositories/listings');
const market = require('../repositories/market');
const reviews = require('../repositories/reviews');
const flags = require('../repositories/flags');
const reviewSvc = require('../services/reviews');
const { savedSetFor, savedItemsFor } = require('../services/saved');
const site = require('../services/site');
const { clean, toInt, isUid } = require('../lib/util');
const { reportLimiter, reviewLimiter } = require('../middleware/security');
const { requireAuth, requireVerified, wrap } = require('../middleware/core');

const router = express.Router();
const REVIEWS_PER_PAGE = 10;

// Who can be seen: active people, and banned ones (with a clear notice). Suspended and deleted accounts do not exist publicly.
function visibleUser(uid, viewer) {
  if (!isUid(uid)) return null;
  const u = users.byUid(uid);
  if (!u || u.status === 'deleted') return null;
  if (u.status === 'suspended' && !u.bannedAt && !(viewer && viewer.isAdmin)) return null;
  return u;
}

router.get('/u/:uid', wrap((req, res, next) => {
  const u = visibleUser(req.params.uid, req.user);
  if (!u) return next();
  const banned = !!u.bannedAt;
  const active = u.status === 'active';
  const lp = listers.byUserId(u.id);
  const page = Math.max(1, toInt(req.query.page, 1, 1000) || 1);
  const lodges = active ? listings.publicByLister(u.id, 12) : [];
  const items = active ? market.publicBySeller(u.id, 12) : [];
  const summary = reviews.summary(u.id);
  const isSelf = !!req.user && req.user.id === u.id;
  const mine = req.user && !isSelf ? reviews.byPair(u.id, req.user.id) : null;
  res.render('profile', {
    p: u, lp, banned, active, lodges, items, savedItems: savedItemsFor(req.user, items), savedSet: savedSetFor(req.user, lodges), summary, isSelf, mine,
    reviewList: reviews.list(u.id, { page, size: REVIEWS_PER_PAGE }), page, morePages: page * REVIEWS_PER_PAGE < summary.count,
    canReview: !!req.user && !isSelf && active && !!req.user.emailVerifiedAt && !(mine && mine.status === 'removed'),
    title: u.name, nav: isSelf ? 'profile' : '', noindex: true, description: u.name + ' on ' + site.get().name
  });
}));

router.post('/u/:uid/review', requireAuth, requireVerified, reviewLimiter, wrap((req, res, next) => {
  const u = visibleUser(req.params.uid, req.user);
  if (!u) return next();
  const r = reviewSvc.submit({ author: req.user, subject: u, rating: req.body.rating, body: req.body.body });
  req.flash(r.ok ? 'success' : 'error', r.ok ? (r.created ? 'Thank you. Your review is public.' : 'Your review was updated.') : r.error);
  res.redirect('/u/' + u.uid + '#reviews');
}));

router.post('/u/:uid/review/delete', requireAuth, wrap((req, res, next) => {
  const u = visibleUser(req.params.uid, req.user);
  if (!u) return next();
  const mine = reviews.byPair(u.id, req.user.id);
  if (mine) { reviews.remove(mine.id); req.flash('success', 'Your review was deleted.'); }
  res.redirect('/u/' + u.uid + '#reviews');
}));

// ---- Reports about a person
router.get('/u/:uid/report', wrap((req, res, next) => {
  const u = visibleUser(req.params.uid, req.user);
  if (!u || u.status !== 'active' || (req.user && req.user.id === u.id)) return next();
  res.render('report-flag', { title: 'Report this person', heading: 'Report this person', subject: u.name, reasons: C.USER_REPORT_REASONS, action: '/u/' + u.uid + '/report', back: '/u/' + u.uid,
    hint: 'Tell us what happened, including the lodge or item involved. Reports are reviewed by the ' + site.get().name + ' team and we never share who reported.', noindex: true });
}));
router.post('/u/:uid/report', reportLimiter, wrap((req, res, next) => {
  const u = visibleUser(req.params.uid, req.user);
  if (!u || u.status !== 'active') return next();
  const reason = C.USER_REPORT_REASONS.find((r) => r.value === req.body.reason);
  if (!reason) { req.flash('error', 'Choose a reason for your report.'); return res.redirect('/u/' + u.uid + '/report'); }
  const key = req.user ? 'u:' + req.user.id : 'a:' + req.anonId;
  if (flags.exists('user', u.id, key)) req.flash('info', 'You already reported this person. Our team will look at it.');
  else {
    flags.add({ targetType: 'user', targetId: u.id, subjectUserId: u.id, reporterId: req.user && req.user.id, reporterKey: key, reason: reason.value, note: clean(req.body.note, 500) });
    req.flash('success', 'Thank you. Our team will review your report.');
  }
  res.redirect('/u/' + u.uid);
}));

// ---- Reports about a review
router.get('/reviews/:ruid/report', wrap((req, res, next) => {
  const r = isUid(req.params.ruid) ? reviews.byUid(req.params.ruid) : null;
  if (!r || r.status !== 'visible') return next();
  res.render('report-flag', { title: 'Report this review', heading: 'Report this review', subject: 'Review by ' + r.author.name, reasons: C.REVIEW_REPORT_REASONS, action: '/reviews/' + r.uid + '/report', back: '/u/' + r.subject.uid + '#reviews',
    hint: 'Reviews are opinions, so we only remove ones that are abusive, fake or about the wrong person.', noindex: true });
}));
router.post('/reviews/:ruid/report', reportLimiter, wrap((req, res, next) => {
  const r = isUid(req.params.ruid) ? reviews.byUid(req.params.ruid) : null;
  if (!r || r.status !== 'visible') return next();
  const reason = C.REVIEW_REPORT_REASONS.find((x) => x.value === req.body.reason);
  if (!reason) { req.flash('error', 'Choose a reason for your report.'); return res.redirect('/reviews/' + r.uid + '/report'); }
  const key = req.user ? 'u:' + req.user.id : 'a:' + req.anonId;
  if (flags.exists('review', r.id, key)) req.flash('info', 'You already reported this review.');
  else {
    flags.add({ targetType: 'review', targetId: r.id, subjectUserId: r.authorId, reporterId: req.user && req.user.id, reporterKey: key, reason: reason.value, note: clean(req.body.note, 500) });
    req.flash('success', 'Thank you. Our team will review your report.');
  }
  res.redirect('/u/' + r.subject.uid + '#reviews');
}));

module.exports = router;
