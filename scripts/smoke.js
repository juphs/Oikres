// npm run smoke - starts Oikres with a throwaway database and walks through the main flow.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oikres-smoke-'));
const port = 41000 + Math.floor(Math.random() * 2000);
Object.assign(process.env, {
  NODE_ENV: 'test', DATA_DIR: dir, DATABASE_PATH: path.join(dir, 'oikres.db'), PORT: String(port), BASE_URL: 'http://127.0.0.1:' + port,
  ADMIN_EMAIL: 'admin@oikres.local', ADMIN_PASSWORD: 'oikres-local-admin', SESSION_SECRET: '', SMTP_HOST: '', CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: ''
});

(async () => {
  const { start } = require('../src/start');
  const { runFlow } = require('./flow');
  const app = await start({ quiet: true });
  console.log('Oikres smoke test (temporary data in ' + dir + ')\n');
  try {
    await runFlow('http://127.0.0.1:' + port, { adminEmail: 'admin@oikres.local', adminPassword: 'oikres-local-admin' }, (n) => console.log('  ok  ' + n));
    console.log('\nAll steps passed.');
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((err) => { console.error('\nSmoke test FAILED: ' + (err && err.message ? err.message : err) + '\n'); process.exit(1); });
