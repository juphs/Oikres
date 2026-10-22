// npm run backup - writes a consistent copy of the database to DATA_DIR/backups
const path = require('path');
const { open, cfg, db } = require('./boot');
const { backupTo, prune } = require('../db/backup');
if (cfg.dbFile === ':memory:') { console.error('Nothing to back up: the database is in memory.'); process.exit(1); }
open();
const file = backupTo(path.join(cfg.backupsDir, 'manual-' + new Date().toISOString().replace(/[:.]/g, '-') + '.db'));
prune(cfg.backupsDir, 'manual-', 10);
db.close();
console.log('Backup saved: ' + file + '\nUploaded photos are in ' + cfg.uploadsDir + ' - copy that folder too.');
