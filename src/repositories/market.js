const db = require('../db');
const { uid: newUid, escapeLike } = require('../lib/util');

const DAY = 86400000;
const BASE = `SELECT i.*, (SELECT COUNT(*) FROM market_saved ms WHERE ms.item_id = i.id) AS save_count, u.uid AS seller_uid, u.name AS seller_name, u.status AS seller_status, u.banned_at AS seller_banned, u.email AS seller_email,
  st.name AS state_name, st.slug AS state_slug, c.name AS campus_name, c.slug AS campus_slug
  FROM market_items i JOIN users u ON u.id = i.seller_id
  LEFT JOIN states st ON st.id = i.state_id LEFT JOIN campuses c ON c.id = i.campus_id`;

const mapRow = (r) => r && ({
  _id: r.uid, id: r.id, uid: r.uid, slug: r.slug, title: r.title, description: r.description, category: r.category, condition: r.item_condition,
  price: r.price, negotiable: !!r.negotiable, pickup: r.pickup || '', whatsappNumber: r.whatsapp_number,
  state: r.state_id ? { id: r.state_id, name: r.state_name, slug: r.state_slug } : null,
  campus: r.campus_id ? { id: r.campus_id, name: r.campus_name, slug: r.campus_slug } : null,
  featured: !!r.is_featured, views: r.views || 0, contacts: r.contacts || 0, saves: r.save_count || 0,
  expiresAt: r.expires_at, expired: !!r.expires_at && r.expires_at <= Date.now(), daysLeft: r.expires_at ? Math.ceil((r.expires_at - Date.now()) / DAY) : null,
  status: r.status, hiddenReason: r.hidden_reason, reportCount: r.report_count, publishedAt: r.published_at, soldAt: r.sold_at, createdAt: r.created_at, updatedAt: r.updated_at,
  sellerId: r.seller_id, seller: { uid: r.seller_uid, name: r.seller_name, status: r.seller_status, banned: !!r.seller_banned, email: r.seller_email },
  media: []
});

function hydrate(list) {
  if (!list.length) return list;
  const ids = list.map((i) => i.id);
  const by = new Map();
  db.all('SELECT * FROM market_media WHERE item_id IN (' + db.inList(ids) + ') ORDER BY position, id', ...ids).forEach((m) => {
    if (!by.has(m.item_id)) by.set(m.item_id, []);
    by.get(m.item_id).push({ type: m.type || 'image', url: m.url, thumbUrl: m.thumb_url, publicId: m.public_id, mediaUid: m.media_uid, width: m.width, height: m.height });
  });
  list.forEach((i) => { i.media = by.get(i.id) || []; });
  return list;
}
const cards = (rows) => hydrate(rows.map(mapRow));
const one = (sql, ...p) => { const r = mapRow(db.get(sql, ...p)); return r ? hydrate([r])[0] : null; };

const byUid = (uid) => one(BASE + ' WHERE i.uid = ?', uid);
const bySlug = (slug) => one(BASE + ' WHERE i.slug = ?', slug);
const byId = (id) => one(BASE + ' WHERE i.id = ?', id);

const COL = { title: 'title', description: 'description', category: 'category', condition: 'item_condition', price: 'price', negotiable: 'negotiable',
  stateId: 'state_id', campusId: 'campus_id', pickup: 'pickup', whatsappNumber: 'whatsapp_number', status: 'status', hiddenReason: 'hidden_reason',
  reportCount: 'report_count', publishedAt: 'published_at', soldAt: 'sold_at', expiresAt: 'expires_at', expiryNotifiedAt: 'expiry_notified_at', featured: 'is_featured' };
function update(id, patch) {
  const keys = Object.keys(patch).filter((k) => COL[k]);
  if (!keys.length) return;
  db.run('UPDATE market_items SET ' + keys.map((k) => COL[k] + ' = ?').join(', ') + ', updated_at = ? WHERE id = ?', ...keys.map((k) => patch[k]), Date.now(), id);
}

