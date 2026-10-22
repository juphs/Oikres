// Admin > Ads: create and manage the promo cards shown inside the lodge list and the market list. Mounted at /admin/ads.
const express = require('express');
const ads = require('../repositories/ads');
const placesRepo = require('../repositories/places');
const adsSvc = require('../services/ads');
const { wrap } = require('../middleware/core');
const { audit } = require('../services/notify');
const media = require('../services/media');
const { isUid } = require('../lib/util');

const router = express.Router();
const day = (ms) => (ms ? new Date(ms + 3600000).toISOString().slice(0, 10) : '');

function render(res, { ad = null, form, errors = {}, status = 200 }) {
  res.status(status).render('admin/ad-form', { title: ad ? 'Edit ad' : 'New ad', nav: 'ads', ad, form, errors, PLACEMENTS: adsSvc.PLACEMENTS, LINK_TYPES: adsSvc.LINK_TYPES,
    states: placesRepo.listStates(), campuses: placesRepo.listCampuses(), scripts: ['places.js', 'uploader.js', 'ad-form.js'] });
}
const formFrom = (a) => ({ title: a.title, body: a.body, imageUrl: a.imageUrl || '', thumbUrl: a.thumbUrl || '', mediaUid: a.mediaUid || '', videoUrl: a.videoUrl || '', videoMediaUid: a.videoMediaUid || '', sponsor: a.sponsor, badge: a.badge, buttonLabel: a.buttonLabel,
  linkType: a.linkType, linkValue: a.linkValue, placement: a.placement, state: a.stateId || '', campus: a.campusId || '', startsAt: day(a.startsAt), endsAt: day(a.endsAt), position: a.position });

router.get('/', wrap((req, res) => res.render('admin/ads', { title: 'Ads', nav: 'ads', ads: ads.all(), PLACEMENTS: adsSvc.PLACEMENTS })));
router.get('/new', (req, res) => render(res, { form: { linkType: 'url', placement: 'both', position: 100, badge: 'Ad' } }));
router.post('/', wrap((req, res) => {
  const r = adsSvc.parseAd(req.body);
  if (!r.ok) return render(res, { form: req.body, errors: r.errors, status: 422 });
  const ad = ads.create(r.data, req.user.id);
  audit(req.user, 'ad.create', 'Ad', ad.id, ad.title);
  req.flash('success', 'Ad created. It is live now.');
  res.redirect('/admin/ads');
}));
router.get('/:id/edit', wrap((req, res, next) => {
  const ad = isUid(req.params.id) ? ads.byUid(req.params.id) : null;
  if (!ad) return next();
  render(res, { ad, form: formFrom(ad) });
}));
router.post('/:id/edit', wrap((req, res, next) => {
  const ad = isUid(req.params.id) ? ads.byUid(req.params.id) : null;
  if (!ad) return next();
  const r = adsSvc.parseAd(req.body);
  if (!r.ok) return render(res, { ad, form: req.body, errors: r.errors, status: 422 });
  ads.update(ad.id, r.data);
  audit(req.user, 'ad.update', 'Ad', ad.id, r.data.title);
  req.flash('success', 'Ad saved.');
  res.redirect('/admin/ads');
}));
router.post('/:id/:action', wrap((req, res, next) => {
  const ad = isUid(req.params.id) ? ads.byUid(req.params.id) : null;
  if (!ad) return next();
  if (req.params.action === 'toggle') ads.toggle(ad.id);
  else if (req.params.action === 'delete') { ads.remove(ad.id); media.deleteListingFiles([ad.mediaUid, ad.videoMediaUid].filter(Boolean)); }
  else return next();
  audit(req.user, 'ad.' + req.params.action, 'Ad', ad.id, ad.title);
  res.redirect('/admin/ads');
}));

module.exports = router;
