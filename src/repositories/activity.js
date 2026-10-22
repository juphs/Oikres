const db = require('../db');

// ---- wishlist
const isSaved = (userId, listingId) => !!db.get('SELECT 1 AS x FROM wishlists WHERE user_id = ? AND listing_id = ?', userId, listingId);
function savedIds(userId, listingIds) {
  if (!listingIds.length) return new Set();
  return new Set(db.all('SELECT listing_id FROM wishlists WHERE user_id = ? AND listing_id IN (' + db.inList(listingIds) + ')', userId, ...listingIds).map((r) => r.listing_id));
}
function toggleSave(userId, listingId) {
  return db.tx(() => {
    if (db.run('DELETE FROM wishlists WHERE user_id = ? AND listing_id = ?', userId, listingId).changes) {
      db.run('UPDATE listings SET saves = MAX(saves - 1, 0) WHERE id = ?', listingId);
      return false;
    }
    db.run('INSERT INTO wishlists (user_id, listing_id, created_at) VALUES (?, ?, ?)', userId, listingId, Date.now());
    db.run('UPDATE listings SET saves = saves + 1 WHERE id = ?', listingId);
    return true;
  });
}
function addSave(userId, listingId) {
  if (db.run('INSERT OR IGNORE INTO wishlists (user_id, listing_id, created_at) VALUES (?, ?, ?)', userId, listingId, Date.now()).changes) {
    db.run('UPDATE listings SET saves = saves + 1 WHERE id = ?', listingId);
    return true;
  }
  return false;
}
const savedListingIds = (userId) => db.all('SELECT listing_id FROM wishlists WHERE user_id = ? ORDER BY created_at DESC', userId).map((r) => r.listing_id);
const savedCount = (userId) => db.get('SELECT COUNT(*) AS n FROM wishlists WHERE user_id = ?', userId).n;

// ---- events and feedback
const eventSince = (type, listingId, anonId, sinceMs) => !!db.get('SELECT 1 AS x FROM events WHERE type = ? AND listing_id = ? AND anon_id = ? AND at > ? LIMIT 1', type, listingId, anonId, Date.now() - sinceMs);
function recordEvent(type, listingId, anonId, userId) {
  db.run('INSERT INTO events (type, listing_id, anon_id, user_id, at) VALUES (?, ?, ?, ?, ?)', type, listingId, anonId, userId || null, Date.now());
  if (type === 'view') db.run('UPDATE listings SET views = views + 1 WHERE id = ?', listingId);
  if (type === 'contact_click') db.run('UPDATE listings SET contact_clicks = contact_clicks + 1 WHERE id = ?', listingId);
}
function dailyCounts(days, listingIds) {
  const since = new Date(); since.setUTCHours(0, 0, 0, 0); since.setTime(since.getTime() - (days - 1) * 86400000);
  let sql = "SELECT strftime('%Y-%m-%d', at / 1000, 'unixepoch') AS d, type, COUNT(*) AS n FROM events WHERE type IN ('view', 'contact_click') AND at >= ?";
  const p = [since.getTime()];
  if (listingIds) { if (!listingIds.length) return buildDays(days, []); sql += ' AND listing_id IN (' + db.inList(listingIds) + ')'; p.push(...listingIds); }
  return buildDays(days, db.all(sql + ' GROUP BY d, type', ...p));
}
function buildDays(days, rows) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    const n = (t) => (rows.find((r) => r.d === key && r.type === t) || { n: 0 }).n;
    out.push({ label: d.toLocaleDateString('en-NG', { weekday: 'short', timeZone: 'UTC' }), views: n('view'), clicks: n('contact_click') });
  }
  return out;
}
const purgeEvents = () => db.run('DELETE FROM events WHERE at < ?', Date.now() - 365 * 86400000).changes;

const addFeedback = (listingId, anonId, userId, replied) => db.run('INSERT INTO contact_feedback (listing_id, anon_id, user_id, replied, created_at) VALUES (?, ?, ?, ?, ?)', listingId, anonId, userId || null, replied ? 1 : 0, Date.now());
const feedbackRecent = (listingId, anonId) => !!db.get('SELECT 1 AS x FROM contact_feedback WHERE listing_id = ? AND anon_id = ? AND created_at > ?', listingId, anonId, Date.now() - 86400000);
function feedbackFor(listingIds) {
  const out = {};
  if (!listingIds.length) return out;
  db.all('SELECT listing_id, COUNT(*) AS total, SUM(replied) AS replied FROM contact_feedback WHERE listing_id IN (' + db.inList(listingIds) + ') GROUP BY listing_id', ...listingIds).forEach((r) => { out[r.listing_id] = r; });
  return out;
}

