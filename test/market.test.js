// Places, marketplace, reviews, bans, reports and ads on a real in-memory database.
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAIL = 'admin@oikres.local';
process.env.ADMIN_PASSWORD = 'oikres-local-admin';
process.env.DATABASE_PATH = ':memory:';
process.env.DATA_DIR = require('node:os').tmpdir() + '/oikres-market-test-' + process.pid;
const test = require('node:test');
const assert = require('node:assert');
const cfg = require('../src/config');
cfg.prepare();
const db = require('../src/db');
db.open(':memory:');
const { migrate } = require('../src/db/migrate');
migrate({});
const boot = require('../src/services/bootstrap');
const auth = require('../src/services/auth');
const users = require('../src/repositories/users');
const listers = require('../src/repositories/listers');
const areas = require('../src/repositories/areas');
const places = require('../src/repositories/places');
const listings = require('../src/repositories/listings');
const market = require('../src/repositories/market');
const reviews = require('../src/repositories/reviews');
const flags = require('../src/repositories/flags');
const adsRepo = require('../src/repositories/ads');
const mrepo = require('../src/repositories/media');
const ls = require('../src/services/listings');
const ms = require('../src/services/market');
const rs = require('../src/services/reviews');
const userSvc = require('../src/services/users');
const adsSvc = require('../src/services/ads');
const placesSvc = require('../src/services/places');
const site = require('../src/services/site');
const { parseItem } = require('../src/services/marketForm');

const reg = (name, email) => auth.register({ name, email, password: 'password-1', terms: 'on' });
let seq = 0;
const photo = (u) => { seq++; return mrepo.insert({ ownerId: u.id, kind: 'photo', file: 'm' + seq + 'cccccccccccccccccc.jpg', thumbFile: 'm' + seq + 'cccccccccccccccccc-t.jpg', width: 800, height: 600, size: 10 }); };
const itemBody = (u, extra = {}) => ({ state: String(places.stateBySlug('anambra').id), title: 'Used Tecno phone', category: 'phones', condition: 'used_good', price: '45,000', description: 'Works perfectly, no cracks.', whatsapp: '08012345678',
  mediaJson: JSON.stringify([{ type: 'image', id: photo(u).uid }]), ...extra });

test('places: the same area name can exist in two states, and inactive states disappear from forms', async () => {
  assert.equal(boot.ensureStarterAreas(), 7);
  await boot.ensureAdminFromEnv();
  const anambra = places.stateBySlug('anambra');
  assert.ok(anambra && areas.bySlug('ifite').stateId === anambra.id);
  const enugu = places.stateById(places.createState('Enugu', 2));
  assert.throws(() => places.createState('Enugu'), /already exists/);
  const unn = places.campusById(places.createCampus(enugu.id, 'UNN', 1));
  assert.equal(unn.stateName, 'Enugu');
  assert.throws(() => places.createCampus(enugu.id, 'unn'), /already exists/);
  // "Ifite" exists in Anambra; Enugu may have its own. The slug is made unique, the same name in the same state is refused.
  const id = areas.create('Ifite', 5, [], enugu.id);
  assert.notEqual(areas.byId(id).slug, 'ifite');
  assert.throws(() => areas.create('ifite', 5, [], enugu.id), /already exists/);
  assert.equal(areas.list({ stateId: enugu.id }).length, 1);
  assert.equal(areas.list({ activeOnly: true }).length, 8);
  places.toggleState(enugu.id);
  assert.equal(areas.list({ activeOnly: true }).length, 7, 'areas of a hidden state are not offered');
  assert.equal(places.listCampuses({ activeOnly: true }).length, 1, 'campuses of a hidden state are not offered');
  places.toggleState(enugu.id);
});

