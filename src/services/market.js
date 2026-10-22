// Market workflow: validate, save, and decide whether an item goes live at once or waits for review.
const C = require('../config/constants');
const cfg = require('../config');
const market = require('../repositories/market');
const media = require('./media');
const site = require('./site');
const placesSvc = require('./places');
const { parseItem } = require('./marketForm');
const { slugify, uid } = require('../lib/util');
const { sendMail } = require('./mail');

// Returns { ok, errors, state, item, needsReview }. `existing` is the item being edited (or null).
function saveFromForm({ user, existing, body }) {
  const { data, errors } = parseItem(body, { places: placesSvc.lookup() });
  const resolved = media.resolveItems(data.mediaItems, user, { folder: 'oikres/market' });
  const items = resolved.filter((m) => m.type === 'image').slice(0, C.RULES.marketMaxPhotos);
  const video = resolved.find((m) => m.type === 'video');
  data.media = video ? [video].concat(items) : items; // the video comes first
  if (items.length < C.RULES.marketMinPhotos) errors.media = 'Add at least ' + C.RULES.marketMinPhotos + ' photo' + (C.RULES.marketMinPhotos === 1 ? '' : 's') + '.';
  if (!existing && market.activeCount(user.id) >= C.RULES.marketMaxActive) errors.title = 'You have ' + C.RULES.marketMaxActive + ' items for sale already. Mark some as sold or delete them first.';
  const state = { ...data, state: data.stateId ? String(data.stateId) : '', campus: data.campusId ? String(data.campusId) : '', whatsapp: body.whatsapp || '', status: existing ? existing.status : 'live',
    media: data.media.map((m) => ({ type: m.type, id: m.mediaUid, url: m.url, thumbUrl: m.thumbUrl, publicId: m.publicId, width: m.width, height: m.height })) };
  if (Object.keys(errors).length) return { ok: false, errors, state };

  // Pre-approval is a site setting. Edits to a live item go back to review only when it is on. Hidden and sold items keep their state.
  const review = site.marketReviewRequired() && !user.isAdmin; // administrators are the reviewers
  let status; let hiddenReason = null;
  if (!existing) status = review ? 'pending' : 'live';
  else if (existing.status === 'live') status = review ? 'pending' : 'live';
  else { status = existing.status; hiddenReason = existing.hiddenReason; }
  const publishedAt = status === 'live' && !(existing && existing.publishedAt) ? Date.now() : null;
  const expiresAt = !(existing && existing.expiresAt) ? expiryFromNow() : null;
  const meta = { id: existing && existing.id, sellerId: user.id, status, hiddenReason, publishedAt, expiresAt, slug: '' };
  let id;
  if (existing) id = market.save(meta, data);
  else {
    for (let i = 0; ; i++) {
      try { id = market.save({ ...meta, slug: (slugify(data.title).slice(0, 50) || 'item') + '-' + uid(5) }, data); break; }
      catch (err) { if (!/UNIQUE constraint failed: market_items\.slug/.test(err.message) || i >= 3) throw err; }
    }
  }
  media.markAttached(data.media);
  const item = market.byId(id);
  const needsReview = item.status === 'pending';
  if (needsReview && cfg.adminNotifyEmail) sendMail({ to: cfg.adminNotifyEmail, subject: 'New market item to review: ' + item.title, text: cfg.baseUrl + '/admin/market/' + item._id });
  return { ok: true, item, needsReview, id };
}

const stateFrom = (i) => ({ title: i.title, category: i.category, condition: i.condition, price: i.price, negotiable: i.negotiable, description: i.description || '',
  state: i.state ? String(i.state.id) : '', campus: i.campus ? String(i.campus.id) : '', pickup: i.pickup, whatsapp: i.whatsappNumber, status: i.status,
  media: i.media.map((m) => ({ type: m.type, id: m.mediaUid, url: m.url, thumbUrl: m.thumbUrl, publicId: m.publicId, width: m.width, height: m.height })) });
const blankState = (user, lister, defaultState) => ({ title: '', category: '', condition: '', price: '', negotiable: false, description: '', state: defaultState || '', campus: '', pickup: '',
  whatsapp: user.phone || (lister && lister.whatsappNumber) || '', status: 'live', media: [] });

const isPublic = (i) => i.status === 'live' && i.seller.status === 'active' && !i.expired;
const expiryFromNow = () => Date.now() + C.RULES.marketExpireDays * 86400000;

function removeItem(item) {
  const uids = market.mediaUidsFor(item.id);
  market.hardDelete(item.id);
  media.deleteListingFiles(uids);
}

module.exports = { saveFromForm, stateFrom, blankState, isPublic, removeItem, expiryFromNow };
