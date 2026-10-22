// Shared by the command-line tools: load config, open the database, migrate.
const cfg = require('../config');
const db = require('../db');
const { migrate } = require('../db/migrate');

function open() {
  const { errors } = cfg.validate();
  const blocking = errors.filter((e) => !/SESSION_SECRET|SMTP|BASE_URL must start with https/.test(e));
  if (blocking.length) { console.error('\n' + blocking.map((e) => '  x ' + e).join('\n') + '\n'); process.exit(1); }
  cfg.prepare();
  db.open(cfg.dbFile);
  migrate({ backupDir: cfg.backupsDir, isFile: cfg.dbFile !== ':memory:' });
  return db;
}
module.exports = { open, cfg, db };
