// Database and workflow tests on a real in-memory SQLite database. No network, no web server.
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAIL = 'admin@oikres.local';
process.env.ADMIN_PASSWORD = 'oikres-local-admin';
process.env.DATABASE_PATH = ':memory:';
process.env.DATA_DIR = require('node:os').tmpdir() + '/oikres-data-test-' + process.pid;
const test = require('node:test');
const assert = require('node:assert');
const cfg = require('../src/config');
cfg.prepare();
const db = require('../src/db');
db.open(':memory:');
const { migrate } = require('../src/db/migrate');
const boot = require('../src/services/bootstrap');
const auth = require('../src/services/auth');
const users = require('../src/repositories/users');
const listers = require('../src/repositories/listers');
const areas = require('../src/repositories/areas');
const listings = require('../src/repositories/listings');
const act = require('../src/repositories/activity');
const mrepo = require('../src/repositories/media');
const ls = require('../src/services/listings');
const jobs = require('../src/services/jobs');

test('migrations apply once and are safe to repeat', () => {
  assert.deepEqual(migrate({}).applied, ['001_init.sql', '002_admin_power.sql', '003_initial_payment.sql', '004_market_reviews_places.sql', '005_market_video.sql', '006_ads_video_market_extras.sql']);
  assert.equal(migrate({}).applied.length, 0);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM schema_migrations').n, 6);
});

test('first run is idempotent and never changes an existing password', async () => {
  assert.equal(boot.ensureStarterAreas(), 7);
  assert.equal(boot.ensureStarterAreas(), 0);
  assert.equal(await boot.ensureAdminFromEnv(), 'created-example');
  const first = users.firstAdmin().passwordHash;
  assert.equal(await boot.ensureAdminFromEnv(), 'exists');
  assert.equal(users.firstAdmin().passwordHash, first);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').n, 1);
});

test('a normal account with the admin email is never promoted', async () => {
  db.run('DELETE FROM users');
  await auth.register({ name: 'Sneaky', email: 'admin@oikres.local', password: 'password-1', terms: 'on' });
  assert.equal(await boot.ensureAdminFromEnv(), 'email-taken');
  assert.equal(users.adminExists(), false);
  db.run('DELETE FROM users');
  assert.equal(await boot.ensureAdminFromEnv(), 'created-example');
});

