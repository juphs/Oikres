const crypto = require('crypto');
const { promisify } = require('util');
const cfg = require('../config');
const users = require('../repositories/users');
const { hashToken, clean } = require('../lib/util');
const { ValidationError } = require('../lib/errors');
const { sendMail, wrap, esc } = require('./mail');

const scrypt = promisify(crypto.scrypt);
const P = { N: 32768, r: 8, p: 1 };
const MAXMEM = 64 * 1024 * 1024;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, { ...P, maxmem: MAXMEM });
  return ['scrypt', P.N, P.r, P.p, salt.toString('base64'), key.toString('base64')].join('$');
}
async function verifyPassword(pw, stored) {
  const [alg, N, r, p, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt' || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const got = await scrypt(String(pw), Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: MAXMEM * 2 });
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}
let dummy;
const dummyHash = () => dummy || (dummy = hashPassword('not-a-real-password'));

function checkPassword(pw, { admin = false } = {}) {
  const min = admin ? 12 : 8;
  if (typeof pw !== 'string' || pw.length < min) return 'Use at least ' + min + ' characters.';
  if (pw.length > 128) return 'Use 128 characters or fewer.';
  return null;
}

const newToken = () => crypto.randomBytes(32).toString('hex');

async function register({ name, email, password, terms }) {
  const v = { name: clean(name, 60), email: clean(email, 120).toLowerCase() };
  const errors = {};
  if (v.name.length < 2) errors.name = 'Enter your name.';
  if (!EMAIL.test(v.email)) errors.email = 'Enter a valid email address.';
  const pe = checkPassword(password);
  if (pe) errors.password = pe;
  if (terms !== 'on') errors.terms = 'Please accept the terms to continue.';
  if (!errors.email && users.byEmail(v.email)) errors.email = 'This email already has an account. Sign in instead.';
  if (Object.keys(errors).length) throw Object.assign(new ValidationError(errors), { form: v });
  const user = users.create({ name: v.name, email: v.email, passwordHash: await hashPassword(password), emailVerified: !cfg.emailVerificationRequired });
  if (cfg.emailVerificationRequired) await sendVerification(user);
  return user;
}

async function sendVerification(user) {
  const raw = newToken();
  users.createToken(user.id, 'verify_email', raw, 24 * 3600 * 1000);
  const url = cfg.baseUrl + '/verify-email/' + raw;
  await sendMail({ to: user.email, subject: 'Verify your email for Oikres', text: 'Hi ' + user.name + ',\n\nConfirm your email address: ' + url + '\n\nThis link works for 24 hours.',
    html: wrap('Confirm your email', '<p>Hi ' + esc(user.name) + ', confirm your email address to list lodges and get updates. This link works for 24 hours.</p>', { url, label: 'Verify email' }) });
}
function verifyEmail(raw) {
  const t = users.findToken(String(raw), 'verify_email');
  if (!t) return false;
  users.update(t.user_id, { emailVerifiedAt: Date.now() });
  users.useToken(t.id);
  return true;
}

// Returns the user or throws a message safe to show. Locks the account briefly after repeated failures.
async function authenticate(email, password) {
  const user = users.byEmail(clean(email, 120));
  if (user && user.lockUntil && user.lockUntil > Date.now()) throw new Error('Too many wrong attempts. Try again in a few minutes or reset your password.');
  const ok = await verifyPassword(String(password || ''), user ? user.passwordHash : await dummyHash());
  // Only someone who knows the password is told the account is banned, so this cannot be used to find out who is banned.
  if (user && ok && user.bannedAt) throw new Error('This account has been banned for breaking the rules. If you think this is a mistake, contact support.');
  if (!user || !ok || user.status !== 'active') {
    if (user) {
      const n = (user.failedLogins || 0) + 1;
      users.update(user.id, n >= 5 ? { failedLogins: 0, lockedUntil: Date.now() + 15 * 60 * 1000 } : { failedLogins: n });
    }
    throw new Error('Email or password is not correct.');
  }
  users.update(user.id, { failedLogins: 0, lockedUntil: null, lastLoginAt: Date.now() });
  return user;
}

function startSession(userId) { const token = newToken(); users.createSession(userId, token); return token; }

async function requestReset(email) {
  const user = users.byEmail(clean(email, 120));
  if (!user || user.status !== 'active' || !cfg.mail.enabled) {
    if (user && user.status === 'active' && !cfg.mail.enabled && !cfg.isProd) {
      const raw = newToken();
      users.createToken(user.id, 'reset_password', raw, 3600 * 1000);
      await sendMail({ to: user.email, subject: 'Reset your Oikres password', text: 'Reset your password: ' + cfg.baseUrl + '/reset/' + raw });
    }
    return;
  }
  const raw = newToken();
  users.createToken(user.id, 'reset_password', raw, 3600 * 1000);
  const url = cfg.baseUrl + '/reset/' + raw;
  await sendMail({ to: user.email, subject: 'Reset your Oikres password', text: 'Reset your password: ' + url + '\n\nThis link works for 1 hour. If you did not ask for it, ignore this email.',
    html: wrap('Reset your password', '<p>This link works for 1 hour. If you did not ask for it, you can ignore this email.</p>', { url, label: 'Choose a new password' }) });
}
const resetTokenValid = (raw) => !!users.findToken(String(raw), 'reset_password');
async function finishReset(raw, password) {
  const t = users.findToken(String(raw), 'reset_password');
  if (!t) return false;
  const err = checkPassword(password);
  if (err) throw new Error(err);
  users.update(t.user_id, { passwordHash: await hashPassword(password), passwordChangedAt: Date.now(), failedLogins: 0, lockedUntil: null });
  users.deleteSessionsFor(t.user_id);
  users.useToken(t.id);
  return true;
}
async function changePassword(user, current, next, keepToken) {
  if (!(await verifyPassword(String(current || ''), user.passwordHash))) throw new Error('Your current password is not correct.');
  const err = checkPassword(next, { admin: user.isAdmin });
  if (err) throw new Error(err);
  users.update(user.id, { passwordHash: await hashPassword(next), passwordChangedAt: Date.now() });
  users.deleteSessionsFor(user.id, keepToken);
}

module.exports = { hashPassword, verifyPassword, checkPassword, register, sendVerification, verifyEmail, authenticate, startSession, requestReset, resetTokenValid, finishReset, changePassword, newToken, EMAIL };
