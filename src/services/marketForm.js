const C = require('../config/constants');
const { clean, toInt, normalisePhone, safeJson } = require('../lib/util');
const { resolvePlaces } = require('./listingForm');

const has = (list, v) => list.some((x) => x.value === v);

// Validates the sell-item form. Photos are resolved separately (they need the database).
function parseItem(body, { places }) {
  const errors = {};
  const need = (cond, key, msg) => { if (!cond) errors[key] = msg; };
  const title = clean(body.title, 80);
  need(title.length >= 5, 'title', 'Enter a title of at least 5 characters.');
  const category = has(C.MARKET_CATEGORIES, body.category) ? body.category : '';
  need(category, 'category', 'Choose a category.');
  const condition = has(C.MARKET_CONDITIONS, body.condition) ? body.condition : '';
  need(condition, 'condition', 'Say what condition it is in.');
  const rawPrice = String(body.price == null ? '' : body.price).replace(/[^\d]/g, '');
  const price = rawPrice === '' ? null : Number(rawPrice);
  need(price !== null && price <= 100000000, 'price', price === null ? 'Enter the price in naira (0 if it is free).' : 'That price is too high. The most you can enter is 100,000,000.');
  const description = clean(body.description, 1000);
  need(description.length >= 10, 'description', 'Describe the item in at least 10 characters.');
  const pl = resolvePlaces(body, places, null, errors, true);
  const whatsappNumber = normalisePhone(clean(body.whatsapp, 25));
  need(whatsappNumber, 'whatsapp', 'Enter a valid Nigerian WhatsApp number, for example 0801 234 5678.');
  const rawMedia = safeJson(body.mediaJson, []);
  const mediaItems = (Array.isArray(rawMedia) ? rawMedia : []).slice(0, C.RULES.marketMaxPhotos + 2)
    .filter((m) => m && (m.type === 'image' || m.type === 'video'))
    .map((m) => ({ type: m.type, id: clean(m.id || m.mediaUid, 20), url: clean(m.url, 500), publicId: clean(m.publicId, 200), width: toInt(m.width, 0, 20000), height: toInt(m.height, 0, 20000) }));
  return { ok: !Object.keys(errors).length, errors, data: {
    title, category, condition, price: price || 0, negotiable: body.negotiable === 'on' || body.negotiable === '1' || body.negotiable === true,
    description, stateId: pl.stateId, campusId: pl.campusId, pickup: clean(body.pickup, 80), whatsappNumber, mediaItems } };
}
module.exports = { parseItem };