// ---- reports
const reportMap = (r) => r && ({ _id: String(r.id), id: r.id, listingId: r.listing_id, reason: r.reason, note: r.note, status: r.status, createdAt: r.created_at, handledAt: r.handled_at, resolutionNote: r.resolution_note });
const reportExists = (listingId, key) => !!db.get("SELECT 1 AS x FROM reports WHERE listing_id = ? AND reporter_key = ? AND status = 'open'", listingId, key);
function addReport({ listingId, reporterId, reporterKey, reason, note }) {
  db.run('INSERT INTO reports (listing_id, reporter_id, reporter_key, reason, note, created_at) VALUES (?, ?, ?, ?, ?, ?)', listingId, reporterId || null, reporterKey, reason, note || null, Date.now());
  return db.get("SELECT COUNT(DISTINCT reporter_key) AS n FROM reports WHERE listing_id = ? AND status = 'open'", listingId).n;
}
const openReportCount = () => db.get("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").n;
function listReports(status) {
  return db.all('SELECT r.*, l.uid AS l_uid, l.title AS l_title, l.slug AS l_slug, l.status AS l_status, l.lister_id AS l_lister, lu.uid AS lu_uid, lu.name AS lu_name, lu.banned_at AS lu_banned FROM reports r JOIN listings l ON l.id = r.listing_id JOIN users lu ON lu.id = l.lister_id WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 100', status)
    .map((r) => ({ ...reportMap(r), listing: { _id: r.l_uid, id: r.listing_id, title: r.l_title, slug: r.l_slug, status: r.l_status, listerId: r.l_lister, listerUid: r.lu_uid, listerName: r.lu_name, listerBanned: !!r.lu_banned } }));
}
const reportById = (id) => { const r = db.get('SELECT r.*, l.uid AS l_uid, l.title AS l_title, l.lister_id AS l_lister FROM reports r JOIN listings l ON l.id = r.listing_id WHERE r.id = ?', id); return r && { ...reportMap(r), listing: { _id: r.l_uid, id: r.listing_id, title: r.l_title, listerId: r.l_lister } }; };
const reportsForListing = (listingId) => db.all('SELECT * FROM reports WHERE listing_id = ? ORDER BY created_at DESC LIMIT 10', listingId).map(reportMap);
const setReport = (id, status, by, note) => db.run('UPDATE reports SET status = ?, handled_by = ?, handled_at = ?, resolution_note = COALESCE(?, resolution_note) WHERE id = ?', status, by, Date.now(), note || null, id);
const closeOpenReports = (listingId, by, note) => db.run("UPDATE reports SET status = 'actioned', handled_by = ?, handled_at = ?, resolution_note = ? WHERE listing_id = ? AND status = 'open'", by, Date.now(), note, listingId);

// ---- notifications and audit
const addNotification = (userId, { type, title, body, link }) => db.run('INSERT INTO notifications (user_id, type, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?)', userId, type || null, title, body || '', link || null, Date.now());
const unreadCount = (userId) => db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', userId).n;
const listNotifications = (userId) => db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', userId).map((r) => ({ title: r.title, body: r.body, link: r.link, createdAt: r.created_at }));
const markAllRead = (userId) => db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', Date.now(), userId);

const addAudit = (actor, action, targetType, targetId, detail) => db.run('INSERT INTO audit_log (actor_id, actor_label, action, target_type, target_id, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?)', actor ? actor.id : null, actor ? actor.email : 'system', action, targetType || null, String(targetId || ''), detail || '', Date.now());
const auditPage = (page, size) => ({ total: db.get('SELECT COUNT(*) AS n FROM audit_log').n, rows: db.all('SELECT actor_label AS actorLabel, action, target_type AS targetType, detail, at FROM audit_log ORDER BY at DESC, id DESC LIMIT ? OFFSET ?', size, (page - 1) * size) });

function broadcast(userIds, { title, body, link }) {
  const t = Date.now();
  db.tx(() => userIds.forEach((id) => db.run('INSERT INTO notifications (user_id, type, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, 'announcement', title, body || '', link || null, t)));
  return userIds.length;
}
const removeReport = (id) => db.run("DELETE FROM reports WHERE id = ? AND status != 'open'", id);

module.exports = { broadcast, removeReport, isSaved, savedIds, toggleSave, addSave, savedListingIds, savedCount, eventSince, recordEvent, dailyCounts, purgeEvents,
  addFeedback, feedbackRecent, feedbackFor, reportExists, addReport, openReportCount, listReports, reportById, reportsForListing, setReport, closeOpenReports,
  addNotification, unreadCount, listNotifications, markAllRead, addAudit, auditPage };
