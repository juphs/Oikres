/* Admin ad form: one image upload, and showing only the link field that matches the button type. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var toast = function (m) { if (window.Oikres) window.Oikres.toast(m); else alert(m); };
  var input = $('#ad-image-input'), prev = $('#ad-preview'), status = $('#ad-image-status');
  function show(url) { prev.innerHTML = url ? '<img src="' + url + '" alt="" style="max-width:240px;border-radius:12px">' : ''; $('#ad-remove').hidden = !url; }
  show($('#imageUrl').value);
  input.addEventListener('change', function () {
    var f = input.files[0]; input.value = '';
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return toast('Use a JPG, PNG or WebP image.');
    status.textContent = 'Uploading...';
    window.OikresUpload.upload(f, 'ad_image', function (p) { status.textContent = 'Uploading... ' + Math.round(p * 100) + '%'; })
      .then(function (m) { $('#imageUrl').value = m.url; $('#thumbUrl').value = m.thumbUrl || m.url; $('#mediaUid').value = m.id || ''; show(m.url); status.textContent = 'Image added.'; })
      .catch(function (err) { status.textContent = ''; toast(err.message); });
  });
  $('#ad-remove').addEventListener('click', function () { ['imageUrl', 'thumbUrl', 'mediaUid'].forEach(function (id) { $('#' + id).value = ''; }); show(''); status.textContent = ''; });

  var vInput = $('#ad-video-input'), vPrev = $('#ad-video-preview'), vStatus = $('#ad-video-status');
  function showVideo(url) { vPrev.innerHTML = url ? '<video src="' + url + '" muted loop playsinline controls style="max-width:240px;border-radius:12px"></video>' : ''; $('#ad-video-remove').hidden = !url; }
  showVideo($('#videoUrl').value);
  vInput.addEventListener('change', function () {
    var f = vInput.files[0]; vInput.value = '';
    if (!f) return;
    if (!/^video\/(mp4|quicktime)$/.test(f.type)) return toast('Use an MP4 or MOV video.');
    if (f.size > 25 * 1024 * 1024) return toast('The video is larger than 25 MB. Use a shorter or smaller one.');
    vStatus.textContent = 'Uploading...';
    window.OikresUpload.upload(f, 'ad_video', function (p) { vStatus.textContent = 'Uploading... ' + Math.round(p * 100) + '%'; })
      .then(function (m) { $('#videoUrl').value = m.url; $('#videoMediaUid').value = m.id || ''; showVideo(m.url); vStatus.textContent = 'Video added.'; })
      .catch(function (err) { vStatus.textContent = ''; toast(err.message); });
  });
  $('#ad-video-remove').addEventListener('click', function () { $('#videoUrl').value = ''; $('#videoMediaUid').value = ''; showVideo(''); vStatus.textContent = ''; });

  var type = $('#linkType'), val = $('#linkValue'), label = $('#linkLabel'), wrap = $('#link-fields');
  var hints = { url: ['Web address', 'https://example.com/offer'], page: ['Page on this site', '/market'], whatsapp: ['WhatsApp number', '0801 234 5678'] };
  function sync() { var h = hints[type.value]; wrap.hidden = !h; if (h) { label.textContent = h[0]; val.placeholder = h[1]; } }
  type.addEventListener('change', sync); sync();
})();