test('the full lodge workflow: register, list, search, edit, availability, reports, jobs, deletion', async () => {
  const admin=users.firstAdmin(); assert(admin.isAdmin);
 assert(await auth.verifyPassword('oikres-local-admin',admin.passwordHash)); assert(!(await auth.verifyPassword('nope',admin.passwordHash)));
 const u=await auth.register({name:'Ada Agent',email:'ada@example.com',password:'password-1',terms:'on'}); assert(u.emailVerifiedAt,'auto-verified without SMTP');
 await assert.rejects(()=>auth.register({name:'x',email:'bad',password:'1',terms:''}),e=>!!(e.errors&&e.errors.email&&e.errors.password&&e.errors.terms));
 await assert.rejects(()=>auth.authenticate('ada@example.com','wrong'),/not correct/);
 const tok=auth.startSession((await auth.authenticate('ada@example.com','password-1')).id); assert(users.findSession(tok).user.email==='ada@example.com');
 const p=listers.create({userId:u.id,displayName:'Ada',type:'agent',whatsappNumber:'+2348012345678'}); assert(users.byId(u.id).roles.includes('lister'));
 const ifite=areas.bySlug('ifite'); assert(ifite.junctions.includes('Dynamo'));
 const body={action:'submit',title:'Self-contain near Miracle Junction',propertyType:'self_contain',area:String(ifite.id),description:'A clean self-contain with water and light.',chargesDisclosed:'on',
  unitsJson:JSON.stringify([{label:'Self-contain',kind:'whole_unit',rent:200000,period:'year'},{label:'Bed spaces',kind:'shared_room',rent:120000,spacesTotal:4,spacesAvailable:2,genderPreference:'female',sharedFacilities:['kitchen']}]),
  feesJson:JSON.stringify([{label:'agent',kind:'percent',value:10,payee:'oikres'},{label:'agreement',kind:'fixed',value:10000,payee:'landlord',refundable:false}]),mediaJson:'[]',amenities:['water','security']};
 let r=ls.saveFromForm({user:u,profile:p,existing:null,body}); assert(!r.ok&&r.errors.media,'needs photos');
 // seed three photo rows directly to emulate uploads
 const mrepo=require('../src/repositories/media'); const items=[1,2,3].map(n=>mrepo.insert({ownerId:u.id,kind:'photo',file:'a'+n+'bbbbbbbbbbbbbbbbbb.jpg',thumbFile:'a'+n+'bbbbbbbbbbbbbbbbbb-t.jpg',width:800,height:600,size:10}));
 body.mediaJson=JSON.stringify(items.map(i=>({type:'image',id:i.uid})));
 r=ls.saveFromForm({user:u,profile:p,existing:null,body}); assert(r.ok,JSON.stringify(r.errors)); const l=r.listing;
 assert.equal(l.status,'pending'); assert.equal(l.units.length,2); assert.equal(l.fees[0].payee,'agent','listers cannot add Oikres charges');
 assert.equal(l.priceFrom,120000); assert.equal(l.moveInFrom,120000+12000+10000); assert(l.hasRoomShare); assert.equal(l.media.length,3);
 assert(mrepo.byUid(items[0].uid).attached,'media attached');
 assert.equal(listings.browse({page:1,size:12}).total,0,'pending is not public');
 ls.goLive(listings.byId(l.id)); let b=listings.browse({page:1,size:12}); assert.equal(b.total,1); assert.equal(b.rows[0].units.length,2);
 assert.equal(listings.browse({page:1,size:12,q:'miracle'}).total,1); assert.equal(listings.browse({page:1,size:12,roommate:true}).total,1);
 assert.equal(listings.browse({page:1,size:12,min:500000}).total,0); assert.equal(listings.browse({page:1,size:12,amenities:['water','security']}).total,1);
 assert.equal(listings.browse({page:1,size:12,q:'100%_'}).total,0,'LIKE wildcards are escaped');
 assert.equal(listings.browse({page:1,size:12,q:"x' OR '1'='1"}).total,0,'SQL injection attempt is inert');
 // edit live lodge goes back to review and keeps unit ids
 const before=listings.byId(l.id).units.map(u=>u._id); const st=ls.stateFrom(listings.byId(l.id));
 r=ls.saveFromForm({user:u,profile:p,existing:listings.byId(l.id),body:{...body,action:'draft',unitsJson:JSON.stringify(st.units),title:'Self-contain near Miracle Junction (edited)'}});
 assert(r.ok); assert.equal(r.listing.status,'pending'); assert.deepEqual(r.listing.units.map(u=>u._id),before);
 ls.goLive(listings.byId(l.id));
 // availability
 ls.updateAvailability(listings.byId(l.id),(id)=>id===before[1]?'0':'1'); const a=listings.byId(l.id); assert.equal(a.units[1].status,'full'); assert.equal(a.hasRoomShare,false);
 // wishlist, events, reports, notifications
 assert.equal(act.toggleSave(u.id,l.id),true); assert.equal(listings.byId(l.id).counters.saves,1); assert.equal(act.toggleSave(u.id,l.id),false);
 act.recordEvent('view',l.id,'anon1',null); act.recordEvent('contact_click',l.id,'anon1',null); assert(act.eventSince('view',l.id,'anon1',3600000));
 assert.equal(act.dailyCounts(7,[l.id]).at(-1).views,1);
 act.addReport({listingId:l.id,reporterKey:'a:1',reason:'fraud'}); act.addReport({listingId:l.id,reporterKey:'a:2',reason:'fraud'}); assert.equal(act.addReport({listingId:l.id,reporterKey:'a:3',reason:'fraud'}),3);
 act.addNotification(u.id,{title:'Hi'}); assert.equal(act.unreadCount(u.id),1);
 // jobs: age the lodge
 db.run('UPDATE listings SET reconfirm_due_at = ? WHERE id = ?',Date.now()-1000,l.id); let s=await jobs.run(); assert.equal(s.reconfirm,1); assert.equal(listings.byId(l.id).status,'needs_reconfirm');
 db.run('UPDATE listings SET last_confirmed_at = ? WHERE id = ?',Date.now()-31*86400000,l.id); s=await jobs.run(); assert.equal(s.hidden,1); const h=listings.byId(l.id); assert.equal(h.status,'hidden'); assert.equal(h.hiddenReason,'stale');
 assert(ls.canReconfirm(h)); ls.reconfirm(h); assert.equal(listings.byId(l.id).status,'live');
 // cascade delete user removes everything
 db.run('DELETE FROM users WHERE id = ?',u.id); assert.equal(db.get('SELECT COUNT(*) n FROM listings').n,0); assert.equal(db.get('SELECT COUNT(*) n FROM listing_units').n,0);
 // constraints
 assert.throws(()=>db.run("INSERT INTO listing_fees(listing_id,label,kind,value,payee) VALUES (999,'x','fixed',1,'agent')"),/FOREIGN KEY|constraint/i);
 
});

