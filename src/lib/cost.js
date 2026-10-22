const { PERIODS, FEE_LABELS } = require('../config/constants');

const labelOf = (key) => (FEE_LABELS.find((f) => f.value === key) || { label: 'Charge' }).label;
const feeText = (fee) => (fee.label === 'other' && fee.customLabel ? fee.customLabel : labelOf(fee.label));
const feeAmount = (fee, rent) =>
  fee.kind === 'percent' ? Math.round((rent * fee.value) / 100) : Math.round(fee.value);

// Itemised cost of moving into one room/unit. Percent fees use that unit's rent as the base.
function breakdown(rent, fees, initialPayment) {
  rent = Number(rent) || 0;
  const lines = [{ key: 'rent', label: 'Rent', amount: rent, payee: null, refundable: false, note: '' }];
  let total = rent;
  let refundable = 0;
  (fees || []).forEach((f) => {
    const amount = feeAmount(f, rent);
    total += amount;
    if (f.refundable) refundable += amount;
    lines.push({
      key: f.label,
      label: feeText(f),
      amount,
      percent: f.kind === 'percent' ? f.value : null,
      payee: f.payee,
      refundable: !!f.refundable,
      note: f.note || ''
    });
  });
  // The lister may state the initial payment directly. Whatever is not itemised is shown as one honest line.
  const initial = Number(initialPayment) || 0;
  let other = 0;
  if (initial > total) { other = initial - total; lines.push({ key: 'other_initial', label: 'Other first-time charges', amount: other, payee: null, refundable: false, note: 'Not itemised by the lister', unitemised: true }); total = initial; }
  return { lines, total, refundable, other, itemised: total - other };
}

const factor = (period) => (PERIODS.find((p) => p.value === period) || PERIODS[0]).yearlyFactor;

function unitStatus(u) {
  if (u.spacesAvailable <= 0) return 'full';
  if (u.spacesAvailable < u.spacesTotal) return 'partly_taken';
  return 'available';
}

// Fills moveInTotal/status on each unit and returns the summary stored on the listing.
function applyPricing(units, fees) {
  units.forEach((u) => {
    u.status = unitStatus(u);
    u.moveInTotal = breakdown(u.rent, fees, u.initialPayment).total;
  });
  const open = units.filter((u) => u.status !== 'full');
  const pool = open.length ? open : units;
  const cheapest = pool.reduce((a, b) => (a == null || b.rent * factor(b.period) < a.rent * factor(a.period) ? b : a), null);
  return {
    priceFrom: cheapest ? cheapest.rent : 0,
    periodFrom: cheapest ? cheapest.period : 'year',
    moveInFrom: cheapest ? cheapest.moveInTotal : 0,
    priceYearly: cheapest ? cheapest.rent * factor(cheapest.period) : 0,
    hasRoomShare: units.some((u) => u.kind === 'shared_room' && u.spacesAvailable > 0)
  };
}

module.exports = { breakdown, feeText, feeAmount, applyPricing, unitStatus, factor };