test('lodge form: state, campus and area must agree, and a single state is filled in automatically', async () => {
  const { parseListing } = require('../src/services/listingForm');
  const anambra = places.stateBySlug('anambra'); const enugu = places.stateBySlug('enugu');
  const unizik = places.campusBySlug('unizik'); const unn = places.campusBySlug('unn');
  const ifite = areas.bySlug('ifite');
  const lookup = placesSvc.lookup();
  const areaIds = areas.list({ activeOnly: true }).map((a) => a.id);
  const base = { title: 'Nice self-contain', propertyType: 'self_contain', description: 'A clean room with water.', area: String(ifite.id) };
  let r = parseListing({ ...base, campus: String(unizik.id) }, { submit: true, areaIds, places: lookup });
  assert.equal(r.data.stateId, anambra.id, 'state taken from the area');
  assert.equal(r.data.campusId, unizik.id);
  r = parseListing({ ...base, state: String(enugu.id) }, { submit: true, areaIds, places: lookup });
  assert.ok(r.errors.area, 'area from another state is refused');
  r = parseListing({ ...base, state: String(anambra.id), campus: String(unn.id) }, { submit: true, areaIds, places: lookup });
  assert.ok(r.errors.campus, 'campus from another state is refused');
  r = parseListing({ title: 'Draft only' }, { submit: false, areaIds, places: lookup });
  assert.equal(r.errors.state, undefined, 'drafts do not need a state');
  r = parseListing({ ...base, area: '' }, { submit: true, areaIds, places: lookup });
  assert.ok(r.errors.area);
});

test('market: validation, posting, browsing by place, sold and hidden states', async () => {
  const seller = await reg('Sam Seller', 'sam@example.com');
  const buyer = await reg('Bola Buyer', 'bola@example.com');
  const anambra = places.stateBySlug('anambra'); const unizik = places.campusBySlug('unizik');

  const bad = parseItem({ title: 'x', price: '' }, { places: placesSvc.lookup() });
  assert.ok(!bad.ok && bad.errors.title && bad.errors.category && bad.errors.condition && bad.errors.price && bad.errors.description && bad.errors.whatsapp);
  assert.equal(parseItem({ ...itemBody(seller), price: '0' }, { places: placesSvc.lookup() }).data.price, 0, 'free items are allowed');
  assert.ok(parseItem({ ...itemBody(seller), price: '999999999999' }, { places: placesSvc.lookup() }).errors.price, 'absurd prices are refused, not clamped');
  assert.ok(parseItem({ ...itemBody(seller), state: '' }, { places: placesSvc.lookup() }).errors.state, 'with two active states the state must be chosen');

  let r = ms.saveFromForm({ user: seller, existing: null, body: { ...itemBody(seller), mediaJson: '[]' } });
  assert.ok(!r.ok && r.errors.media, 'needs a photo');
  r = ms.saveFromForm({ user: seller, existing: null, body: itemBody(seller, { state: String(anambra.id), campus: String(unizik.id), negotiable: 'on', pickup: 'Engineering gate' }) });
  assert.ok(r.ok, JSON.stringify(r.errors));
  const item = r.item;
  assert.equal(item.status, 'live'); assert.equal(item.price, 45000); assert.ok(item.negotiable);
  assert.equal(item.whatsappNumber, '+2348012345678'); assert.equal(item.campus.name, 'UNIZIK'); assert.equal(item.media.length, 1);
  assert.ok(mrepo.byUid(item.media[0].mediaUid).attached, 'the photo is kept, not purged as an orphan');

  // someone else's photo cannot be attached
  r = ms.saveFromForm({ user: buyer, existing: null, body: { ...itemBody(seller), mediaJson: JSON.stringify([{ type: 'image', id: item.media[0].mediaUid }]) } });
  assert.ok(!r.ok && r.errors.media, 'cannot reuse another user\'s upload');

  assert.equal(market.browse({ page: 1, size: 10 }).total, 1);
  assert.equal(market.browse({ campusId: unizik.id, page: 1, size: 10 }).total, 1);
  assert.equal(market.browse({ stateId: places.stateBySlug('enugu').id, page: 1, size: 10 }).total, 0);
  assert.equal(market.browse({ category: 'books', page: 1, size: 10 }).total, 0);
  assert.equal(market.browse({ q: 'tecno', min: 40000, max: 50000, page: 1, size: 10 }).total, 1);
  assert.equal(market.browse({ q: 'tecno', min: 50000, page: 1, size: 10 }).total, 0);

  // editing keeps it live; marking sold takes it out of the market
  r = ms.saveFromForm({ user: seller, existing: market.byId(item.id), body: itemBody(seller, { title: 'Used Tecno phone (edited)', mediaJson: JSON.stringify([{ type: 'image', id: item.media[0].mediaUid }]) }) });
  assert.ok(r.ok, JSON.stringify(r.errors)); assert.equal(r.item.title, 'Used Tecno phone (edited)');
  market.update(item.id, { status: 'sold', soldAt: Date.now() });
  assert.equal(market.browse({ page: 1, size: 10 }).total, 0);
  market.update(item.id, { status: 'live', soldAt: null });

  // pre-approval switch
  site.save({ marketReviewRequired: true });
  r = ms.saveFromForm({ user: seller, existing: null, body: itemBody(seller, { title: 'Needs approval item' }) });
  assert.equal(r.item.status, 'pending'); assert.ok(r.needsReview);
  assert.equal(market.browse({ page: 1, size: 10 }).total, 1, 'pending items are not public');
  site.save({ marketReviewRequired: false });

  // a seller cannot have more than the allowed number of live items
  db.run("UPDATE market_items SET status = 'sold' WHERE seller_id = ?", seller.id);
  for (let n = 0; n < 30; n++) market.save({ sellerId: seller.id, slug: 'bulk-' + n, status: 'live', publishedAt: Date.now() }, { title: 'Bulk ' + n, category: 'other', condition: 'new', price: 1, whatsappNumber: '+2348012345678', media: [] });
  r = ms.saveFromForm({ user: seller, existing: null, body: itemBody(seller) });
  assert.ok(!r.ok && /30 items/.test(r.errors.title));
  db.run('DELETE FROM market_items WHERE seller_id = ?', seller.id);
});

