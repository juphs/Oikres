const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cfg = require('../config');
const { HttpError } = require('../lib/errors');

const self = ["'self'"];
const headers = () => helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: self, scriptSrc: self, styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com'], mediaSrc: ["'self'", 'blob:', 'https://res.cloudinary.com'],
      connectSrc: ["'self'", 'https://api.cloudinary.com'], fontSrc: self, formAction: self, frameAncestors: ["'none'"],
      objectSrc: ["'none'"], baseUri: self, workerSrc: self, manifestSrc: self,
      ...(cfg.isProd ? { upgradeInsecureRequests: [] } : {})
    }
  },
  crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' }
});

const limiter = (windowMs, limit, message) => rateLimit({
  windowMs, limit, standardHeaders: true, legacyHeaders: false,
  handler: (req, res, next) => next(new HttpError(429, message || 'Too many requests. Please wait a moment and try again.'))
});

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|curl|wget|headless|monitor/i;
const isBot = (req) => BOT.test(req.get('user-agent') || '');

const L = cfg.isTest ? 1000 : 1;
module.exports = {
  headers, isBot,
  authLimiter: limiter(15 * 60 * 1000, 20 * L, 'Too many attempts. Please wait 15 minutes and try again.'),
  apiLimiter: limiter(60 * 1000, 120 * L),
  uploadLimiter: limiter(60 * 60 * 1000, 150 * L, 'Too many uploads. Try again in a while.'),
  reportLimiter: limiter(60 * 60 * 1000, 12 * L),
  postLimiter: limiter(60 * 60 * 1000, 40 * L, 'You are posting too fast. Try again in a while.'),
  reviewLimiter: limiter(60 * 60 * 1000, 20 * L, 'You are reviewing too fast. Try again in a while.'),
  waLimiter: limiter(10 * 60 * 1000, 60 * L),
  mailLimiter: limiter(60 * 60 * 1000, 6 * L, 'Too many emails requested. Try again in an hour.')
};
