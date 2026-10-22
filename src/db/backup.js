const fs = require('fs');
const path = require('path');
const db = require('./index');

// Writes a consistent copy of the live database (safe while the app is running).
function backupTo(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.unlinkSync(file);
  db.exec("VACUUM INTO '" + file.replace(/'/g, "''") + "'");
  return file;
}

// Keeps only the newest `keep` files that start with the prefix.
function prune(dir, prefix, keep) {
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).sort().reverse();
  files.slice(keep).forEach((f) => { try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* ignore */ } });
}

module.exports = { backupTo, prune };
