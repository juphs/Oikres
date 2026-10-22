// Lodge workflow shared by the routes: validate, price, save, and move through review states.
const C = require('../config/constants');
const cfg = require('../config');
const listings = require('../repositories/listings');
const areas = require('../repositories/areas');
const placesSvc = require('./places');
const media = require('./media');
const { parseListing } = require('./listingForm');
const { applyPricing } = require('../lib/cost');
const { slugify, uid } = require('../lib/util');
const { sendMail } = require('./mail');
const site = require('./site');

const DAY = 86400000;
const EDITABLE = ['draft', 'rejected', 'pending', 'live', 'needs_reconfirm', 'hidden', 'rented'];

// Returns { ok, errors, state, id }. `existing` is the lodge being edited (or null).
function saveFromForm({ user, profile, existing, body, adminEdit = false, actor = null }) {
  const areaIds = areas.list({ activeOnly: true }).map((a) => a.id);
  const strict = body.action === 'submit' || (existing && !['draft', 'rejected'].includes(existing.status));
  const needsReview = !adminEdit && strict;
  const { data, errors } = parseListing(body, { submit: strict, areaIds, places: placesSvc.lookup() });
  const items = media.resolveItems(data.mediaItems, user, adminEdit ? { owners: actor ? [actor.id] : [], anyFolder: true } : {});
  data.media = items;
  if (strict && items.filter((m) => m.type === 'image').length < site.rules().minPhotos) errors.media = 'Add at least ' + site.rules().minPhotos + ' photos.';
  const state = { ...data, area: data.areaId ? String(data.areaId) : '', state: data.stateId ? String(data.stateId) : '', campus: data.campusId ? String(data.campusId) : '', minutesWalk: data.minutesWalk ?? '', minutesKeke: data.minutesKeke ?? '', status: existing ? existing.status : 'draft', _id: existing ? existing._id : undefined };
  if (Object.keys(errors).length) return { ok: false, errors, state };

  const pricing = applyPricing(data.units, data.fees);
  const status = adminEdit ? existing.status : needsReview ? 'pending' : 'draft';
  const submittedAt = needsReview ? Date.now() : null;
  let id;
  if (existing) {
    id = listings.save({ id: existing.id, status, submittedAt }, data, pricing);
  } else {
    for (let i = 0; ; i++) {
      try { id = listings.save({ listerId: user.id, profileId: profile.id, slug: (slugify(data.title).slice(0, 50) || 'lodge') + '-' + uid(5), status, submittedAt }, data, pricing); break; }
      catch (err) { if (!/UNIQUE constraint failed: listings\.slug/.test(err.message) || i >= 3) throw err; }
    }
  }
  media.markAttached(items);
  let saved = listings.byId(id);
  let autoLive = false;
  // An administrator is the reviewer, so their own lodges go straight to live.
  if (needsReview && (!site.reviewRequired() || user.isAdmin)) { goLive(saved); saved = listings.byId(id); autoLive = true; }
  if (needsReview && !autoLive && cfg.adminNotifyEmail) sendMail({ to: cfg.adminNotifyEmail, subject: 'New lodge to review: ' + saved.title, text: cfg.baseUrl + '/admin/listings/' + saved._id });
  return { ok: true, id, listing: saved, needsReview, autoLive };
}

function stateFrom(l) {
  return { _id: l._id, title: l.title, propertyType: l.propertyType || '', area: l.area ? String(l.area.id) : '', state: l.state ? String(l.state.id) : '', campus: l.campus ? String(l.campus.id) : '', junction: l.junction || '', minutesWalk: l.minutesWalk ?? '', minutesKeke: l.minutesKeke ?? '',
    description: l.description || '', amenities: l.amenities, chargesDisclosed: l.chargesDisclosed, status: l.status,
    units: l.units.map((u) => ({ _id: u._id, label: u.label, kind: u.kind, spacesTotal: u.spacesTotal, spacesAvailable: u.spacesAvailable, rent: u.rent, initialPayment: u.initialPayment || '', period: u.period, genderPreference: u.genderPreference, sharedFacilities: u.sharedFacilities, notes: u.notes })),
    fees: l.fees, media: l.media.map((m) => ({ type: m.type, id: m.mediaUid, url: m.url, thumbUrl: m.thumbUrl, publicId: m.publicId, width: m.width, height: m.height })) };
}

const blankState = (profile) => ({
  title: '', propertyType: '', area: '', state: '', campus: '', junction: '', minutesWalk: '', minutesKeke: '', description: '', amenities: [], chargesDisclosed: false, status: 'draft',
  units: [{ label: 'Self-contain', kind: 'whole_unit', spacesTotal: 1, spacesAvailable: 1, rent: '', period: 'year', genderPreference: 'any', sharedFacilities: [], notes: '' }],
  fees: profile.type === 'agent' ? [{ label: 'agent', kind: 'percent', value: 10, payee: 'agent', refundable: false, customLabel: '', note: '' }] : [], media: []
});

// Applies an admin or lister decision to the review state of a lodge.
function goLive(l) {
  const t = Date.now();
  listings.update(l.id, { status: 'live', hiddenReason: null, rejectionReason: null, publishedAt: l.publishedAt || t, lastConfirmedAt: t, reconfirmDueAt: t + site.rules().reconfirmEveryDays * DAY, reminderSentAt: null });
}
function reconfirm(l) {
  const t = Date.now();
  listings.update(l.id, { status: 'live', hiddenReason: null, lastConfirmedAt: t, reconfirmDueAt: t + site.rules().reconfirmEveryDays * DAY, reminderSentAt: null });
}
const canReconfirm = (l) => ['live', 'needs_reconfirm'].includes(l.status) || (l.status === 'hidden' && l.hiddenReason === 'stale');

function updateAvailability(l, bodyGetter) {
  const units = l.units.map((u) => {
    const v = Number(bodyGetter(u._id));
    return { ...u, spacesAvailable: Number.isInteger(v) ? Math.min(u.spacesTotal, Math.max(0, v)) : u.spacesAvailable };
  });
  const pricing = applyPricing(units, l.fees);
  listings.saveAvailability(l.id, units, pricing);
  reconfirm(l.status === 'rented' ? { ...l, status: 'rented' } : l);
}

// Permanently remove a lodge and the files uploaded for it.
function removeListing(l) {
  const uids = listings.mediaUidsFor(l.id);
  listings.hardDelete(l.id);
  media.deleteListingFiles(uids);
}

module.exports = { removeListing, EDITABLE, saveFromForm, stateFrom, blankState, goLive, reconfirm, canReconfirm, updateAvailability };
