// Account operations an administrator can perform (plus the shared deletion logic).
const db = require('../db');
const users = require('../repositories/users');
const listers = require('../repositories/listers');
const listings = require('../repositories/listings');
const media = require('./media');
const market = require('../repositories/market');
const flags = require('../repositories/flags');

// Removes personal data but keeps the row, so history (reports, audit log) stays readable.
function anonymise(user) {
  db.tx(() => {
    const prof = listers.byUserId(user.id);
    if (prof && prof.verification.idDocument) media.removePrivateFile(prof.verification.idDocument.publicId);
    media.deleteUserFiles(user.id);
    listings.markDeletedFor(user.id);
    market.markDeletedFor(user.id);
    db.run('DELETE FROM reviews WHERE author_id = ?', user.id);
    db.run('DELETE FROM wishlists WHERE user_id = ?', user.id);
    db.run('DELETE FROM notifications WHERE user_id = ?', user.id);
    if (prof) db.run('DELETE FROM lister_profiles WHERE id = ?', prof.id);
    users.deleteSessionsFor(user.id);
    users.update(user.id, { status: 'deleted', deletedAt: Date.now(), email: 'deleted+' + user.uid + '@deleted.invalid', name: 'Deleted user', phone: null, isLister: 0, isAdmin: 0 });
  });
}

// Removes the account and everything it owns, for good.
function purge(user) {
  const prof = listers.byUserId(user.id);
  if (prof && prof.verification.idDocument) media.removePrivateFile(prof.verification.idDocument.publicId);
  media.deleteUserFiles(user.id);
  users.hardDelete(user.id);
}

// The system must always keep at least one active administrator, and nobody can remove themselves.
function guardAdminChange(actor, target) {
  if (actor.id === target.id) throw new Error('You cannot do that to your own account. Ask another administrator.');
  if (target.isAdmin && users.adminCount() <= 1) throw new Error('This is the last administrator.');
}

// Ban: for confirmed fraud or abuse. The account stays (so its email cannot be used to sign up again), cannot sign in,
// and everything it posted is taken down. Reviews it wrote stop counting. Reports about it are closed.
function ban(actor, target, reason) {
  guardAdminChange(actor, target);
  if (target.isAdmin) throw new Error('Remove administrator access before banning this account.');
  if (target.status === 'deleted') throw new Error('This account was deleted.');
  if (!reason || reason.length < 3) throw new Error('Choose a reason for the ban.');
  db.tx(() => {
    users.update(target.id, { status: 'suspended', bannedAt: Date.now(), banReason: reason, bannedBy: actor.id });
    users.deleteSessionsFor(target.id);
    listings.suspendFor(target.id);
    market.hideAllFor(target.id, 'banned');
    flags.closeOpenAgainstUser(target.id, actor.id, 'Account banned');
  });
}
// Lifting a ban lets the person sign in again. Their lodges and items stay hidden until an administrator restores them one by one.
function unban(target) {
  if (!target.bannedAt) throw new Error('This account is not banned.');
  users.update(target.id, { status: 'active', bannedAt: null, banReason: null, bannedBy: null });
}

module.exports = { anonymise, purge, guardAdminChange, ban, unban };
