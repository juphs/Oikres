const db = require('../db');
const { uid: newUid, escapeLike } = require('../lib/util');

const PUBLIC = "('live', 'needs_reconfirm')";
const BASE = `SELECT l.*, a.name AS area_name, a.slug AS area_slug, a.id AS area_pk,
  st.name AS state_name, st.slug AS state_slug, cp.name AS campus_name, cp.slug AS campus_slug,
  p.id AS profile_pk, p.display_name, p.business_name, p.type AS lister_type, p.whatsapp_number, p.phone_verified, p.id_checked,
  u.uid AS lister_uid, u.status AS lister_status
  FROM listings l LEFT JOIN areas a ON a.id = l.area_id
  LEFT JOIN states st ON st.id = l.state_id LEFT JOIN campuses cp ON cp.id = l.campus_id
  JOIN lister_profiles p ON p.id = l.lister_profile_id JOIN users u ON u.id = l.lister_id`;

const mapRow = (r) => r && ({
  _id: r.uid, id: r.id, slug: r.slug, title: r.title, description: r.description, propertyType: r.property_type,
  area: r.area_pk ? { _id: String(r.area_pk), id: r.area_pk, name: r.area_name, slug: r.area_slug } : null,
  state: r.state_id ? { id: r.state_id, name: r.state_name, slug: r.state_slug } : null,
  campus: r.campus_id ? { id: r.campus_id, name: r.campus_name, slug: r.campus_slug } : null,
  junction: r.junction, minutesWalk: r.minutes_walk, minutesKeke: r.minutes_keke, chargesDisclosed: !!r.charges_disclosed,
  priceFrom: r.price_from, periodFrom: r.period_from, moveInFrom: r.move_in_from, priceYearly: r.price_yearly, hasRoomShare: !!r.has_room_share,
  status: r.status, hiddenReason: r.hidden_reason, rejectionReason: r.rejection_reason,
  submittedAt: r.submitted_at, publishedAt: r.published_at, lastConfirmedAt: r.last_confirmed_at, reconfirmDueAt: r.reconfirm_due_at, rentedAt: r.rented_at,
  visited: { done: !!r.visited_done, at: r.visited_at, note: r.visited_note },
  isFeatured: !!r.is_featured, counters: { views: r.views, contactClicks: r.contact_clicks, saves: r.saves }, reportCount: r.report_count,
  listerId: r.lister_id, lister: r.lister_uid, listerStatus: r.lister_status, updatedAt: r.updated_at,
  listerProfile: { _id: String(r.profile_pk), id: r.profile_pk, displayName: r.display_name, businessName: r.business_name, type: r.lister_type, whatsappNumber: r.whatsapp_number, verification: { phoneVerified: !!r.phone_verified, idChecked: !!r.id_checked } },
  units: [], fees: [], media: [], amenities: []
});

function group(rows) {
  const m = new Map();
  rows.forEach((r) => { if (!m.has(r.listing_id)) m.set(r.listing_id, []); m.get(r.listing_id).push(r); });
  return m;
}
function hydrate(list, { units = true, fees = true, media = true, amenities = false } = {}) {
  if (!list.length) return list;
  const ids = list.map((l) => l.id);
  const ph = db.inList(ids);
  const U = units ? group(db.all('SELECT * FROM listing_units WHERE listing_id IN (' + ph + ') ORDER BY position, id', ...ids)) : null;
  const F = fees ? group(db.all('SELECT * FROM listing_fees WHERE listing_id IN (' + ph + ') ORDER BY position, id', ...ids)) : null;
  const M = media ? group(db.all('SELECT * FROM listing_media WHERE listing_id IN (' + ph + ') ORDER BY position, id', ...ids)) : null;
  const A = amenities ? group(db.all('SELECT * FROM listing_amenities WHERE listing_id IN (' + ph + ') ORDER BY amenity', ...ids)) : null;
  list.forEach((l) => {
    if (U) l.units = (U.get(l.id) || []).map((r) => ({ _id: r.uid, label: r.label, kind: r.kind, spacesTotal: r.spaces_total, spacesAvailable: r.spaces_available, rent: r.rent, initialPayment: r.initial_payment, period: r.period, genderPreference: r.gender_preference, sharedFacilities: r.shared_facilities ? r.shared_facilities.split(',') : [], notes: r.notes || '', status: r.status, moveInTotal: r.move_in_total }));
    if (F) l.fees = (F.get(l.id) || []).map((r) => ({ label: r.label, customLabel: r.custom_label || '', kind: r.kind, value: r.value, payee: r.payee, refundable: !!r.refundable, note: r.note || '' }));
    if (M) l.media = (M.get(l.id) || []).map((r) => ({ type: r.type, url: r.url, thumbUrl: r.thumb_url, publicId: r.public_id, mediaUid: r.media_uid, width: r.width, height: r.height }));
    if (A) l.amenities = (A.get(l.id) || []).map((r) => r.amenity);
  });
  return list;
}
const one = (sql, ...p) => { const r = mapRow(db.get(sql, ...p)); return r ? hydrate([r], { amenities: true })[0] : null; };

