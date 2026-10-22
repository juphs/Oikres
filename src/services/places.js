// What the forms and filters offer for state > campus > area, and the lookup used to check what was submitted.
const places = require('../repositories/places');
const areasRepo = require('../repositories/areas');

// Active places only (an area or campus is offered only while its state is active too).
function forForm() {
  return { states: places.listStates({ activeOnly: true }), campuses: places.listCampuses({ activeOnly: true }), areas: areasRepo.list({ activeOnly: true }) };
}
// Maps used by the validators: area id -> state id, campus id -> state id.
function lookup() {
  const f = forForm();
  return { states: new Set(f.states.map((s) => s.id)), areas: new Map(f.areas.map((a) => [a.id, a.stateId])), campuses: new Map(f.campuses.map((c) => [c.id, c.stateId])),
    onlyState: f.states.length === 1 ? f.states[0].id : null };
}
// With a single active state the form pre-selects it.
const defaultState = (f) => (f.states.length === 1 ? String(f.states[0].id) : '');

module.exports = { forForm, lookup, defaultState };
