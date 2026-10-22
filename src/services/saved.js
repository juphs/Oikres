const act = require('../repositories/activity');
// Saved-heart state for a set of lodges, as a set of public ids (what templates compare against).
function savedSetFor(user, list) {
  if (!user || !list.length) return new Set();
  const saved = act.savedIds(user.id, list.map((l) => l.id));
  return new Set(list.filter((l) => saved.has(l.id)).map((l) => String(l._id)));
}
// Saved state for market items, as a set of numeric item ids.
function savedItemsFor(user, list) {
  if (!user || !list.length) return new Set();
  return require('../repositories/market').savedIds(user.id, list.map((i) => i.id));
}
module.exports = { savedSetFor, savedItemsFor };
