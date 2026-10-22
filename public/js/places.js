/* State > campus > area: choosing a state narrows the campus and area lists to that state.
   Works on any element marked data-places that holds selects marked data-place="state|campus|area".
   Without JavaScript every option is still listed and the server checks the choice. */
(function () {
  'use strict';
  Array.prototype.forEach.call(document.querySelectorAll('[data-places]'), function (box) {
    var state = box.querySelector('[data-place=state]');
    if (!state) return;
    var dependants = ['campus', 'area'].map(function (n) { return box.querySelector('[data-place=' + n + ']') || (n === 'area' ? box.querySelector('#area') : null); }).filter(Boolean);

    function narrow(sel) {
      if (!sel._all) sel._all = Array.prototype.map.call(sel.options, function (o) { return o.cloneNode(true); });
      var keep = sel.value;
      var sid = state.value;
      sel.innerHTML = '';
      sel._all.forEach(function (o) {
        var s = o.getAttribute('data-state');
        if (!s || !sid || s === sid) sel.appendChild(o.cloneNode(true));
      });
      sel.value = keep;
      if (sel.value !== keep) sel.value = '';
      sel.dispatchEvent(new Event('ui:refresh'));
      sel.dispatchEvent(new Event('change', { bubbles: true })); // lets the junction suggestions follow the area
    }
    function all() { dependants.forEach(narrow); }
    state.addEventListener('change', all);
    all();
  });
})();