test('market video: one video is kept and always saved first', async () => {
  const u = await reg('Vic Video', 'vic@example.com');
  const vid = mrepo.insert({ ownerId: u.id, kind: 'video', file: 'v1dddddddddddddddddd.mp4', thumbFile: null, width: null, height: null, size: 10 });
  const vid2 = mrepo.insert({ ownerId: u.id, kind: 'video', file: 'v2dddddddddddddddddd.mp4', thumbFile: null, width: null, height: null, size: 10 });
  const pic = photo(u);
  const body = itemBody(u, { title: 'Bike with a video', mediaJson: JSON.stringify([{ type: 'image', id: pic.uid }, { type: 'video', id: vid.uid }, { type: 'video', id: vid2.uid }]) });
  const r = ms.saveFromForm({ user: u, existing: null, body });
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.deepEqual(r.item.media.map((m) => m.type), ['video', 'image'], 'video first, only one video');
  assert.equal(parseItem({ ...body, mediaJson: JSON.stringify([{ type: 'video', id: vid.uid }]) }, { places: placesSvc.lookup() }).ok, true);
  const onlyVideo = ms.saveFromForm({ user: u, existing: null, body: { ...body, mediaJson: JSON.stringify([{ type: 'video', id: vid.uid }]) } });
  assert.ok(!onlyVideo.ok && onlyVideo.errors.media, 'a video does not replace the required photo');
  const other = await reg('Not Owner', 'notowner@example.com');
  const stolen = ms.saveFromForm({ user: other, existing: null, body: { ...body, mediaJson: JSON.stringify([{ type: 'image', id: photo(other).uid }, { type: 'video', id: vid.uid }]) } });
  assert.ok(stolen.ok && !stolen.item.media.some((m) => m.type === 'video'), 'someone else\'s video cannot be attached');
  assert.equal(market.byId(r.item.id).media[0].type, 'video', 'order survives a reload');
});

