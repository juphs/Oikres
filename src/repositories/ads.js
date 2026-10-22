const db = require('../db');
const { uid: newUid } = require('../lib/util');

const map = (r) => r && ({ _id: r.uid, id: r.id, uid: r.uid, title: r.title, body: r.body || '', imageUrl: r.image_url, thumbUrl: r.thumb_url, mediaUid: r.media_uid, videoUrl: r.video_url, videoMediaUid: r.video_media_uid,
  sponsor: r.sponsor || '', badge: r.badge || '', buttonLabel: r.button_label || '', linkType: r.link_type, linkValue: r.link_value || '', placement: r.placement,
  stateId: r.state_id, campusId: r.campus_id, startsAt: r.starts_at, endsAt: r.ends_at, position: r.position, isActive: !!r.is_active,
  impressions: r.impressions, clicks: r.clicks, createdAt: r.created_at, stateName: r.state_name, campusName: r.campus_name });

const SELECT = 'SELECT a.*, s.name AS state_name, c.name AS campus_name FROM ads a LEFT JOIN states s ON s.id = a.state_id LEFT JOIN campuses c ON c.id = a.campus_id';
const byUid = (uid) => map(db.get(SELECT + ' WHERE a.uid = ?', uid));
const all = () => db.all(SELECT + ' ORDER BY a.is_active DESC, a.position, a.id DESC').map(map);

// Ads to show on a list: active, inside their dates, for this place (an ad with no state/campus shows everywhere).
function forPlacement(placement, { stateId = null, campusId = null, limit = 6 } = {}) {
  const t = Date.now();
  const where = ['a.is_active = 1', "a.placement IN (?, 'both')", '(a.starts_at IS NULL OR a.starts_at <= ?)', '(a.ends_at IS NULL OR a.ends_at >= ?)'];
  const p = [placement, t, t];
  if (stateId) { where.push('(a.state_id IS NULL OR a.state_id = ?)'); p.push(stateId); }
  if (campusId) { where.push('(a.campus_id IS NULL OR a.campus_id = ?)'); p.push(campusId); }
  return db.all(SELECT + ' WHERE ' + where.join(' AND ') + ' ORDER BY a.position, a.id DESC LIMIT ?', ...p, limit).map(map);
}

const FIELDS = ['title', 'body', 'imageUrl', 'thumbUrl', 'mediaUid', 'videoUrl', 'videoMediaUid', 'sponsor', 'badge', 'buttonLabel', 'linkType', 'linkValue', 'placement', 'stateId', 'campusId', 'startsAt', 'endsAt', 'position'];
const vals = (d) => [d.title, d.body || null, d.imageUrl || null, d.thumbUrl || null, d.mediaUid || null, d.videoUrl || null, d.videoMediaUid || null, d.sponsor || null, d.badge || null, d.buttonLabel || null, d.linkType, d.linkValue || null, d.placement, d.stateId || null, d.campusId || null, d.startsAt || null, d.endsAt || null, d.position];
function create(d, by) {
  const t = Date.now();
  const id = Number(db.run('INSERT INTO ads (' + FIELDS.map((f) => f.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())).join(', ') + ', uid, created_by, created_at, updated_at) VALUES (' + FIELDS.map(() => '?').join(', ') + ', ?, ?, ?, ?)',
    ...vals(d), newUid(), by || null, t, t).lastInsertRowid);
  return map(db.get(SELECT + ' WHERE a.id = ?', id));
}
function update(id, d) {
  db.run('UPDATE ads SET ' + FIELDS.map((f) => f.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase()) + ' = ?').join(', ') + ', updated_at = ? WHERE id = ?', ...vals(d), Date.now(), id);
}
const toggle = (id) => db.run('UPDATE ads SET is_active = 1 - is_active, updated_at = ? WHERE id = ?', Date.now(), id);
const remove = (id) => db.run('DELETE FROM ads WHERE id = ?', id);
const countActive = () => db.get('SELECT COUNT(*) AS n FROM ads WHERE is_active = 1').n;

// Counters are plain totals (no per-visitor tracking).
const seen = (ids) => { if (ids.length) db.run('UPDATE ads SET impressions = impressions + 1 WHERE id IN (' + db.inList(ids) + ')', ...ids); };
const clicked = (id) => db.run('UPDATE ads SET clicks = clicks + 1 WHERE id = ?', id);

module.exports = { map, byUid, all, forPlacement, create, update, toggle, remove, countActive, seen, clicked };
