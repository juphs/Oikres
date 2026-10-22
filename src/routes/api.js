const express = require('express');
const C = require('../config/constants');
const cfg = require('../config');
const listings = require('../repositories/listings');
const act = require('../repositories/activity');
const listers = require('../repositories/listers');
const media = require('../services/media');
const { isUid } = require('../lib/util');
const { apiLimiter, uploadLimiter } = require('../middleware/security');
const { requireAuth, wrap } = require('../middleware/core');
const { HttpError } = require('../lib/errors');

const router = express.Router();

// Upload endpoint first: it streams multipart data, so it has its own limiter and no JSON parsing.
router.post('/media/upload', requireAuth, uploadLimiter, wrap(async (req, res) => {
  if (!req.user.emailVerifiedAt) throw new HttpError(403, 'Verify your email first.');
  res.json(await media.receive(req, req.user, { isLister: !!listers.byUserId(req.user.id), isAdmin: !!req.user.isAdmin }));
}));

router.use(apiLimiter);

// Tells the browser how to upload photos and videos: to this server, or straight to Cloudinary with signed parameters.
router.post('/media/sign', requireAuth, wrap((req, res) => {
  if (!req.user.emailVerifiedAt) throw new HttpError(403, 'Verify your email first.');
  const kind = String(req.body.kind || '');
  if (!['photo', 'video', 'item', 'itemvideo'].includes(kind)) throw new HttpError(400, 'Unknown upload type.');
  if (!['item', 'itemvideo'].includes(kind) && !listers.byUserId(req.user.id) && !req.user.isAdmin) throw new HttpError(403, 'Lister account required.');
  res.json(cfg.storageDriver === 'cloudinary' ? media.signCloudinary(kind, req.user) : { driver: 'local' });
}));

router.post('/wishlist/merge', requireAuth, wrap((req, res) => {
  const ids = [].concat(req.body.ids || []).filter(isUid).slice(0, 100);
  let merged = 0;
  ids.forEach((uid) => { const id = listings.publicIdByUid(uid); if (id && act.addSave(req.user.id, id)) merged++; });
  res.json({ merged });
}));
router.post('/wishlist/:id/toggle', requireAuth, wrap((req, res) => {
  if (!isUid(req.params.id)) throw new HttpError(400, 'Invalid lodge.');
  const l = listings.byUid(req.params.id);
  if (!l || !(C.PUBLIC_STATUSES.includes(l.status) || l.status === 'rented')) throw new HttpError(404, 'Lodge not found.');
  res.json({ saved: act.toggleSave(req.user.id, l.id) });
}));

// Cards for lodges saved on this device (guests).
router.get('/saved-cards', wrap((req, res) => {
  const ids = String(req.query.ids || '').split(',').filter(isUid).slice(0, 60).map(listings.publicIdByUid).filter(Boolean);
  const list = listings.cardsByIds(ids);
  res.render('partials/cards-more', { listings: list, savedSet: new Set(list.map((l) => String(l._id))), hasMore: false, nextUrl: null, prevUrl: null, page: 1 });
}));

// "Did the agent reply?" - an honest signal; we cannot know whether a conversation happened.
router.post('/lodges/:id/feedback', wrap((req, res) => {
  if (!isUid(req.params.id)) throw new HttpError(400, 'Invalid lodge.');
  const id = listings.idByUid(req.params.id);
  if (!id) throw new HttpError(404, 'Lodge not found.');
  if (!act.feedbackRecent(id, req.anonId)) act.addFeedback(id, req.anonId, req.user && req.user.id, req.body.replied === true || req.body.replied === 'true');
  res.json({ ok: true });
}));

module.exports = router;
