// A real visit to the running site over HTTP: register, become a lister, upload photos, add a lodge,
// approve it as admin, see it publicly. Used by `npm run smoke` and by the integration test.
const assert = require('node:assert/strict');

class Client {
  constructor(base) { this.base = base; this.jar = {}; this.token = ''; }
  cookie() { return Object.entries(this.jar).map(([k, v]) => k + '=' + v).join('; '); }
  absorb(res) {
    for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
      const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i); const v = kv.slice(i + 1);
      if (/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)) delete this.jar[k]; else this.jar[k] = v;
    }
  }
  async req(path, { method = 'GET', form, json, body, headers = {} } = {}) {
    const h = { cookie: this.cookie(), ...headers };
    let b = body;
    if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; b = new URLSearchParams(form).toString(); }
    if (json) { h['content-type'] = 'application/json'; b = JSON.stringify(json); }
    const res = await fetch(this.base + path, { method, headers: h, body: b, redirect: 'manual' });
    this.absorb(res);
    return res;
  }
  async page(path) { const r = await this.req(path); const html = await r.text(); const m = html.match(/name="csrf-token" content="([^"]+)"/); if (m) this.token = m[1]; return { res: r, html }; }
  async post(path, form) { if (!this.token) await this.page('/login'); return this.req(path, { method: 'POST', form: { _csrf: this.token, ...form } }); }
  async upload(kind, withThumb = true) {
    if (!this.token) await this.page('/login');
    const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
    const fd = new FormData();
    fd.append('kind', kind);
    fd.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'x.jpg');
    if (withThumb) fd.append('thumb', new Blob([jpeg], { type: 'image/jpeg' }), 't.jpg');
    return this.req('/api/media/upload', { method: 'POST', body: fd, headers: { 'x-csrf-token': this.token } });
  }
  // A tiny file that starts like an MP4 (the server checks the file signature, not the name).
  async uploadVideo(kind) {
    if (!this.token) await this.page('/login');
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(12)]);
    const fd = new FormData();
    fd.append('kind', kind);
    fd.append('file', new Blob([mp4], { type: 'video/mp4' }), 'x.mp4');
    return this.req('/api/media/upload', { method: 'POST', body: fd, headers: { 'x-csrf-token': this.token } });
  }
}

