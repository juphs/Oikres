const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./index');
const { backupTo, prune } = require('./backup');

const DIR = path.join(__dirname, 'migrations');
const checksum = (text) => crypto.createHash('sha256').update(text).digest('hex');

function files() {
  return fs.readdirSync(DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
}

// Applies pending migrations in order, each in its own transaction. Safe to run on every start.
// Returns { applied: [names], backup: path|null }.
function migrate({ backupDir, isFile } = {}) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  const done = new Map(db.all('SELECT version, name, checksum FROM schema_migrations').map((r) => [r.version, r]));
  const pending = [];
  for (const f of files()) {
    const version = parseInt(f, 10);
    const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
    const sum = checksum(sql);
    const prior = done.get(version);
    if (prior) {
      if (prior.checksum !== sum) throw new Error('Migration ' + f + ' was changed after it was applied. Never edit an applied migration: add a new numbered file instead.');
      continue;
    }
    pending.push({ version, name: f, sql, sum });
  }
  let backup = null;
  if (pending.length && done.size > 0 && isFile && backupDir) {
    backup = backupTo(path.join(backupDir, 'before-migration-' + Date.now() + '.db'));
    prune(backupDir, 'before-migration-', 5);
  }
  const applied = [];
  for (const m of pending) {
    try {
      db.tx(() => {
        db.exec(m.sql);
        db.run('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)', m.version, m.name, m.sum, Date.now());
      });
      applied.push(m.name);
    } catch (err) {
      throw new Error('Migration ' + m.name + ' failed: ' + err.message + (backup ? ' (a backup was saved at ' + backup + ')' : ''));
    }
  }
  return { applied, backup };
}

module.exports = { migrate };
