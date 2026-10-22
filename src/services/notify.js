const cfg = require('../config');
const act = require('../repositories/activity');
const users = require('../repositories/users');
const { sendMail, wrap, esc } = require('./mail');
const log = require('../lib/log');

// In-app notification, plus an email when the user allows it.
async function notify(userId, { type, title, body, link, emailToo = true }) {
  try {
    act.addNotification(userId, { type, title, body, link });
    if (!emailToo) return;
    const user = users.byId(userId);
    if (!user || user.status !== 'active' || !user.notificationPrefs.email) return;
    const url = link ? cfg.baseUrl + link : cfg.baseUrl;
    await sendMail({ to: user.email, subject: title, text: title + '\n\n' + body + '\n\n' + url, html: wrap(title, '<p>' + esc(body) + '</p>', link ? { url, label: 'Open Oikres' } : null) });
  } catch (err) { log.error('notify failed:', err.message); }
}
const audit = (actor, action, targetType, targetId, detail) => { try { act.addAudit(actor, action, targetType, targetId, detail); } catch (err) { log.error('audit failed:', err.message); } };
module.exports = { notify, audit };