test('reviews: one per person, editable, counted in the average, and banned reviewers stop counting', async () => {
  const subject = users.byEmail('sam@example.com');
  const a = users.byEmail('bola@example.com');
  const c = await reg('Chidi C', 'chidi@example.com');
  const d = await reg('Dayo D', 'dayo@example.com');
  assert.match(rs.submit({ author: subject, subject, rating: 5 }).error, /yourself/);
  assert.match(rs.submit({ author: a, subject, rating: 0 }).error, /rating/);
  assert.match(rs.submit({ author: a, subject, rating: 9 }).error, /1 to 5/, 'out-of-range ratings are refused, not clamped');
  assert.match(rs.submit({ author: a, subject, rating: 'abc' }).error, /1 to 5/);
  assert.match(rs.submit({ author: a, subject, rating: 2.5 }).error, /1 to 5/);
  assert.ok(rs.submit({ author: a, subject, rating: 5, body: 'Honest seller' }).created);
  assert.ok(rs.submit({ author: c, subject, rating: 3 }).created);
  assert.ok(rs.submit({ author: d, subject, rating: 4, body: 'x'.repeat(2000) }).created);
  assert.equal(reviews.byPair(subject.id, d.id).body.length, 600, 'long comments are cut');
  let sum = reviews.summary(subject.id);
  assert.equal(sum.count, 3); assert.equal(sum.average, 4); assert.deepEqual(sum.stars, { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 });
  // posting again edits instead of adding a second review
  assert.equal(rs.submit({ author: c, subject, rating: 5 }).created, false);
  sum = reviews.summary(subject.id);
  assert.equal(sum.count, 3); assert.equal(sum.average, 4.7);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM reviews WHERE subject_id = ?', subject.id).n, 3);
  assert.equal(require('../src/repositories/activity').unreadCount(subject.id) > 0, true, 'the reviewed person is told');
  // admin removal is soft and final for that reviewer
  reviews.setStatus(reviews.byPair(subject.id, a.id).id, 'removed');
  assert.equal(reviews.summary(subject.id).count, 2);
  assert.match(rs.submit({ author: a, subject, rating: 1 }).error, /removed/);
  reviews.setStatus(reviews.byPair(subject.id, a.id).id, 'visible');
  // unverified accounts cannot review
  assert.match(rs.submit({ author: { ...d, id: 9999, emailVerifiedAt: null }, subject, rating: 5 }).error, /Verify/);
  // a banned reviewer's reviews stop counting; lifting the ban restores them
  userSvc.ban(users.firstAdmin(), d, 'Fraud or scam');
  assert.equal(reviews.summary(subject.id).count, 2);
  assert.equal(reviews.list(subject.id).length, 2);
  userSvc.unban(users.byId(d.id));
  assert.equal(reviews.summary(subject.id).count, 3);
});

test('ban: signs out, blocks sign-in with a clear message, hides lodges and items, closes reports, keeps the email', async () => {
  const admin = users.firstAdmin();
  const scammer = await reg('Fake Agent', 'scam@example.com');
  const p = listers.create({ userId: scammer.id, displayName: 'Fake', type: 'agent', whatsappNumber: '+2348099999999' });
  const token = auth.startSession(scammer.id);
  assert.ok(users.findSession(token));
  const r = ms.saveFromForm({ user: scammer, existing: null, body: itemBody(scammer, { title: 'Cheap iPhone, pay first' }) });
  assert.ok(r.ok);
  // a lodge for the scammer
  const ifite = areas.bySlug('ifite');
  const items = [1, 2, 3].map(() => photo(scammer));
  const lr = ls.saveFromForm({ user: scammer, profile: p, existing: null, body: { action: 'submit', title: 'Too good to be true', propertyType: 'self_contain', area: String(ifite.id), description: 'Very cheap room near campus.', chargesDisclosed: 'on',
    unitsJson: JSON.stringify([{ label: 'Room', kind: 'whole_unit', rent: 50000, period: 'year' }]), mediaJson: JSON.stringify(items.map((m) => ({ type: 'image', id: m.uid }))) } });
  assert.ok(lr.ok, JSON.stringify(lr.errors));
  flags.add({ targetType: 'user', targetId: scammer.id, subjectUserId: scammer.id, reporterKey: 'a:x', reason: 'fraud' });
  flags.add({ targetType: 'item', targetId: r.item.id, subjectUserId: scammer.id, reporterKey: 'a:y', reason: 'fraud' });
  assert.equal(flags.openAgainstUser(scammer.id), 2);

  assert.throws(() => userSvc.ban(admin, admin, 'Fraud or scam'), /./, 'cannot ban yourself');
  assert.throws(() => userSvc.ban(admin, scammer, ''), /reason/);
  userSvc.ban(admin, scammer, 'Fraud or scam: took deposits');
  const after = users.byId(scammer.id);
  assert.ok(after.bannedAt); assert.equal(after.status, 'suspended'); assert.match(after.banReason, /deposits/);
  assert.equal(users.findSession(token), null, 'signed out at once');
  assert.equal(market.byId(r.item.id).status, 'hidden'); assert.equal(market.byId(r.item.id).hiddenReason, 'banned');
  assert.notEqual(listings.byId(lr.listing.id).status, 'live');
  assert.equal(market.browse({ q: 'iPhone', page: 1, size: 10 }).total, 0);
  assert.equal(flags.openAgainstUser(scammer.id), 0, 'reports are closed once the account is banned');
  // the message is only shown to someone who knows the password
  await assert.rejects(() => auth.authenticate('scam@example.com', 'password-1'), /banned/);
  await assert.rejects(() => auth.authenticate('scam@example.com', 'wrong-password'), /not correct/);
  // the email cannot be used to sign up again
  await assert.rejects(() => reg('Fake Agent 2', 'scam@example.com'), (e) => !!(e.errors && e.errors.email));
  assert.equal(users.counts().banned, 1);
  assert.equal(users.list({ filter: 'banned', page: 1, size: 10 }).rows.length, 1);
  // administrators cannot be banned
  const other = await reg('Other Admin', 'other-admin@example.com'); users.update(other.id, { isAdmin: true });
  assert.throws(() => userSvc.ban(admin, users.byId(other.id), 'Fraud or scam'), /administrator/);
  // lifting the ban lets them in again but leaves their content hidden
  userSvc.unban(after);
  assert.equal(users.byId(scammer.id).status, 'active');
  assert.ok((await auth.authenticate('scam@example.com', 'password-1')).id);
  assert.equal(market.byId(r.item.id).status, 'hidden');
});

