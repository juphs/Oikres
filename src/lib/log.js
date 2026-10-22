const cfg = require('../config');
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const min = LEVELS[cfg.logLevel] || 20;
const out = (level, args) => { if (LEVELS[level] >= min && !(cfg.isTest && level !== 'error')) (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(...args); };
module.exports = { debug: (...a) => out('debug', a), info: (...a) => out('info', a), warn: (...a) => out('warn', a), error: (...a) => out('error', a) };
