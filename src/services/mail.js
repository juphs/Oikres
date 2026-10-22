const cfg = require('../config');
const log = require('../lib/log');

let transport = null;
function getTransport() {
  if (!cfg.mail.enabled) return null;
  if (!transport) {
    const nodemailer = require('nodemailer');
    transport = nodemailer.createTransport({ host: cfg.smtp.host, port: cfg.smtp.port, secure: cfg.smtp.port === 465, auth: cfg.smtp.user ? { user: cfg.smtp.user, pass: cfg.smtp.pass } : undefined });
  }
  return transport;
}
function siteLine() { try { const s = require('./site').get(); return s.name + ' · ' + s.domain; } catch (e) { return 'Oikres'; } }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function wrap(title, bodyHtml, button) {
  const btn = button ? '<p style="margin:24px 0"><a href="' + esc(button.url) + '" style="background:#0369A1;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">' + esc(button.label) + '</a></p>' : '';
  return '<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#0F172A"><h2 style="margin:0 0 12px">' + esc(title) + '</h2>' + bodyHtml + btn + '<p style="color:#5B6B7C;font-size:13px;margin-top:32px">' + esc(siteLine()) + '</p></div>';
}

// Never throws: a mail failure must not break a request.
async function sendMail({ to, subject, text, html }) {
  try {
    const t = getTransport();
    if (!t) {
      if (cfg.isProd) log.warn('Email not sent (SMTP is not configured): "' + subject + '"');
      else if (!cfg.isTest) console.log('\n  [email preview - SMTP is not configured, nothing was sent]\n  To: ' + to + '\n  Subject: ' + subject + '\n  ' + String(text).replace(/\n/g, '\n  ') + '\n');
      return;
    }
    await t.sendMail({ from: cfg.smtp.from, to, subject, text, html });
  } catch (err) {
    log.error('Mail failed:', err.message);
  }
}
module.exports = { sendMail, wrap, esc };
