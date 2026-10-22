/* Add/edit lodge form: rooms, charges, live cost preview, photo and video uploads. */
(function () {
  'use strict';
  var form = document.getElementById('lodge-form');
  if (!form) return;
  var data = JSON.parse(document.getElementById('form-data').textContent);
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var naira = function (n) { return '\u20A6' + Math.round(n || 0).toLocaleString('en-NG'); };
  var toast = function (m) { if (window.Oikres) window.Oikres.toast(m); else alert(m); };
  var LIMITS = data.limits;

  var unitsBox = $('#units'), feesBox = $('#fees');
  var tplUnit = $('#tpl-unit'), tplFee = $('#tpl-fee');

  /* ---------- Rooms and spaces ---------- */
  function showKind(item) {
    var kind = $('[data-f=kind]', item).value;
    $$('[data-kinds]', item).forEach(function (el) {
      el.hidden = el.getAttribute('data-kinds').split(' ').indexOf(kind) === -1;
    });
  }
  function addUnit(u) {
    u = u || { label: '', kind: 'private_room', spacesTotal: 1, spacesAvailable: 1, rent: '', period: 'year', genderPreference: 'any', sharedFacilities: [], notes: '' };
    var item = tplUnit.content.firstElementChild.cloneNode(true);
    if (u._id) item.setAttribute('data-id', u._id);
    ['label', 'kind', 'spacesTotal', 'spacesAvailable', 'rent', 'initialPayment', 'period', 'genderPreference', 'notes'].forEach(function (k) {
      var el = $('[data-f=' + k + ']', item);
      if (el) el.value = u[k] === undefined || u[k] === null ? '' : u[k];
    });
    $$('[data-fac]', item).forEach(function (c) { c.checked = (u.sharedFacilities || []).indexOf(c.value) > -1; });
    unitsBox.appendChild(item);
    showKind(item);
    renumber();
  }
  function renumber() {
    var items = $$('.edit-item', unitsBox);
    items.forEach(function (it, i) {
      $('.item-no', it).textContent = 'Room or space ' + (i + 1);
      $('[data-remove]', it).hidden = items.length === 1;
    });
    refreshPreviewSelect();
  }
  function readUnits() {
    return $$('.edit-item', unitsBox).map(function (it) {
      var o = {};
      ['label', 'kind', 'spacesTotal', 'spacesAvailable', 'rent', 'initialPayment', 'period', 'genderPreference', 'notes'].forEach(function (k) { o[k] = $('[data-f=' + k + ']', it).value; });
      if (it.getAttribute('data-id')) o._id = it.getAttribute('data-id');
      o.rent = Number(String(o.rent).replace(/[^\d]/g, '')) || 0;
      o.initialPayment = Number(String(o.initialPayment).replace(/[^\d]/g, '')) || 0;
      o.sharedFacilities = $$('[data-fac]:checked', it).map(function (c) { return c.value; });
      return o;
    });
  }
  unitsBox.addEventListener('change', function (e) {
    var item = e.target.closest('.edit-item');
    if (item && e.target.getAttribute('data-f') === 'kind') {
      showKind(item);
      if (e.target.value !== 'shared_room') { $('[data-f=spacesTotal]', item).value = 1; $('[data-f=spacesAvailable]', item).value = 1; }
    }
    renderPreview();
  });
  unitsBox.addEventListener('input', function () { renderPreview(); refreshPreviewSelect(); });
  unitsBox.addEventListener('click', function (e) {
    var rm = e.target.closest('[data-remove]');
    if (rm) { rm.closest('.edit-item').remove(); renumber(); renderPreview(); }
  });
  $('#add-unit').addEventListener('click', function () {
    if ($$('.edit-item', unitsBox).length >= 12) return toast('You can add up to 12 rooms or spaces.');
    addUnit();
  });

  /* ---------- Charges ---------- */
  function showFee(item) {
    var other = $('[data-f=label]', item).value === 'other';
    $('[data-other]', item).hidden = !other;
    $('[data-sym]', item).textContent = $('[data-f=kind]', item).value === 'percent' ? '%' : '\u20A6';
  }
  function addFee(f) {
    f = f || { label: 'agreement', kind: 'fixed', value: '', payee: 'agent', refundable: false, customLabel: '', note: '' };
    var item = tplFee.content.firstElementChild.cloneNode(true);
    ['label', 'customLabel', 'kind', 'value', 'payee', 'note'].forEach(function (k) {
      var el = $('[data-f=' + k + ']', item);
      if (el) el.value = f[k] === undefined || f[k] === null ? '' : f[k];
    });
    $('[data-f=refundable]', item).checked = !!f.refundable;
    feesBox.appendChild(item);
    showFee(item);
    toggleNone();
  }
  function toggleNone() { $('#no-fees').hidden = $$('.edit-item', feesBox).length > 0; }
  function readFees() {
    return $$('.edit-item', feesBox).map(function (it) {
      var o = {};
      ['label', 'customLabel', 'kind', 'value', 'payee', 'note'].forEach(function (k) { o[k] = $('[data-f=' + k + ']', it).value; });
      o.value = Number(String(o.value).replace(/[^\d.]/g, '')) || 0;
      o.refundable = $('[data-f=refundable]', it).checked;
      return o;
    }).filter(function (f) { return f.value > 0; });
  }
  feesBox.addEventListener('change', function (e) {
    var item = e.target.closest('.edit-item');
    if (item) showFee(item);
    renderPreview();
  });
  feesBox.addEventListener('input', renderPreview);
  feesBox.addEventListener('click', function (e) {
    var rm = e.target.closest('[data-remove]');
    if (rm) { rm.closest('.edit-item').remove(); toggleNone(); renderPreview(); }
  });
  $('#add-fee').addEventListener('click', function () {
    if ($$('.edit-item', feesBox).length >= 10) return toast('You can add up to 10 charges.');
    addFee();
  });

  /* ---------- Live cost preview (the server recalculates the real figures) ---------- */
  var previewSel = $('#preview-unit'), previewBox = $('#preview');
  function labelFor(f) {
    if (f.label === 'other') return f.customLabel || 'Other charge';
    var opt = tplFee.content.querySelector('[data-f=label] option[value="' + f.label + '"]');
    return opt ? opt.textContent : 'Charge';
  }
  function refreshPreviewSelect() {
    var units = readUnits();
    var keep = previewSel.value;
    previewSel.innerHTML = '';
    units.forEach(function (u, i) {
      var o = document.createElement('option');
      o.value = i;
      o.textContent = u.label || 'Room or space ' + (i + 1);
      previewSel.appendChild(o);
    });
    if (keep && keep < units.length) previewSel.value = keep;
    previewSel.parentNode.hidden = units.length < 2;
    renderPreview();
  }
  function renderPreview() {
    var units = readUnits();
    var u = units[Number(previewSel.value) || 0];
    previewBox.innerHTML = '';
    if (!u || !u.rent) { previewBox.textContent = 'Enter the rent to see what a tenant pays to move in.'; return; }
    var total = u.rent;
    function row(label, amount, sub) {
      var d = document.createElement('div');
      d.className = 'cost-row';
      var l = document.createElement('dt');
      l.textContent = label;
      if (sub) { var s = document.createElement('span'); s.className = 'sub'; s.textContent = sub; l.appendChild(s); }
      var a = document.createElement('dd');
      a.textContent = naira(amount);
      d.appendChild(l); d.appendChild(a);
      previewBox.appendChild(d);
    }
    row('Rent', u.rent);
    readFees().forEach(function (f) {
      var amt = f.kind === 'percent' ? Math.round(u.rent * f.value / 100) : Math.round(f.value);
      total += amt;
      row(labelFor(f) + (f.kind === 'percent' ? ' (' + f.value + '%)' : ''), amt, 'Paid to the ' + f.payee + (f.refundable ? ' \u00B7 refundable' : ''));
    });
    if (u.initialPayment && u.initialPayment > total) { row('Other first-time charges', u.initialPayment - total, 'Not itemised'); total = u.initialPayment; }
    else if (u.initialPayment && u.initialPayment < total) { row('Check this', 0, 'The initial payment you entered is less than rent plus the charges (' + naira(total) + ').'); }
    var t = document.createElement('div');
    t.className = 'cost-total';
    t.innerHTML = '<span>Initial payment</span><strong></strong>';
    t.querySelector('strong').textContent = naira(total);
    previewBox.appendChild(t);
    var rn = document.createElement('p');
    rn.className = 'cost-note';
    rn.textContent = 'On renewal the tenant pays the rent: ' + naira(u.rent) + '.';
    previewBox.appendChild(rn);
  }
  previewSel.addEventListener('change', renderPreview);

  /* ---------- Area -> junction suggestions ---------- */
  var areaSel = $('#area'), list = $('#junction-list');
  function junctions() {
    var o = areaSel.options[areaSel.selectedIndex];
    list.innerHTML = '';
    var arr = [];
    try { arr = JSON.parse((o && o.getAttribute('data-j')) || '[]'); } catch (e) {}
    arr.forEach(function (j) { var el = document.createElement('option'); el.value = j; list.appendChild(el); });
  }
  areaSel.addEventListener('change', junctions);
  junctions();

  /* ---------- Photos and video ---------- */
  var media = (data.state.media || []).map(function (m) { return m; });
  var pending = 0;
  var grid = $('#uploads');
  function thumbUrl(m) {
    if (m.thumbUrl) return m.thumbUrl;
    if (m.url.indexOf('/upload/') === -1) return m.type === 'video' ? '' : m.url;
    if (m.type === 'video') return m.url.replace('/upload/', '/upload/so_0,c_fill,w_240,h_240/').replace(/\.\w+$/, '.jpg');
    return m.url.replace('/upload/', '/upload/c_fill,w_240,h_240,f_auto,q_auto/');
  }
  function render() {
    grid.innerHTML = '';
    // The video always comes first: it is the first thing seen on the lodge page.
    media = media.filter(function (m) { return m.type === 'video'; }).concat(media.filter(function (m) { return m.type !== 'video'; }));
    var firstImage = -1;
    media.forEach(function (m, i) {
      if (m.type === 'image' && firstImage === -1) firstImage = i;
      var t = document.createElement('div');
      t.className = 'thumb';
      var src = thumbUrl(m);
      if (src) {
        var im = document.createElement('img');
        im.src = src;
        im.alt = m.type === 'video' ? 'Walkthrough video' : 'Photo ' + (i + 1);
        t.appendChild(im);
      } else {
        var ph = document.createElement('div');
        ph.style.cssText = 'display:grid;place-items:center;height:100%;font-size:.8125rem';
        ph.textContent = 'Video added';
        t.appendChild(ph);
      }
      var x = document.createElement('button');
      x.type = 'button'; x.className = 'x'; x.setAttribute('aria-label', 'Remove'); x.textContent = '\u00D7';
      x.addEventListener('click', function () { media.splice(i, 1); render(); });
      t.appendChild(x);
      if (m.type === 'video') { var v = document.createElement('span'); v.className = 'tag tag-info cover-tag'; v.textContent = 'Video'; t.appendChild(v); }
      else if (i === firstImage) { var c = document.createElement('span'); c.className = 'tag tag-ok cover-tag'; c.textContent = 'Cover'; t.appendChild(c); }
      else {
        var mk = document.createElement('button');
        mk.type = 'button'; mk.className = 'tag cover-tag'; mk.textContent = 'Make cover'; mk.style.border = '0'; mk.style.cursor = 'pointer';
        mk.addEventListener('click', function () { var it = media.splice(i, 1)[0]; media.unshift(it); render(); });
        t.appendChild(mk);
      }
      grid.appendChild(t);
    });
    var n = media.filter(function (m) { return m.type === 'image'; }).length;
    $('#photo-count').textContent = n + ' of ' + LIMITS.maxPhotos + ' photos' + (n < LIMITS.minPhotos ? ' (add at least ' + LIMITS.minPhotos + ')' : '');
  }
  function placeholder() {
    var t = document.createElement('div');
    t.className = 'thumb';
    t.innerHTML = '<div class="pct"></div>';
    grid.appendChild(t);
    return t.firstChild;
  }
  function run(file, kind) {
    var bar = placeholder();
    pending++;
    return window.OikresUpload.upload(file, kind, function (p) { bar.style.width = Math.round(p * 100) + '%'; })
      .then(function (m) { media.push(m); })
      .catch(function (err) { toast(err.message); })
      .then(function () { pending--; render(); });
  }
  $('#photo-input').addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files);
    e.target.value = '';
    var room = LIMITS.maxPhotos - media.filter(function (m) { return m.type === 'image'; }).length - pending;
    if (files.length > room) toast('Only ' + Math.max(room, 0) + ' more photos fit. The rest were skipped.');
    files.slice(0, Math.max(room, 0)).forEach(function (f) {
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return toast(f.name + ' is not a JPG, PNG or WebP photo.');
      if (f.size > 30 * 1024 * 1024) return toast(f.name + ' is too large.');
      run(f, 'listing_image');
    });
  });
  $('#video-input').addEventListener('change', function (e) {
    var f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (media.some(function (m) { return m.type === 'video'; })) return toast('Remove the current video first.');
    if (!/^video\/(mp4|quicktime)$/.test(f.type)) return toast('Use an MP4 or MOV video.');
    if (f.size > LIMITS.maxVideoMb * 1024 * 1024) return toast('The video is larger than ' + LIMITS.maxVideoMb + ' MB. Record a shorter walkthrough.');
    run(f, 'listing_video');
  });
  render();

  /* ---------- Submit ---------- */
  var action = $('#action');
  $$('[data-action]').forEach(function (b) { b.addEventListener('click', function () { action.value = b.getAttribute('data-action'); }); });
  form.addEventListener('submit', function (e) {
    if (pending > 0) { e.preventDefault(); return toast('Wait for the uploads to finish.'); }
    $('#unitsJson').value = JSON.stringify(readUnits());
    $('#feesJson').value = JSON.stringify(readFees());
    $('#mediaJson').value = JSON.stringify(media.map(function (m) { return { type: m.type, id: m.id, url: m.url, publicId: m.publicId, width: m.width, height: m.height }; }));
    $$('[data-action]').forEach(function (b) { setTimeout(function () { b.disabled = true; }, 0); });
  });

  /* ---------- Start ---------- */
  (data.state.units && data.state.units.length ? data.state.units : [null]).forEach(function (u) { addUnit(u || undefined); });
  (data.state.fees || []).forEach(addFee);
  toggleNone();
  refreshPreviewSelect();
})();