// Create or update an item together with its photos, in one transaction.
// meta: { id?, sellerId, slug, status, hiddenReason, publishedAt }   data: parsed form, with data.media already resolved.
function save(meta, data) {
  return db.tx(() => {
    const t = Date.now();
    let id = meta.id;
    const f = [data.title, data.description || null, data.category, data.condition, data.price, data.negotiable ? 1 : 0, data.stateId || null, data.campusId || null, data.pickup || null, data.whatsappNumber];
    if (id) {
      db.run('UPDATE market_items SET title = ?, description = ?, category = ?, item_condition = ?, price = ?, negotiable = ?, state_id = ?, campus_id = ?, pickup = ?, whatsapp_number = ?, status = ?, hidden_reason = ?, published_at = COALESCE(?, published_at), expires_at = COALESCE(?, expires_at), updated_at = ? WHERE id = ?',
        ...f, meta.status, meta.hiddenReason || null, meta.publishedAt || null, meta.expiresAt || null, t, id);
    } else {
      id = Number(db.run('INSERT INTO market_items (title, description, category, item_condition, price, negotiable, state_id, campus_id, pickup, whatsapp_number, uid, slug, seller_id, status, hidden_reason, published_at, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ...f, newUid(), meta.slug, meta.sellerId, meta.status, meta.hiddenReason || null, meta.publishedAt || null, meta.expiresAt || null, t, t).lastInsertRowid);
    }
    db.run('DELETE FROM market_media WHERE item_id = ?', id);
    // A video always comes first, so it is the first thing seen on the item page.
    const ordered = data.media.filter((m) => m.type === 'video').concat(data.media.filter((m) => m.type !== 'video'));
    ordered.forEach((m, i) => db.run('INSERT INTO market_media (item_id, position, type, url, thumb_url, public_id, media_uid, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, i, m.type === 'video' ? 'video' : 'image', m.url, m.thumbUrl || null, m.publicId || null, m.mediaUid || null, m.width || null, m.height || null));
    return id;
  });
}

function browse(f) {
  const where = ["i.status = 'live'", "u.status = 'active'", '(i.expires_at IS NULL OR i.expires_at > ?)'];
  const p = [Date.now()];
  if (f.category) { where.push('i.category = ?'); p.push(f.category); }
  if (f.condition) { where.push('i.item_condition = ?'); p.push(f.condition); }
  if (f.stateId) { where.push('i.state_id = ?'); p.push(f.stateId); }
  if (f.campusId) { where.push('i.campus_id = ?'); p.push(f.campusId); }
  if (f.min) { where.push('i.price >= ?'); p.push(f.min); }
  if (f.max) { where.push('i.price <= ?'); p.push(f.max); }
  if (f.q) {
    const like = '%' + escapeLike(f.q) + '%';
    where.push("(i.title LIKE ? ESCAPE '\\' OR i.description LIKE ? ESCAPE '\\')");
    p.push(like, like);
  }
  const order = { new: 'i.is_featured DESC, i.published_at DESC, i.id DESC', price_asc: 'i.price ASC, i.id DESC', price_desc: 'i.price DESC, i.id DESC' }[f.sort] || 'i.is_featured DESC, i.published_at DESC, i.id DESC';
  const w = ' WHERE ' + where.join(' AND ');
  const total = db.get('SELECT COUNT(*) AS n FROM market_items i JOIN users u ON u.id = i.seller_id' + w, ...p).n;
  return { total, rows: cards(db.all(BASE + w + ' ORDER BY ' + order + ' LIMIT ? OFFSET ?', ...p, f.size, (f.page - 1) * f.size)) };
}

const publicBySeller = (userId, limit = 24) => cards(db.all(BASE + " WHERE i.seller_id = ? AND i.status = 'live' AND (i.expires_at IS NULL OR i.expires_at > ?) ORDER BY i.published_at DESC LIMIT ?", userId, Date.now(), limit));
const similar = (category, excludeId, limit = 4) => cards(db.all(BASE + " WHERE i.status = 'live' AND u.status = 'active' AND (i.expires_at IS NULL OR i.expires_at > ?) AND i.category = ? AND i.id != ? ORDER BY i.published_at DESC LIMIT ?", Date.now(), category, excludeId, limit));
const forSeller = (userId) => cards(db.all(BASE + " WHERE i.seller_id = ? AND i.status != 'deleted' ORDER BY i.updated_at DESC", userId));
const activeCount = (userId) => db.get("SELECT COUNT(*) AS n FROM market_items WHERE seller_id = ? AND status IN ('live', 'pending')", userId).n;
const sitemap = () => db.all("SELECT i.slug, i.updated_at FROM market_items i JOIN users u ON u.id = i.seller_id WHERE i.status = 'live' AND u.status = 'active' AND (i.expires_at IS NULL OR i.expires_at > ?) ORDER BY i.updated_at DESC LIMIT 5000", Date.now());

// ---- admin
function adminList({ status, q, page, size }) {
  const where = ["i.status != 'deleted'"];
  const p = [];
  if (status !== 'all') { where.push('i.status = ?'); p.push(status); }
  if (q) { where.push("(i.title LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')"); const l = '%' + escapeLike(q) + '%'; p.push(l, l); }
  const w = ' WHERE ' + where.join(' AND ');
  const total = db.get('SELECT COUNT(*) AS n FROM market_items i JOIN users u ON u.id = i.seller_id' + w, ...p).n;
  return { total, rows: cards(db.all(BASE + w + ' ORDER BY i.updated_at DESC LIMIT ? OFFSET ?', ...p, size, (page - 1) * size)) };
}
const countStatus = (status) => db.get('SELECT COUNT(*) AS n FROM market_items WHERE status = ?', status).n;
const mediaUidsFor = (id) => db.all('SELECT media_uid FROM market_media WHERE item_id = ? AND media_uid IS NOT NULL', id).map((r) => r.media_uid);

// ---- account-level changes (ban, suspend, delete)
const hideAllFor = (userId, reason) => db.run("UPDATE market_items SET status = 'hidden', hidden_reason = ?, updated_at = ? WHERE seller_id = ? AND status IN ('live', 'pending')", reason, Date.now(), userId).changes;
const markDeletedFor = (userId) => db.run("UPDATE market_items SET status = 'deleted', updated_at = ? WHERE seller_id = ?", Date.now(), userId);
const hardDelete = (id) => db.tx(() => {
  db.run("DELETE FROM abuse_reports WHERE target_type = 'item' AND target_id = ?", id);
  db.run('DELETE FROM market_items WHERE id = ?', id);
});

// ---- saved items (a buyer's hearts)
const savedIds = (userId, ids) => ids.length ? new Set(db.all('SELECT item_id FROM market_saved WHERE user_id = ? AND item_id IN (' + db.inList(ids) + ')', userId, ...ids).map((r) => r.item_id)) : new Set();
function toggleSaved(userId, itemId) {
  const had = db.get('SELECT 1 AS x FROM market_saved WHERE user_id = ? AND item_id = ?', userId, itemId);
  if (had) db.run('DELETE FROM market_saved WHERE user_id = ? AND item_id = ?', userId, itemId);
  else db.run('INSERT INTO market_saved (user_id, item_id, created_at) VALUES (?, ?, ?)', userId, itemId, Date.now());
  return !had;
}
// Items someone saved that are still worth showing: live (not expired) or sold, from an active seller.
const savedBy = (userId) => cards(db.all(BASE + " JOIN market_saved sv ON sv.item_id = i.id WHERE sv.user_id = ? AND u.status = 'active' AND ((i.status = 'live' AND (i.expires_at IS NULL OR i.expires_at > ?)) OR i.status = 'sold') ORDER BY sv.created_at DESC LIMIT 100", userId, Date.now()));
// People who saved an item, so they can be told when it is sold (capped so one popular item cannot flood the notifier).
const saversOf = (itemId, limit = 100) => db.all('SELECT user_id FROM market_saved WHERE item_id = ? ORDER BY created_at DESC LIMIT ?', itemId, limit).map((r) => r.user_id);
const savedCount = (userId) => db.get('SELECT COUNT(*) AS n FROM market_saved WHERE user_id = ?', userId).n;

// ---- seller stats: one view and one contact per visitor per item per day
const dayKey = () => Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
function recordEvent(itemId, kind, visitor) {
  const r = db.run('INSERT OR IGNORE INTO market_events (item_id, kind, day, visitor) VALUES (?, ?, ?, ?)', itemId, kind, dayKey(), visitor);
  if (r.changes) db.run('UPDATE market_items SET ' + (kind === 'view' ? 'views = views + 1' : 'contacts = contacts + 1') + ' WHERE id = ?', itemId);
  return !!r.changes;
}
const purgeEvents = (days = 45) => db.run('DELETE FROM market_events WHERE day < ?', Number(new Date(Date.now() - days * DAY).toISOString().slice(0, 10).replace(/-/g, ''))).changes;

// ---- expiry: warn sellers shortly before an item drops out of the market, and renew it
const expiringSoon = (days) => db.all("SELECT id, seller_id, title, slug FROM market_items WHERE status = 'live' AND expiry_notified_at IS NULL AND expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ?", Date.now(), Date.now() + days * DAY);
const renew = (id, days) => update(id, { expiresAt: Date.now() + days * DAY, expiryNotifiedAt: null });
const featuredCount = () => db.get('SELECT COUNT(*) AS n FROM market_items WHERE is_featured = 1 AND status = \'live\'').n;

module.exports = { saversOf, savedIds, toggleSaved, savedBy, savedCount, recordEvent, purgeEvents, expiringSoon, renew, featuredCount, mapRow, byUid, bySlug, byId, update, save, browse, publicBySeller, similar, forSeller, activeCount, sitemap,
  adminList, countStatus, mediaUidsFor, hideAllFor, markDeletedFor, hardDelete };