const byUid = (uid) => one(BASE + ' WHERE l.uid = ?', uid);
const bySlug = (slug) => one(BASE + ' WHERE l.slug = ?', slug);
const byId = (id) => one(BASE + ' WHERE l.id = ?', id);
const ownByUid = (uid, userId) => one(BASE + " WHERE l.uid = ? AND l.lister_id = ? AND l.status != 'deleted'", uid, userId);
const idByUid = (uid) => (db.get('SELECT id FROM listings WHERE uid = ?', uid) || {}).id || null;
const publicIdByUid = (uid) => (db.get('SELECT id FROM listings WHERE uid = ? AND status IN ' + PUBLIC, uid) || {}).id || null;

const COL = { title: 'title', description: 'description', propertyType: 'property_type', areaId: 'area_id', junction: 'junction',
  status: 'status', hiddenReason: 'hidden_reason', rejectionReason: 'rejection_reason', submittedAt: 'submitted_at', publishedAt: 'published_at',
  lastConfirmedAt: 'last_confirmed_at', reconfirmDueAt: 'reconfirm_due_at', reminderSentAt: 'reminder_sent_at', rentedAt: 'rented_at',
  isFeatured: 'is_featured', visitedDone: 'visited_done', visitedAt: 'visited_at', visitedBy: 'visited_by', visitedNote: 'visited_note', reportCount: 'report_count' };
function update(id, patch) {
  const keys = Object.keys(patch).filter((k) => COL[k]);
  if (!keys.length) return;
  db.run('UPDATE listings SET ' + keys.map((k) => COL[k] + ' = ?').join(', ') + ', updated_at = ? WHERE id = ?', ...keys.map((k) => patch[k]), Date.now(), id);
}

