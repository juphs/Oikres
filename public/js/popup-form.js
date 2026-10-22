/* Admin > Popup: add, remove and reorder feature rows. */
(function () {
  'use strict';
  var box = document.getElementById('pop-rows'), add = document.getElementById('pop-add');
  if (!box) return;
  var MAX = 10;
  function rows() { return [].slice.call(box.querySelectorAll('.pop-row')); }
  function sync() { add.disabled = rows().length >= MAX; }
  add.addEventListener('click', function () {
    var list = rows(); if (list.length >= MAX) return;
    var copy = list[list.length - 1].cloneNode(true);
    [].forEach.call(copy.querySelectorAll('input,textarea'), function (f) { f.value = ''; });
    box.appendChild(copy); sync(); copy.querySelector('input[name=itemTitle]').focus();
  });
  box.addEventListener('click', function (e) {
    var row = e.target.closest('.pop-row'); if (!row) return;
    if (e.target.closest('[data-row-remove]')) { if (rows().length > 1) row.remove(); else [].forEach.call(row.querySelectorAll('input,textarea'), function (f) { f.value = ''; }); sync(); }
    else if (e.target.closest('[data-row-up]') && row.previousElementSibling) box.insertBefore(row, row.previousElementSibling);
    else if (e.target.closest('[data-row-down]') && row.nextElementSibling) box.insertBefore(row.nextElementSibling, row);
  });
  sync();
})();
