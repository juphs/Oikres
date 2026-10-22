const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('../config');
const C = require('../config/constants');
const media = require('../repositories/media');
const { uid, isUid } = require('../lib/util');
const { HttpError } = require('../lib/errors');
const log = require('../lib/log');

const MB = 1024 * 1024;
const KINDS = { site: { max: 3 * MB, type: 'image' }, photo: { max: C.RULES.maxPhotoMb * MB, type: 'image' }, item: { max: C.RULES.maxPhotoMb * MB, type: 'image' }, ads: { max: 3 * MB, type: 'image' }, video: { max: C.RULES.maxVideoMb * MB, type: 'video' }, itemvideo: { max: C.RULES.maxVideoMb * MB, type: 'video' }, adsvideo: { max: 25 * MB, type: 'video' }, id: { max: C.RULES.maxPhotoMb * MB, type: 'image' } };
const THUMB_MAX = 2 * MB;
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime' };
const FILE_RE = /^[a-z0-9]{20}(-t)?\.(jpg|png|webp|mp4|mov)$/;

// Identify a file from its first bytes. The declared type and file name are never trusted.
function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image', ext: 'jpg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image', ext: 'png' };
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return { type: 'image', ext: 'webp' };
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') return { type: 'video', ext: buf.toString('latin1', 8, 12) === 'qt  ' ? 'mov' : 'mp4' };
  return null;
}
function sniffFile(file) {
  const fd = fs.openSync(file, 'r');
  try { const b = Buffer.alloc(16); const n = fs.readSync(fd, b, 0, 16, 0); return sniff(b.subarray(0, n)); } finally { fs.closeSync(fd); }
}
const rm = (f) => { try { fs.unlinkSync(f); } catch (e) { /* already gone */ } };
const dirFor = (kind) => (kind === 'id' ? cfg.privateDir : cfg.uploadsDir);

// Receives a multipart upload (fields first: kind, then file and optional thumb). Streams to disk.
function receive(req, user, { isLister = false, isAdmin = false } = {}) {
  return new Promise((resolve, reject) => {
    const busboy = require('busboy');
    let bb;
    try { bb = busboy({ headers: req.headers, limits: { files: 2, fields: 6, parts: 10, fileSize: KINDS.video.max + MB } }); }
    catch (e) { return reject(new HttpError(400, 'That upload was not understood.')); }
    const fields = {};
    const parts = [];
    let failure = null;
    const base = path.join(cfg.uploadsDir, '.tmp-' + uid(12));

    bb.on('field', (name, value) => { if (['kind', 'width', 'height'].includes(name)) fields[name] = String(value).slice(0, 12); });
    bb.on('file', (name, stream) => {
      const kind = KINDS[fields.kind];
      if (!kind || !['file', 'thumb'].includes(name) || (name === 'thumb' && !['photo', 'item'].includes(fields.kind))) { failure = failure || new HttpError(400, 'Choose what you are uploading first.'); stream.resume(); return; }
      const limit = name === 'thumb' ? THUMB_MAX : kind.max;
      const tmp = base + '-' + name;
      const out = fs.createWriteStream(tmp, { mode: 0o640 });
      const part = { name, tmp, size: 0, truncated: false, closed: new Promise((r) => out.on('close', r)) };
      parts.push(part);
      stream.on('data', (c) => {
        part.size += c.length;
        if (part.size > limit && !part.truncated) { part.truncated = true; stream.unpipe(out); out.end(); stream.resume(); }
      });
      stream.on('limit', () => { part.truncated = true; });
      stream.pipe(out);
    });
    bb.on('error', (err) => { parts.forEach((p) => rm(p.tmp)); reject(new HttpError(400, 'The upload was interrupted. Please try again.')); });
    bb.on('close', async () => {
      try {
        await Promise.all(parts.map((p) => p.closed));
        const fail = (err) => { parts.forEach((p) => rm(p.tmp)); reject(err); };
        if (failure) return fail(failure);
        const kind = KINDS[fields.kind];
        const main = parts.find((p) => p.name === 'file');
        if (!main || main.size === 0) return fail(new HttpError(400, 'No file was received.'));
        if (['site', 'ads', 'adsvideo'].includes(fields.kind) && !isAdmin) return fail(new HttpError(403, 'Only administrators can change site images.'));
        if (!['id', 'site', 'ads', 'adsvideo', 'item', 'itemvideo'].includes(fields.kind) && !isLister && !isAdmin) return fail(new HttpError(403, 'Lister account required.'));
        if (parts.some((p) => p.truncated)) return fail(new HttpError(413, 'That file is too large. Photos can be up to ' + C.RULES.maxPhotoMb + ' MB and videos up to ' + C.RULES.maxVideoMb + ' MB.'));
        const sn = sniffFile(main.tmp);
        if (!sn || sn.type !== kind.type) return fail(new HttpError(415, kind.type === 'video' ? 'Use an MP4 or MOV video.' : 'Use a JPG, PNG or WebP photo.'));
        const thumb = parts.find((p) => p.name === 'thumb');
        let tn = null;
        if (thumb) { tn = sniffFile(thumb.tmp); if (!tn || tn.type !== 'image') return fail(new HttpError(415, 'The preview image is not a valid photo.')); }

        const name = uid(20);
        const dir = dirFor(fields.kind);
        const file = name + '.' + sn.ext;
        fs.renameSync(main.tmp, path.join(dir, file));
        let thumbFile = null;
        if (thumb && tn) { thumbFile = name + '-t.' + tn.ext; fs.renameSync(thumb.tmp, path.join(dir, thumbFile)); }
        const row = media.insert({ ownerId: user.id, kind: ['site', 'item', 'ads'].includes(fields.kind) ? 'photo' : ['itemvideo', 'adsvideo'].includes(fields.kind) ? 'video' : fields.kind, file, thumbFile, width: Number(fields.width) || null, height: Number(fields.height) || null, size: main.size });
        if (['site', 'ads', 'adsvideo'].includes(fields.kind)) media.attach(row.uid);
        resolve({ id: row.uid, type: kind.type, kind: fields.kind, url: fields.kind === 'id' ? null : '/media/' + file, thumbUrl: thumbFile ? '/media/' + thumbFile : null, width: row.width, height: row.height });
      } catch (err) { parts.forEach((p) => rm(p.tmp)); reject(err); }
    });
    req.pipe(bb);
  });
}

