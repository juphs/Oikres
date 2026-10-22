// States and campuses. Areas live in repositories/areas.js and belong to a state.
const db = require('../db');
const { slugify } = require('../lib/util');

const mapState = (r) => r && ({ _id: String(r.id), id: r.id, name: r.name, slug: r.slug, isActive: !!r.is_active, order: r.sort_order });
const mapCampus = (r) => r && ({ _id: String(r.id), id: r.id, stateId: r.state_id, stateName: r.state_name, name: r.name, slug: r.slug, isActive: !!r.is_active, order: r.sort_order });

const listStates = ({ activeOnly = false } = {}) => db.all('SELECT * FROM states' + (activeOnly ? ' WHERE is_active = 1' : '') + ' ORDER BY sort_order, name').map(mapState);
const stateById = (id) => mapState(db.get('SELECT * FROM states WHERE id = ?', id));
const stateBySlug = (s) => mapState(db.get('SELECT * FROM states WHERE slug = ?', s));
const stateCount = () => db.get('SELECT COUNT(*) AS n FROM states').n;

function createState(name, order = 100) {
  const slug = slugify(name);
  if (!slug) throw new Error('Enter a state name.');
  if (db.get('SELECT 1 AS x FROM states WHERE slug = ?', slug)) throw new Error('That state already exists.');
  return Number(db.run('INSERT INTO states (name, slug, sort_order) VALUES (?, ?, ?)', name, slug, order).lastInsertRowid);
}
const toggleState = (id) => db.run('UPDATE states SET is_active = 1 - is_active WHERE id = ?', id);
const setStateOrder = (id, order) => db.run('UPDATE states SET sort_order = ? WHERE id = ?', order, id);

// A campus is only offered while it and its state are both active.
const CAMPUS_SQL = 'SELECT c.*, s.name AS state_name FROM campuses c JOIN states s ON s.id = c.state_id';
function listCampuses({ activeOnly = false, stateId = null } = {}) {
  const where = [];
  const p = [];
  if (activeOnly) where.push('c.is_active = 1 AND s.is_active = 1');
  if (stateId) { where.push('c.state_id = ?'); p.push(stateId); }
  return db.all(CAMPUS_SQL + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY s.sort_order, c.sort_order, c.name', ...p).map(mapCampus);
}
const campusById = (id) => mapCampus(db.get(CAMPUS_SQL + ' WHERE c.id = ?', id));
const campusBySlug = (s) => mapCampus(db.get(CAMPUS_SQL + ' WHERE c.slug = ?', s));

function createCampus(stateId, name, order = 100) {
  const state = stateById(stateId);
  if (!state) throw new Error('Choose a state first.');
  if (!slugify(name)) throw new Error('Enter a campus name.');
  if (db.get('SELECT 1 AS x FROM campuses WHERE state_id = ? AND name = ? COLLATE NOCASE', stateId, name)) throw new Error('That campus already exists in ' + state.name + '.');
  // The slug is global (it is used in links), so a repeated name in another state gets the state added to it.
  let slug = slugify(name);
  if (db.get('SELECT 1 AS x FROM campuses WHERE slug = ?', slug)) slug = slugify(name + ' ' + state.name);
  return Number(db.run('INSERT INTO campuses (state_id, name, slug, sort_order) VALUES (?, ?, ?, ?)', stateId, name, slug, order).lastInsertRowid);
}
const toggleCampus = (id) => db.run('UPDATE campuses SET is_active = 1 - is_active WHERE id = ?', id);
const setCampusOrder = (id, order) => db.run('UPDATE campuses SET sort_order = ? WHERE id = ?', order, id);

module.exports = { listStates, stateById, stateBySlug, stateCount, createState, toggleState, setStateOrder,
  listCampuses, campusById, campusBySlug, createCampus, toggleCampus, setCampusOrder };
