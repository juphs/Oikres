// Reports about market items, people and reviews (lodge reports are in activity.js and keep their own table).
const db = require('../db');

const map = (r) => r && ({ _id: String(r.id), id: r.id, targetType: r.target_type, targetId: r.target_id, subjectUserId: r.subject_user_id, reason: r.reason, note: r.note,
  status: r.status, createdAt: r.created_at, handledAt: r.handled_at, resolutionNote: r.resolution_note });

const exists = (type, targetId, key) => !!db.get("SELECT 1 AS x FROM abuse_reports WHERE target_type = ? AND target_id = ? AND reporter_key = ? AND status = 'open'", type, targetId, key);

// Returns how many different people have an open report on this target.
function add({ targetType, targetId, subjectUserId, reporterId, reporterKey, reason, note }) {
  db.run('INSERT INTO abuse_reports (target_type, target_id, subject_user_id, reporter_id, reporter_key, reason, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    targetType, targetId, subjectUserId, reporterId || null, reporterKey, reason, note || null, Date.now());
  return db.get("SELECT COUNT(DISTINCT reporter_key) AS n FROM abuse_reports WHERE target_type = ? AND target_id = ? AND status = 'open'", targetType, targetId).n;
}

function openCounts() {
  const out = { item: 0, user: 0, review: 0 };
  db.all("SELECT target_type, COUNT(*) AS n FROM abuse_reports WHERE status = 'open' GROUP BY target_type").forEach((r) => { out[r.target_type] = r.n; });
  return out;
}
const openTotal = () => { const c = openCounts(); return c.item + c.user + c.review; };
const openAgainstUser = (userId) => db.get("SELECT COUNT(*) AS n FROM abuse_reports WHERE subject_user_id = ? AND status = 'open'", userId).n;

const SUBJECT = 'su.uid AS su_uid, su.name AS su_name, su.status AS su_status, su.banned_at AS su_banned';
function list(type, status) {
  let sql;
  if (type === 'item') {
    sql = `SELECT f.*, i.uid AS t_uid, i.title AS t_title, i.slug AS t_slug, i.status AS t_status, ${SUBJECT}
      FROM abuse_reports f LEFT JOIN market_items i ON i.id = f.target_id JOIN users su ON su.id = f.subject_user_id WHERE f.target_type = 'item' AND f.status = ? ORDER BY f.created_at DESC LIMIT 100`;
  } else if (type === 'review') {
    sql = `SELECT f.*, rv.uid AS t_uid, rv.rating AS t_rating, rv.body AS t_body, rv.status AS t_status, rs.name AS t_about, rs.uid AS t_about_uid, ${SUBJECT}
      FROM abuse_reports f LEFT JOIN reviews rv ON rv.id = f.target_id LEFT JOIN users rs ON rs.id = rv.subject_id JOIN users su ON su.id = f.subject_user_id WHERE f.target_type = 'review' AND f.status = ? ORDER BY f.created_at DESC LIMIT 100`;
  } else {
    sql = `SELECT f.*, ${SUBJECT} FROM abuse_reports f JOIN users su ON su.id = f.subject_user_id WHERE f.target_type = 'user' AND f.status = ? ORDER BY f.created_at DESC LIMIT 100`;
  }
  return db.all(sql, status).map((r) => ({ ...map(r),
    target: { uid: r.t_uid, title: r.t_title, slug: r.t_slug, status: r.t_status, rating: r.t_rating, body: r.t_body, about: r.t_about, aboutUid: r.t_about_uid },
    subject: { uid: r.su_uid, name: r.su_name, status: r.su_status, banned: !!r.su_banned } }));
}
const byId = (id) => map(db.get('SELECT * FROM abuse_reports WHERE id = ?', id));
const setStatus = (id, status, by, note) => db.run('UPDATE abuse_reports SET status = ?, handled_by = ?, handled_at = ?, resolution_note = COALESCE(?, resolution_note) WHERE id = ?', status, by, Date.now(), note || null, id);
const closeOpenFor = (type, targetId, by, note) => db.run("UPDATE abuse_reports SET status = 'actioned', handled_by = ?, handled_at = ?, resolution_note = ? WHERE target_type = ? AND target_id = ? AND status = 'open'", by, Date.now(), note, type, targetId).changes;
const closeOpenAgainstUser = (userId, by, note) => db.run("UPDATE abuse_reports SET status = 'actioned', handled_by = ?, handled_at = ?, resolution_note = ? WHERE subject_user_id = ? AND status = 'open'", by, Date.now(), note, userId).changes;
const removeResolved = (id) => db.run("DELETE FROM abuse_reports WHERE id = ? AND status != 'open'", id);
const forUser = (userId) => db.all('SELECT * FROM abuse_reports WHERE subject_user_id = ? ORDER BY created_at DESC LIMIT 20', userId).map(map);

module.exports = { exists, add, openCounts, openTotal, openAgainstUser, list, byId, setStatus, closeOpenFor, closeOpenAgainstUser, removeResolved, forUser };
