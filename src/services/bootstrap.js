// Safe, repeatable first-run tasks. Nothing here deletes data or changes an existing password.
const cfg = require('../config');
const users = require('../repositories/users');
const areas = require('../repositories/areas');
const places = require('../repositories/places');
const auth = require('./auth');
const { clean } = require('../lib/util');

const STARTER_AREAS = [
  { name: 'Ifite', order: 1, junctions: ['Miracle Junction', 'Dynamo', 'Next Level', 'Book Foundation', 'Yahoo Junction'] },
  { name: 'Amansea', order: 2 }, { name: 'Okpuno', order: 3 }, { name: 'Agu-Awka', order: 4 },
  { name: 'Awka Town', order: 5 }, { name: 'Nibo', order: 6 }, { name: 'Umuokpu', order: 7 }
];

// Only when there are no areas at all, so edits made by admins are never undone.
function ensureStarterAreas() {
  if (areas.count() > 0) return 0;
  const state = places.stateBySlug('anambra') || places.stateById(places.createState('Anambra', 1));
  STARTER_AREAS.forEach((a) => areas.create(a.name, a.order, a.junctions || [], state.id));
  return STARTER_AREAS.length;
}

async function createAdmin({ name, email, password }) {
  name = clean(name, 60); email = clean(email, 120).toLowerCase();
  if (name.length < 2) throw new Error('Name must have at least 2 characters.');
  if (!auth.EMAIL.test(email)) throw new Error('Enter a valid email address.');
  const pe = auth.checkPassword(password, { admin: true });
  if (pe) throw new Error(pe);
  if (users.byEmail(email)) throw new Error('An account with that email already exists.');
  return users.create({ name, email, passwordHash: await auth.hashPassword(password), isAdmin: true, emailVerified: true });
}

// Creates the first administrator from ADMIN_* when none exists. Development only creates the example admin;
// production needs real values (validated at startup). Never promotes an existing account or changes a password.
async function ensureAdminFromEnv(log = () => {}) {
  const { email, password, name } = cfg.admin;
  if (users.adminExists()) return 'exists';
  if (!email || !password) return 'not-configured';
  if (users.byEmail(email)) { log('ADMIN_EMAIL (' + email + ') already belongs to a normal account, so it was not promoted. Use another email or run: npm run admin:create'); return 'email-taken'; }
  try {
    await createAdmin({ name, email, password });
    return password === cfg.EXAMPLE_ADMIN_PASSWORD ? 'created-example' : 'created';
  } catch (err) { log('Could not create the administrator from .env: ' + err.message); return 'invalid'; }
}

async function resetAdminPassword(email, password) {
  const admin = users.adminByEmail(email);
  if (!admin) throw new Error('No administrator uses that email.');
  const pe = auth.checkPassword(password, { admin: true });
  if (pe) throw new Error(pe);
  users.update(admin.id, { passwordHash: await auth.hashPassword(password), passwordChangedAt: Date.now(), failedLogins: 0, lockedUntil: null, status: 'active' });
  users.deleteSessionsFor(admin.id);
}

module.exports = { STARTER_AREAS, ensureStarterAreas, createAdmin, ensureAdminFromEnv, resetAdminPassword };
