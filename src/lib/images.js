// Image and video URLs for both storage drivers.
const cfg = require('../config');

const isCld = (url) => typeof url === 'string' && url.includes('res.cloudinary.com') && url.includes('/upload/');
const withT = (url, t) => url.replace('/upload/', '/upload/' + t + '/');
const cldImg = (url, w, h) => withT(url, 'f_auto,q_auto,c_' + (h ? 'fill' : 'limit') + ',w_' + w + (h ? ',h_' + h : ''));
const SIZES = { thumb: [320, 240], card: [480, 360], large: [900, 0], xl: [1400, 0], og: [1200, 630] };

// One picture at a named size. Local files already come in a large and a small version.
function mediaSrc(m, size = 'card') {
  if (!m || !m.url) return '';
  if (isCld(m.url)) { const [w, h] = SIZES[size] || SIZES.card; return cldImg(m.url, w, h || 0); }
  return (size === 'thumb' || size === 'card') && m.thumbUrl ? m.thumbUrl : m.url;
}
const mediaSet = (m, widths = [320, 480, 640]) => (m && isCld(m.url) ? widths.map((w) => cldImg(m.url, w, Math.round(w * 0.75)) + ' ' + w + 'w').join(', ') : '');
const videoSrc = (m) => (m && isCld(m.url) ? withT(m.url, 'f_auto:video,q_auto,c_limit,h_720') : m ? m.url : '');
const posterSrc = (m, fallback) => (m && isCld(m.url) ? withT(m.url, 'so_0,f_jpg,q_auto,c_limit,w_900').replace(/\.\w+$/, '.jpg') : fallback ? mediaSrc(fallback, 'card') : '');
const absolute = (u) => (!u ? '' : /^https?:/.test(u) ? u : cfg.baseUrl + u);

module.exports = { isCld, mediaSrc, mediaSet, videoSrc, posterSrc, absolute };
