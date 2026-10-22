const path = require('path');
const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const cfg = require('./config');
const db = require('./db');
const log = require('./lib/log');
const { uid } = require('./lib/util');
const sec = require('./middleware/security');
const core = require('./middleware/core');

function createApp() {
  const app = express();
  app.set('trust proxy', cfg.trustProxy);
  app.set('query parser', 'simple');
  app.set('view engine', 'ejs');
  app.set('views', path.join(cfg.root, 'views'));
  app.disable('x-powered-by');

  app.use(core.requestLog);
  app.use(sec.headers());
  app.use(compression());
  app.get('/healthz', (req, res) => { const ok = db.ping(); res.status(ok ? 200 : 503).json({ ok }); });
  app.use(express.static(path.join(cfg.root, 'public'), { maxAge: cfg.isProd ? '30d' : 0, index: false }));
  app.use('/media', require('./routes/media'));

  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false, limit: '300kb', parameterLimit: 500 }));
  app.use(express.json({ limit: '100kb' }));
  app.use(core.locals);
  app.use(core.anon);
  app.use(core.csrf);
  app.use(core.sessionLoader);
  app.use(core.impersonation);
  app.use(core.flash);
  app.use(core.maintenance);

  app.use('/api', require('./routes/api'));
  app.use('/', require('./routes/auth'));
  app.use('/account', require('./routes/account'));
  app.use('/lister', require('./routes/lister'));
  app.use('/market', require('./routes/market'));
  app.use('/', require('./routes/profile'));
  app.use('/admin', require('./routes/admin'));
  app.use('/', require('./routes/public'));

  app.use((req, res) => res.status(404).render('404', { title: 'Page not found', noindex: true }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    const ref = uid(8);
    if (status >= 500) log.error('[' + ref + '] ' + req.method + ' ' + req.path + ' failed:', err && err.stack ? err.stack : err);
    const message = err.expose || status < 500 ? err.message : cfg.isProd ? 'Something went wrong on our side. Please try again.' : err.message;
    if (req.originalUrl.startsWith('/api/')) return res.status(status).json({ error: message, ref: status >= 500 ? ref : undefined });
    res.status(status).render('error', { title: 'Something went wrong', noindex: true, status, message, errorRef: status >= 500 ? ref : '' }, (renderErr, html) => {
      if (renderErr) return res.type('text/plain').send(message + (status >= 500 ? ' (reference ' + ref + ')' : ''));
      res.send(html);
    });
  });
  return app;
}
module.exports = createApp;
