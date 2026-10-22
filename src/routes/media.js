const express = require('express');
const cfg = require('../config');
const { FILE_RE } = require('../services/media');

const router = express.Router();

// Public photos and videos stored on this server. ID documents live elsewhere and are never served here.
router.get('/:file', (req, res, next) => {
  if (!FILE_RE.test(req.params.file)) return next();
  res.sendFile(req.params.file, {
    root: cfg.uploadsDir, dotfiles: 'deny', maxAge: '30d', immutable: true,
    headers: { 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-site' }
  }, (err) => { if (err && !res.headersSent) next(); });
});

module.exports = router;
