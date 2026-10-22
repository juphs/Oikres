// Everything an administrator can change without touching code: name, logo, colours, contact details, rules, notices.
// Stored as one JSON document in the settings table. Defaults apply for anything not set.
const cfg = require('../config');
const settings = require('../repositories/settings');
const color = require('../lib/color');
const { clean, normalisePhone, toInt } = require('../lib/util');

const DEFAULTS = {
  name: 'Oikres', tagline: 'Student lodges near UNIZIK', description: 'Find student lodges, self-contains and room-shares near UNIZIK, Awka. See the full cost to move in before you call.',
  domain: 'oikres.com', logoUrl: '', logoDarkUrl: '', iconUrl: '',
  whatsapp: '', whatsappMessage: 'Hello, I need help with {site}.', supportEmail: '', footerNote: '',
  registrationOpen: true, reviewRequired: true, marketReviewRequired: false,
  rules: { reconfirmEveryDays: 14, hideAfterDays: 30, reportsToAutoHide: 3, minPhotos: 3 },
  announcement: { enabled: false, text: '', tone: 'info' },
  maintenance: { enabled: false, message: 'We are making improvements. Please check back in a little while.' },
  theme: {
    radius: 14,
    light: { primary: '#0369A1', bg: '#F6F9FC', surface: '#FFFFFF', text: '#0F172A', muted: '#556579', border: '#D8E2ED' },
    dark: { primary: '#38BDF8', bg: '#0B1219', surface: '#121C27', text: '#E6EEF6', muted: '#98A9BA', border: '#263647' }
  }
};
const COLOR_KEYS = ['primary', 'bg', 'surface', 'text', 'muted', 'border'];
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, extra) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!isObj(extra)) return out;
  Object.keys(extra).forEach((k) => { out[k] = isObj(base[k]) && isObj(extra[k]) ? merge(base[k], extra[k]) : extra[k]; });
  return out;
}

let cache = null;
let cssCache = null;
const invalidate = () => { cache = null; cssCache = null; };
function get() {
  if (!cache) {
    const s = merge(DEFAULTS, settings.getJson('site', {}));
    s.supportEmail = s.supportEmail || cfg.supportEmail;
    cache = s;
  }
  return cache;
}
function save(patch) { settings.setJson('site', merge(settings.getJson('site', {}), patch)); invalidate(); }
function resetTheme() { const cur = settings.getJson('site', {}); delete cur.theme; settings.setJson('site', cur); invalidate(); }
const rules = () => get().rules;
const reviewRequired = () => get().reviewRequired !== false;
const marketReviewRequired = () => get().marketReviewRequired === true;
const domain = () => get().domain || 'oikres.com';

// Support WhatsApp: Site settings first, then SUPPORT_WHATSAPP in .env, then the first administrator's phone.
function whatsappDigits() {
  const fromSettings = String(get().whatsapp || '').replace(/\D/g, '');
  if (fromSettings) return fromSettings;
  if (cfg.supportWhatsapp) return cfg.supportWhatsapp;
  try {
    const admin = require('../repositories/users').firstAdmin();
    const n = admin && admin.phone ? normalisePhone(admin.phone) : null;
    if (n) return n.replace(/\D/g, '');
  } catch (e) { /* database not open yet */ }
  return '';
}
function whatsappLink(message) {
  const d = whatsappDigits();
  if (!d) return '';
  const text = (message || get().whatsappMessage || '').replace(/\{site\}/g, get().name);
  return 'https://wa.me/' + d + '?text=' + encodeURIComponent(text);
}

// ---- theme -> CSS custom properties (colours are validated and normalised, so this is safe to print)
function modeVars(t) {
  const bg = color.parse(t.bg); const surface = color.parse(t.surface); const text = color.parse(t.text); const primary = color.parse(t.primary);
  const bgO = color.blend(bg, { r: 255, g: 255, b: 255, a: 1 });
  const surfO = color.blend(surface, bgO);
  const primO = color.blend(primary, surfO);
  const textO = color.blend(text, surfO);
  return '--bg:' + color.toCss(bg) + ';--surface:' + color.toCss(surface) + ';--raised:' + color.toCss(color.mix(textO, surfO, 0.05)) +
    ';--text:' + color.toCss(text) + ';--muted:' + t.muted + ';--border:' + t.border + ';--primary:' + color.toCss(primary) +
    ';--on-primary:' + color.readableOn(primO) + ';--primary-soft:' + color.toCss(color.mix(primO, surfO, 0.14)) + ';--sky:' + color.toCss(primary) + ';';
}
function themeCss() {
  if (!cssCache) {
    const t = get().theme;
    cssCache = ':root{' + modeVars(t.light) + '--r:' + t.radius + 'px;}@media (prefers-color-scheme: dark){:root{' + modeVars(t.dark) + '}}';
  }
  return cssCache;
}
const themeMeta = () => ({ light: color.toCss(color.parse(get().theme.light.bg)), dark: color.toCss(color.parse(get().theme.dark.bg)), primary: color.toCss(color.parse(get().theme.light.primary)) });

