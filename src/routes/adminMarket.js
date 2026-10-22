// Admin > Market: review, hide, restore and delete items. Mounted at /admin/market (already behind the admin guard).
const express = require('express');
const C = require('../config/constants');
const market = require('../repositories/market');
const users = require('../repositories/users');
const flags = require('../repositories/flags');
const svc = require('../services/market');
const { wrap } = require('../middleware/core');
const { notify, audit } = require('../services/notify');
const { isUid, clean, toInt } = require('../lib/util');

const router = express.Router();
const PER_PAGE = 30;

router.get('/', wrap((req, res) => {
  const status = Object.keys(C.MARKET_STATUS_LABELS).includes(req.query.status) && req.query.status !== 'deleted' ? req.query.status : req.query.status === 'all' ? 'all' : 'live';
  const q = clean(req.query.q, 60);
  const page = Math.max(1, toInt(req.query.page, 1, 1000) || 1);
  const { total, rows } = market.adminList({ status, q, page, size: PER_PAGE });
  res.render('admin/market', { title: 'Market', nav: 'market', items: rows, status, q, page, total, pages: Math.ceil(total / PER_PAGE), pendingCount: market.countStatus('pending') });
}));

router.get('/:id', wrap((req, res, next) => {
  if (!isUid(req.params.id)) return next();
  const i = market.byUid(req.params.id);
  if (!i || i.status === 'deleted') return next();
  const seller = users.byId(i.sellerId);
  res.render('admin/market-item', { title: i.title, nav: 'market', i, seller, reports: flags.list('item', 'open').filter((r) => r.targetId === i.id), openAgainstSeller: flags.openAgainstUser(i.sellerId) });
}));

router.post('/:id/:action', wrap(async (req, res, next) => {
  if (!isUid(req.params.id)) return next();
  const i = market.byUid(req.params.id);
  if (!i || i.status === 'deleted') return next();
  const back = '/admin/market/' + i._id;
  const { action } = req.params;
  const fail = (msg) => { req.flash('error', msg); return res.redirect(back); };
  if (action === 'approve') {
    if (i.status !== 'pending') return fail('Only items waiting for review can be approved.');
    if (i.seller.status !== 'active') return fail('The seller account is not active.');
    market.update(i.id, { status: 'live', hiddenReason: null, publishedAt: i.publishedAt || Date.now(), expiresAt: svc.expiryFromNow(), expiryNotifiedAt: null });
    await notify(i.sellerId, { type: 'item', title: 'Your item is live', body: '"' + i.title + '" was approved and is now in the market.', link: '/market/' + i.slug });
  } else if (action === 'hide') {
    if (!['live', 'pending'].includes(i.status)) return fail('Only live or pending items can be hidden.');
    market.update(i.id, { status: 'hidden', hiddenReason: 'admin' });
    flags.closeOpenFor('item', i.id, req.user.id, 'Item hidden');
    await notify(i.sellerId, { type: 'item', title: 'Your item was hidden', body: '"' + i.title + '" was removed from the market by the team. Contact support if you think this is a mistake.', link: '/market/mine' });
  } else if (action === 'restore') {
    if (i.status !== 'hidden') return fail('Nothing to restore.');
    if (i.seller.status !== 'active') return fail('The seller account is not active.');
    market.update(i.id, { status: 'live', hiddenReason: null, publishedAt: i.publishedAt || Date.now(), expiresAt: svc.expiryFromNow(), expiryNotifiedAt: null });
  } else if (action === 'feature' || action === 'unfeature') {
    market.update(i.id, { featured: action === 'feature' ? 1 : 0 });
  } else if (action === 'delete') {
    svc.removeItem(i);
    audit(req.user, 'item.deleted', 'MarketItem', i.id, i.title);
    req.flash('success', 'Item deleted for good.');
    return res.redirect('/admin/market');
  } else return next();
  audit(req.user, 'item.' + action, 'MarketItem', i.id, i.title);
  req.flash('success', 'Done.');
  res.redirect(back);
}));

module.exports = router;
