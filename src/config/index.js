// Loads .env and exposes settings. Importing never exits or writes files:
// call cfg.validate() to get errors/warnings and cfg.prepare() to create folders and the dev secret.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const envFile = path.join(root, '.env');
const hasEnvFile = fs.existsSync(envFile);
require('dotenv').config({ path: envFile, quiet: true });

const e = process.env;
const nodeEnv = e.NODE_ENV === 'production' ? 'production' : e.NODE_ENV === 'test' ? 'test' : 'development';
const isProd = nodeEnv === 'production';
const port = Number.isInteger(Number(e.PORT)) && e.PORT !== '' && e.PORT !== undefined ? Number(e.PORT) : 3000;
const dataDir = path.resolve(root, e.DATA_DIR || './data');
const EXAMPLE_ADMIN_PASSWORD = 'oikres-local-admin';

const cfg = {
  root, nodeEnv, isProd, isTest: nodeEnv === 'test', hasEnvFile, port,
  baseUrl: (e.BASE_URL || 'http://localhost:' + port).replace(/\/$/, ''),
  trustProxy: e.TRUST_PROXY ? Number(e.TRUST_PROXY) || 0 : isProd ? 1 : 0,
  logLevel: ['debug', 'info', 'warn', 'error'].includes(e.LOG_LEVEL) ? e.LOG_LEVEL : 'info',
  dataDir,
  dbFile: e.DATABASE_PATH === ':memory:' ? ':memory:' : path.resolve(root, e.DATABASE_PATH || path.join(dataDir, 'oikres.db')),
  uploadsDir: path.join(dataDir, 'uploads'),
  privateDir: path.join(dataDir, 'private'),
  backupsDir: path.join(dataDir, 'backups'),
  sessionSecret: (e.SESSION_SECRET || '').trim(),
  sessionSecretSource: e.SESSION_SECRET ? 'env' : 'none',
  cloudinary: { cloudName: (e.CLOUDINARY_CLOUD_NAME || '').trim(), apiKey: (e.CLOUDINARY_API_KEY || '').trim(), apiSecret: (e.CLOUDINARY_API_SECRET || '').trim() },
  smtp: { host: (e.SMTP_HOST || '').trim(), port: Number(e.SMTP_PORT) || 587, user: (e.SMTP_USER || '').trim(), pass: e.SMTP_PASS || '', from: e.MAIL_FROM || 'Oikres <no-reply@oikres.com>' },
  allowNoEmail: e.ALLOW_NO_EMAIL === 'true',
  supportEmail: e.SUPPORT_EMAIL || 'support@oikres.com',
  supportWhatsapp: (e.SUPPORT_WHATSAPP || '').replace(/\D/g, ''),
  adminNotifyEmail: (e.ADMIN_NOTIFY_EMAIL || '').trim(),
  admin: { name: (e.ADMIN_NAME || 'Oikres Admin').trim(), email: (e.ADMIN_EMAIL || '').trim().toLowerCase(), password: e.ADMIN_PASSWORD || '' },
  siteName: 'Oikres',
  credit: { name: 'Thoth Design Services', url: 'https://thothdesignservices.com' },
  assetVersion: Date.now().toString(36)
};
cfg.cloudinary.enabled = !!(cfg.cloudinary.cloudName && cfg.cloudinary.apiKey && cfg.cloudinary.apiSecret);
cfg.storageDriver = e.STORAGE_DRIVER === 'local' ? 'local' : cfg.cloudinary.enabled ? 'cloudinary' : 'local';
cfg.mail = { enabled: !!cfg.smtp.host };
cfg.emailVerificationRequired = cfg.mail.enabled;

cfg.validate = function validate(c = cfg) {
  const errors = [];
  const warnings = [];
  const major = Number(process.versions.node.split('.')[0]);
  // OIKRES_ALLOW_OLD_NODE exists only so the code can be tested on Node 22, which also has node:sqlite. Not for normal use.
  if (major < 24 && process.env.OIKRES_ALLOW_OLD_NODE !== '1') errors.push('Node.js 24 or newer is required (this is ' + process.versions.node + '). Fix: nvm install 24   (or install Node 24 LTS from https://nodejs.org)');
  if (!/^https?:\/\//.test(c.baseUrl)) errors.push('BASE_URL must start with http:// or https://. Example: http://localhost:3000');
  if (!(c.port > 0 && c.port < 65536)) errors.push('PORT must be a number between 1 and 65535.');
  const partial = [c.cloudinary.cloudName, c.cloudinary.apiKey, c.cloudinary.apiSecret].filter(Boolean).length;
  if (partial > 0 && partial < 3) errors.push('Cloudinary is partly configured. Set all three CLOUDINARY_* values, or leave all three empty to store files on this server.');
  if (c.smtp.host && !c.smtp.user !== !c.smtp.pass) warnings.push('SMTP_USER and SMTP_PASS should be set together.');
  if (c.isProd) {
    if (c.sessionSecret.length < 32) errors.push('SESSION_SECRET is required in production (32+ characters). Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    if (!c.baseUrl.startsWith('https://')) errors.push('BASE_URL must start with https:// in production because session cookies are marked secure.');
    if (!c.mail.enabled && !c.allowNoEmail) errors.push('SMTP is not configured. Production needs email for verification and password resets. Set SMTP_HOST (and friends), or set ALLOW_NO_EMAIL=true to start without it.');
    if (!c.mail.enabled && c.allowNoEmail) warnings.push('Running without email: accounts are not email-verified and password-reset emails are not sent.');
    if (c.admin.email && (c.admin.password === EXAMPLE_ADMIN_PASSWORD || c.admin.password.length < 12 || /@oikres\.local$/.test(c.admin.email))) {
      errors.push('ADMIN_EMAIL / ADMIN_PASSWORD still use the example values or are too weak. In production set a real email and a password of 12+ characters, or clear both and run: npm run admin:create');
    }
  } else if (!c.hasEnvFile && !c.isTest) {
    warnings.push('No .env file found, so built-in defaults are used. Create one with: cp .env.example .env');
  }
  if (c.storageDriver === 'local' && c.isProd) warnings.push('Photos and videos are stored on this server (DATA_DIR). Make sure DATA_DIR is on a persistent disk and is backed up.');
  return { errors, warnings };
};

// Creates data folders and (development) a persistent session secret. Called once at startup.
cfg.prepare = function prepare() {
  for (const d of [cfg.dataDir, cfg.uploadsDir, cfg.privateDir, cfg.backupsDir]) fs.mkdirSync(d, { recursive: true, mode: 0o750 });
  if (!cfg.sessionSecret) {
    const f = path.join(cfg.dataDir, '.session-secret');
    if (fs.existsSync(f)) cfg.sessionSecret = fs.readFileSync(f, 'utf8').trim();
    if (cfg.sessionSecret.length < 32) {
      cfg.sessionSecret = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(f, cfg.sessionSecret, { mode: 0o600 });
    }
    cfg.sessionSecretSource = 'file';
  }
};

module.exports = cfg;
module.exports.EXAMPLE_ADMIN_PASSWORD = EXAMPLE_ADMIN_PASSWORD;
