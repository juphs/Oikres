const db = require('../db');
const { uid: newUid } = require('../lib/util');

const map = (r) => r && ({ id: r.id, uid: r.uid, ownerId: r.owner_id, kind: r.kind, file: r.file, thumbFile: r.thumb_file, width: r.width, height: r.height, size: r.size, attached: !!r.attached });
function insert({ ownerId, kind, file, thumbFile, width, height, size }) {
  const uid = newUid();
  db.run('INSERT INTO media_files (uid, owner_id, kind, file, thumb_file, width, height, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', uid, ownerId, kind, file, thumbFile || null, width || null, height || null, size || 0, Date.now());
  return map(db.get('SELECT * FROM media_files WHERE uid = ?', uid));
}
const byUid = (uid) => map(db.get('SELECT * FROM media_files WHERE uid = ?', uid));
const attach = (uid) => db.run('UPDATE media_files SET attached = 1 WHERE uid = ?', uid);
const orphans = (olderThanMs) => db.all('SELECT * FROM media_files WHERE attached = 0 AND created_at < ?', Date.now() - olderThanMs).map(map);
const remove = (id) => db.run('DELETE FROM media_files WHERE id = ?', id);
const removeByFile = (file) => db.run('DELETE FROM media_files WHERE file = ?', file);
const byOwner = (ownerId) => db.all('SELECT * FROM media_files WHERE owner_id = ?', ownerId).map(map);
module.exports = { byOwner, insert, byUid, attach, orphans, remove, removeByFile };