test('reports on items, people and reviews: no duplicates, auto-hide for items, counts by type', async () => {
  const seller = await reg('Tola T', 'tola@example.com');
  const r = ms.saveFromForm({ user: seller, existing: null, body: itemBody(seller, { title: 'Laptop for sale' }) });
  const item = r.item;
  assert.ok(!flags.exists('item', item.id, 'u:1'));
  assert.equal(flags.add({ targetType: 'item', targetId: item.id, subjectUserId: seller.id, reporterId: 1, reporterKey: 'u:1', reason: 'fraud' }), 1);
  assert.ok(flags.exists('item', item.id, 'u:1'));
  assert.equal(flags.add({ targetType: 'item', targetId: item.id, subjectUserId: seller.id, reporterKey: 'a:2', reason: 'fraud' }), 2);
  assert.equal(flags.openCounts().item >= 2, true);
  const listed = flags.list('item', 'open').filter((f) => f.targetId === item.id);
  assert.equal(listed.length, 2); assert.equal(listed[0].target.title, 'Laptop for sale'); assert.equal(listed[0].subject.name, 'Tola T');
  flags.closeOpenFor('item', item.id, 1, 'Item hidden');
  assert.equal(flags.list('item', 'open').filter((f) => f.targetId === item.id).length, 0);
  // deleting an item removes its reports, deleting a review removes its reports
  flags.add({ targetType: 'item', targetId: item.id, subjectUserId: seller.id, reporterKey: 'a:3', reason: 'fraud' });
  ms.removeItem(market.byId(item.id));
  assert.equal(db.get("SELECT COUNT(*) AS n FROM abuse_reports WHERE target_type = 'item' AND target_id = ?", item.id).n, 0);
  const a = users.byEmail('bola@example.com'); const s = users.byEmail('sam@example.com');
  const rev = reviews.byPair(s.id, a.id);
  flags.add({ targetType: 'review', targetId: rev.id, subjectUserId: a.id, reporterKey: 'u:9', reason: 'abusive' });
  assert.equal(flags.list('review', 'open')[0].target.about, 'Sam Seller');
  reviews.remove(rev.id);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM abuse_reports WHERE target_type = 'review'").n, 0);
});

test('deleting an account removes the reviews it wrote and takes its items down', async () => {
  const x = await reg('Leaver', 'leaver@example.com');
  const sam = users.byEmail('sam@example.com');
  rs.submit({ author: x, subject: sam, rating: 1, body: 'bad' });
  const r = ms.saveFromForm({ user: x, existing: null, body: itemBody(x, { title: 'Leaver item' }) });
  await userSvc.anonymise(x);
  assert.equal(reviews.byPair(sam.id, x.id), null);
  assert.equal(market.byId(r.item.id).status, 'deleted');
});

