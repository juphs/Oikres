// Development-only sample data, so you can see the site with lodges in it.
//   npm run seed          add sample lodges (safe to repeat)
//   npm run seed:remove   delete exactly those sample lodges and the demo lister
const { open, cfg, db } = require('./boot');

async function main() {
  if (cfg.isProd) throw new Error('Sample data is for development only and is disabled when NODE_ENV=production.');
  open();
  const crypto = require('crypto');
  const auth = require('../services/auth');
  const boot = require('../services/bootstrap');
  const users = require('../repositories/users');
  const listers = require('../repositories/listers');
  const areas = require('../repositories/areas');
  const listings = require('../repositories/listings');
  const { applyPricing } = require('../lib/cost');
  const EMAIL = 'demo-lister@oikres.invalid';
  const REVIEWER = 'demo-reviewer@oikres.invalid';

  if (process.argv.includes('--remove')) {
    const u = users.byEmail(EMAIL);
    const rv = users.byEmail(REVIEWER);
    if (rv) db.run('DELETE FROM users WHERE id = ?', rv.id);
    db.run("DELETE FROM ads WHERE title LIKE '[Demo]%'");
    if (u) { db.run('DELETE FROM users WHERE id = ?', u.id); console.log('Removed the demo lister, its lodges, items and reviews, the demo reviewer and the demo ad.'); } else console.log('No demo data found.');
    return db.close();
  }
  boot.ensureStarterAreas();
  const places = require('../repositories/places');
  const market = require('../repositories/market');
  const reviews = require('../repositories/reviews');
  const adsRepo = require('../repositories/ads');
  const anambra = places.stateBySlug('anambra');
  const unizik = places.campusBySlug('unizik');
  const ifite = areas.bySlug('ifite');
  const amansea = areas.bySlug('amansea') || ifite;
  let u = users.byEmail(EMAIL) || users.create({ name: 'Demo Agent', email: EMAIL, passwordHash: await auth.hashPassword(crypto.randomBytes(24).toString('hex')), emailVerified: true });
  const p = listers.byUserId(u.id) || listers.create({ userId: u.id, displayName: 'Demo Agent', type: 'agent', whatsappNumber: '+2348000000000' });
  const agent = { label: 'agent', kind: 'percent', value: 10, payee: 'agent', refundable: false, customLabel: '', note: '' };
  const agreement = { label: 'agreement', kind: 'fixed', value: 10000, payee: 'landlord', refundable: false, customLabel: '', note: '' };
  const caution = { label: 'caution', kind: 'fixed', value: 20000, payee: 'landlord', refundable: true, customLabel: '', note: 'Returned when you leave' };
  const U = (o) => ({ spacesTotal: 1, spacesAvailable: 1, genderPreference: 'any', sharedFacilities: [], notes: '', ...o });
  const samples = [
    { slug: 'demo-self-contain-miracle-junction', title: '[Demo] Self-contain near Miracle Junction', type: 'self_contain', area: ifite, junction: 'Miracle Junction', walk: 12, keke: 4, img: 1, units: [U({ label: 'Self-contain', kind: 'whole_unit', rent: 350000, period: 'year' })], fees: [agent, agreement] },
    { slug: 'demo-room-share-dynamo', title: '[Demo] Room-share, male roommate needed', type: 'single_room', area: ifite, junction: 'Dynamo', walk: 15, keke: 5, img: 2, units: [U({ label: 'Shared room', kind: 'shared_room', rent: 170000, period: 'year', spacesTotal: 2, spacesAvailable: 1, genderPreference: 'male', sharedFacilities: ['kitchen', 'bathroom', 'toilet'] })], fees: [agent, caution] },
    { slug: 'demo-flat-ifite-rooms', title: '[Demo] Student flat with three rooms', type: 'three_bedroom', area: ifite, junction: 'Next Level', walk: 10, keke: 3, img: 3, units: [
      U({ label: 'Room A (private)', kind: 'private_room', rent: 260000, genderPreference: 'female', sharedFacilities: ['kitchen', 'living_room'] }),
      U({ label: 'Room B (private)', kind: 'private_room', rent: 240000, genderPreference: 'female', sharedFacilities: ['kitchen', 'living_room'] }),
      U({ label: 'Bed spaces in Room C', kind: 'shared_room', rent: 120000, spacesTotal: 4, spacesAvailable: 3, genderPreference: 'female', sharedFacilities: ['kitchen', 'living_room', 'bathroom'] })], fees: [agent, agreement, caution] },
    { slug: 'demo-single-room-amansea', title: '[Demo] Single room in Amansea', type: 'single_room', area: amansea, junction: '', walk: 20, keke: 6, img: 1, units: [U({ label: 'Single room', kind: 'whole_unit', rent: 90000 })], fees: [agreement] }
  ];
  let added = 0;
  for (const s of samples) {
    if (listings.bySlug(s.slug)) continue;
    s.units.forEach((x) => { x.period = x.period || 'year'; });
    const pricing = applyPricing(s.units, s.fees);
    const id = listings.save({ listerId: u.id, profileId: p.id, slug: s.slug, status: 'live', submittedAt: Date.now() }, {
      title: s.title, description: 'Sample lodge for development. It shows how a listing looks with its full cost breakdown. Remove it with npm run seed:remove.',
      propertyType: s.type, areaId: s.area.id, stateId: anambra && anambra.id, campusId: unizik && unizik.id, junction: s.junction, minutesWalk: s.walk, minutesKeke: s.keke, chargesDisclosed: true, units: s.units, fees: s.fees,
      amenities: ['water', 'electricity', 'security', 'tiled_floor'],
      media: [1, 2, 3].map((n) => ({ type: 'image', url: '/demo/room-' + (((s.img + n) % 3) + 1) + '.svg', width: 800, height: 600 }))
    }, pricing);
    listings.update(id, { publishedAt: Date.now(), lastConfirmedAt: Date.now(), reconfirmDueAt: Date.now() + 14 * 86400000 });
    added++;
  }
  // Market items, a reviewer with a review, and an ad, so the market, profile and ad cards have something to show.
  const items = [
    { slug: 'demo-hp-laptop', title: '[Demo] HP EliteBook laptop, 8GB RAM', category: 'computers', condition: 'used_good', price: 185000, negotiable: true, pickup: 'Faculty of Engineering gate' },
    { slug: 'demo-engineering-maths', title: '[Demo] Engineering Mathematics textbooks (3)', category: 'books', condition: 'used_fair', price: 8000, negotiable: false, pickup: 'Library' },
    { slug: 'demo-mini-fridge', title: '[Demo] Mini fridge, works perfectly', category: 'appliances', condition: 'like_new', price: 65000, negotiable: true, pickup: '' },
    { slug: 'demo-mattress', title: '[Demo] Single mattress, 4 inch', category: 'furniture', condition: 'used_good', price: 22000, negotiable: false, pickup: 'Ifite' }
  ];
  let itemsAdded = 0;
  for (const it of items) {
    if (market.bySlug(it.slug)) continue;
    market.save({ sellerId: u.id, slug: it.slug, status: 'live', publishedAt: Date.now() }, { ...it, condition: it.condition, description: 'Sample item for development. Remove it with npm run seed:remove.',
      stateId: anambra && anambra.id, campusId: unizik && unizik.id, whatsappNumber: '+2348000000000',
      media: [1, 2].map((n) => ({ type: 'image', url: '/demo/room-' + (n % 3 + 1) + '.svg', width: 800, height: 600 })) });
    itemsAdded++;
  }
  const rv = users.byEmail(REVIEWER) || users.create({ name: 'Demo Reviewer', email: REVIEWER, passwordHash: await auth.hashPassword(crypto.randomBytes(24).toString('hex')), emailVerified: true });
  if (!reviews.byPair(u.id, rv.id)) reviews.create({ subjectId: u.id, authorId: rv.id, rating: 5, body: 'Sample review. Replied fast and the room was as described.' });
  if (!db.get("SELECT 1 AS x FROM ads WHERE title LIKE '[Demo]%'")) adsRepo.create({ title: '[Demo] Moving out? Book a student-friendly truck', body: 'Sample ad. Admins create these under Admin > Ads.', sponsor: 'Demo Movers', badge: 'Ad',
    buttonLabel: 'Learn more', linkType: 'page', linkValue: '/help', placement: 'both', position: 1 });
  console.log('Added ' + itemsAdded + ' demo market items, a demo review and a demo ad.');
  console.log('Added ' + added + ' demo lodges (' + (samples.length - added) + ' already existed). Open the site to see them.');
  db.close();
}
main().catch((err) => { console.error('\nSeed stopped: ' + err.message + '\n'); process.exit(1); });