// Turns what the browser sent into trusted media records. Local files are looked up by id and must belong to the user;
// Cloudinary files must be on our own account and under the user's folder.
function resolveItems(items, user, { owners = [], anyFolder = false, folder = 'oikres/listings' } = {}) {
  const out = [];
  for (const m of items || []) {
    if (m.id && isUid(m.id)) {
      const row = media.byUid(m.id);
      if (row && (row.ownerId === user.id || owners.includes(row.ownerId)) && (row.kind === 'photo' || row.kind === 'video')) {
        out.push({ type: row.kind === 'video' ? 'video' : 'image', url: '/media/' + row.file, thumbUrl: row.thumbFile ? '/media/' + row.thumbFile : null, mediaUid: row.uid, width: row.width, height: row.height });
      }
    } else if (cfg.cloudinary.enabled && m.url && m.publicId) {
      const own = new RegExp('^https://res\\.cloudinary\\.com/' + cfg.cloudinary.cloudName.replace(/[^\w-]/g, '') + '/(image|video)/upload/').test(m.url);
      if (own && m.publicId.startsWith(anyFolder ? folder + '/' : folder + '/' + user.uid + '/')) out.push({ type: m.type, url: m.url, publicId: m.publicId, width: m.width, height: m.height });
    }
  }
  const images = out.filter((m) => m.type === 'image').slice(0, C.RULES.maxPhotos);
  return images.concat(out.filter((m) => m.type === 'video').slice(0, 1));
}
const markAttached = (items) => items.forEach((m) => { if (m.mediaUid) media.attach(m.mediaUid); });

// Takes a private ID document uploaded earlier and returns its stored file name.
function claimIdDocument(mediaUid, user) {
  if (!isUid(mediaUid)) return null;
  const row = media.byUid(mediaUid);
  if (!row || row.ownerId !== user.id || row.kind !== 'id') return null;
  media.attach(row.uid);
  return row.file;
}
function removePrivateFile(file) {
  if (!file || !FILE_RE.test(file)) return;
  rm(path.join(cfg.privateDir, file));
  media.removeByFile(file);
}

function signCloudinary(kind, user) {
  if (!cfg.cloudinary.enabled || !['photo', 'video', 'item', 'itemvideo'].includes(kind)) return null;
  const isVideo = kind === 'video' || kind === 'itemvideo';
  const params = { allowed_formats: isVideo ? 'mp4,mov' : 'jpg,jpeg,png,webp', folder: (kind === 'item' || kind === 'itemvideo' ? 'oikres/market/' : 'oikres/listings/') + user.uid, timestamp: Math.round(Date.now() / 1000) };
  const toSign = Object.keys(params).sort().map((k) => k + '=' + params[k]).join('&');
  const signature = crypto.createHash('sha1').update(toSign + cfg.cloudinary.apiSecret).digest('hex');
  return { driver: 'cloudinary', cloudName: cfg.cloudinary.cloudName, apiKey: cfg.cloudinary.apiKey, resourceType: isVideo ? 'video' : 'image', params, signature };
}

// Deletes uploads that were never attached to a lodge or profile.
function purgeOrphans() {
  let n = 0;
  for (const row of media.orphans(24 * 3600 * 1000)) {
    [row.file, row.thumbFile].filter(Boolean).forEach((f) => rm(path.join(dirFor(row.kind), f)));
    media.remove(row.id); n++;
  }
  // leftover temp files from interrupted uploads
  try { fs.readdirSync(cfg.uploadsDir).filter((f) => f.startsWith('.tmp-')).forEach((f) => { const p = path.join(cfg.uploadsDir, f); if (Date.now() - fs.statSync(p).mtimeMs > 3600 * 1000) rm(p); }); } catch (e) { log.debug('tmp cleanup skipped'); }
  return n;
}

// Delete the files behind uploads (used when a lodge or an account is removed for good).
function deleteUploadRows(rows) {
  rows.forEach((row) => { [row.file, row.thumbFile].filter(Boolean).forEach((f) => rm(path.join(dirFor(row.kind), f))); media.remove(row.id); });
}
function deleteListingFiles(mediaUids) { deleteUploadRows(mediaUids.map((u) => media.byUid(u)).filter(Boolean)); }
function deleteUserFiles(userId) {
  deleteUploadRows(media.byOwner(userId));
}

module.exports = { deleteListingFiles, deleteUserFiles, sniff, receive, resolveItems, markAttached, claimIdDocument, removePrivateFile, signCloudinary, purgeOrphans, FILE_RE, MIME, KINDS };