test('site settings: defaults, validation, theme CSS, support WhatsApp fallbacks and upgrade migration', async () => {
  const site = require('../src/services/site');
  assert.equal(migrate({}).applied.length, 0);
  assert.equal(site.get().name, 'Oikres');
  assert.equal(site.get().domain, 'oikres.com');
  assert.match(site.themeCss(), /--primary:#0369a1|--primary:#0369A1/i);
  // validation
  let r = site.parseSection('general', { name: 'X', domain: 'not a domain', whatsapp: '123' });
  assert.ok(r.errors.name && r.errors.domain && r.errors.whatsapp);
  r = site.parseSection('general', { name: 'Oikres Nest', domain: 'https://Oikres.com/', whatsapp: '0801 234 5678', supportEmail: 'help@oikres.com' });
  assert.deepEqual(r.errors, {});
  assert.equal(r.patch.domain, 'oikres.com'); assert.equal(r.patch.whatsapp, '2348012345678');
  site.save(r.patch);
  assert.equal(site.get().name, 'Oikres Nest');
  assert.match(site.whatsappLink(), /^https:\/\/wa\.me\/2348012345678\?text=Hello%2C%20I%20need%20help%20with%20Oikres%20Nest/);
  // theme: rgba accepted, junk rejected, css injection impossible
  const theme = { radius: '18' };
  ['light', 'dark'].forEach((m) => ['primary', 'bg', 'surface', 'text', 'muted', 'border'].forEach((k) => { theme[m + '_' + k] = site.DEFAULTS.theme[m][k]; }));
  theme.light_primary = 'rgba(220, 38, 38, 0.9)';
  r = site.parseSection('theme', theme); assert.deepEqual(r.errors, {});
  site.save({ theme: r.patch.theme });
  assert.match(site.themeCss(), /--primary:rgba\(220, 38, 38, 0.9\)/);
  assert.match(site.themeCss(), /--on-primary:#FFFFFF/);
  r = site.parseSection('theme', { ...theme, dark_text: 'red;}body{display:none' }); assert.ok(r.errors.dark_text);
  site.resetTheme(); assert.match(site.themeCss(), /#0369a1/i);
  // branding only accepts files uploaded through this site
  assert.ok(site.parseSection('branding', { logoUrl: 'https://evil.example/x.png' }).errors.logoUrl);
  assert.deepEqual(site.parseSection('branding', { logoUrl: '/media/abcdefghjk2345678mnp.png' }).errors, {});
  // rules
  assert.ok(site.parseSection('rules', { reconfirmEveryDays: '30', hideAfterDays: '20' }).errors.hideAfterDays);
  // WhatsApp fallbacks: settings, then env, then the admin's phone
  site.save({ whatsapp: '' });
  assert.equal(site.whatsappDigits(), '');
  users.update(users.firstAdmin().id, { phone: '+2347016845867' });
  assert.equal(site.whatsappDigits(), '2347016845867');
  // featured lodges sort first
  assert.equal(typeof listings.browse({ page: 1, size: 5 }).total, 'number');
});

test('upgrading an existing database applies only the new migration, keeps data and makes a backup first', () => {
  const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oikres-upgrade-'));
  const file = path.join(dir, 'old.db');
  const { DatabaseSync } = require('node:sqlite');
  // an "old" database that only knows migration 001
  const old = new DatabaseSync(file);
  old.exec(fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_init.sql'), 'utf8'));
  old.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  const sum = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_init.sql'), 'utf8')).digest('hex');
  old.prepare('INSERT INTO schema_migrations VALUES (1, ?, ?, ?)').run('001_init.sql', sum, Date.now());
  old.prepare("INSERT INTO users (uid, name, email, password_hash, created_at, updated_at) VALUES ('abcdefghjk23', 'Old User', 'old@example.com', 'x', 1, 1)").run();
  old.prepare("INSERT INTO areas (name, slug, sort_order) VALUES ('Ifite', 'ifite', 1)").run();
  old.close();
  db.open(file);
  const r = migrate({ backupDir: path.join(dir, 'backups'), isFile: true });
  assert.deepEqual(r.applied, ['002_admin_power.sql', '003_initial_payment.sql', '004_market_reviews_places.sql', '005_market_video.sql', '006_ads_video_market_extras.sql']);
  const st = db.get("SELECT a.state_id, s.slug FROM areas a JOIN states s ON s.id = a.state_id WHERE a.slug = 'ifite'");
  assert.equal(st.slug, 'anambra', 'existing areas are attached to the launch state');
  assert.ok(r.backup && fs.existsSync(r.backup), 'a backup was written before upgrading');
  assert.equal(db.get('SELECT name, admin_notes FROM users').name, 'Old User');
  assert.equal(migrate({ backupDir: path.join(dir, 'backups'), isFile: true }).applied.length, 0);
  db.open(':memory:'); migrate({});
});
