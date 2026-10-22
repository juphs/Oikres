const db = require('../db');

const map = (r) => r && ({
  _id: String(r.id), id: r.id, userId: r.user_id, displayName: r.display_name, businessName: r.business_name, type: r.type,
  whatsappNumber: r.whatsapp_number, adminNotes: r.admin_notes,
  verification: {
    phoneVerified: !!r.phone_verified, phoneVerifiedAt: r.phone_verified_at,
    idChecked: !!r.id_checked, idCheckedAt: r.id_checked_at, idStatus: r.id_status, idType: r.id_type, idNote: r.id_note,
    idDocument: r.id_file ? { publicId: r.id_file, uploadedAt: r.id_uploaded_at, purgeAfter: r.id_purge_after } : null
  }
});
const byUserId = (uid) => map(db.get('SELECT * FROM lister_profiles WHERE user_id = ?', uid));
const byId = (id) => map(db.get('SELECT * FROM lister_profiles WHERE id = ?', id));

function create({ userId, displayName, businessName, type, whatsappNumber, idFile, idType }) {
  const t = Date.now();
  const r = db.tx(() => {
    const res = db.run('INSERT INTO lister_profiles (user_id, display_name, business_name, type, whatsapp_number, id_status, id_type, id_file, id_uploaded_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      userId, displayName, businessName || null, type, whatsappNumber, idFile ? 'submitted' : 'none', idFile ? idType || 'nin' : null, idFile || null, idFile ? t : null, t, t);
    db.run('UPDATE users SET is_lister = 1, updated_at = ? WHERE id = ?', t, userId);
    return res;
  });
  return byId(Number(r.lastInsertRowid));
}

const COLS = { displayName: 'display_name', businessName: 'business_name', type: 'type', whatsappNumber: 'whatsapp_number',
  phoneVerified: 'phone_verified', phoneVerifiedAt: 'phone_verified_at', phoneVerifiedBy: 'phone_verified_by',
  idStatus: 'id_status', idType: 'id_type', idChecked: 'id_checked', idCheckedAt: 'id_checked_at', idCheckedBy: 'id_checked_by',
  idFile: 'id_file', idUploadedAt: 'id_uploaded_at', idPurgeAfter: 'id_purge_after', idNote: 'id_note', adminNotes: 'admin_notes' };
function update(id, patch) {
  const keys = Object.keys(patch).filter((k) => COLS[k]);
  if (!keys.length) return;
  db.run('UPDATE lister_profiles SET ' + keys.map((k) => COLS[k] + ' = ?').join(', ') + ', updated_at = ? WHERE id = ?', ...keys.map((k) => patch[k]), Date.now(), id);
}

function listForAdmin({ waiting, q }) {
  const where = [];
  const params = [];
  if (waiting) where.push("(p.id_status = 'submitted' OR p.phone_verified = 0)");
  if (q) { where.push("(p.display_name LIKE ? ESCAPE '\\' OR p.business_name LIKE ? ESCAPE '\\' OR p.whatsapp_number LIKE ? ESCAPE '\\')"); const l = '%' + q.replace(/[\\%_]/g, '\\$&') + '%'; params.push(l, l, l); }
  const rows = db.all('SELECT p.*, u.email AS u_email, u.status AS u_status FROM lister_profiles p JOIN users u ON u.id = p.user_id' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY p.updated_at DESC LIMIT 100', ...params);
  return rows.map((r) => ({ ...map(r), user: { email: r.u_email, status: r.u_status } }));
}
const waitingCount = () => db.get("SELECT COUNT(*) AS n FROM lister_profiles WHERE id_status = 'submitted' OR phone_verified = 0").n;
const dueForPurge = () => db.all('SELECT * FROM lister_profiles WHERE id_file IS NOT NULL AND id_purge_after IS NOT NULL AND id_purge_after < ?', Date.now()).map(map);
const clearId = (id) => db.run('UPDATE lister_profiles SET id_file = NULL, id_purge_after = NULL, updated_at = ? WHERE id = ?', Date.now(), id);

module.exports = { map, byUserId, byId, create, update, listForAdmin, waitingCount, dueForPurge, clearId };
