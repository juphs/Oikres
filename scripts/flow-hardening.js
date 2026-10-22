// Third walk over HTTP: who may reach what, CSRF, other people's data, hostile input, odd requests, headers, and a crawler that fails on any error page.
const assert = require('node:assert/strict');
const { Client } = require('./flow');

const DENIED = [301, 302, 303, 307, 401, 403, 404];
const HOSTILE = ['<img src=x onerror=alert(1)>', '"><script>alert(1)</script>', "'; DROP TABLE users; --", '</script><script>alert(2)</script>', '{{7*7}}<%= 7*7 %>'];

async function runHardening(base, { adminEmail, adminPassword }, log = () => {}) {
  const step = async (name, fn) => { await fn(); log(name); };
  const visitor = new Client(base); const alice = new Client(base); const bob = new Client(base); const admin = new Client(base);
  const stamp = Date.now(); const pw = 'a-good-password';
  const em = (n) => n + stamp + '@example.com';
  const signUp = async (c, name, email) => { await c.page('/register'); assert.equal((await c.post('/register', { name, email, password: pw, terms: 'on' })).status, 302); };
  const myUid = async (c) => (await c.page('/account')).html.match(/href="\/u\/([a-z0-9]{12})"/)[1];
  const slugOf = async (c, title) => ((await (await c.req('/market/mine')).text()).match(new RegExp('href="/market/(' + title + '[a-z0-9-]*)/edit"')) || [])[1];
  const sellerFields = async (c, extra) => { const ph = await (await c.upload('item')).json(); const st = (await c.page('/market/sell')).html.match(/<option value="(\d+)" selected>/)?.[1] || (await c.page('/market/sell')).html.match(/<option value="(\d+)"[^>]*>[A-Z]/)[1];
    return { category: 'books', condition: 'new', price: '1000', description: 'A perfectly ordinary description of the item.', state: st, whatsapp: '08012345678', mediaJson: JSON.stringify([{ type: 'image', id: ph.id, url: ph.url }]), ...extra }; };

  await admin.page('/login'); await admin.post('/login', { email: adminEmail, password: adminPassword });
  await signUp(alice, 'Alice <b>Bold</b>', em('alice')); await signUp(bob, 'Bob Builder', em('bob'));
  const aliceUid = await myUid(alice); const bobUid = await myUid(bob);

  await step('admin pages are closed to visitors and to ordinary users', async () => {
    const pages = ['/admin', '/admin/listings', '/admin/users', '/admin/listers', '/admin/market', '/admin/ads', '/admin/ads/new', '/admin/reports', '/admin/reference', '/admin/popup', '/admin/broadcast', '/admin/settings', '/admin/audit', '/admin/users/' + aliceUid];
    for (const p of pages) {
      const v = await visitor.req(p); assert.ok(DENIED.includes(v.status), 'visitor ' + p + ' -> ' + v.status); await v.arrayBuffer();
      const u = await bob.req(p); assert.ok(DENIED.includes(u.status), 'user ' + p + ' -> ' + u.status); await u.arrayBuffer();
      const a = await admin.req(p); assert.equal(a.status, 200, 'admin ' + p); await a.arrayBuffer();
    }
  });

  await step('admin actions do nothing for ordinary users (and changed nothing)', async () => {
    for (const [p, form] of [['/admin/popup', { enabled: 'on', title: 'Hacked' }], ['/admin/ads', { title: 'Evil ad', body: 'x', linkType: 'none' }], ['/admin/reference/state', { name: 'Hackland' }],
      ['/admin/users/' + aliceUid + '/ban', { reason: 'fraud' }], ['/admin/users/' + aliceUid + '/make_admin', {}], ['/admin/settings/rules', { reviewRequired: '' }], ['/admin/popup/reset', {}]]) {
      const r = await bob.post(p, form); assert.ok(DENIED.includes(r.status), p + ' -> ' + r.status); await r.arrayBuffer();
      const v = await visitor.req(p, { method: 'POST', form }); assert.ok(DENIED.includes(v.status) || v.status === 403, 'visitor POST ' + p + ' -> ' + v.status); await v.arrayBuffer();
    }
    assert.ok(!(await (await visitor.req('/')).text()).includes('Evil ad')); assert.ok(!(await (await visitor.req('/?state=hackland')).text()).includes('Hackland'));
    assert.ok(!(await (await admin.req('/admin/users/' + aliceUid)).text()).includes('Banned 2'), 'alice was not banned');
    assert.match(await (await visitor.req('/u/' + aliceUid)).text(), /Alice/, 'alice still has a public profile');
  });

  await step('forms need a valid CSRF token', async () => {
    const f = await sellerFields(alice, { title: 'CSRF probe item' });
    const noToken = await alice.req('/market/sell', { method: 'POST', form: f }); assert.equal(noToken.status, 403); await noToken.arrayBuffer();
    const wrong = await alice.req('/market/sell', { method: 'POST', form: { ...f, _csrf: 'f'.repeat(36) + '.' + 'a'.repeat(24) } }); assert.equal(wrong.status, 403); await wrong.arrayBuffer();
    for (const p of ['/u/' + bobUid + '/review', '/account/notifications', '/admin/popup']) { const r = await alice.req(p, { method: 'POST', form: { rating: '5' } }); assert.ok([403, 404].includes(r.status), p + ' ' + r.status); await r.arrayBuffer(); }
    assert.ok(!(await (await visitor.req('/market?q=CSRF+probe')).text()).includes('CSRF probe item'));
    const j = await alice.req('/api/media/upload', { method: 'POST', body: new FormData() }); assert.ok([400, 403].includes(j.status), 'upload without token ' + j.status); await j.arrayBuffer();
  });

  await step('nobody can change, delete, renew or sell another person\'s item', async () => {
    assert.equal((await alice.post('/market/sell', await sellerFields(alice, { title: 'Alice private item' }))).status, 302);
    const slug = await slugOf(alice, 'alice-private-item'); assert.ok(slug);
    for (const action of ['edit', 'sold', 'relist', 'renew', 'delete']) { const r = await bob.post('/market/' + slug + '/' + action, await sellerFields(bob, { title: 'Hijack' })); assert.equal(r.status, 404, action); await r.arrayBuffer(); }
    assert.equal((await bob.req('/market/' + slug + '/edit')).status, 404);
    assert.match(await (await visitor.req('/market/' + slug)).text(), /Alice private item/, 'still there, unchanged');
    assert.ok(!(await (await visitor.req('/market/' + slug)).text()).includes('Hijack'));
    // someone else's uploaded photo cannot be attached to your item
    const alicePhoto = await (await alice.upload('item')).json();
    const f = await sellerFields(bob, { title: 'Stolen photo item', mediaJson: JSON.stringify([{ type: 'image', id: alicePhoto.id, url: alicePhoto.url }]) });
    const r = await bob.post('/market/sell', f); assert.equal(r.status, 422); await r.arrayBuffer();
    // a review can only be deleted by its author
    await bob.post('/u/' + aliceUid + '/review', { rating: '4', body: 'Fine' });
    await visitor.page('/login'); const before = await (await visitor.req('/u/' + aliceUid)).text(); assert.match(before, /Fine/);
    await alice.post('/u/' + aliceUid + '/review/delete', {}); assert.match(await (await visitor.req('/u/' + aliceUid)).text(), /Fine/, 'alice cannot delete bob\'s review');
    // saved items are private to each account
    assert.equal((await bob.post('/market/' + slug + '/save', {})).status, 200);
    assert.ok(!(await (await alice.req('/saved?tab=items')).text()).includes('Alice private item'), 'bob\'s saved items are not shown to alice');
    assert.ok([401, 403].includes((await visitor.req('/market/' + slug + '/save', { method: 'POST', form: {} })).status), 'a visitor cannot save items');
  });

  await step('text people write is always escaped (items, reviews, names, ads, popup, reports, search)', async () => {
    for (const [i, bad] of HOSTILE.entries()) {
      const title = 'xss' + i + ' ' + bad;
      const r = await alice.post('/market/sell', await sellerFields(alice, { title, description: 'desc ' + bad + ' more text here', pickup: bad }));
      assert.ok([302, 422].includes(r.status), 'item ' + r.status); await r.arrayBuffer();
    }
    await bob.post('/u/' + aliceUid + '/review', { rating: '3', body: HOSTILE.join(' ') });
    const listing = await (await visitor.req('/market?q=xss0')).text();
    assert.match(listing, /xss0 &lt;img src=x onerror=alert\(1\)&gt;/, 'the hostile item exists and is shown as harmless text');
    assert.match(await (await visitor.req('/u/' + aliceUid)).text(), /Alice &lt;b&gt;Bold&lt;\/b&gt;/, 'a name with tags is shown as text');
    assert.match(await (await visitor.req('/u/' + aliceUid)).text(), /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, 'a review with a script tag is shown as text');
    const pages = ['/market', '/market?q=' + encodeURIComponent(HOSTILE[1]), '/u/' + aliceUid, '/?q=' + encodeURIComponent(HOSTILE[0]), '/market?campus=' + encodeURIComponent(HOSTILE[3])];
    const mine = await (await alice.req('/market/mine')).text(); pages.push('/market/mine');
    const slug = (mine.match(/href="\/market\/(xss0[a-z0-9-]*)"/) || [])[1]; if (slug) pages.push('/market/' + slug);
    for (const p of pages) {
      const c = p === '/market/mine' ? alice : visitor; const html = await (await c.req(p)).text();
      assert.ok(!html.includes('<img src=x onerror'), 'raw img tag on ' + p);
      assert.ok(!html.includes('"><script>alert'), 'raw script on ' + p);
      assert.ok(!/<script>alert\(\d\)<\/script>/.test(html), 'script tag on ' + p);
      assert.ok(!html.includes('</script><script>alert'), 'script break-out on ' + p);
      assert.ok(!html.includes('<b>Bold</b>'), 'raw tags from a name on ' + p);
    }
    // admin-written content too
    await admin.post('/admin/ads', { title: 'Ad ' + HOSTILE[0], body: HOSTILE[1], sponsor: HOSTILE[3], badge: 'x', linkType: 'none', placement: 'both' });
    const ph = await (await admin.upload('item')).json();
    await admin.post('/admin/popup', { enabled: 'on', title: HOSTILE[0], intro: HOSTILE[1], buttonLabel: 'ok', itemIcon: ['home'], itemTitle: [HOSTILE[3]], itemText: [HOSTILE[0]] });
    const helpHtml = await (await visitor.req('/help')).text(); const frag = await (await visitor.req('/welcome')).text(); const home = await (await visitor.req('/')).text();
    for (const [n, h] of [['help', helpHtml], ['welcome', frag], ['home', home]]) { assert.ok(!h.includes('<img src=x onerror'), n); assert.ok(!/<script>alert\(\d\)<\/script>/.test(h), n); assert.ok(!h.includes('</script><script>alert'), n); }
    await admin.post('/admin/popup/reset', {});
    // report notes and the admin pages that show them
    await visitor.post('/u/' + aliceUid + '/report', { reason: 'fraud', note: HOSTILE[0] + HOSTILE[1] });
    const rep = await (await admin.req('/admin/reports?type=user')).text(); assert.ok(!rep.includes('<img src=x onerror') && !/<script>alert\(\d\)<\/script>/.test(rep));
    const usr = await (await admin.req('/admin/users/' + aliceUid)).text(); assert.ok(!usr.includes('<b>Bold</b>'));
    // server-side template syntax is not evaluated
    const tpl = await (await visitor.req('/market?q=' + encodeURIComponent('<%= 7*7 %>'))).text(); assert.ok(!tpl.includes('value="49"'));
  });

  await step('odd and hostile requests get a clean answer, never a server error', async () => {
    const q = [];
    q.push(['/market?q=' + encodeURIComponent("' OR 1=1 --")], ['/market?q=%27%22%5C%25%5F'], ['/?q=' + 'a'.repeat(5000)], ['/market?min=-5&max=abc&sort=%00&category[]=x&condition[a]=b'], ['/?area=' + encodeURIComponent("1' UNION SELECT * FROM users--")],
      ['/market?page=-1'], ['/market?page=99999999999999999999'], ['/?page=abc&partial=1'], ['/market?partial=1&page=3'], ['/u/%00'], ['/u/..%2f..%2fetc%2fpasswd'], ['/market/%00'], ['/lodges/%ff%fe'], ['/market/' + 'x'.repeat(3000)],
      ['/media/..%2f..%2fetc%2fpasswd'], ['/media/%2e%2e%2f%2e%2e%2fpackage.json'], ['/js/..%2f..%2fpackage.json'], ['/css/../../package.json'], ['/ads/abcdefghijkl/go'], ['/welcome?preview=1'], ['/admin/market/%00'], ['/nope/nope/nope']);
    for (const [p] of q) { const r = await visitor.req(p); assert.ok(r.status < 500, p.slice(0, 60) + ' -> ' + r.status); const t = await r.text(); assert.ok(!/at .*\(\/.*\.js:\d+/.test(t) && !/SQLITE|SqliteError/.test(t), 'internals leaked on ' + p.slice(0, 50)); }
    for (const m of ['PUT', 'DELETE', 'PATCH']) for (const p of ['/', '/market', '/market/sell', '/u/' + aliceUid, '/admin']) { const r = await visitor.req(p, { method: m }); assert.ok(r.status < 500, m + ' ' + p + ' ' + r.status); await r.arrayBuffer(); }
    // broken form data
    const sell = await sellerFields(alice, { title: 'Broken json item', mediaJson: '{not json' }); const r1 = await alice.post('/market/sell', sell); assert.equal(r1.status, 422); await r1.arrayBuffer();
    for (const bad of [{ price: '-5' }, { price: '1e9' }, { price: '9'.repeat(40) }, { title: 'x'.repeat(10000) }, { description: '\u0000\u0001 control chars \u202e', pickup: '\n\n\n' }, { whatsapp: '0'.repeat(50) }, { state: '999999' }, { category: '__proto__' }, { condition: ['a', 'b'] }]) {
      const r = await alice.post('/market/sell', await sellerFields(alice, { title: 'Odd values item', ...bad })); assert.ok([302, 422].includes(r.status), JSON.stringify(bad).slice(0, 40) + ' -> ' + r.status); await r.arrayBuffer();
    }
    for (const body of ['not json', '{"a":', '[]', 'null']) { const r = await alice.req('/api/media/sign', { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-csrf-token': alice.token } }); assert.ok(r.status < 500, 'sign ' + body + ' ' + r.status); await r.arrayBuffer(); }
    const rr = await alice.post('/u/' + bobUid + '/review', { rating: { a: 1 }, body: ['x', 'y'] }); assert.ok(rr.status < 500); await rr.arrayBuffer();
    const big = await alice.req('/market/sell', { method: 'POST', body: 'x='.padEnd(5_000_000, 'a'), headers: { 'content-type': 'application/x-www-form-urlencoded' } }); assert.ok(big.status < 500, 'huge body ' + big.status); await big.arrayBuffer();
    const fake = new FormData(); fake.append('kind', 'itemvideo'); fake.append('file', new Blob([Buffer.from('MZ this is an exe')], { type: 'video/mp4' }), 'x.mp4');
    const up = await alice.req('/api/media/upload', { method: 'POST', body: fake, headers: { 'x-csrf-token': alice.token } }); assert.equal(up.status, 415, 'a file that is not a video is refused even when it says it is'); await up.arrayBuffer();
    const php = new FormData(); php.append('kind', 'item'); php.append('file', new Blob(['<?php echo 1; ?>'], { type: 'image/jpeg' }), 'x.php.jpg');
    const up2 = await alice.req('/api/media/upload', { method: 'POST', body: php, headers: { 'x-csrf-token': alice.token } }); assert.equal(up2.status, 415); await up2.arrayBuffer();
  });

  await step('security headers and cookies', async () => {
    const r = await visitor.req('/market'); const h = r.headers; await r.arrayBuffer();
    assert.match(h.get('content-security-policy') || '', /default-src 'self'/); assert.match(h.get('content-security-policy') || '', /frame-ancestors 'none'|frame-ancestors 'self'/);
    assert.match(h.get('content-security-policy') || '', /script-src 'self'(?![^;]*unsafe-inline)/, 'no inline scripts allowed');
    assert.equal(h.get('x-content-type-options'), 'nosniff'); assert.ok(h.get('referrer-policy')); assert.ok(!h.get('x-powered-by'), 'framework is not advertised');
    const login = await new Client(base).req('/login', { method: 'POST', form: { email: 'x', password: 'y' } }); await login.arrayBuffer();
    const c = new Client(base); await c.page('/login'); const res = await c.req('/login', { method: 'POST', form: { _csrf: c.token, email: adminEmail, password: adminPassword } });
    const cookies = (res.headers.getSetCookie ? res.headers.getSetCookie() : []).join('\n'); assert.match(cookies, /HttpOnly/i); assert.match(cookies, /SameSite=(Lax|Strict)/i);
    const m = await visitor.req('/media/' + (await (await alice.upload('item')).json()).url.split('/media/')[1], {}); assert.equal(m.status, 200); assert.equal(m.headers.get('x-content-type-options'), 'nosniff'); await m.arrayBuffer();
  });

  await step('a crawler finds no error page, leaked template text, or broken link for visitors, users and admins', async () => {
    const crawl = async (c, seeds, max) => {
      const seen = new Set(); const q = [...seeds]; const bad = [];
      while (q.length && seen.size < max) {
        const p = q.shift(); if (seen.has(p)) continue; seen.add(p);
        const r = await c.req(p); const ct = r.headers.get('content-type') || ''; const txt = ct.includes('html') ? await r.text() : (await r.arrayBuffer(), '');
        if (r.status >= 500) bad.push(p + ' -> ' + r.status);
        if (r.status === 200 && ct.includes('html')) {
          if (/\[object Object\]|\bundefined\b(?![-.])|<%[=-]?|NaN(?!\w)/.test(txt.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' '))) bad.push(p + ' shows template junk');
          for (const m of txt.matchAll(/<a [^>]*href="(\/[^"#]*)"/g)) { const h = m[1].replace(/&amp;/g, '&'); if (!/^\/(logout|api\/|media\/|ads\/|stop-impersonating|.*\/whatsapp$)/.test(h) && !seen.has(h) && q.length < 400) q.push(h); }
        }
      }
      assert.deepEqual(bad, [], bad.join('\n')); return seen.size;
    };
    const n1 = await crawl(visitor, ['/', '/market', '/help', '/login', '/register', '/privacy', '/terms'], 120);
    const n2 = await crawl(alice, ['/', '/account', '/market/mine', '/saved', '/saved?tab=items', '/account/notifications', '/market/sell'], 120);
    const n3 = await crawl(admin, ['/admin', '/admin/popup', '/admin/ads', '/admin/market', '/admin/reports', '/admin/reference', '/admin/settings', '/admin/audit', '/admin/users'], 200);
    assert.ok(n1 > 15 && n2 > 10 && n3 > 25, 'the crawl covered pages: ' + [n1, n2, n3]);
  });
}

module.exports = { runHardening };