test('ads: validation, scheduling, placement and targeting, and how they mix into a list', async () => {
  const bad = adsSvc.parseAd({ title: 'x', linkType: 'url', linkValue: 'javascript:alert(1)' });
  assert.ok(!bad.ok && bad.errors.title && bad.errors.linkValue && bad.errors.body);
  assert.ok(adsSvc.parseAd({ title: 'Page', body: 'hi', linkType: 'page', linkValue: '//evil.com' }).errors.linkValue, 'no protocol-relative redirects');
  assert.ok(adsSvc.parseAd({ title: 'Page', body: 'hi', linkType: 'page', linkValue: '/market' }).ok);
  assert.ok(adsSvc.parseAd({ title: 'Hi', body: 'hi', imageUrl: 'https://evil.com/x.png' }).errors.imageUrl, 'only images uploaded through the site');
  const wa = adsSvc.parseAd({ title: 'Call us', body: 'hello', linkType: 'whatsapp', linkValue: '0801 234 5678' });
  assert.equal(wa.data.linkValue, '+2348012345678'); assert.equal(wa.data.buttonLabel, 'Message on WhatsApp');
  assert.ok(adsSvc.parseAd({ title: 'Dates', body: 'x', startsAt: '2026-12-10', endsAt: '2026-12-01' }).errors.endsAt);

  const unizik = places.campusBySlug('unizik'); const unn = places.campusBySlug('unn');
  const mk = (o) => adsRepo.create(adsSvc.parseAd({ title: 'Ad', body: 'text', linkType: 'none', ...o }).data, 1);
  const both = mk({ title: 'Everywhere' });
  const lodgesOnly = mk({ title: 'Lodges only', placement: 'lodges' });
  const marketOnly = mk({ title: 'Market only', placement: 'market' });
  const unizikOnly = mk({ title: 'UNIZIK only', state: String(unizik.stateId), campus: String(unizik.id) });
  const future = mk({ title: 'Future', startsAt: '2099-01-01' });
  const expired = mk({ title: 'Expired', endsAt: '2020-01-01' });
  const off = mk({ title: 'Off' }); adsRepo.toggle(off.id);
  const titles = (l) => adsRepo.forPlacement(l.p, l.o).map((a) => a.title).sort();
  assert.deepEqual(titles({ p: 'lodges' }), ['Everywhere', 'Lodges only', 'UNIZIK only']);
  assert.deepEqual(titles({ p: 'market' }), ['Everywhere', 'Market only', 'UNIZIK only']);
  assert.deepEqual(titles({ p: 'lodges', o: { campusId: unn.id, stateId: unn.stateId } }), ['Everywhere', 'Lodges only'], 'targeted to another campus');
  adsRepo.clicked(both.id); adsRepo.seen([both.id, lodgesOnly.id]);
  const row = adsRepo.byUid(both.uid); assert.equal(row.clicks, 1); assert.equal(row.impressions, 1);
  assert.equal(adsSvc.hrefFor(both), '');

  const cards = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ n }));
  const mixed = adsSvc.mix(cards, [{ t: 'a' }, { t: 'b' }, { t: 'c' }, { t: 'd' }]);
  assert.equal(mixed.filter((x) => x.card).length, 10, 'every card is kept');
  assert.deepEqual(mixed.map((x) => (x.ad ? 'ad' : x.card.n)).slice(0, 4), [1, 2, 'ad', 3]);
  assert.equal(mixed.filter((x) => x.ad).length, 3, 'one after the 2nd card, then after every 4 more; the 4th ad has no slot on a full page');
  // short lists still show every ad (a new site with a few lodges or items must not look like the ads are broken)
  const short = adsSvc.mix([{ n: 1 }, { n: 2 }, { n: 3 }], [{ t: 'a' }, { t: 'b' }, { t: 'c' }]);
  assert.equal(short.filter((x) => x.ad).length, 3); assert.equal(short.length, 6);
  assert.equal(adsSvc.mix([{ n: 1 }], [{ t: 'a' }]).filter((x) => x.ad).length, 1, 'an ad shows even beside a single result');
  assert.deepEqual(adsSvc.mix([], [{ t: 'a' }]), [{ ad: { t: 'a' } }], 'and on an empty list');
});


