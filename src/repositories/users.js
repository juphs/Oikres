const db = require('../db');
const { uid: newUid, hashToken } = require('../lib/util');

const map = (r) => r && ({
  _id: r.uid, id: r.id, uid: r.uid, name: r.name, email: r.email, passwordHash: r.password_hash,
  emailVerifiedAt: r.email_verified_at, roles: r.is_lister ? ['seeker', 'lister'] : ['seeker'], isAdmin: !!r.is_admin,
  status: r.status, phone: r.phone, notificationPrefs: { email: !!r.notify_email },
  adminNotes: r.admin_notes, failedLogins: r.failed_logins, lockUntil: r.locked_until, passwordChangedAt: r.password_changed_at, createdAt: r.created_at,
  bannedAt: r.banned_at, banReason: r.ban_reason, bannedBy: r.banned_by
});

const byId = (id) => map(db.get('SELECT * FROM users WHERE id = ?', id));
const byUid = (u) => map(db.get('SELECT * FROM users WHERE uid = ?', u));
const byEmail = (e) => map(db.get('SELECT * FROM users WHERE email = ?', String(e).toLowerCase()));

function create({ name, email, passwordHash, isAdmin = false, emailVerified = false }) {
  const t = Date.now();
  const r = db.run('INSERT INTO users (uid, name, email, password_hash, is_admin, email_verified_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    newUid(), name, String(email).toLowerCase(), passwordHash, isAdmin ? 1 : 0, emailVerified ? t : null, t, t);
  return byId(Number(r.lastInsertRowid));
}

const COLS = { name: 'name', phone: 'phone', notifyEmail: 'notify_email', passwordHash: 'password_hash', passwordChangedAt: 'password_changed_at',
  failedLogins: 'failed_logins', lockedUntil: 'locked_until', lastLoginAt: 'last_login_at', emailVerifiedAt: 'email_verified_at',
  status: 'status', isLister: 'is_lister', isAdmin: 'is_admin', email: 'email', deletedAt: 'deleted_at', adminNotes: 'admin_notes',
  bannedAt: 'banned_at', banReason: 'ban_reason', bannedBy: 'banned_by' };
function update(id, patch) {
  const keys = Object.keys(patch).filter((k) => COLS[k]);
  if (!keys.length) return;
  db.run('UPDATE users SET ' + keys.map((k) => COLS[k] + ' = ?').join(', ') + ', updated_at = ? WHERE id = ?', ...keys.map((k) => patch[k]), Date.now(), id);
}

const adminExists = () => !!db.get("SELECT 1 AS x FROM users WHERE is_admin = 1 AND status = 'active' LIMIT 1");
const firstAdmin = () => map(db.get("SELECT * FROM users WHERE is_admin = 1 AND status = 'active' ORDER BY id LIMIT 1"));
const countActive = () => db.get("SELECT COUNT(*) AS n FROM users WHERE status = 'active'").n;
const adminByEmail = (e) => map(db.get('SELECT * FROM users WHERE email = ? AND is_admin = 1', String(e).toLowerCase()));

// ---- sessions (only a hash of the cookie token is stored)
const SESSION_MS = 30 * 24 * 3600 * 1000;
function createSession(userId, token) {
  const t = Date.now();
  db.run('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)', hashToken(token), userId, t, t, t + SESSION_MS);
}
function findSession(token) {
  const r = db.get('SELECT s.id AS sid, s.created_at AS s_created, s.last_seen_at, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?', hashToken(token));
  if (!r) return null;
  return { sid: r.sid, createdAt: r.s_created, lastSeenAt: r.last_seen_at, expiresAt: r.expires_at, user: map(r) };
}
const touchSession = (sid) => { const t = Date.now(); db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', t, t + SESSION_MS, sid); };
const deleteSession = (token) => db.run('DELETE FROM sessions WHERE token_hash = ?', hashToken(token));
const deleteSessionsFor = (userId, exceptToken) =>
  exceptToken ? db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', userId, hashToken(exceptToken)) : db.run('DELETE FROM sessions WHERE user_id = ?', userId);
const purgeSessions = () => db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now()).changes;

// ---- one-time tokens (verify email, reset password)
function createToken(userId, purpose, raw, ttlMs) {
  db.run('DELETE FROM tokens WHERE user_id = ? AND purpose = ?', userId, purpose);
  db.run('INSERT INTO tokens (user_id, purpose, token_hash, expires_at) VALUES (?, ?, ?, ?)', userId, purpose, hashToken(raw), Date.now() + ttlMs);
}
const findToken = (raw, purpose) => db.get('SELECT * FROM tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?', hashToken(raw), purpose, Date.now());
const useToken = (id) => db.run('UPDATE tokens SET used_at = ? WHERE id = ?', Date.now(), id);
const purgeTokens = () => db.run('DELETE FROM tokens WHERE expires_at < ?', Date.now()).changes;

const { escapeLike } = require('../lib/util');
// Admin: search and filter all accounts.
function list({ q, filter, page, size }) {
  const where = [];
  const p = [];
  if (q) { const l = '%' + escapeLike(q) + '%'; where.push("(u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\')"); p.push(l, l, l); }
  const f = { admins: 'u.is_admin = 1', listers: 'u.is_lister = 1', suspended: "u.status = 'suspended' AND u.banned_at IS NULL", banned: "u.banned_at IS NOT NULL AND u.status != 'deleted'", unverified: 'u.email_verified_at IS NULL', deleted: "u.status = 'deleted'" }[filter];
  if (f) where.push(f); else where.push("u.status != 'deleted'");
  const w = ' WHERE ' + where.join(' AND ');
  const total = db.get('SELECT COUNT(*) AS n FROM users u' + w, ...p).n;
  const rows = db.all('SELECT u.*, (SELECT COUNT(*) FROM listings l WHERE l.lister_id = u.id AND l.status != \'deleted\') AS listing_count FROM users u' + w + ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?', ...p, size, (page - 1) * size);
  return { total, rows: rows.map((r) => ({ ...map(r), listingCount: r.listing_count })) };
}
const counts = () => db.get("SELECT COUNT(*) AS total, SUM(status = 'active') AS active, SUM(is_lister = 1 AND status = 'active') AS listers, SUM(is_admin = 1 AND status = 'active') AS admins, SUM(status = 'suspended' AND banned_at IS NULL) AS suspended, SUM(banned_at IS NOT NULL) AS banned, SUM(created_at > ?) AS week FROM users WHERE status != 'deleted'", Date.now() - 7 * 86400000);
const recent = (n) => db.all("SELECT * FROM users WHERE status != 'deleted' ORDER BY created_at DESC LIMIT ?", n).map(map);
const byUidAny = (u) => map(db.get('SELECT * FROM users WHERE uid = ?', u));
const adminCount = () => db.get("SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND status = 'active'").n;
const idsFor = (audience) => db.all({ listers: "SELECT id FROM users WHERE status = 'active' AND is_lister = 1", admins: "SELECT id FROM users WHERE status = 'active' AND is_admin = 1" }[audience] || "SELECT id FROM users WHERE status = 'active'").map((r) => r.id);
const hardDelete = (id) => db.run('DELETE FROM users WHERE id = ?', id);

module.exports = { list, counts, recent, byUidAny, adminCount, idsFor, hardDelete, map, byId, byUid, byEmail, create, update, adminExists, firstAdmin, countActive, adminByEmail,
  createSession, findSession, touchSession, deleteSession, deleteSessionsFor, purgeSessions, createToken, findToken, useToken, purgeTokens };