async function runFlow(base, { adminEmail, adminPassword }, log = () => {}) {
  const step = async (name, fn) => { await fn(); log(name); };
  const visitor = new Client(base);
  const lister = new Client(base);
  const admin = new Client(base);
  const email = 'agent' + Date.now() + '@example.com';
  let lodgeUid; let slug; let photoIds = [];

  await step('homepage loads with the Thoth Design Services credit', async () => {
    const { res, html } = await visitor.page('/');
    assert.equal(res.status, 200);
    assert.match(html, /Find your next lodge/);
    assert.match(html, /href="https:\/\/thothdesignservices\.com"[^>]*>Thoth Design Services</);
    assert.match(html, /prefers-color-scheme: dark/);
    assert.ok(!res.headers.get('x-powered-by'), 'no x-powered-by header');
    assert.match(res.headers.get('content-security-policy') || '', /default-src 'self'/);
  });
  await step('health, robots, sitemap, manifest, stylesheet and scripts', async () => {
    for (const p of ['/healthz', '/robots.txt', '/sitemap.xml', '/manifest.webmanifest', '/css/app.css', '/js/app.js', '/js/form.js', '/js/uploader.js', '/sw.js', '/icons/icon-192.png', '/help', '/privacy', '/terms', '/register', '/login', '/forgot', '/offline', '/saved']) {
      const r = await visitor.req(p);
      assert.equal(r.status, 200, p + ' should return 200');
      await r.arrayBuffer();
    }
    assert.equal((await visitor.req('/no-such-page')).status, 404);
    // the service worker must never be cached, and its version must be in the file (fixes stale styles after updates)
    const sw = await visitor.req('/sw.js');
    assert.match(sw.headers.get('cache-control') || '', /no-store/);
    const swText = await sw.text();
    assert.ok(!swText.includes('__VERSION__') && /const VERSION = 'oikres-[a-z0-9]+'/.test(swText), 'service worker carries a build version');
    assert.ok(!/ignoreSearch: true \}\)\);\s*$/m.test('') && swText.includes('network first'), 'styles and scripts are fetched network-first');
  });
  await step('protected pages redirect visitors; forms without a token are refused', async () => {
    for (const p of ['/admin', '/lister', '/account', '/account/notifications']) assert.equal((await visitor.req(p)).status, 302, p);
    const bare = new Client(base);
    const r = await bare.req('/login', { method: 'POST', form: { email: 'a@b.co', password: 'x' } });
    assert.equal(r.status, 403);
  });
  await step('a visitor can register and is signed in, but cannot reach admin pages', async () => {
    await lister.page('/register');
    const r = await lister.post('/register', { name: 'Test Agent', email, password: 'a-good-password', terms: 'on', isAdmin: 'true' });
    assert.equal(r.status, 302);
    assert.equal((await lister.req('/account')).status, 200);
    assert.equal((await lister.req('/admin')).status, 404);
    assert.equal((await lister.req('/lister')).status, 302);
  });
  await step('wrong passwords get one generic message', async () => {
    const c = new Client(base); await c.page('/login');
    const r = await c.post('/login', { email, password: 'wrong' });
    assert.equal(r.status, 401);
    assert.match(await r.text(), /Email or password is not correct/);
  });
  await step('become a lister', async () => {
    const r = await lister.post('/account/become-lister', { displayName: 'Test Agent', type: 'agent', whatsapp: '08012345678', agree: 'on' });
    assert.equal(r.status, 302);
    assert.equal((await lister.req('/lister')).status, 200);
  });
  await step('upload three photos with previews; a fake image is refused', async () => {
    for (let i = 0; i < 3; i++) { const r = await lister.upload('photo'); assert.equal(r.status, 200, 'photo upload'); const j = await r.json(); assert.match(j.url, /^\/media\/[a-z0-9]{20}\.jpg$/); assert.match(j.thumbUrl, /-t\.jpg$/); photoIds.push(j); }
    const fd = new FormData(); fd.append('kind', 'photo'); fd.append('file', new Blob([Buffer.from('<?php echo 1; ?>')], { type: 'image/jpeg' }), 'evil.jpg');
    const bad = await lister.req('/api/media/upload', { method: 'POST', body: fd, headers: { 'x-csrf-token': lister.token } });
    assert.equal(bad.status, 415);
    const file = await visitor.req(photoIds[0].url);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/jpeg');
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
    await file.arrayBuffer();
  });
  await step('submit a lodge with two rooms and itemised charges', async () => {
    const { html } = await lister.page('/lister/lodges/new');
    const area = (html.match(/value="(\d+)"[^>]*>Ifite</) || [])[1];
    assert.ok(area, 'Ifite area is offered');
    const r = await lister.post('/lister/lodges', {
      action: 'submit', title: 'Smoke test self-contain near Miracle Junction', propertyType: 'self_contain', area, junction: 'Miracle Junction',
      description: 'A clean self-contain with running water and light, close to campus.', chargesDisclosed: 'on', amenities: ['water', 'security'],
      unitsJson: JSON.stringify([{ label: 'Self-contain', kind: 'whole_unit', rent: 200000, initialPayment: 300000, period: 'year' }, { label: 'Bed spaces', kind: 'shared_room', rent: 120000, period: 'year', spacesTotal: 3, spacesAvailable: 2, genderPreference: 'female', sharedFacilities: ['kitchen'] }]),
      feesJson: JSON.stringify([{ label: 'agent', kind: 'percent', value: 10, payee: 'agent' }, { label: 'agreement', kind: 'fixed', value: 10000, payee: 'landlord' }]),
      mediaJson: JSON.stringify(photoIds.map((p) => ({ type: 'image', id: p.id })))
    });
    assert.equal(r.status, 302, 'lodge submitted');
    const list = await (await lister.req('/lister/lodges')).text();
    assert.match(list, /Pending review/);
  });
  await step('a pending lodge is not public', async () => {
    const html = await (await visitor.req('/')).text();
    assert.ok(!html.includes('Smoke test self-contain'));
  });
  await step('the administrator signs in, reviews and approves it', async () => {
    await admin.page('/login');
    const login = await admin.post('/login', { email: adminEmail, password: adminPassword });
    assert.equal(login.status, 302, 'admin login');
    assert.equal((await admin.req('/admin')).status, 200);
    const queue = await (await admin.req('/admin/listings?status=pending')).text();
    lodgeUid = (queue.match(/\/admin\/listings\/([a-z0-9]{12})/) || [])[1];
    assert.ok(lodgeUid, 'lodge is in the review queue');
    const detail = await (await admin.req('/admin/listings/' + lodgeUid)).text();
    assert.match(detail, /Initial payment/);
    assert.equal((await admin.post('/admin/listings/' + lodgeUid + '/approve', {})).status, 302);
    for (const p of ['/admin/listers', '/admin/reports', '/admin/reference', '/admin/audit']) assert.equal((await admin.req(p)).status, 200, p);
  });
  await step('the lodge is public with its full move-in cost and WhatsApp contact', async () => {
    const home = await (await visitor.req('/')).text();
    assert.match(home, /Smoke test self-contain/);
    slug = (home.match(/href="\/lodges\/(smoke-test[^"]+)"/) || [])[1];
    assert.ok(slug, 'card links to the lodge');
    const page = await (await visitor.req('/lodges/' + slug)).text();
    assert.match(page, /Initial payment/);
    assert.match(page, /\u20A6300,000/); // initial payment stated by the lister (rent 200,000 + 20,000 + 10,000 itemised + 70,000 other)
    assert.match(page, /Other first-time charges/);
    assert.match(page, /When you renew/);
    assert.match(page, /\u20A6200,000 per year/); // renewal rent
    assert.match(page, /\u20A6142,000/); // 120,000 + 12,000 + 10,000
    assert.match(page, /Roommate needed/);
    const wa = await visitor.req('/lodges/' + slug + '/whatsapp');
    assert.equal(wa.status, 302);
    assert.match(wa.headers.get('location'), /^https:\/\/wa\.me\/2348012345678\?text=/);
    const found = await (await visitor.req('/?q=miracle&roommate=1')).text();
    assert.match(found, /Smoke test self-contain/);
    const none = await (await visitor.req("/?q=" + encodeURIComponent("' OR 1=1 --"))).text();
    assert.ok(!none.includes('Smoke test self-contain'));
  });
  await step('guests report the lodge three times and it is hidden for review', async () => {
    for (let i = 0; i < 3; i++) {
      const g = new Client(base);
      await g.page('/lodges/' + slug + '/report');
      assert.equal((await g.post('/lodges/' + slug + '/report', { reason: 'fraud' })).status, 302);
    }
    assert.equal((await visitor.req('/lodges/' + slug)).status, 404);
  });
  await step('another user cannot edit someone else\'s lodge', async () => {
    const other = new Client(base);
    await other.page('/register');
    await other.post('/register', { name: 'Other', email: 'other' + Date.now() + '@example.com', password: 'another-password', terms: 'on' });
    assert.equal((await other.req('/lister/lodges/' + lodgeUid + '/edit')).status, 302);
  });
  await step('the owner can still see their hidden lodge, and logout ends the session', async () => {
    assert.equal((await lister.req('/lodges/' + slug)).status, 200);
    assert.equal((await lister.post('/logout', {})).status, 302);
    assert.equal((await lister.req('/lister')).status, 302);
  });

  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const uidOf = (html, em) => (html.match(new RegExp('/admin/users/([a-z0-9]{12})"><strong>[^<]*</strong></a><br><span class="muted small">' + esc(em))) || [])[1];
  let agentUid; let adminUid;

  await step('admin: the people list shows everyone and the detail page opens', async () => {
    const list = await (await admin.req('/admin/users?q=' + encodeURIComponent(email))).text();
    agentUid = uidOf(list, email);
    assert.ok(agentUid, 'registered agent is listed');
    const all = await (await admin.req('/admin/users?filter=admins')).text();
    adminUid = uidOf(all, adminEmail);
    assert.ok(adminUid, 'the administrator is listed');
    const detail = await (await admin.req('/admin/users/' + agentUid)).text();
    assert.match(detail, /Danger zone/);
    assert.match(detail, /Quick actions/);
  });
  await step('admin: the last administrator cannot be suspended or demoted', async () => {
    for (const a of ['suspend', 'remove_admin']) {
      const r = await admin.post('/admin/users/' + adminUid + '/' + a, {});
      assert.equal(r.status, 302);
    }
    assert.equal((await admin.req('/admin')).status, 200, 'still an administrator');
  });
  await step('admin: suspend and reactivate a person; a suspended person cannot sign in', async () => {
    assert.equal((await admin.post('/admin/users/' + agentUid + '/suspend', {})).status, 302);
    const c = new Client(base); await c.page('/login');
    const r = await c.post('/login', { email, password: 'a-good-password' });
    assert.equal(r.status, 401);
    assert.equal((await admin.post('/admin/users/' + agentUid + '/unsuspend', {})).status, 302);
    const r2 = await c.post('/login', { email, password: 'a-good-password' });
    assert.equal(r2.status, 302);
  });
  await step('admin: set a new password for someone, and weak ones are refused', async () => {
    await admin.post('/admin/users/' + agentUid + '/set_password', { password: 'short' });
    const bad = new Client(base); await bad.page('/login');
    assert.equal((await bad.post('/login', { email, password: 'short' })).status, 401);
    await admin.post('/admin/users/' + agentUid + '/set_password', { password: 'a-brand-new-password' });
    const ok = new Client(base); await ok.page('/login');
    assert.equal((await ok.post('/login', { email, password: 'a-brand-new-password' })).status, 302);
  });
  await step('admin: view the site as a person, then return to admin', async () => {
    const r = await admin.post('/admin/users/' + agentUid + '/impersonate', {});
    assert.equal(r.status, 302);
    const home = await (await admin.req('/')).text();
    assert.match(home, /Return to admin/);
    assert.equal((await admin.req('/admin')).status, 404, 'impersonated user is not an admin');
    const back = await admin.post('/stop-impersonating', {});
    assert.equal(back.status, 302);
    assert.equal((await admin.req('/admin')).status, 200, 'back as administrator');
  });
  await step('admin: edit a lodge, feature it and bring it back after the reports', async () => {
    assert.equal((await admin.req('/admin/listings/' + lodgeUid + '/edit')).status, 200);
    assert.equal((await admin.post('/admin/listings/' + lodgeUid + '/feature', {})).status, 302);
    assert.equal((await admin.post('/admin/listings/' + lodgeUid + '/restore', {})).status, 302);
    const home = await (await visitor.req('/')).text();
    assert.match(home, /Smoke test self-contain/);
  });
  await step('admin: change the site name, WhatsApp number and colours; the whole site follows', async () => {
    const g = await admin.post('/admin/settings/general', { name: 'Oikres Test', tagline: 'Lodges', description: 'A description for search engines.', domain: 'oikres.com', whatsapp: '08011112222', whatsappMessage: 'Hello from {site}', supportEmail: 'help@oikres.com', footerNote: 'Made in Awka' });
    assert.equal(g.status, 302);
    const help = await (await visitor.req('/help')).text();
    assert.match(help, /https:\/\/wa\.me\/2348011112222\?text=Hello%20from%20Oikres%20Test/);
    const home = await (await visitor.req('/')).text();
    assert.match(home, /Oikres Test/);
    assert.match(home, /Made in Awka/);
    const light = { primary: 'rgba(220, 38, 38, 0.9)', bg: '#FFF7ED', surface: '#FFFFFF', text: '#1C1917', muted: '#57534E', border: '#E7E5E4' };
    const dark = { primary: '#FB923C', bg: '#1C1917', surface: '#292524', text: '#FAFAF9', muted: '#A8A29E', border: '#44403C' };
    const form = { radius: '20' };
    Object.keys(light).forEach((k) => { form['light_' + k] = light[k]; form['dark_' + k] = dark[k]; });
    assert.equal((await admin.post('/admin/settings/theme', form)).status, 302);
    const themed = await (await visitor.req('/')).text();
    assert.match(themed, /--primary:rgba\(220, 38, 38, 0.9\)/);
    assert.match(themed, /--primary:#fb923c|--primary:#FB923C/i);
    const manifest = await (await visitor.req('/manifest.webmanifest')).json();
    assert.equal(manifest.name, 'Oikres Test');
    const junk = { ...form, light_primary: 'red;}body{display:none' };
    await admin.post('/admin/settings/theme', junk);
    assert.ok(!(await (await visitor.req('/')).text()).includes('red;}body{display:none'), 'invalid colours are refused');
    assert.equal((await lister.req('/admin/settings')).status, 302);
    const outsider = new Client(base); await outsider.page('/register'); await outsider.post('/register', { name: 'Out', email: 'out' + Date.now() + '@example.com', password: 'another-password', terms: 'on' });
    assert.equal((await outsider.req('/admin/settings')).status, 404, 'non-admins cannot open settings');
    assert.equal((await admin.post('/admin/settings/reset-theme', {})).status, 302);
  });
  await step('admin: pause sign-ups, then maintenance mode, then switch both back', async () => {
    await admin.post('/admin/settings/rules', { reconfirmEveryDays: '14', hideAfterDays: '30', reportsToAutoHide: '3', minPhotos: '3', reviewRequired: 'on' });
    const closed = new Client(base);
    assert.equal((await closed.req('/register')).status, 403);
    await admin.post('/admin/settings/rules', { reconfirmEveryDays: '14', hideAfterDays: '30', reportsToAutoHide: '3', minPhotos: '3', registrationOpen: 'on', reviewRequired: 'on' });
    assert.equal((await closed.req('/register')).status, 200);
    await admin.post('/admin/settings/notices', { announcementEnabled: 'on', announcementText: 'Holiday hours apply', announcementTone: 'warn', maintenanceEnabled: 'on', maintenanceMessage: 'Back soon' });
    const m = await visitor.req('/');
    assert.equal(m.status, 503);
    assert.match(await m.text(), /Back soon/);
    assert.equal((await admin.req('/admin')).status, 200, 'admins are not locked out');
    await admin.post('/admin/settings/notices', { announcementEnabled: 'on', announcementText: 'Holiday hours apply', announcementTone: 'warn' });
    const ok = await (await visitor.req('/')).text();
    assert.match(ok, /Holiday hours apply/);
    await admin.post('/admin/settings/notices', {});
    assert.ok(!(await (await visitor.req('/')).text()).includes('Holiday hours apply'));
  });
  await step('admin: broadcast a message', async () => {
    const r = await admin.post('/admin/broadcast', { audience: 'all', title: 'Welcome', body: 'Thanks for joining', link: '/help' });
    assert.equal(r.status, 302);
    const bad = await admin.post('/admin/broadcast', { audience: 'all', title: 'x', link: 'https://evil.example' });
    assert.equal(bad.status, 422);
  });
  await step('admin: delete a lodge for good and erase a person completely', async () => {
    assert.equal((await admin.post('/admin/listings/' + lodgeUid + '/delete', {})).status, 302);
    assert.equal((await visitor.req('/lodges/' + slug)).status, 404);
    const refused = await admin.post('/admin/users/' + agentUid + '/purge', { confirm: 'nope' });
    assert.equal(refused.status, 302);
    assert.ok(uidOf(await (await admin.req('/admin/users?q=' + encodeURIComponent(email))).text(), email), 'not erased without the confirmation word');
    assert.equal((await admin.post('/admin/users/' + agentUid + '/purge', { confirm: 'DELETE' })).status, 302);
    assert.ok(!uidOf(await (await admin.req('/admin/users?q=' + encodeURIComponent(email))).text(), email), 'erased');
    const fileGone = await visitor.req(photoIds[0].url);
    assert.equal(fileGone.status, 404, 'uploaded photos were removed with the account');
    await fileGone.arrayBuffer();
  });
  return { slug, lodgeUid };
}

module.exports = { runFlow, Client };
