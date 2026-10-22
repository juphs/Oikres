const db = require('../db');
const { slugify } = require('../lib/util');

const SELECT = 'SELECT a.*, s.name AS state_name, s.slug AS state_slug FROM areas a LEFT JOIN states s ON s.id = a.state_id';

function hydrate(rows) {
  const js = db.all('SELECT area_id, name FROM junctions ORDER BY name');
  return rows.map((r) => ({ _id: String(r.id), id: r.id, name: r.name, slug: r.slug, isActive: !!r.is_active, order: r.sort_order,
    stateId: r.state_id, stateName: r.state_name || '', stateSlug: r.state_slug || '', junctions: js.filter((j) => j.area_id === r.id).map((j) => j.name) }));
}
// activeOnly: the area and its state must both be active. stateId narrows to one state.
function list({ activeOnly = false, stateId = null } = {}) {
  const where = [];
  const p = [];
  if (activeOnly) where.push('a.is_active = 1 AND (s.id IS NULL OR s.is_active = 1)');
  if (stateId) { where.push('a.state_id = ?'); p.push(stateId); }
  return hydrate(db.all(SELECT + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY COALESCE(s.sort_order, 0), s.name, a.sort_order, a.name', ...p));
}
const byId = (id) => hydrate(db.all(SELECT + ' WHERE a.id = ?', id))[0] || null;
const bySlug = (s) => hydrate(db.all(SELECT + ' WHERE a.slug = ?', s))[0] || null;
const count = () => db.get('SELECT COUNT(*) AS n FROM areas').n;

// The same area name can exist in different states ("GRA", "Town centre"). Slugs are global because they appear in links,
// so a repeat in another state gets the state added to its slug.
function create(name, order = 100, junctions = [], stateId = null) {
  let slug = slugify(name);
  if (!slug) throw new Error('Enter an area name.');
  if (db.get('SELECT 1 AS x FROM areas WHERE name = ? COLLATE NOCASE AND state_id IS ?', name, stateId || null)) throw new Error('That area already exists in this state.');
  if (db.get('SELECT 1 AS x FROM areas WHERE slug = ?', slug)) {
    const st = stateId ? db.get('SELECT name FROM states WHERE id = ?', stateId) : null;
    slug = slugify(name + ' ' + (st ? st.name : 'area'));
    if (db.get('SELECT 1 AS x FROM areas WHERE slug = ?', slug)) throw new Error('That area already exists.');
  }
  return db.tx(() => {
    const id = Number(db.run('INSERT INTO areas (name, slug, sort_order, state_id) VALUES (?, ?, ?, ?)', name, slug, order, stateId || null).lastInsertRowid);
    junctions.forEach((j) => db.run('INSERT OR IGNORE INTO junctions (area_id, name) VALUES (?, ?)', id, j));
    return id;
  });
}
const toggle = (id) => db.run('UPDATE areas SET is_active = 1 - is_active WHERE id = ?', id);
const setOrder = (id, order) => db.run('UPDATE areas SET sort_order = ? WHERE id = ?', order, id);
const addJunction = (id, name) => db.run('INSERT OR IGNORE INTO junctions (area_id, name) VALUES (?, ?)', id, name);
const removeJunction = (id, name) => db.run('DELETE FROM junctions WHERE area_id = ? AND name = ?', id, name);

module.exports = { list, byId, bySlug, count, create, toggle, setOrder, addJunction, removeJunction };
