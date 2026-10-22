// The only file that knows which SQLite engine is used (Node's built-in node:sqlite).
// Everything else calls open/run/get/all/tx, so the engine can be swapped here.
let DatabaseSync;
{
  // Some Node versions print an "experimental" notice when node:sqlite loads. Hide only that one.
  const original = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const msg = typeof warning === 'string' ? warning : warning && warning.message;
    if (/SQLite/i.test(msg || '') && /experimental/i.test(msg || '')) return;
    return original.call(process, warning, ...rest);
  };
  try { ({ DatabaseSync } = require('node:sqlite')); }
  catch (err) {
    process.emitWarning = original;
    throw new Error('This version of Node.js has no built-in SQLite (' + process.version + '). Install Node.js 24 or newer: nvm install 24');
  }
  process.emitWarning = original;
}

let db = null;
let cache = new Map();
let depth = 0;

function open(file) {
  if (db) close();
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  cache = new Map();
  depth = 0;
  return db;
}
function close() {
  if (db) { try { db.close(); } catch (e) { /* already closed */ } }
  db = null; cache = new Map();
}
const handle = () => { if (!db) throw new Error('Database is not open.'); return db; };
const norm = (args) => args.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v instanceof Date ? v.getTime() : v));
function prep(sql) {
  let s = cache.get(sql);
  if (!s) { s = handle().prepare(sql); cache.set(sql, s); }
  return s;
}
const run = (sql, ...p) => prep(sql).run(...norm(p));
const get = (sql, ...p) => prep(sql).get(...norm(p));
const all = (sql, ...p) => prep(sql).all(...norm(p));
const exec = (sql) => handle().exec(sql);

// Transaction with nesting (inner calls use savepoints). Rolls back when fn throws.
function tx(fn) {
  const d = handle();
  if (depth === 0) {
    d.exec('BEGIN IMMEDIATE');
    depth = 1;
    try { const r = fn(); d.exec('COMMIT'); return r; }
    catch (err) { try { d.exec('ROLLBACK'); } catch (e) { /* ignore */ } throw err; }
    finally { depth = 0; }
  }
  const name = 'sp' + depth++;
  d.exec('SAVEPOINT ' + name);
  try { const r = fn(); d.exec('RELEASE ' + name); return r; }
  catch (err) { d.exec('ROLLBACK TO ' + name); d.exec('RELEASE ' + name); throw err; }
  finally { depth--; }
}

const inList = (arr) => arr.map(() => '?').join(',');
const ping = () => { try { return get('SELECT 1 AS ok').ok === 1; } catch (e) { return false; } };

module.exports = { open, close, run, get, all, exec, tx, inList, ping };
