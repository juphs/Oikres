// The introduction popup: what the site offers. An administrator edits it (Admin > Popup); visitors see it once per version.
const settings = require('../repositories/settings');
const { clean } = require('../lib/util');

const ICONS = ['home', 'search', 'pin', 'heart', 'bag', 'star', 'shield', 'flag', 'whatsapp', 'user', 'plus', 'check', 'play', 'bell', 'megaphone', 'help', 'clock', 'building', 'eye', 'users', 'share'];
const MAX_ITEMS = 10;

const DEFAULTS = {
  enabled: true, version: 1,
  title: 'Welcome to {site}',
  intro: 'Student lodges and a campus market, with real prices and people you can check. Here is what you can do.',
  buttonLabel: 'Start exploring',
  items: [
    { icon: 'home', title: 'See the real cost', text: 'Every lodge shows the rent and every other charge, so you know the full move-in cost before you call.' },
    { icon: 'pin', title: 'Browse by state, campus and area', text: 'Filter by place, price and type of room, or look for a roommate to share with.' },
    { icon: 'heart', title: 'Save what you like', text: 'Tap the heart on lodges and market items to keep them all in one place.' },
    { icon: 'bag', title: 'Buy and sell in the market', text: 'Post books, phones, furniture and more with photos and a short video, and chat with buyers on WhatsApp.' },
    { icon: 'star', title: 'Check people before you deal', text: 'Every profile shows ratings, reviews and verification badges. Leave a review after you deal with someone.' },
    { icon: 'whatsapp', title: 'Chat directly on WhatsApp', text: 'Message agents and sellers in one tap. Phone numbers are never shown publicly.' },
    { icon: 'shield', title: 'Stay safe', text: 'Report anything suspicious. Confirmed scammers are banned.' },
    { icon: 'plus', title: 'Agents and landlords', text: 'List lodges for free and add every charge, so students trust what they see.' }
  ]
};

let cache = null;
const invalidate = () => { cache = null; };
function get() {
  if (!cache) {
    const s = settings.getJson('welcome', null);
    cache = s ? { ...DEFAULTS, ...s, items: Array.isArray(s.items) ? s.items : DEFAULTS.items } : { ...DEFAULTS, items: DEFAULTS.items.map((i) => ({ ...i })) };
  }
  return cache;
}
function save(w) { settings.setJson('welcome', w); invalidate(); }
function reset() { const v = get().version + 1; save({ ...DEFAULTS, items: DEFAULTS.items.map((i) => ({ ...i })), version: v }); }
// The version visitors compare against what they last saw. Empty means "do not show".
const activeVersion = () => (get().enabled ? String(get().version) : '');
// {site} in the text becomes the site's name.
const fill = (text, siteName) => String(text || '').replace(/\{site\}/gi, siteName);
function view(siteName) {
  const w = get();
  return { ...w, title: fill(w.title, siteName), intro: fill(w.intro, siteName), items: w.items.map((i) => ({ icon: i.icon, title: fill(i.title, siteName), text: fill(i.text, siteName) })) };
}

// Reads the admin form. Rows with no title are dropped. `reshow` makes everyone see the popup again (version + 1).
function parse(body) {
  const errors = {};
  const enabled = body.enabled === 'on';
  const title = clean(body.title, 80);
  if (enabled && title.length < 3) errors.title = 'Enter a title of at least 3 characters.';
  const icons = [].concat(body.itemIcon || []); const titles = [].concat(body.itemTitle || []); const texts = [].concat(body.itemText || []);
  const items = [];
  titles.forEach((t, i) => {
    const ti = clean(t, 60); const tx = clean(texts[i], 220);
    if (!ti && !tx) return;
    if (ti.length < 2) { errors.items = 'Every feature needs a title of at least 2 characters.'; return; }
    items.push({ icon: ICONS.includes(icons[i]) ? icons[i] : 'check', title: ti, text: tx });
  });
  if (items.length > MAX_ITEMS) errors.items = 'Keep it to ' + MAX_ITEMS + ' features so it stays easy to read.';
  const data = { enabled, title, intro: clean(body.intro, 400), buttonLabel: clean(body.buttonLabel, 30) || 'Got it', items: items.slice(0, MAX_ITEMS) };
  return { ok: !Object.keys(errors).length, errors, data, reshow: body.reshow === 'on' };
}

module.exports = { ICONS, MAX_ITEMS, DEFAULTS, get, save, reset, activeVersion, view, parse, invalidate };