// Create or update a lodge together with its rooms, charges, photos and amenities, in one transaction.
// meta: { id?, listerId, profileId, slug, status, submittedAt } data: parsed form, pricing: from applyPricing
function save(meta, data, pricing) {
  return db.tx(() => {
    const t = Date.now();
    const f = [data.title, data.description || null, data.propertyType || null, data.areaId || null, data.junction || null,
      data.minutesWalk ?? null, data.minutesKeke ?? null, data.chargesDisclosed ? 1 : 0,
      pricing.priceFrom, pricing.periodFrom, pricing.moveInFrom, pricing.priceYearly, pricing.hasRoomShare ? 1 : 0, data.stateId || null, data.campusId || null];
    let id = meta.id;
    let existingUnits = new Set();
    if (id) {
      existingUnits = new Set(db.all('SELECT uid FROM listing_units WHERE listing_id = ?', id).map((r) => r.uid));
      db.run('UPDATE listings SET title = ?, description = ?, property_type = ?, area_id = ?, junction = ?, minutes_walk = ?, minutes_keke = ?, charges_disclosed = ?, price_from = ?, period_from = ?, move_in_from = ?, price_yearly = ?, has_room_share = ?, state_id = ?, campus_id = ?, status = ?, hidden_reason = NULL, rejection_reason = NULL, submitted_at = COALESCE(?, submitted_at), updated_at = ? WHERE id = ?',
        ...f, meta.status, meta.submittedAt || null, t, id);
    } else {
      id = Number(db.run('INSERT INTO listings (title, description, property_type, area_id, junction, minutes_walk, minutes_keke, charges_disclosed, price_from, period_from, move_in_from, price_yearly, has_room_share, state_id, campus_id, uid, slug, lister_id, lister_profile_id, status, submitted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ...f, newUid(), meta.slug, meta.listerId, meta.profileId, meta.status, meta.submittedAt || null, t, t).lastInsertRowid);
    }
    db.run('DELETE FROM listing_units WHERE listing_id = ?', id);
    data.units.forEach((u, i) => {
      const keep = u._id && existingUnits.has(u._id) ? u._id : newUid();
      db.run('INSERT INTO listing_units (uid, listing_id, position, label, kind, spaces_total, spaces_available, rent, initial_payment, period, gender_preference, shared_facilities, notes, status, move_in_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        keep, id, i, u.label, u.kind, u.spacesTotal, u.spacesAvailable, u.rent, u.initialPayment || null, u.period, u.genderPreference, (u.sharedFacilities || []).join(','), u.notes || null, u.status, u.moveInTotal);
    });
    db.run('DELETE FROM listing_fees WHERE listing_id = ?', id);
    data.fees.forEach((x, i) => db.run('INSERT INTO listing_fees (listing_id, position, label, custom_label, kind, value, payee, refundable, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, i, x.label, x.customLabel || null, x.kind, x.value, x.payee, x.refundable ? 1 : 0, x.note || null));
    db.run('DELETE FROM listing_media WHERE listing_id = ?', id);
    data.media.forEach((m, i) => db.run('INSERT INTO listing_media (listing_id, position, type, url, thumb_url, public_id, media_uid, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, i, m.type, m.url, m.thumbUrl || null, m.publicId || null, m.mediaUid || null, m.width || null, m.height || null));
    db.run('DELETE FROM listing_amenities WHERE listing_id = ?', id);
    data.amenities.forEach((a) => db.run('INSERT OR IGNORE INTO listing_amenities (listing_id, amenity) VALUES (?, ?)', id, a));
    return id;
  });
}

// Availability edits: update free spaces and the stored totals without touching anything else.
function saveAvailability(id, units, pricing) {
  db.tx(() => {
    units.forEach((u) => db.run('UPDATE listing_units SET spaces_available = ?, status = ?, move_in_total = ? WHERE uid = ? AND listing_id = ?', u.spacesAvailable, u.status, u.moveInTotal, u._id, id));
    db.run('UPDATE listings SET price_from = ?, period_from = ?, move_in_from = ?, price_yearly = ?, has_room_share = ?, updated_at = ? WHERE id = ?',
      pricing.priceFrom, pricing.periodFrom, pricing.moveInFrom, pricing.priceYearly, pricing.hasRoomShare ? 1 : 0, Date.now(), id);
  });
}

function browse(f) {
  const where = ['l.status IN ' + PUBLIC];
  const p = [];
  if (f.stateId) { where.push('l.state_id = ?'); p.push(f.stateId); }
  if (f.campusId) { where.push('l.campus_id = ?'); p.push(f.campusId); }
  if (f.areaId) { where.push('l.area_id = ?'); p.push(f.areaId); }
  if (f.propertyType) { where.push('l.property_type = ?'); p.push(f.propertyType); }
  if (f.min) { where.push('l.price_yearly >= ?'); p.push(f.min); }
  if (f.max) { where.push('l.price_yearly <= ?'); p.push(f.max); }
  if (f.roommate) where.push('l.has_room_share = 1');
  (f.amenities || []).forEach((a) => { where.push('EXISTS (SELECT 1 FROM listing_amenities x WHERE x.listing_id = l.id AND x.amenity = ?)'); p.push(a); });
  if (f.q) {
    const like = '%' + escapeLike(f.q) + '%';
    where.push("(l.title LIKE ? ESCAPE '\\' OR l.junction LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\')");
    p.push(like, like, like);
  }
  const order = { new: 'l.is_featured DESC, l.published_at DESC, l.id DESC', price_asc: 'l.price_yearly ASC, l.id DESC', price_desc: 'l.price_yearly DESC, l.id DESC' }[f.sort] || 'l.published_at DESC, l.id DESC';
  const w = ' WHERE ' + where.join(' AND ');
  const total = db.get('SELECT COUNT(*) AS n FROM listings l LEFT JOIN areas a ON a.id = l.area_id' + w, ...p).n;
  const rows = db.all(BASE + w + ' ORDER BY ' + order + ' LIMIT ? OFFSET ?', ...p, f.size, (f.page - 1) * f.size).map(mapRow);
  return { total, rows: hydrate(rows, { fees: false }) };
}

const cardSet = (rows) => hydrate(rows.map(mapRow), { fees: false });
const similar = (areaId, excludeId, limit = 4) => areaId ? cardSet(db.all(BASE + ' WHERE l.status IN ' + PUBLIC + ' AND l.area_id = ? AND l.id != ? ORDER BY l.published_at DESC LIMIT ?', areaId, excludeId, limit)) : [];
const cardsByIds = (ids, publicOnly = true) => {
  if (!ids.length) return [];
  const rows = db.all(BASE + ' WHERE l.id IN (' + db.inList(ids) + ')' + (publicOnly ? ' AND l.status IN ' + PUBLIC : " AND l.status IN ('live', 'needs_reconfirm', 'rented')"), ...ids);
  const order = new Map(ids.map((id, i) => [id, i]));
  return cardSet(rows).sort((a, b) => order.get(a.id) - order.get(b.id));
};
const publicByLister = (userId, limit = 24) => cardSet(db.all(BASE + ' WHERE l.lister_id = ? AND l.status IN ' + PUBLIC + ' ORDER BY l.is_featured DESC, l.published_at DESC LIMIT ?', userId, limit));
const forLister = (userId) => hydrate(db.all(BASE + " WHERE l.lister_id = ? AND l.status != 'deleted' ORDER BY l.updated_at DESC", userId).map(mapRow), { fees: false });
const forListerProfile = (userId) => db.all("SELECT uid, title, status FROM listings WHERE lister_id = ? AND status != 'deleted'", userId).map((r) => ({ _id: r.uid, title: r.title, status: r.status }));
const sitemap = () => db.all('SELECT slug, updated_at FROM listings WHERE status IN ' + PUBLIC + ' ORDER BY updated_at DESC LIMIT 5000');

function adminList({ status, q, page, size }) {
  const where = [];
  const p = [];
  if (status !== 'all') { where.push('l.status = ?'); p.push(status); }
  if (q) { where.push("l.title LIKE ? ESCAPE '\\'"); p.push('%' + escapeLike(q) + '%'); }
  const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const total = db.get('SELECT COUNT(*) AS n FROM listings l' + w, ...p).n;
  const rows = db.all(BASE + w + ' ORDER BY COALESCE(l.submitted_at, l.updated_at) DESC LIMIT ? OFFSET ?', ...p, size, (page - 1) * size).map(mapRow);
  return { total, rows };
}
const countStatus = (status) => db.get('SELECT COUNT(*) AS n FROM listings WHERE status = ?', status).n;
const countPublic = () => db.get('SELECT COUNT(*) AS n FROM listings WHERE status IN ' + PUBLIC).n;
const pendingOldest = (n) => db.all("SELECT uid, title, submitted_at FROM listings WHERE status = 'pending' ORDER BY submitted_at LIMIT ?", n).map((r) => ({ _id: r.uid, title: r.title, submittedAt: r.submitted_at }));
const comparable = (areaId, type, excludeId) => areaId ? db.get('SELECT AVG(price_yearly) AS avg, COUNT(*) AS count FROM listings WHERE status IN ' + PUBLIC + ' AND area_id = ? AND property_type = ? AND id != ?', areaId, type, excludeId) : { avg: null, count: 0 };

// scheduled-job helpers
const dueReconfirm = () => db.all("SELECT id, lister_id, title FROM listings WHERE status = 'live' AND reconfirm_due_at < ?", Date.now());
const markNeedsReconfirm = (id) => db.run("UPDATE listings SET status = 'needs_reconfirm', reminder_sent_at = ?, updated_at = ? WHERE id = ? AND status = 'live'", Date.now(), Date.now(), id).changes;
const staleCandidates = (days) => db.all("SELECT id, lister_id, title FROM listings WHERE status = 'needs_reconfirm' AND last_confirmed_at < ?", Date.now() - days * 86400000);
const hideStale = (id) => db.run("UPDATE listings SET status = 'hidden', hidden_reason = 'stale', updated_at = ? WHERE id = ? AND status = 'needs_reconfirm'", Date.now(), id).changes;
const suspendFor = (userId) => db.run("UPDATE listings SET status = 'suspended', hidden_reason = 'admin', updated_at = ? WHERE lister_id = ? AND status IN ('live', 'needs_reconfirm', 'pending')", Date.now(), userId).changes;
const markDeletedFor = (userId) => db.run("UPDATE listings SET status = 'deleted', updated_at = ? WHERE lister_id = ?", Date.now(), userId);
const removeBySlugPrefix = (userId, prefix) => db.run('DELETE FROM listings WHERE lister_id = ? AND slug LIKE ?', userId, prefix + '%').changes;

const statusCounts = () => db.all('SELECT status, COUNT(*) AS n FROM listings GROUP BY status');
const topByViews = (n) => db.all("SELECT uid, title, views, contact_clicks, saves FROM listings WHERE status != 'deleted' ORDER BY views DESC LIMIT ?", n).map((r) => ({ _id: r.uid, title: r.title, views: r.views, clicks: r.contact_clicks, saves: r.saves }));
const mediaUidsFor = (id) => db.all('SELECT media_uid FROM listing_media WHERE listing_id = ? AND media_uid IS NOT NULL', id).map((r) => r.media_uid);
const hardDelete = (id) => db.run('DELETE FROM listings WHERE id = ?', id);

module.exports = { statusCounts, topByViews, mediaUidsFor, hardDelete, PUBLIC, mapRow, hydrate, byUid, bySlug, byId, ownByUid, idByUid, publicIdByUid, update, save, saveAvailability, browse, similar, cardsByIds,
  forLister, publicByLister, forListerProfile, sitemap, adminList, countStatus, countPublic, pendingOldest, comparable,
  dueReconfirm, markNeedsReconfirm, staleCandidates, hideStale, suspendFor, markDeletedFor, removeBySlugPrefix };
