// Validation for the admin ad form, and how ads are mixed into a list of cards.
const ads = require('../repositories/ads');
const places = require('../repositories/places');
const { clean, toInt, normalisePhone } = require('../lib/util');

const PLACEMENTS = [{ value: 'both', label: 'Lodges and market' }, { value: 'lodges', label: 'Lodge list only' }, { value: 'market', label: 'Market list only' }];
const LINK_TYPES = [{ value: 'url', label: 'A web page' }, { value: 'page', label: 'A page on this site' }, { value: 'whatsapp', label: 'WhatsApp chat' }, { value: 'none', label: 'No button (just show it)' }];
const IMG = /^\/media\/[a-z0-9]{20}(-t)?\.(jpg|png|webp)$/;
const VID = /^\/media\/[a-z0-9]{20}\.(mp4|mov)$/;

// "2026-11-30" from a date input -> epoch ms at the start (or end) of that day in Nigeria (UTC+1), or null.
function dayMs(v, end) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], end ? 22 : -1, end ? 59 : 0, end ? 59 : 0);
  return Number.isFinite(t) ? t : null;
}

function parseAd(body) {
  const errors = {};
  const title = clean(body.title, 80);
  if (title.length < 3) errors.title = 'Enter a headline (at least 3 characters).';
  const placement = PLACEMENTS.some((p) => p.value === body.placement) ? body.placement : 'both';
  const linkType = LINK_TYPES.some((t) => t.value === body.linkType) ? body.linkType : 'none';
  let linkValue = clean(body.linkValue, 300);
  if (linkType === 'url') {
    if (!/^https?:\/\/[^\s]+$/i.test(linkValue)) errors.linkValue = 'Enter a full web address starting with https://';
  } else if (linkType === 'page') {
    if (!linkValue.startsWith('/') || linkValue.startsWith('//') || linkValue.includes('\\')) errors.linkValue = 'Enter a page on this site, like /market or /help.';
  } else if (linkType === 'whatsapp') {
    const n = normalisePhone(linkValue);
    if (!n) errors.linkValue = 'Enter a valid Nigerian WhatsApp number.'; else linkValue = n;
  } else linkValue = '';
  const imageUrl = clean(body.imageUrl, 80);
  if (imageUrl && !IMG.test(imageUrl)) errors.imageUrl = 'That image was not uploaded through this site.';
  const thumbUrl = clean(body.thumbUrl, 80);
  if (thumbUrl && !IMG.test(thumbUrl)) errors.imageUrl = 'That image was not uploaded through this site.';
  const body_ = clean(body.body, 300);
  const videoUrl = clean(body.videoUrl, 80);
  if (videoUrl && !VID.test(videoUrl)) errors.videoUrl = 'That video was not uploaded through this site.';
  if (!imageUrl && !videoUrl && !body_) errors.body = 'Add an image, a video or some text so the ad is not empty.';
  const startsAt = dayMs(body.startsAt, false); const endsAt = dayMs(body.endsAt, true);
  if (startsAt && endsAt && endsAt < startsAt) errors.endsAt = 'The end date is before the start date.';
  const stateId = places.stateById(toInt(body.state, 1, 1e9)) ? toInt(body.state, 1, 1e9) : null;
  const campus = stateId ? places.campusById(toInt(body.campus, 1, 1e9)) : null;
  const campusId = campus && campus.stateId === stateId ? campus.id : null;
  const buttonLabel = clean(body.buttonLabel, 24) || (linkType === 'whatsapp' ? 'Message on WhatsApp' : linkType === 'none' ? '' : 'Learn more');
  return { ok: !Object.keys(errors).length, errors, data: { title, body: body_, imageUrl: imageUrl || null, thumbUrl: thumbUrl || null, mediaUid: clean(body.mediaUid, 20) || null, videoUrl: videoUrl || null, videoMediaUid: clean(body.videoMediaUid, 20) || null,
    sponsor: clean(body.sponsor, 40), badge: clean(body.badge, 16) || 'Ad', buttonLabel, linkType, linkValue, placement, stateId, campusId, startsAt, endsAt, position: toInt(body.position, 0, 1000) ?? 100 } };
}

// Puts ads into a page of cards: one after the 2nd card, then one after every 4 cards. Ads that did not fit a slot in a short list
// go at the end, so a new site with only a few lodges or items still shows every ad. Returns [{ ad } | { card }].
function mix(cards, adList) {
  const out = []; let a = 0; let next = 2;
  cards.forEach((c, i) => {
    out.push({ card: c });
    if (i + 1 === next && a < adList.length) { out.push({ ad: adList[a++] }); next += 4; }
  });
  if (cards.length < 8) while (a < adList.length) out.push({ ad: adList[a++] });
  return out;
}
const hrefFor = (ad) => (ad.linkType === 'none' ? '' : '/ads/' + ad.uid + '/go');
module.exports = { PLACEMENTS, LINK_TYPES, parseAd, mix, hrefFor };
