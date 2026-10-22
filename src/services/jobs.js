const C = require('../config/constants');
const cfg = require('../config');
const listings = require('../repositories/listings');
const market = require('../repositories/market');
const users = require('../repositories/users');
const listers = require('../repositories/listers');
const act = require('../repositories/activity');
const media = require('./media');
const site = require('./site');
const settings = require('../db');
const { notify, audit } = require('./notify');
const { backupTo, prune } = require('../db/backup');
const path = require('path');
const log = require('../lib/log');

const DAY = 86400000;

// Every step is idempotent and safe to repeat, so overlapping runs and restarts do no harm.
async function run() {
  const summary = {};
  try {
    let n = 0;
    for (const l of listings.dueReconfirm()) {
      if (listings.markNeedsReconfirm(l.id)) {
        n++;
        await notify(l.lister_id, { type: 'reconfirm', title: 'Is "' + l.title + '" still available?', body: 'Tap to confirm in one step. Lodges not confirmed within ' + (site.rules().hideAfterDays - site.rules().reconfirmEveryDays) + ' more days are hidden from search.', link: '/lister/lodges' });
      }
    }
    summary.reconfirm = n;
    n = 0;
    for (const l of listings.staleCandidates(site.rules().hideAfterDays)) {
      if (listings.hideStale(l.id)) {
        n++;
        await notify(l.lister_id, { type: 'reconfirm', title: '"' + l.title + '" was hidden', body: 'It was not confirmed in time. Confirm it is available to show it again.', link: '/lister/lodges' });
        audit(null, 'listing.auto_hidden_stale', 'Listing', l.id, l.title);
      }
    }
    summary.hidden = n;
    // Tell sellers a few days before an item drops out of the market (once per item), and tidy the old view counters.
    n = 0;
    for (const it of market.expiringSoon(C.RULES.marketExpireWarnDays)) {
      market.update(it.id, { expiryNotifiedAt: Date.now() });
      await notify(it.seller_id, { type: 'item', title: '"' + it.title + '" expires soon', body: 'Still for sale? Renew it in one tap to keep it in the market for another ' + C.RULES.marketExpireDays + ' days.', link: '/market/mine' });
      n++;
    }
    summary.itemsExpiring = n;
    summary.marketEvents = market.purgeEvents();
    summary.sessions = users.purgeSessions();
    summary.tokens = users.purgeTokens();
    summary.events = act.purgeEvents();
    summary.orphans = media.purgeOrphans();
    n = 0;
    for (const p of listers.dueForPurge()) {
      media.removePrivateFile(p.verification.idDocument.publicId);
      listers.clearId(p.id);
      audit(null, 'id_document.purged', 'ListerProfile', p.id, '');
      n++;
    }
    summary.idPurged = n;
    if (cfg.isProd && cfg.dbFile !== ':memory:') {
      const last = Number((settings.get("SELECT value FROM settings WHERE key = 'last_backup'") || {}).value || 0);
      if (Date.now() - last > DAY) {
        backupTo(path.join(cfg.backupsDir, 'daily-' + new Date().toISOString().slice(0, 10) + '.db'));
        prune(cfg.backupsDir, 'daily-', 7);
        settings.run("INSERT INTO settings (key, value) VALUES ('last_backup', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(Date.now()));
        summary.backup = true;
      }
    }
  } catch (err) { log.error('Scheduled job failed:', err); }
  return summary;
}

let timers = [];
function start() {
  timers.push(setTimeout(run, 15 * 1000), setInterval(run, 6 * 3600 * 1000));
  timers.forEach((t) => t.unref && t.unref());
}
function stop() { timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); timers = []; }

module.exports = { run, start, stop };
