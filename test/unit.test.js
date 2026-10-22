// Fast tests that need no network and no web server. Run: npm test
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const U = require('../src/lib/util');
const cost = require('../src/lib/cost');
const IMG = require('../src/lib/images');
const { parseListing } = require('../src/services/listingForm');
const { sniff } = require('../src/services/media');
const auth = require('../src/services/auth');
const cfg = require('../src/config');

test('phone numbers are normalised to +234 form', () => {
  assert.equal(U.normalisePhone('0801 234 5678'), '+2348012345678');
  assert.equal(U.normalisePhone('+234 701 684 5867'), '+2347016845867');
  assert.equal(U.normalisePhone('8012345678'), '+2348012345678');
  assert.equal(U.normalisePhone('12345'), null);
});

test('returnTo only allows local paths; ids are validated', () => {
  assert.equal(U.safeReturnTo('/saved'), '/saved');
  for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', undefined]) assert.equal(U.safeReturnTo(bad), '/');
  assert.ok(U.isUid(U.uid()));
  assert.ok(!U.isUid('../../etc/passwd'));
  assert.equal(U.escapeLike('50%_off\\'), '50\\%\\_off\\\\');
});

test('move-in cost: percent fees use each room\'s own rent; the agent fee is paid by the tenant on top of rent', () => {
  const fees = [{ label: 'agent', kind: 'percent', value: 10, payee: 'agent' }, { label: 'agreement', kind: 'fixed', value: 10000, payee: 'landlord' }];
  assert.equal(cost.breakdown(200000, fees).total, 230000);
  assert.equal(cost.breakdown(120000, fees).total, 142000);
  assert.equal(cost.breakdown(200000, []).total, 200000);
  assert.equal(cost.breakdown(200000, [{ label: 'agent', kind: 'fixed', value: 15000, payee: 'agent' }]).lines[1].amount, 15000);
});

test('room-share pricing: per-person rent, spaces and status', () => {
  const units = [{ kind: 'shared_room', rent: 120000, period: 'year', spacesTotal: 4, spacesAvailable: 0 }, { kind: 'shared_room', rent: 150000, period: 'year', spacesTotal: 2, spacesAvailable: 1 }];
  const s = cost.applyPricing(units, [{ label: 'agent', kind: 'percent', value: 10, payee: 'agent' }]);
  assert.equal(units[0].status, 'full');
  assert.equal(units[1].status, 'partly_taken');
  assert.equal(s.priceFrom, 150000);
  assert.equal(s.moveInFrom, 165000);
  assert.equal(s.hasRoomShare, true);
});

test('listing form: a submission needs photos fields, rent, area and disclosed charges', () => {
  const r = parseListing({ title: 'Short', unitsJson: '[]' }, { submit: true, areaIds: [1] });
  assert.equal(r.ok, false);
  for (const k of ['title', 'propertyType', 'area', 'description', 'units', 'chargesDisclosed']) assert.ok(r.errors[k], 'expected an error for ' + k);
});

test('listing form: drafts are lenient and listers cannot set Oikres as a payee', () => {
  const r = parseListing({ title: 'My draft', unitsJson: JSON.stringify([{ label: 'Room', kind: 'whole_unit', rent: 100000 }]), feesJson: JSON.stringify([{ label: 'agent', kind: 'percent', value: 10, payee: 'oikres' }]) }, { submit: false, areaIds: [] });
  assert.equal(r.ok, true);
  assert.equal(r.data.fees[0].payee, 'agent');
});

