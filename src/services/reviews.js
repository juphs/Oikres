const C = require('../config/constants');
const reviews = require('../repositories/reviews');
const { clean, toInt } = require('../lib/util');
const { notify } = require('./notify');

// Returns { ok, error, created }. Anyone signed in with a verified email can review another active person, once; they can edit or delete it later.
function submit({ author, subject, rating, body }) {
  if (!subject || subject.status !== 'active') return { ok: false, error: 'You cannot review this account.' };
  if (author.id === subject.id) return { ok: false, error: 'You cannot review yourself.' };
  if (!author.emailVerifiedAt) return { ok: false, error: 'Verify your email address before leaving a review.' };
  // Not toInt(): that clamps, so a forged 9 would quietly become 5 stars.
  const stars = Number(rating);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return { ok: false, error: 'Choose a rating from 1 to 5 stars.' };
  const text = clean(body, C.RULES.reviewMaxChars);
  const existing = reviews.byPair(subject.id, author.id);
  if (existing && existing.status === 'removed') return { ok: false, error: 'Your earlier review of this person was removed by the team, so you cannot post another.' };
  if (existing) { reviews.edit(existing.id, { rating: stars, body: text }); return { ok: true, created: false }; }
  reviews.create({ subjectId: subject.id, authorId: author.id, rating: stars, body: text });
  notify(subject.id, { type: 'review', title: author.name + ' reviewed you', body: stars + ' out of 5 stars' + (text ? ': ' + text.slice(0, 120) : ''), link: '/u/' + subject.uid, emailToo: false });
  return { ok: true, created: true };
}

module.exports = { submit };
