const C = require('../config/constants');
const { clean, toInt, safeJson, isUid, naira } = require('../lib/util');
const { breakdown } = require('../lib/cost');

const has = (list, v) => list.some((x) => x.value === v);

// State and campus. `places` comes from services/places.lookup(); without it (older callers) they are simply left empty.
// The state is taken from the form, else from the chosen area, else from the only active state. Area and campus must belong to it.
function resolvePlaces(body, places, areaId, errors, submit) {
  if (!places) return { stateId: null, campusId: null };
  let stateId = places.states.has(Number(body.state)) ? Number(body.state) : null;
  if (areaId) {
    const areaState = places.areas.get(areaId);
    if (stateId && areaState !== stateId) errors.area = 'That area is not in the state you chose.';
    stateId = stateId || areaState || null;
  }
  stateId = stateId || places.onlyState;
  if (submit && !stateId) errors.state = 'Choose the state.';
  let campusId = places.campuses.has(Number(body.campus)) ? Number(body.campus) : null;
  if (campusId && stateId && places.campuses.get(campusId) !== stateId) errors.campus = 'That campus is not in the state you chose.';
  return { stateId, campusId };
}

// Validates the lodge form. Drafts are lenient; submissions must be complete.
// Photos are validated separately (see media.resolveItems) because that needs the database.
function parseListing(body, { submit, areaIds, places }) {
  const errors = {};
  const need = (cond, key, msg) => { if (!cond) errors[key] = msg; };

  const title = clean(body.title, 90);
  need(title.length >= (submit ? 8 : 3), 'title', 'Enter a title of at least ' + (submit ? 8 : 3) + ' characters.');
  const propertyType = has(C.PROPERTY_TYPES, body.propertyType) ? body.propertyType : '';
  need(!submit || propertyType, 'propertyType', 'Choose the type of property.');
  const areaId = areaIds.map(String).includes(String(body.area)) ? Number(body.area) : null;
  need(!submit || areaId, 'area', 'Choose the area.');
  const pl = resolvePlaces(body, places, areaId, errors, submit);
  const description = clean(body.description, 1500);
  need(!submit || description.length >= 20, 'description', 'Add a short description (at least 20 characters).');
  const amenities = [].concat(body.amenities || []).filter((a) => has(C.AMENITIES, a));

  const rawUnits = safeJson(body.unitsJson, []);
  const units = (Array.isArray(rawUnits) ? rawUnits : []).slice(0, 12).map((u) => {
    const kind = has(C.UNIT_KINDS, u.kind) ? u.kind : 'whole_unit';
    const spacesTotal = kind === 'shared_room' ? toInt(u.spacesTotal, 1, 20) || 1 : 1;
    const spacesAvailable = Math.min(spacesTotal, toInt(u.spacesAvailable, 0, 20) ?? spacesTotal);
    const unit = {
      label: clean(u.label, 40) || 'Room', kind, spacesTotal, spacesAvailable,
      rent: toInt(u.rent, 0, 100000000) || 0,
      period: C.PERIODS.some((p) => p.value === u.period) ? u.period : 'year',
      genderPreference: kind === 'whole_unit' || !has(C.GENDERS, u.genderPreference) ? 'any' : u.genderPreference,
      sharedFacilities: [].concat(u.sharedFacilities || []).filter((f) => has(C.SHARED_FACILITIES, f)),
      initialPayment: toInt(u.initialPayment, 0, 100000000) || null,
      notes: clean(u.notes, 200)
    };
    if (isUid(u._id)) unit._id = u._id;
    return unit;
  });
  need(units.length > 0, 'units', 'Add at least one room or space.');
  if (submit && units.some((u) => u.rent < 1000)) errors.units = 'Enter the rent for every room or space.';

  const rawFees = safeJson(body.feesJson, []);
  const fees = (Array.isArray(rawFees) ? rawFees : []).slice(0, 10).map((f) => {
    const kind = f.kind === 'percent' ? 'percent' : 'fixed';
    const value = kind === 'percent' ? Math.min(100, Number(f.value) || 0) : toInt(f.value, 0, 10000000) || 0;
    return { label: has(C.FEE_LABELS, f.label) ? f.label : 'other', customLabel: clean(f.customLabel, 40), kind,
      value: kind === 'percent' ? Math.round(value * 100) / 100 : value,
      payee: f.payee === 'landlord' ? 'landlord' : 'agent', // listers cannot add Oikres charges
      refundable: !!f.refundable, note: clean(f.note, 120) };
  }).filter((f) => f.value > 0);
  if (fees.some((f) => f.label === 'other' && !f.customLabel)) errors.fees = 'Name each "Other charge".';

  units.forEach((u) => {
    if (!u.initialPayment || !u.rent) return;
    const itemised = breakdown(u.rent, fees).total;
    if (u.initialPayment < itemised) errors.units = 'The initial payment for "' + u.label + '" is less than its rent plus the charges you listed (' + naira(itemised) + '). Raise the initial payment or remove a charge.';
  });
  const chargesDisclosed = body.chargesDisclosed === 'on' || body.chargesDisclosed === '1' || body.chargesDisclosed === true;
  need(!submit || chargesDisclosed, 'chargesDisclosed', 'Confirm that every charge a tenant must pay is listed.');

  const rawMedia = safeJson(body.mediaJson, []);
  const mediaItems = (Array.isArray(rawMedia) ? rawMedia : []).slice(0, C.RULES.maxPhotos + 1)
    .filter((m) => m && (m.type === 'image' || m.type === 'video'))
    .map((m) => ({ type: m.type, id: clean(m.id || m.mediaUid, 20), url: clean(m.url, 500), publicId: clean(m.publicId, 200), width: toInt(m.width, 0, 20000), height: toInt(m.height, 0, 20000) }));

  const data = {
    title, propertyType, areaId, stateId: pl.stateId, campusId: pl.campusId, description, amenities, junction: clean(body.junction, 60),
    minutesWalk: body.minutesWalk === '' || body.minutesWalk === undefined ? null : toInt(body.minutesWalk, 0, 180),
    minutesKeke: body.minutesKeke === '' || body.minutesKeke === undefined ? null : toInt(body.minutesKeke, 0, 180),
    units, fees, chargesDisclosed, mediaItems
  };
  return { data, errors, ok: Object.keys(errors).length === 0 };
}

module.exports = { parseListing, resolvePlaces };