// ---- validation of the admin forms, one section at a time
const MEDIA_URL = /^\/media\/[a-z0-9]{20}(-t)?\.(jpg|png|webp)$/;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const on = (v) => v === 'on' || v === '1' || v === true;

function parseSection(section, body) {
  const errors = {};
  const patch = {};
  if (section === 'general') {
    const name = clean(body.name, 40);
    if (name.length < 2) errors.name = 'Enter a site name (2 to 40 characters).';
    const domainIn = clean(body.domain, 80).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (domainIn && !HOST.test(domainIn)) errors.domain = 'Enter a web address like oikres.com.';
    const wa = clean(body.whatsapp, 25);
    const waN = wa ? normalisePhone(wa) : '';
    if (wa && !waN) errors.whatsapp = 'Enter a valid Nigerian WhatsApp number, for example 0801 234 5678.';
    const email = clean(body.supportEmail, 120);
    if (email && !EMAIL.test(email)) errors.supportEmail = 'Enter a valid email address.';
    Object.assign(patch, { name, tagline: clean(body.tagline, 80), description: clean(body.description, 200), domain: domainIn || DEFAULTS.domain,
      whatsapp: waN ? waN.replace(/\D/g, '') : '', whatsappMessage: clean(body.whatsappMessage, 200) || DEFAULTS.whatsappMessage, supportEmail: email, footerNote: clean(body.footerNote, 120) });
  } else if (section === 'branding') {
    ['logoUrl', 'logoDarkUrl', 'iconUrl'].forEach((k) => {
      const v = clean(body[k], 80);
      if (v && !MEDIA_URL.test(v)) errors[k] = 'That image was not uploaded through this site.'; else patch[k] = v;
    });
  } else if (section === 'theme') {
    const theme = { light: {}, dark: {} };
    ['light', 'dark'].forEach((mode) => COLOR_KEYS.forEach((k) => {
      const c = color.parse(clean(body[mode + '_' + k], 40));
      if (!c) errors[mode + '_' + k] = 'Not a valid colour.'; else theme[mode][k] = color.toCss(c);
    }));
    theme.radius = toInt(body.radius, 4, 28) ?? 14;
    patch.theme = theme;
    if (!Object.keys(errors).length) {
      const warn = [];
      ['light', 'dark'].forEach((mode) => {
        const t = theme[mode]; const bgO = color.blend(color.parse(t.bg), { r: 255, g: 255, b: 255, a: 1 });
        if (color.contrast(color.blend(color.parse(t.text), bgO), bgO) < 4.5) warn.push('text on the ' + mode + ' background');
        if (color.contrast(color.blend(color.parse(t.primary), bgO), bgO) < 3) warn.push('the brand colour on the ' + mode + ' background');
      });
      if (warn.length) patch._warn = 'Saved, but these may be hard to read: ' + warn.join(', ') + '.';
    }
  } else if (section === 'rules') {
    const re = toInt(body.reconfirmEveryDays, 3, 60); const hide = toInt(body.hideAfterDays, 5, 120);
    if (re === null) errors.reconfirmEveryDays = 'Enter 3 to 60 days.';
    if (hide === null || (re !== null && hide <= re)) errors.hideAfterDays = 'Must be more than the reconfirm days (up to 120).';
    patch.rules = { reconfirmEveryDays: re ?? 14, hideAfterDays: hide ?? 30, reportsToAutoHide: toInt(body.reportsToAutoHide, 1, 20) ?? 3, minPhotos: toInt(body.minPhotos, 1, 10) ?? 3 };
    patch.registrationOpen = on(body.registrationOpen);
    patch.reviewRequired = on(body.reviewRequired);
    patch.marketReviewRequired = on(body.marketReviewRequired);
  } else if (section === 'notices') {
    patch.announcement = { enabled: on(body.announcementEnabled), text: clean(body.announcementText, 200), tone: ['info', 'warn', 'success'].includes(body.announcementTone) ? body.announcementTone : 'info' };
    if (patch.announcement.enabled && !patch.announcement.text) errors.announcementText = 'Write the message people should see.';
    patch.maintenance = { enabled: on(body.maintenanceEnabled), message: clean(body.maintenanceMessage, 200) || DEFAULTS.maintenance.message };
  } else errors._ = 'Unknown section.';
  return { patch, errors };
}

module.exports = { DEFAULTS, COLOR_KEYS, get, save, invalidate, resetTheme, rules, reviewRequired, marketReviewRequired, domain, whatsappDigits, whatsappLink, themeCss, themeMeta, parseSection, merge };
