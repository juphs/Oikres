// Starts Oikres: validate config, open the database, migrate, first-run tasks, then listen.
// Returns { server, app, close } so tests and the smoke script can run it in-process.
const cfg = require('./config');
const db = require('./db');
const { migrate } = require('./db/migrate');

class StartupError extends Error {}

async function start({ quiet = false } = {}) {
  const say = (s = '') => { if (!quiet) console.log(s); };
  const { errors, warnings } = cfg.validate();
  if (!quiet) warnings.forEach((w) => console.warn('  ! ' + w));
  if (errors.length) throw Object.assign(new StartupError('Oikres cannot start. Fix these in .env, then run npm start again:\n' + errors.map((e) => '  x ' + e).join('\n')), { startup: true });

  try { cfg.prepare(); db.open(cfg.dbFile); }
  catch (err) { throw Object.assign(new StartupError('Could not open the database at ' + cfg.dbFile + ': ' + err.message + '\n  Check that the folder exists and is writable (DATA_DIR in .env).'), { startup: true }); }
  const m = migrate({ backupDir: cfg.backupsDir, isFile: cfg.dbFile !== ':memory:' });
  if (m.applied.length) say('  Database ready (' + m.applied.length + ' migration' + (m.applied.length === 1 ? '' : 's') + ' applied).');
  else say('  Database ready.');

  const boot = require('./services/bootstrap');
  const users = require('./repositories/users');
  const areas = boot.ensureStarterAreas();
  if (areas) say('  Added ' + areas + ' starter areas around UNIZIK (edit them in Admin > Places).');
  if (!cfg.isProd || cfg.admin.email) {
    const r = await boot.ensureAdminFromEnv((msg) => say('  ' + msg));
    if (r === 'created-example') say('  Created the local development administrator.');
  }
  const devAdmin = !cfg.isProd && cfg.admin.password === cfg.EXAMPLE_ADMIN_PASSWORD && cfg.admin.email && users.adminByEmail(cfg.admin.email);
  const hasAdmin = users.adminExists();

  const createApp = require('./app');
  const app = createApp();
  const server = await new Promise((resolve, reject) => { const s = app.listen(cfg.port, () => resolve(s)); s.on('error', reject); })
    .catch((err) => {
      db.close();
      throw Object.assign(new StartupError(err.code === 'EADDRINUSE' ? 'Port ' + cfg.port + ' is already in use. Stop the other program, or set a different PORT in .env.' : 'Could not start the web server: ' + err.message), { startup: true });
    });
  const jobs = require('./services/jobs');
  if (!cfg.isTest) jobs.start();

  say('');
  say('  Photos and videos: ' + (cfg.storageDriver === 'cloudinary' ? 'Cloudinary' : 'stored on this server (' + cfg.uploadsDir + ')'));
  say('  Email: ' + (cfg.mail.enabled ? 'SMTP (' + cfg.smtp.host + ')' : 'not configured - emails are printed here and sign-ups are verified automatically'));
  say('');
  say('  Oikres is running:  ' + (cfg.isProd ? cfg.baseUrl : 'http://localhost:' + server.address().port));
  if (devAdmin) say('  Admin sign-in (local use only):  ' + cfg.admin.email + '  /  ' + cfg.admin.password);
  else if (!hasAdmin) say('  No administrator yet. Run: npm run admin:create');
  say('');

  let closed = false;
  const close = () => new Promise((resolve) => {
    if (closed) return resolve();
    closed = true;
    jobs.stop();
    const force = setTimeout(() => { db.close(); resolve(); }, 10000);
    force.unref && force.unref();
    server.close(() => { clearTimeout(force); db.close(); resolve(); });
    server.closeIdleConnections && server.closeIdleConnections();
  });
  return { server, app, close };
}

module.exports = { start, StartupError };
