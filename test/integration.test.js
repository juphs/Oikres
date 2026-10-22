// Starts the real site on a random port with a throwaway database and walks through the main flow over HTTP.
// Needs `npm install` first. Skipped (not failed) if the packages are missing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let missing = '';
try { ['express', 'ejs', 'helmet', 'compression', 'cookie-parser', 'express-rate-limit', 'busboy'].forEach((m) => require.resolve(m)); } catch (e) { missing = 'dependencies are not installed (run npm install)'; }

test('the whole product works end to end', { skip: missing || false }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oikres-it-'));
  const port = 43000 + Math.floor(Math.random() * 2000);
  Object.assign(process.env, { NODE_ENV: 'test', DATA_DIR: dir, DATABASE_PATH: path.join(dir, 'oikres.db'), PORT: String(port), BASE_URL: 'http://127.0.0.1:' + port,
    ADMIN_EMAIL: 'admin@oikres.local', ADMIN_PASSWORD: 'oikres-local-admin', SESSION_SECRET: '', SMTP_HOST: '', CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '' });
  const { start } = require('../src/start');
  const { runFlow } = require('../scripts/flow');
  const { runMarketFlow } = require('../scripts/flow-market');
  const { runHardening } = require('../scripts/flow-hardening');
  const app = await start({ quiet: true });
  try {
    await runFlow('http://127.0.0.1:' + port, { adminEmail: 'admin@oikres.local', adminPassword: 'oikres-local-admin' });
    await runMarketFlow('http://127.0.0.1:' + port, { adminEmail: 'admin@oikres.local', adminPassword: 'oikres-local-admin' }, (n) => process.stdout.write('  ok - ' + n + '\n'));
    await runHardening('http://127.0.0.1:' + port, { adminEmail: 'admin@oikres.local', adminPassword: 'oikres-local-admin' }, (n) => process.stdout.write('  ok - ' + n + '\n'));
    // restarting keeps data and does not duplicate anything
    const db = require('../src/db');
    const before = db.get('SELECT (SELECT COUNT(*) FROM users) AS u, (SELECT COUNT(*) FROM areas) AS a, (SELECT COUNT(*) FROM states) AS s, (SELECT COUNT(*) FROM listings) AS l');
    await app.close();
    const again = await start({ quiet: true });
    try {
    const after = db.get('SELECT (SELECT COUNT(*) FROM users) AS u, (SELECT COUNT(*) FROM areas) AS a, (SELECT COUNT(*) FROM states) AS s, (SELECT COUNT(*) FROM listings) AS l');
      assert.equal(after.u, before.u);
      assert.equal(after.a, before.a, 'restarting does not add starter areas again');
      assert.equal(after.s, before.s, 'restarting does not add states again');
    } finally { await again.close(); }
  } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