test('expiry: items drop out of the market after their date, renew brings them back, and sellers get one warning', async () => {
  const u = await reg('Ex Pire', 'expire@example.com');
  const r = ms.saveFromForm({ user: u, existing: null, body: itemBody(u, { title: 'Expiring lamp' }) });
  assert.ok(r.ok, JSON.stringify(r.errors));
  const id = r.item.id;
  const days = (n) => Date.now() + n * 86400000;
  assert.ok(market.byId(id).expiresAt > days(59), 'a new item gets about 60 days');
  assert.equal(market.byId(id).expired, false); assert.ok(ms.isPublic(market.byId(id)));
  const inMarket = () => market.browse({ q: 'Expiring lamp', page: 1, size: 10 }).total;
  assert.equal(inMarket(), 1);
  // 3 days left: not expired yet, but due a reminder (once)
  market.update(id, { expiresAt: days(3) });
  assert.equal(market.expiringSoon(5).filter((x) => x.id === id).length, 1);
  const act = require('../src/repositories/activity');
  const before = act.unreadCount(u.id);
  const summary = await require('../src/services/jobs').run();
  assert.ok(summary.itemsExpiring >= 1, 'the job found the item');
  assert.equal(act.unreadCount(u.id), before + 1, 'the seller was told');
  assert.equal(market.expiringSoon(5).filter((x) => x.id === id).length, 0, 'warned once only');
  await require('../src/services/jobs').run();
  assert.equal(act.unreadCount(u.id), before + 1, 'running the job again does not warn again');
  assert.equal(market.byId(id).daysLeft, 3);
  // past its date: gone from every public list, still stored as live for the seller
  market.update(id, { expiresAt: Date.now() - 1000 });
  const e = market.byId(id);
  assert.ok(e.expired && e.status === 'live' && !ms.isPublic(e));
  assert.equal(inMarket(), 0);
  assert.ok(!market.publicBySeller(u.id).some((x) => x.id === id));
  assert.ok(!market.similar('phones', 0, 50).some((x) => x.id === id));
  assert.ok(!market.sitemap().some((x) => x.slug === e.slug));
  // renew
  market.renew(id, 60);
  const n = market.byId(id);
  assert.ok(!n.expired && n.expiresAt > days(59));
  assert.equal(inMarket(), 1);
  assert.equal(db.get('SELECT expiry_notified_at AS x FROM market_items WHERE id = ?', id).x, null, 'renewing re-arms the warning');
});

test('saved items, seller stats and featuring', async () => {
  const seller = await reg('Stat Seller', 'stat@example.com'); const fan = await reg('Fan Buyer', 'fan@example.com');
  const a = ms.saveFromForm({ user: seller, existing: null, body: itemBody(seller, { title: 'Stat item one' }) }).item;
  const b = ms.saveFromForm({ user: seller, existing: null, body: itemBody(seller, { title: 'Stat item two' }) }).item;
  // saving
  assert.equal(market.toggleSaved(fan.id, a.id), true); assert.equal(market.toggleSaved(fan.id, b.id), true);
  assert.deepEqual([...market.savedIds(fan.id, [a.id, b.id])].sort(), [a.id, b.id].sort());
  assert.equal(market.toggleSaved(fan.id, b.id), false, 'toggling again removes it');
  assert.equal(market.savedCount(fan.id), 1); assert.equal(market.byId(a.id).saves, 1);
  assert.deepEqual(market.saversOf(a.id), [fan.id]);
  assert.equal(market.savedBy(fan.id).length, 1);
  market.update(a.id, { status: 'sold', soldAt: Date.now() });
  assert.equal(market.savedBy(fan.id).length, 1, 'a sold item stays in saved, so the buyer can see it is gone');
  market.update(a.id, { status: 'hidden', hiddenReason: 'admin' });
  assert.equal(market.savedBy(fan.id).length, 0, 'a hidden item disappears from saved');
  market.update(a.id, { status: 'live', hiddenReason: null });
  market.update(a.id, { expiresAt: Date.now() - 1 });
  assert.equal(market.savedBy(fan.id).length, 0, 'so does an expired one');
  market.renew(a.id, 60);
  // deleting an item removes the save
  assert.equal(market.savedIds(fan.id, [a.id]).size, 1); ms.removeItem(market.byId(a.id));
  assert.equal(db.get('SELECT COUNT(*) AS n FROM market_saved WHERE item_id = ?', a.id).n, 0);
  // stats: one view and one chat per visitor per day
  assert.equal(market.recordEvent(b.id, 'view', 'a-1'), true); assert.equal(market.recordEvent(b.id, 'view', 'a-1'), false);
  assert.equal(market.recordEvent(b.id, 'view', 'a-2'), true); assert.equal(market.recordEvent(b.id, 'contact', 'a-1'), true); assert.equal(market.recordEvent(b.id, 'contact', 'a-1'), false);
  const s = market.byId(b.id); assert.equal(s.views, 2); assert.equal(s.contacts, 1);
  db.run('UPDATE market_events SET day = 20200101'); assert.ok(market.purgeEvents(45) >= 3, 'old counters are tidied away');
  assert.equal(market.byId(b.id).views, 2, 'but the totals stay');
  // featured items come first, and only while live
  const c = ms.saveFromForm({ user: seller, existing: null, body: itemBody(seller, { title: 'Stat item three' }) }).item;
  market.update(b.id, { featured: 1 });
  const order = market.browse({ q: 'Stat item', page: 1, size: 10 }).rows.map((x) => x.title);
  assert.equal(order[0], 'Stat item two'); assert.equal(market.byId(b.id).featured, true); assert.ok(c);
  assert.equal(market.browse({ q: 'Stat item', sort: 'price_asc', page: 1, size: 10 }).rows.length, 2, 'other sorts ignore featuring order but keep the items');
});

