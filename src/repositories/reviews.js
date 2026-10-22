const db = require('../db');
const { uid: newUid } = require('../lib/util');

// A review counts only while it is visible and its author is not banned or deleted. Ratings are worked out from these rows every time,
// so there is no stored average that could drift from the real reviews.
const COUNTED = "r.status = 'visible' AND a.banned_at IS NULL AND a.status != 'deleted'";

const map = (r) => r && ({
  id: r.id, uid: r.uid, rating: r.rating, body: r.body || '', status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
  subjectId: r.subject_id, authorId: r.author_id,
  author: { uid: r.a_uid, name: r.a_name, banned: !!r.a_banned }, subject: { uid: r.s_uid, name: r.s_name }
});
const SELECT = `SELECT r.*, a.uid AS a_uid, a.name AS a_name, a.banned_at AS a_banned, s.uid AS s_uid, s.name AS s_name
  FROM reviews r JOIN users a ON a.id = r.author_id JOIN users s ON s.id = r.subject_id`;

const byPair = (subjectId, authorId) => map(db.get(SELECT + ' WHERE r.subject_id = ? AND r.author_id = ?', subjectId, authorId));
const byUid = (uid) => map(db.get(SELECT + ' WHERE r.uid = ?', uid));
const byId = (id) => map(db.get(SELECT + ' WHERE r.id = ?', id));

function create({ subjectId, authorId, rating, body }) {
  const t = Date.now();
  return byId(Number(db.run('INSERT INTO reviews (uid, subject_id, author_id, rating, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', newUid(), subjectId, authorId, rating, body || null, t, t).lastInsertRowid));
}
const edit = (id, { rating, body }) => db.run('UPDATE reviews SET rating = ?, body = ?, updated_at = ? WHERE id = ?', rating, body || null, Date.now(), id);
const setStatus = (id, status) => db.run('UPDATE reviews SET status = ?, updated_at = ? WHERE id = ?', status, Date.now(), id);
const remove = (id) => db.tx(() => {
  db.run("DELETE FROM abuse_reports WHERE target_type = 'review' AND target_id = ?", id);
  db.run('DELETE FROM reviews WHERE id = ?', id);
});

// { count, average, stars: {1..5: n} } for one person.
function summary(subjectId) {
  const r = db.get(`SELECT COUNT(*) AS n, AVG(r.rating) AS avg, SUM(r.rating = 1) AS s1, SUM(r.rating = 2) AS s2, SUM(r.rating = 3) AS s3, SUM(r.rating = 4) AS s4, SUM(r.rating = 5) AS s5
    FROM reviews r JOIN users a ON a.id = r.author_id WHERE r.subject_id = ? AND ` + COUNTED, subjectId);
  return { count: r.n, average: r.n ? Math.round(r.avg * 10) / 10 : 0, stars: { 1: r.s1 || 0, 2: r.s2 || 0, 3: r.s3 || 0, 4: r.s4 || 0, 5: r.s5 || 0 } };
}
function list(subjectId, { page = 1, size = 10 } = {}) {
  return db.all(SELECT + ' WHERE r.subject_id = ? AND ' + COUNTED + ' ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?', subjectId, size, (page - 1) * size).map(map);
}

// Admin views: every review about a person or written by them, whatever its state.
const aboutUser = (userId) => db.all(SELECT + ' WHERE r.subject_id = ? ORDER BY r.created_at DESC LIMIT 50', userId).map(map);
const writtenBy = (userId) => db.all(SELECT + ' WHERE r.author_id = ? ORDER BY r.created_at DESC LIMIT 50', userId).map(map);
const total = () => db.get("SELECT COUNT(*) AS n FROM reviews WHERE status = 'visible'").n;

module.exports = { byPair, byUid, byId, create, edit, setStatus, remove, summary, list, aboutUser, writtenBy, total };
