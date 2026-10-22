const db = require('../db');
const getJson = (key, fallback) => { const r = db.get('SELECT value FROM settings WHERE key = ?', key); if (!r || r.value == null) return fallback; try { return JSON.parse(r.value); } catch (e) { return fallback; } };
const setJson = (key, value) => db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
module.exports = { getJson, setJson };
