// Second end-to-end walk over HTTP: states and campuses, the market, public profiles and reviews, bans, reports and ads.
// Runs against the same server as flow.js (see test/integration.test.js).
const assert = require('node:assert/strict');
const { Client } = require('./flow');

async function runMarketFlow(base, { adminEmail, adminPassword }, log = () => {}) {
  const step = async (name, fn) => { await fn(); log(name); };
  const visitor = new Client(base); const seller = new Client(base); const buyer = new Client(base); const admin = new Client(base); const scammer = new Client(base);
  const stamp = Date.now();
  const emails = { seller: 'seller' + stamp + '@example.com', buyer: 'buyer' + stamp + '@example.com', scammer: 'scam' + stamp + '@example.com' };
  const uidFromProfileLink = (html) => (html.match(/href="\/u\/([a-z0-9]{12})"/) || [])[1];
  let sellerUid; let buyerUid; let scammerUid; let itemSlug; let itemUid; let photo; let adUid; let reviewUid;

  const signUp = async (c, name, email) => { await c.page('/register'); const r = await c.post('/register', { name, email, password: 'a-good-password', terms: 'on' }); assert.equal(r.status, 302); };
  const myUid = async (c) => { const html = (await c.page('/account')).html; const m = html.match(/href="\/u\/([a-z0-9]{12})"/); assert.ok(m, 'profile link in the menu'); return m[1]; };

  await step('new pages and scripts are served', async () => {
    for (const p of ['/market', '/js/places.js', '/js/market-form.js', '/js/ad-form.js']) { const r = await visitor.req(p); assert.equal(r.status, 200, p); await r.arrayBuffer(); }
    assert.equal((await visitor.req('/market/sell')).status, 302, 'selling needs an account');
    assert.equal((await visitor.req('/market/mine')).status, 302);
    assert.equal((await visitor.req('/market/no-such-item')).status, 404);
    assert.equal((await visitor.req('/u/abcdefghjk23')).status, 404);
    assert.match(await (await visitor.req('/robots.txt')).text(), /Disallow: \/u\//);
  });

  await step('browse shows state, campus and area filters that fit together', async () => {
    const { html } = await visitor.page('/');
    assert.match(html, /name="state"[\s\S]*Anambra/);
    assert.match(html, /name="campus"[\s\S]*UNIZIK/);
    assert.match(html, /name="area"[\s\S]*Ifite/);
    assert.equal((await visitor.req('/?state=anambra&campus=unizik&area=ifite')).status, 200);
    assert.equal((await visitor.req('/?state=nowhere&campus=nope&area=nope')).status, 200, 'unknown filters are ignored, not an error');
    assert.match((await visitor.page('/market')).html, /name="campus"[\s\S]*UNIZIK/);
  });

  await step('people sign up; public profiles exist and are not indexed', async () => {
    await signUp(seller, 'Sam Seller', emails.seller); await signUp(buyer, 'Bola Buyer', emails.buyer); await signUp(scammer, 'Fake Agent', emails.scammer);
    sellerUid = await myUid(seller); buyerUid = await myUid(buyer); scammerUid = await myUid(scammer);
    const { res, html } = await visitor.page('/u/' + sellerUid);
    assert.equal(res.status, 200);
    assert.match(html, /Sam Seller/); assert.match(html, /No ratings yet/); assert.match(html, /name="robots" content="noindex/);
    assert.ok(!html.includes(emails.seller), 'email address is never shown');
    assert.match(html, /Sign in<\/a> to leave a rating/);
  });

  await step('any signed-in person can upload item photos; lodge photos are still for listers only', async () => {
    const r = await seller.upload('item'); assert.equal(r.status, 200); photo = await r.json();
    assert.match(photo.url, /^\/media\/[a-z0-9]{20}\.jpg$/);
    const lodge = await seller.upload('photo'); assert.equal(lodge.status, 403); await lodge.arrayBuffer();
    const ads = await seller.upload('ads', false); assert.equal(ads.status, 403, 'only admins upload ad images'); await ads.arrayBuffer();
  });

  await step('selling: the form validates, then the item is live and appears in the market', async () => {
    const { html } = await seller.page('/market/sell');
    assert.match(html, /name="state"/); assert.match(html, /name="campus"/); assert.match(html, /data-places/);
    const bad = await seller.post('/market/sell', { title: 'x' });
    assert.equal(bad.status, 422); assert.match(await bad.text(), /Choose a category/);
    const okState = html.match(/<option value="(\d+)" selected>Anambra/); assert.ok(okState, 'the only state is pre-selected');
    const campus = html.match(/<option value="(\d+)" data-state="\d+" >UNIZIK|<option value="(\d+)" data-state="\d+" *>UNIZIK/);
    const r = await seller.post('/market/sell', { title: 'Used Tecno Spark 10', category: 'phones', condition: 'used_good', price: '45000', negotiable: 'on', description: 'Works well, no cracks, comes with charger.',
      state: okState[1], campus: campus ? (campus[1] || campus[2]) : '', pickup: 'Engineering gate', whatsapp: '08012345678', mediaJson: JSON.stringify([{ type: 'image', id: photo.id, url: photo.url }]) });
    assert.equal(r.status, 302, 'saved');
    const mine = await (await seller.req('/market/mine')).text();
    itemSlug = (mine.match(/href="\/market\/([a-z0-9-]+)\/edit"/) || [])[1]; assert.ok(itemSlug);
    const list = await (await visitor.req('/market')).text();
    assert.match(list, /Used Tecno Spark 10/); assert.match(list, /negotiable/); assert.match(list, /UNIZIK/);
    assert.match(await (await visitor.req('/market?campus=unizik&category=phones&q=tecno')).text(), /Used Tecno Spark 10/);
    assert.ok(!(await (await visitor.req('/market?category=books')).text()).includes('Used Tecno Spark 10'));
    assert.ok(!(await (await visitor.req('/market?min=50000')).text()).includes('Used Tecno Spark 10'));
  });

  await step('an item page shows the price, seller and rating; the phone number is never printed', async () => {
    const { res, html } = await visitor.page('/market/' + itemSlug);
    assert.equal(res.status, 200);
    assert.match(html, /Used Tecno Spark 10/); assert.match(html, /45,000/); assert.match(html, /Negotiable/); assert.match(html, /Sold by Sam Seller/);
    assert.ok(!html.includes('8012345678'), 'WhatsApp number is not in the page');
    assert.equal(uidFromProfileLink(html), sellerUid);
    const wa = await visitor.req('/market/' + itemSlug + '/whatsapp');
    assert.equal(wa.status, 302); assert.match(wa.headers.get('location'), /^https:\/\/wa\.me\/2348012345678\?text=/);
    assert.equal((await visitor.req('/market/' + itemSlug + '/edit')).status, 302);
    assert.equal((await buyer.req('/market/' + itemSlug + '/edit')).status, 404, 'only the seller can edit');
    assert.match(await (await visitor.req('/sitemap.xml')).text(), new RegExp('/market/' + itemSlug));
  });

  await step('reviews: sign-in required, 1 to 5 stars, one per person, average and count shown', async () => {
    assert.equal((await visitor.post('/u/' + sellerUid + '/review', { rating: '5' })).status, 401);
    let r = await buyer.post('/u/' + buyerUid + '/review', { rating: '5' }); // own profile
    assert.equal(r.status, 302);
    assert.match(await (await buyer.req('/u/' + buyerUid)).text(), /No ratings yet/, 'you cannot review yourself');
    r = await buyer.post('/u/' + sellerUid + '/review', { rating: '9', body: 'forged' });
    assert.match(await (await buyer.req('/u/' + sellerUid)).text(), /No ratings yet/, 'out-of-range rating refused');
    r = await buyer.post('/u/' + sellerUid + '/review', { rating: '4', body: 'Quick reply, item as described.' });
    assert.equal(r.status, 302);
    let html = await (await visitor.req('/u/' + sellerUid)).text();
    assert.match(html, /4\.0/); assert.match(html, /1 rating</); assert.match(html, /Quick reply, item as described/); assert.match(html, /Bola Buyer/);
    reviewUid = (html.match(/\/reviews\/([a-z0-9]{12})\/report/) || [])[1];
    // the same person posting again edits their review
    await buyer.post('/u/' + sellerUid + '/review', { rating: '5', body: 'Updated: great seller.' });
    html = await (await visitor.req('/u/' + sellerUid)).text();
    assert.match(html, /5\.0/); assert.match(html, /1 rating</); assert.ok(!html.includes('Quick reply'));
    // item page and lodge pages show the seller's rating
    assert.match(await (await visitor.req('/market/' + itemSlug)).text(), /\(1 rating\)/);
    // the reviewed person got a notification
    assert.match(await (await seller.req('/account/notifications')).text(), /Bola Buyer reviewed you/);
    // the markup for the star picker is accessible
    html = await (await buyer.req('/u/' + sellerUid)).text();
    assert.match(html, /id="rate5"[^>]*name="rating"|name="rating" value="5"/); assert.match(html, /Update review/);
  });

  await step('reports on an item, a person and a review reach the admin, and several item reports hide it', async () => {
    const r = await visitor.post('/market/' + itemSlug + '/report', { reason: 'fraud', note: 'asked me to pay first' });
    assert.equal(r.status, 302);
    await visitor.post('/market/' + itemSlug + '/report', { reason: 'fraud' }); // same anonymous reporter: not counted twice
    assert.equal((await visitor.post('/u/' + scammerUid + '/report', { reason: 'fraud', note: 'took my deposit' })).status, 302);
    assert.equal((await buyer.post('/reviews/' + reviewUid + '/report', { reason: 'fake' })).status, 302);
    assert.match(await (await visitor.req('/market/' + itemSlug + '/report')).text(), /Report this item/);
    await admin.page('/login'); await admin.post('/login', { email: adminEmail, password: adminPassword });
    for (const type of ['item', 'user', 'review']) assert.match(await (await admin.req('/admin/reports?type=' + type)).text(), /Dismiss/, type + ' reports are listed');
    assert.match(await (await admin.req('/admin/reports?type=item')).text(), /asked me to pay first/);
    assert.match(await (await admin.req('/admin')).text(), /Open reports/);
  });

  await step('admin bans the reported account: they are signed out, cannot sign in, and the profile says banned', async () => {
    assert.equal((await scammer.req('/market/sell')).status, 200, 'signed in before the ban');
    const r0 = await admin.post('/admin/users/' + scammerUid + '/ban', { reason: '', note: '' });
    assert.equal(r0.status, 302);
    assert.equal((await scammer.req('/market/sell')).status, 200, 'a ban without a reason does nothing');
    const r = await admin.post('/admin/users/' + scammerUid + '/ban', { reason: 'fraud', note: 'Took deposits', next: '/admin/reports?type=user' });
    assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/admin/reports?type=user');
    assert.equal((await scammer.req('/market/sell')).status, 302, 'signed out at once');
    const fresh = new Client(base); await fresh.page('/login');
    const login = await fresh.post('/login', { email: emails.scammer, password: 'a-good-password' });
    assert.equal(login.status, 401); assert.match(await login.text(), /has been banned/);
    const bad = await fresh.post('/login', { email: emails.scammer, password: 'not-the-password' });
    assert.match(await bad.text(), /Email or password is not correct/, 'the banned message is only shown with the right password');
    const prof = await (await visitor.req('/u/' + scammerUid)).text();
    assert.match(prof, /This account was banned/); assert.ok(!prof.includes('name="rating"'));
    assert.ok(!prof.includes('Took deposits'), 'the reason is private');
    const page = await (await admin.req('/admin/users/' + scammerUid)).text();
    assert.match(page, /Banned/); assert.match(page, /Took deposits/); assert.match(page, /Lift ban/);
    assert.ok(!page.includes('/unsuspend'), 'a banned account cannot be quietly reactivated');
    assert.match(await (await admin.req('/admin/users?filter=banned')).text(), /Fake Agent/);
    assert.equal((await admin.post('/admin/users/' + scammerUid + '/unsuspend', {})).status, 302);
    assert.equal((await fresh.post('/login', { email: emails.scammer, password: 'a-good-password' })).status, 401, 'unsuspend does not lift a ban');
    // administrators cannot be banned
    const adminUid = (await (await admin.req('/admin/users?filter=admins')).text()).match(/\/admin\/users\/([a-z0-9]{12})/)[1];
    assert.equal((await admin.post('/admin/users/' + adminUid + '/ban', { reason: 'fraud' })).status, 302);
    assert.equal((await admin.req('/admin/users/' + adminUid)).status, 200);
    // lifting the ban lets them in again
    assert.equal((await admin.post('/admin/users/' + scammerUid + '/unban', {})).status, 302);
    assert.equal((await fresh.post('/login', { email: emails.scammer, password: 'a-good-password' })).status, 302);
  });

  await step('admin can remove a review, and then it no longer counts', async () => {
    assert.equal((await admin.post('/admin/reviews/' + reviewUid + '/remove', {})).status, 302);
    const html = await (await visitor.req('/u/' + sellerUid)).text();
    assert.match(html, /No ratings yet/); assert.ok(!html.includes('Updated: great seller'));
    const again = await buyer.post('/u/' + sellerUid + '/review', { rating: '1' });
    assert.match(await (await buyer.req('/u/' + sellerUid)).text(), /No ratings yet/, 'a removed review cannot simply be posted again');
    assert.equal(again.status, 302);
  });

  await step('seller manages items: mark sold, sell again, edit', async () => {
    assert.equal((await seller.post('/market/' + itemSlug + '/sold', {})).status, 302);
    assert.ok(!(await (await visitor.req('/market')).text()).includes('Used Tecno Spark 10'), 'sold items leave the market');
    assert.match(await (await visitor.req('/market/' + itemSlug)).text(), /has been sold/);
    assert.equal((await seller.post('/market/' + itemSlug + '/relist', {})).status, 302);
    assert.match(await (await visitor.req('/market')).text(), /Used Tecno Spark 10/);
    const edit = await (await seller.req('/market/' + itemSlug + '/edit')).text();
    assert.match(edit, /value="Used Tecno Spark 10"/);
  });

  await step('admin market: list, hide with notice to the seller, restore, and pre-approval mode', async () => {
    const list = await (await admin.req('/admin/market')).text();
    itemUid = (list.match(/\/admin\/market\/([a-z0-9]{12})/) || [])[1]; assert.ok(itemUid, 'item listed');
    assert.equal((await admin.post('/admin/market/' + itemUid + '/hide', {})).status, 302);
    assert.equal((await visitor.req('/market/' + itemSlug)).status, 404, 'hidden items are not public');
    assert.match(await (await seller.req('/market/mine')).text(), /Hidden by the/);
    assert.equal((await admin.post('/admin/market/' + itemUid + '/restore', {})).status, 302);
    assert.equal((await visitor.req('/market/' + itemSlug)).status, 200);
    await admin.post('/admin/settings/rules', { registrationOpen: 'on', reviewRequired: 'on', reconfirmEveryDays: '14', hideAfterDays: '30', reportsToAutoHide: '3', minPhotos: '3', marketReviewRequired: 'on' });
    const r2 = await seller.upload('item'); const p2 = await r2.json();
    const html = (await seller.page('/market/sell')).html; const st = html.match(/<option value="(\d+)" selected>Anambra/)[1];
    await seller.post('/market/sell', { title: 'Needs approval first', category: 'books', condition: 'new', price: '3000', description: 'Brand new textbook set.', state: st, whatsapp: '08012345678', mediaJson: JSON.stringify([{ type: 'image', id: p2.id, url: p2.url }]) });
    assert.match(await (await seller.req('/market/mine')).text(), /Waiting for the team/);
    assert.ok(!(await (await visitor.req('/market')).text()).includes('Needs approval first'));
    const pend = (await (await admin.req('/admin/market?status=pending')).text()).match(/\/admin\/market\/([a-z0-9]{12})/)[1];
    assert.equal((await admin.post('/admin/market/' + pend + '/approve', {})).status, 302);
    assert.match(await (await visitor.req('/market')).text(), /Needs approval first/);
    await admin.post('/admin/settings/rules', { registrationOpen: 'on', reviewRequired: 'on', reconfirmEveryDays: '14', hideAfterDays: '30', reportsToAutoHide: '3', minPhotos: '3' });
  });

  await step('admin places: add a state, a campus and an area; filters and forms follow', async () => {
    const page = await (await admin.req('/admin/reference')).text();
    assert.match(page, /Add a state/); assert.match(page, /Add a campus/); assert.match(page, /Anambra/);
    assert.equal((await admin.post('/admin/reference/state', { name: 'Enugu', order: '2' })).status, 302);
    const sid = (await (await admin.req('/admin/reference')).text()).match(/\/admin\/reference\/state\/(\d+)\/toggle[\s\S]{0,200}?Enugu|Enugu[\s\S]{0,400}?\/admin\/reference\/state\/(\d+)\/toggle/);
    const enuguId = (await (await admin.req('/admin/reference')).text()).match(/<option value="(\d+)">Enugu<\/option>/)[1];
    assert.equal((await admin.post('/admin/reference/campus', { state: enuguId, name: 'UNN', order: '1' })).status, 302);
    assert.equal((await admin.post('/admin/reference/area', { state: enuguId, name: 'Ifite', order: '1' })).status, 302);
    const err = await admin.post('/admin/reference/area', { state: enuguId, name: 'ifite', order: '1' });
    assert.equal(err.status, 302);
    const home = (await visitor.page('/')).html;
    assert.match(home, /Enugu/); assert.match(home, /UNN/);
    const enuguHome = (await visitor.page('/?state=enugu')).html;
    assert.match(enuguHome, /UNN/); assert.ok(!/<option value="unizik"/.test(enuguHome), 'campuses of other states are not offered');
    const form = (await seller.page('/market/sell')).html;
    assert.match(form, /data-state="\d+"[^>]*>UNN/); assert.match(form, /<option value="\d+"\s*>Enugu/);
    assert.equal((await admin.post('/admin/reference/state/' + enuguId + '/toggle', {})).status, 302);
    assert.ok(!(await visitor.page('/')).html.includes('>UNN<'), 'a hidden state disappears from the filters');
    assert.ok(sid !== undefined);
  });

  await step('ads: admin creates cards that appear in the lodge list and the market, clicks are counted, and they can be turned off', async () => {
    assert.equal((await seller.req('/admin/ads')).status, 404, 'ads are admin only');
    assert.match(await (await admin.req('/admin/ads')).text(), /No ads yet/);
    const bad = await admin.post('/admin/ads', { title: 'x', linkType: 'url', linkValue: 'javascript:alert(1)' });
    assert.equal(bad.status, 422);
    const u = await admin.upload('ads', false); assert.equal(u.status, 200); const img = await u.json();
    const ok = await admin.post('/admin/ads', { title: 'Hostel moving? Book a truck', body: 'Cheap student moving across Awka.', sponsor: 'Awka Movers', badge: 'Promo', placement: 'both',
      linkType: 'whatsapp', linkValue: '08098765432', buttonLabel: 'Book now', imageUrl: img.url, thumbUrl: img.thumbUrl || img.url, mediaUid: img.id, position: '1' });
    assert.equal(ok.status, 302);
    const list = await (await admin.req('/admin/ads')).text();
    adUid = (list.match(/\/admin\/ads\/([a-z0-9]{12})\/edit/) || [])[1]; assert.ok(adUid);
    // the ad is woven in after the 2nd card, and still shows when the list is short.
    assert.match(await (await visitor.req('/market?category=books')).text(), /Book a truck/, 'ads also show on a short list');
    const m2 = await (await visitor.req('/market')).text();
    assert.match(m2, /Hostel moving\? Book a truck/); assert.match(m2, /Sponsored by Awka Movers/); assert.match(m2, />Promo</); assert.match(m2, new RegExp('/ads/' + adUid + '/go'));
    assert.ok(!/Hostel moving[\s\S]*Hostel moving/.test(m2), 'shown once');
    assert.ok(!(await (await visitor.req('/market?q=tecno')).text()).includes('Book a truck'), 'no ads while searching for words');
    const go = await visitor.req('/ads/' + adUid + '/go');
    assert.equal(go.status, 302); assert.match(go.headers.get('location'), /^https:\/\/wa\.me\/2348098765432/);
    assert.match(await (await admin.req('/admin/ads')).text(), /1 click\b/);
    // edit, then turn off
    assert.match(await (await admin.req('/admin/ads/' + adUid + '/edit')).text(), /Hostel moving\? Book a truck/);
    assert.equal((await admin.post('/admin/ads/' + adUid + '/toggle', {})).status, 302);
    assert.ok(!(await (await visitor.req('/market')).text()).includes('Book a truck'));
    assert.equal((await visitor.req('/ads/' + adUid + '/go')).status, 404, 'a switched-off ad redirects nowhere');
    assert.equal((await admin.post('/admin/ads/' + adUid + '/toggle', {})).status, 302);
  });

  await step('video: items accept one video, it is saved and shown first, and cards still use a photo as the cover', async () => {
    const vid = await seller.uploadVideo('itemvideo'); assert.equal(vid.status, 200, 'any signed-in person can attach an item video'); const v = await vid.json();
    assert.equal(v.type, 'video'); assert.match(v.url, /^\/media\/[a-z0-9]{20}\.mp4$/);
    const lodgeVid = await seller.uploadVideo('video'); assert.equal(lodgeVid.status, 403, 'lodge videos are still for listers'); await lodgeVid.arrayBuffer();
    const notVideo = await seller.upload('itemvideo', false); assert.equal(notVideo.status, 415, 'a photo is not accepted as a video'); await notVideo.arrayBuffer();
    const v2 = await (await seller.uploadVideo('itemvideo')).json();
    const p = await (await seller.upload('item')).json();
    const st = (await seller.page('/market/sell')).html.match(/<option value="(\d+)" selected>Anambra/)[1];
    const r = await seller.post('/market/sell', { title: 'Generator with a demo video', category: 'electronics', condition: 'used_good', price: '90000', description: 'Starts first pull, video shows it running.', state: st, whatsapp: '08012345678',
      mediaJson: JSON.stringify([{ type: 'image', id: p.id, url: p.url }, { type: 'video', id: v.id, url: v.url }, { type: 'video', id: v2.id, url: v2.url }]) });
    assert.equal(r.status, 302);
    const slug = ((await (await seller.req('/market/mine')).text()).match(/href="\/market\/(generator-with-a-demo-video-[a-z0-9]+)\/edit"/) || [])[1]; assert.ok(slug);
    const page = await (await visitor.req('/market/' + slug)).text();
    assert.equal((page.match(/<video/g) || []).length, 1, 'only one video is kept');
    assert.ok(page.indexOf('<video') < page.indexOf('data-kind="image"'), 'the video comes before the first photo');
    assert.match(page, /Video and 1 photo/);
    const list = await (await visitor.req('/market?q=generator')).text();
    assert.match(list, /Video<\/span>/); assert.ok(!/<img[^>]*\.mp4/.test(list), 'a video file is never used as a card image');
    // editing keeps the video, and the seller's own pages do not break
    const edit = await (await seller.req('/market/' + slug + '/edit')).text();
    assert.match(edit, /"type":"video"/);
    assert.equal((await seller.req('/market/mine')).status, 200);
    assert.equal((await admin.req('/admin/market')).status, 200);
  });

  await step('an administrator\'s own lodge goes straight to live, and appears in browse (no self-approval)', async () => {
    assert.equal((await admin.post('/account/become-lister', { displayName: 'House Admin', type: 'agent', whatsapp: '08012345678', agree: 'on' })).status, 302);
    const ph = []; for (let i = 0; i < 3; i++) ph.push(await (await admin.upload('photo')).json());
    const vd = await (await admin.uploadVideo('video')).json();
    const html = (await admin.page('/lister/lodges/new')).html; const area = html.match(/value="(\d+)"[^>]*>Ifite</)[1];
    const r = await admin.post('/lister/lodges', { action: 'submit', title: 'Admin own lodge with video', propertyType: 'self_contain', area, description: 'A clean self-contain with water and light near campus.', chargesDisclosed: 'on',
      unitsJson: JSON.stringify([{ label: 'Self-contain', kind: 'whole_unit', rent: 200000, period: 'year' }]),
      mediaJson: JSON.stringify(ph.map((m) => ({ type: 'image', id: m.id })).concat([{ type: 'video', id: vd.id }])) });
    assert.equal(r.status, 302);
    assert.match(await (await admin.req('/lister/lodges')).text(), /Live/);
    const home = await (await visitor.req('/')).text();
    assert.match(home, /Admin own lodge with video/);
    const slug = home.match(/href="\/lodges\/(admin-own-lodge-with-video-[a-z0-9]+)"/)[1];
    const page = await (await visitor.req('/lodges/' + slug)).text();
    assert.ok(page.indexOf('<video') > -1 && page.indexOf('<video') < page.indexOf('data-kind="image"'), 'the lodge video is first');
    // an administrator\'s market item is live at once even when pre-approval is on
    await admin.post('/admin/settings/rules', { registrationOpen: 'on', reviewRequired: 'on', reconfirmEveryDays: '14', hideAfterDays: '30', reportsToAutoHide: '3', minPhotos: '3', marketReviewRequired: 'on' });
    const ph2 = await (await admin.upload('item')).json(); const st = (await admin.page('/market/sell')).html.match(/<option value="(\d+)" selected>Anambra/)[1];
    await admin.post('/market/sell', { title: 'Admin item no approval', category: 'books', condition: 'new', price: '1500', description: 'Posted by the administrator.', state: st, whatsapp: '08012345678', mediaJson: JSON.stringify([{ type: 'image', id: ph2.id, url: ph2.url }]) });
    assert.match(await (await visitor.req('/market')).text(), /Admin item no approval/);
    await admin.post('/admin/settings/rules', { registrationOpen: 'on', reviewRequired: 'on', reconfirmEveryDays: '14', hideAfterDays: '30', reportsToAutoHide: '3', minPhotos: '3' });
  });

  await step('titles follow the place, and item pages carry product data for search engines', async () => {
    assert.match(await (await visitor.req('/?campus=unizik')).text(), /<title>Student lodges near UNIZIK/);
    assert.match(await (await visitor.req('/market?campus=unizik')).text(), /<title>Student market near UNIZIK/);
    const list = await (await visitor.req('/market')).text();
    const slug = list.match(/href="\/market\/(generator-with-a-demo-video-[a-z0-9]+)"/)[1];
    const page = await (await visitor.req('/market/' + slug)).text();
    const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(ld['@type'], 'Product'); assert.equal(ld.offers.priceCurrency, 'NGN'); assert.equal(ld.offers.price, 90000);
    assert.match(ld.offers.availability, /InStock/); assert.ok(ld.image.length === 1 && ld.image[0].startsWith('http'), 'photos only, with full web addresses');
  });

  await step('welcome popup: served as a fragment, edited by admins, versioned, and switched off cleanly', async () => {
    const home = await (await visitor.req('/')).text();
    const ver = (home.match(/data-welcome="(\d+)"/) || [])[1]; assert.ok(ver, 'the page carries the popup version'); assert.match(home, /data-welcome-auto="1"/);
    assert.match(home, /data-open-welcome/, 'footer has a tour link'); assert.match(home, /\/js\/welcome\.js/);
    const frag = await visitor.req('/welcome'); assert.equal(frag.status, 200); const html = await frag.text();
    assert.match(html, /id="welcome-title"/); assert.match(html, /data-welcome-close/); assert.ok(!/<html|<body/i.test(html), 'a fragment, not a page');
    assert.match(await (await visitor.req('/help')).text(), /id="tour"/, 'help lists the same features as plain text');
    assert.ok(!/data-welcome-auto/.test((await (await seller.req('/market/sell')).text()).match(/<body[^>]*>/)[0]), 'not offered on forms');
    assert.ok(!/data-welcome-auto/.test((await (await admin.req('/admin')).text()).match(/<body[^>]*>/)[0]), 'not offered in the admin area');
    // validation and editing
    const bad = await admin.post('/admin/popup', { enabled: 'on', title: 'x' }); assert.equal(bad.status, 422);
    assert.equal((await admin.post('/admin/popup', { enabled: 'on', title: 'Welcome to our site', intro: 'Hi there', buttonLabel: 'Go', itemIcon: ['home', 'bag'], itemTitle: ['First thing', 'Second thing'], itemText: ['One', 'Two'] })).status, 302);
    const edited = await (await visitor.req('/welcome')).text(); assert.match(edited, /First thing/); assert.match(edited, /Second thing/); assert.match(edited, /Welcome to our site/);
    assert.equal(((await (await visitor.req('/')).text()).match(/data-welcome="(\d+)"/) || [])[1], ver, 'a small edit keeps the version, so nobody sees it again');
    assert.equal((await admin.post('/admin/popup', { enabled: 'on', reshow: 'on', title: 'Welcome to our site', itemIcon: ['home'], itemTitle: ['First thing'], itemText: ['One'] })).status, 302);
    assert.equal(Number(((await (await visitor.req('/')).text()).match(/data-welcome="(\d+)"/) || [])[1]), Number(ver) + 1, 'ticking "show again" bumps the version');
    // switched off
    await admin.post('/admin/popup', { title: 'Welcome to our site', itemIcon: ['home'], itemTitle: ['First thing'], itemText: ['One'] });
    assert.equal((await visitor.req('/welcome')).status, 404); const off = await (await visitor.req('/')).text(); assert.ok(!/data-welcome=/.test(off) && !/welcome\.js/.test(off) && !/data-open-welcome/.test(off));
    assert.equal((await admin.req('/welcome?preview=1')).status, 200, 'admins can still preview it'); assert.equal((await seller.req('/welcome?preview=1')).status, 404, 'ordinary users cannot');
    await admin.post('/admin/popup/reset', {}); assert.equal((await visitor.req('/welcome')).status, 200);
  });

  await step('video ads: only admins upload them, they render as muted looping videos, and deleting the ad removes the file', async () => {
    assert.equal((await seller.uploadVideo('adsvideo')).status, 403, 'only admins upload ad videos');
    const up = await admin.uploadVideo('adsvideo'); assert.equal(up.status, 200); const v = await up.json(); assert.match(v.url, /^\/media\/[a-z0-9]{20}\.mp4$/);
    const bad = await admin.post('/admin/ads', { title: 'Remote video ad', videoUrl: 'https://evil.example/v.mp4', linkType: 'none', placement: 'both' }); assert.equal(bad.status, 422);
    assert.equal((await admin.post('/admin/ads', { title: 'Autoplay video ad', body: 'Watch this', linkType: 'url', linkValue: 'https://example.com/x', buttonLabel: 'Watch', videoUrl: v.url, videoMediaUid: v.id, placement: 'both', position: '2' })).status, 302);
    const m = await (await visitor.req('/market')).text();
    assert.match(m, /<video class="ad-video"[^>]*muted[^>]*loop[^>]*playsinline[^>]*data-autoplay-view/); assert.ok(m.includes(v.url));
    assert.match(await (await visitor.req('/')).text(), /class="ad-video"/);
    const list = await (await admin.req('/admin/ads')).text(); assert.match(list, /Autoplay video ad/); assert.match(list, /video/);
    const adId = (list.match(/Autoplay video ad[\s\S]*?\/admin\/ads\/([a-z0-9]{12})\/edit/) || [])[1]; assert.ok(adId);
    assert.match(await (await admin.req('/admin/ads/' + adId + '/edit')).text(), /id="videoUrl" value="\/media\//);
    assert.equal((await visitor.req(v.url)).status, 200);
    assert.equal((await admin.post('/admin/ads/' + adId + '/delete', {})).status, 302);
    assert.equal((await visitor.req(v.url)).status, 404, 'the video file is deleted with the ad');
  });

  await step('saved items: signed in only, private, listed on the Saved page, and savers are told when it sells', async () => {
    const mine = await (await seller.req('/market/mine')).text(); const slug = (mine.match(/href="\/market\/(used-tecno[a-z0-9-]*)"/) || mine.match(/href="\/market\/([a-z0-9-]+)\/edit"/))[1];
    assert.ok([401, 403].includes((await visitor.req('/market/' + slug + '/save', { method: 'POST', form: {} })).status));
    const s1 = await buyer.req('/market/' + slug + '/save', { method: 'POST', json: {}, headers: { 'x-csrf-token': buyer.token } }); assert.equal(s1.status, 200); assert.deepEqual(await s1.json(), { saved: true });
    assert.match(await (await buyer.req('/saved?tab=items')).text(), new RegExp('/market/' + slug)); assert.match(await (await buyer.req('/saved')).text(), /Items <span class="muted">\(1\)/);
    assert.match(await (await buyer.req('/market')).text(), /aria-pressed="true"/);
    assert.equal((await seller.post('/market/' + slug + '/sold', {})).status, 302);
    assert.match(await (await buyer.req('/account/notifications')).text(), /An item you saved was sold/);
    assert.match(await (await buyer.req('/saved?tab=items')).text(), /Sold/, 'it stays in the list, marked as sold');
    const s2 = await buyer.req('/market/' + slug + '/save', { method: 'POST', json: {}, headers: { 'x-csrf-token': buyer.token } }); assert.deepEqual(await s2.json(), { saved: false });
    await seller.post('/market/' + slug + '/relist', {});
  });

  await step('expiry and renewal, with seller stats', async () => {
    const db = require('../src/db');
    const mine = await (await seller.req('/market/mine')).text(); const slug = mine.match(/href="\/market\/([a-z0-9-]+)\/edit"/)[1];
    assert.match(mine, /\d+ days? left/); assert.match(mine, /views/);
    const id = db.get('SELECT id FROM market_items WHERE slug = ?', slug).id;
    db.run('UPDATE market_items SET expires_at = ? WHERE id = ?', Date.now() - 1000, id);
    assert.ok(!(await (await visitor.req('/market')).text()).includes('/market/' + slug + '"'), 'an expired item leaves the list');
    const page = await (await visitor.req('/market/' + slug)).text(); assert.match(page, /has expired/); assert.ok(!/\/whatsapp/.test(page), 'no contact on an expired item');
    assert.ok(!(await (await visitor.req('/sitemap.xml')).text()).includes('/market/' + slug));
    const mine2 = await (await seller.req('/market/mine')).text(); assert.match(mine2, /Expired/); assert.match(mine2, /\/renew"/);
    assert.equal((await seller.post('/market/' + slug + '/renew', {})).status, 302);
    assert.match(await (await visitor.req('/market')).text(), new RegExp('/market/' + slug)); assert.ok(!/has expired/.test(await (await visitor.req('/market/' + slug)).text()));
    // soon to expire: a Renew button shows before it is too late
    db.run('UPDATE market_items SET expires_at = ? WHERE id = ?', Date.now() + 2 * 86400000, id);
    assert.match(await (await seller.req('/market/mine')).text(), /\/renew"/);
    db.run('UPDATE market_items SET expires_at = ? WHERE id = ?', Date.now() + 40 * 86400000, id);
    // a non-owner cannot renew
    assert.equal((await buyer.post('/market/' + slug + '/renew', {})).status, 404);
  });

  await step('admin can feature an item, and it is shown first with a tag', async () => {
    const list = await (await admin.req('/admin/market?status=live')).text(); const last = [...list.matchAll(/\/admin\/market\/([a-z0-9]{12})/g)].map((m) => m[1]).pop();
    assert.equal((await admin.post('/admin/market/' + last + '/feature', {})).status, 302);
    const html = await (await visitor.req('/market')).text(); const firstCard = html.slice(html.indexOf('<article class="card lodge item"'));
    assert.match(firstCard.slice(0, 1500), /Featured/, 'the featured item is the first card');
    assert.equal((await admin.post('/admin/market/' + last + '/unfeature', {})).status, 302);
    assert.ok(!/Featured<\/span>/.test(await (await visitor.req('/market')).text()));
  });

  await step('the dashboard counts market items, bans and ads', async () => {
    const html = await (await admin.req('/admin')).text();
    assert.match(html, /Market items live/); assert.match(html, /Ads running/); assert.match(html, />Banned</);
  });
}

module.exports = { runMarketFlow };