test('uploads are identified by their bytes, not their names', () => {
  assert.deepEqual(sniff(Buffer.from('ffd8ffe000104a464946', 'hex')), { type: 'image', ext: 'jpg' });
  assert.deepEqual(sniff(Buffer.from('89504e470d0a1a0a00000000', 'hex')), { type: 'image', ext: 'png' });
  assert.deepEqual(sniff(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])), { type: 'image', ext: 'webp' });
  assert.deepEqual(sniff(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom')])), { type: 'video', ext: 'mp4' });
  assert.deepEqual(sniff(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypqt  ')])), { type: 'video', ext: 'mov' });
  assert.equal(sniff(Buffer.from('<?php echo 1; ?>')), null);
  assert.equal(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
});

test('image helpers: Cloudinary gets transformations, local files get their own thumbnail', () => {
  assert.match(IMG.mediaSrc({ url: 'https://res.cloudinary.com/x/image/upload/v1/a.jpg' }, 'card'), /\/upload\/f_auto,q_auto,c_fill,w_480,h_360\//);
  assert.equal(IMG.mediaSrc({ url: '/media/a.jpg', thumbUrl: '/media/a-t.jpg' }, 'card'), '/media/a-t.jpg');
  assert.equal(IMG.mediaSrc({ url: '/media/a.jpg', thumbUrl: '/media/a-t.jpg' }, 'large'), '/media/a.jpg');
});

test('passwords: scrypt hash verifies, rejects wrong passwords and is salted', async () => {
  const h1 = await auth.hashPassword('correct horse');
  const h2 = await auth.hashPassword('correct horse');
  assert.notEqual(h1, h2);
  assert.match(h1, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await auth.verifyPassword('correct horse', h1), true);
  assert.equal(await auth.verifyPassword('wrong', h1), false);
  assert.equal(await auth.verifyPassword('x', 'garbage'), false);
  assert.ok(auth.checkPassword('short'));
  assert.ok(auth.checkPassword('only-eleven', { admin: true }));
  assert.equal(auth.checkPassword('a-long-enough-pass', { admin: true }), null);
});

const base = () => ({ ...cfg, isProd: false, baseUrl: 'http://localhost:3000', port: 3000, cloudinary: { enabled: false, cloudName: '', apiKey: '', apiSecret: '' }, mail: { enabled: false }, smtp: { host: '', user: '', pass: '' }, admin: { email: '', password: '' }, hasEnvFile: true, sessionSecret: '' });

test('config: development defaults are valid with no services at all', () => {
  const { errors } = cfg.validate({ ...base(), nodeEnv: 'development' });
  assert.deepEqual(errors.filter((e) => !/Node\.js 24/.test(e)), []);
});

test('config: production refuses weak secrets, http, missing SMTP and the example admin password', () => {
  const prod = { ...base(), isProd: true, sessionSecret: 'short', baseUrl: 'http://example.com', admin: { email: 'admin@oikres.local', password: cfg.EXAMPLE_ADMIN_PASSWORD } };
  const { errors } = cfg.validate(prod);
  assert.ok(errors.some((e) => /SESSION_SECRET/.test(e)));
  assert.ok(errors.some((e) => /https/.test(e)));
  assert.ok(errors.some((e) => /SMTP/.test(e)));
  assert.ok(errors.some((e) => /ADMIN_PASSWORD/.test(e)));
  const ok = cfg.validate({ ...prod, sessionSecret: crypto.randomBytes(32).toString('hex'), baseUrl: 'https://oikres.com', mail: { enabled: true }, admin: { email: 'me@oikres.com', password: 'a-very-long-secret-1' } });
  assert.deepEqual(ok.errors.filter((e) => !/Node\.js 24/.test(e)), []);
});

test('config: partly configured Cloudinary is an error, not a silent fallback', () => {
  const { errors } = cfg.validate({ ...base(), cloudinary: { enabled: false, cloudName: 'x', apiKey: '', apiSecret: '' } });
  assert.ok(errors.some((e) => /Cloudinary/.test(e)));
});

const color = require('../src/lib/color');
test('colours: hex and rgba parse, normalise and keep alpha', () => {
  assert.deepEqual(color.parse('#0369A1'), { r: 3, g: 105, b: 161, a: 1 });
  assert.deepEqual(color.parse('rgba(10, 20, 30, 0.5)'), { r: 10, g: 20, b: 30, a: 0.5 });
  assert.deepEqual(color.parse('#fff8'), { r: 255, g: 255, b: 255, a: 0.53 });
  assert.equal(color.normalise('rgb(255 0 0)'), '#ff0000');
  assert.equal(color.toCss({ r: 1, g: 2, b: 3, a: 0.456 }), 'rgba(1, 2, 3, 0.46)');
  for (const bad of ['red', 'javascript:alert(1)', 'url(x)', '#12', 'rgb(1,2)', '', null]) assert.equal(color.parse(bad), null, String(bad));
});
test('colours: readable text colour and contrast ratio', () => {
  assert.equal(color.readableOn({ r: 3, g: 105, b: 161, a: 1 }), '#FFFFFF');
  assert.equal(color.readableOn({ r: 56, g: 189, b: 248, a: 1 }), '#0F172A');
  assert.ok(color.contrast({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 }) > 20);
});

test('initial payment: stated by the lister, itemised charges inside it, the rest shown honestly; renewal stays the rent', () => {
  const fees = [{ label: 'inspection', kind: 'fixed', value: 5000, payee: 'agent' }];
  const b = cost.breakdown(300000, fees, 530000);
  assert.equal(b.total, 530000);
  assert.equal(b.other, 225000);
  assert.deepEqual(b.lines.map((l) => l.amount), [300000, 5000, 225000]);
  assert.equal(cost.breakdown(300000, fees).total, 305000, 'without a stated initial payment it is rent plus charges');
  const units = [{ kind: 'whole_unit', rent: 300000, period: 'year', spacesTotal: 1, spacesAvailable: 1, initialPayment: 530000 }];
  const s = cost.applyPricing(units, fees);
  assert.equal(s.priceFrom, 300000);
  assert.equal(s.moveInFrom, 530000);
  const bad = parseListing({ title: 'Cheap self-con upschool', unitsJson: JSON.stringify([{ label: 'Self-con', kind: 'whole_unit', rent: 300000, initialPayment: 300500 }]), feesJson: JSON.stringify([{ label: 'inspection', kind: 'fixed', value: 5000, payee: 'agent' }]) }, { submit: false, areaIds: [] });
  assert.match(bad.errors.units, /less than its rent plus the charges/);
});