test('welcome popup: defaults, validation, versions and the site name', async () => {
  const w = require('../src/services/welcome');
  assert.ok(w.get().enabled && w.get().items.length >= 6 && w.activeVersion() === '1');
  assert.equal(w.view('Oikres').title, 'Welcome to Oikres');
  assert.ok(w.view('Oikres').items.every((i) => w.ICONS.includes(i.icon)));
  const bad = w.parse({ enabled: 'on', title: 'x', itemTitle: ['A'], itemText: ['t'], itemIcon: ['home'] });
  assert.ok(!bad.ok && bad.errors.title && bad.errors.items);
  const many = w.parse({ enabled: 'on', title: 'Hello', itemTitle: Array.from({ length: 12 }, (_, i) => 'Feature ' + i), itemText: [], itemIcon: [] });
  assert.ok(many.errors.items, 'too many features');
  const good = w.parse({ enabled: 'on', title: 'Hi {site}', intro: 'Intro', buttonLabel: '', itemIcon: ['home', 'nope', 'bag'], itemTitle: ['One', '', 'Three'], itemText: ['a', '', 'c'], reshow: 'on' });
  assert.ok(w.parse({ enabled: 'on', title: 'Hello', itemTitle: ['', 'Ok'], itemText: ['text without a title', 'x'], itemIcon: [] }).errors.items, 'a description with no title is refused');
  assert.ok(good.ok && good.reshow);
  assert.deepEqual(good.data.items.map((i) => i.icon), ['home', 'bag'], 'blank rows are dropped');
  assert.equal(good.data.buttonLabel, 'Got it', 'a missing button text gets a default');
  const hostile = w.parse({ enabled: 'on', title: '<script>alert(1)</script> hello', itemIcon: ['<img>'], itemTitle: ['<b>x</b>'], itemText: [] });
  assert.equal(hostile.data.items[0].icon, 'check', 'icons are limited to the known list');
  w.save({ ...good.data, version: w.get().version + 1 });
  assert.equal(w.activeVersion(), '2'); assert.equal(w.view('Oikres').title, 'Hi Oikres');
  w.save({ ...w.get(), enabled: false }); assert.equal(w.activeVersion(), '', 'switched off means no version, so nothing is shown');
  w.reset(); assert.ok(w.get().enabled && Number(w.activeVersion()) > 2 && w.get().items.length >= 6, 'reset restores the wording and shows it again');
});

test('video ads: only uploaded videos are accepted and an ad can be video only', async () => {
  const good = adsSvc.parseAd({ title: 'Video only', videoUrl: '/media/abcdefghij0123456789.mp4', videoMediaUid: 'abcdefghij0123456789', linkType: 'none' });
  assert.ok(good.ok, JSON.stringify(good.errors)); assert.equal(good.data.videoUrl, '/media/abcdefghij0123456789.mp4');
  assert.ok(adsSvc.parseAd({ title: 'Remote video', videoUrl: 'https://evil.example/x.mp4', linkType: 'none' }).errors.videoUrl, 'remote videos are refused');
  assert.ok(adsSvc.parseAd({ title: 'Bad ext', videoUrl: '/media/abcdefghij0123456789.exe', linkType: 'none' }).errors.videoUrl);
  assert.ok(adsSvc.parseAd({ title: 'Nothing at all', linkType: 'none' }).errors.body, 'an ad needs some content');
  const ad = adsRepo.create(good.data, 1);
  assert.equal(adsRepo.byUid(ad.uid).videoUrl, '/media/abcdefghij0123456789.mp4');
  assert.ok(adsRepo.forPlacement('lodges').some((a) => a.uid === ad.uid && a.videoUrl));
});
