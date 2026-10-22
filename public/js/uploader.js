/* Photo, video and ID uploads. Photos are shrunk on the phone first (also removes GPS data from the picture).
   Local mode sends the file to this server; Cloudinary mode uploads straight to Cloudinary with signed parameters. */
(function () {
  'use strict';
  var csrfMeta = document.querySelector('meta[name=csrf-token]');
  var csrf = csrfMeta ? csrfMeta.getAttribute('content') : '';
  var driverMeta = document.querySelector('meta[name=storage-driver]');
  var driver = driverMeta ? driverMeta.getAttribute('content') : 'local';
  var KIND = { listing_image: 'photo', listing_video: 'video', id_document: 'id', site_image: 'site', market_image: 'item', market_video: 'itemvideo', ad_video: 'adsvideo', ad_image: 'ads' };

  function asJson(r) {
    return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Upload failed. Please try again.'); return j; });
  }

  function resize(file, maxSide, quality) {
    return new Promise(function (resolve) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return resolve({ blob: file, width: 0, height: 0 });
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (b) { resolve({ blob: b || file, width: c.width, height: c.height }); }, 'image/jpeg', quality);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve({ blob: file, width: 0, height: 0 }); };
      img.src = url;
    });
  }

  function xhr(url, form, headers, onProgress) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('POST', url);
      Object.keys(headers || {}).forEach(function (k) { x.setRequestHeader(k, headers[k]); });
      x.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = function () {
        var j = {};
        try { j = JSON.parse(x.responseText); } catch (e) {}
        if (x.status >= 200 && x.status < 300) resolve(j);
        else reject(new Error((j.error && (j.error.message || j.error)) || 'Upload failed. Please try again.'));
      };
      x.onerror = function () { reject(new Error('Network problem. Check your connection and try again.')); };
      x.send(form);
    });
  }

  function toServer(file, kind, onProgress) {
    // Site logos keep their original file so transparency is not lost.
    var prep = kind === 'photo' || kind === 'item' || kind === 'id' ? resize(file, 1600, 0.82) : Promise.resolve({ blob: file, width: 0, height: 0 });
    var thumb = kind === 'photo' || kind === 'item' ? resize(file, 480, 0.75) : Promise.resolve(null);
    return Promise.all([prep, thumb]).then(function (r) {
      var fd = new FormData();
      fd.append('kind', kind); // must come first
      if (r[0].width) { fd.append('width', r[0].width); fd.append('height', r[0].height); }
      fd.append('file', r[0].blob, 'upload');
      if (r[1] && r[1].blob) fd.append('thumb', r[1].blob, 'thumb');
      return xhr('/api/media/upload', fd, { 'x-csrf-token': csrf }, onProgress);
    });
  }

  function toCloudinary(file, kind, onProgress) {
    var prep = kind === 'photo' || kind === 'item' ? resize(file, 1600, 0.82) : Promise.resolve({ blob: file, width: 0, height: 0 });
    return prep.then(function (r) {
      return fetch('/api/media/sign', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ kind: kind }) })
        .then(asJson)
        .then(function (sig) {
          var fd = new FormData();
          fd.append('file', r.blob);
          Object.keys(sig.params).forEach(function (k) { fd.append(k, sig.params[k]); });
          fd.append('api_key', sig.apiKey);
          fd.append('signature', sig.signature);
          return xhr('https://api.cloudinary.com/v1_1/' + sig.cloudName + '/' + sig.resourceType + '/upload', fd, {}, onProgress).then(function (j) {
            return { type: sig.resourceType === 'video' ? 'video' : 'image', url: j.secure_url, publicId: j.public_id, width: j.width, height: j.height };
          });
        });
    });
  }

  // kind: listing_image, listing_video or id_document
  function upload(file, kindName, onProgress) {
    var kind = KIND[kindName];
    if (!kind) return Promise.reject(new Error('Unknown upload type.'));
    if (driver === 'cloudinary' && ['photo', 'video', 'item', 'itemvideo'].indexOf(kind) > -1) return toCloudinary(file, kind, onProgress);
    return toServer(file, kind, onProgress);
  }
  window.OikresUpload = { upload: upload, driver: driver };

  /* ID document widgets (always stored privately on this server) */
  Array.prototype.forEach.call(document.querySelectorAll('.js-id-upload'), function (box) {
    var input = box.querySelector('input[type=file]');
    var hidden = box.querySelector('input[type=hidden]');
    var status = box.querySelector('.js-status');
    var pickName = box.querySelector('.pick-name');
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      if (pickName) pickName.textContent = f.name;
      if (!/^image\//.test(f.type)) { status.textContent = 'Choose a photo of the ID (JPG or PNG).'; return; }
      status.textContent = 'Uploading... 0%';
      toServer(f, 'id', function (p) { status.textContent = 'Uploading... ' + Math.round(p * 100) + '%'; })
        .then(function (r) { hidden.value = r.id; status.textContent = 'ID uploaded. Only Oikres admins can see it.'; })
        .catch(function (err) { hidden.value = ''; status.textContent = err.message; });
    });
  });
})();
