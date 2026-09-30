const functions = require("firebase-functions");

// The owner's own testing account - nobody else, ever (see docs/NOTES.md 2026-09-29 "God mode restricted to the
// owner's testing account" and the snowy-balls-blaze-migration memory, item 10). Not a save field any client can
// set - a hardcoded identity check, compared against request.auth.uid, which a client cannot forge without
// actually controlling that Google account.
const ADMIN_UID = "zrHVHG8QVXfZfMhUn0PJHf9TEKO2";

// The admin account's coin balance is forced to this on every read (see purchase/openBox in functions/economy.js) -
// not a special "skip the cost check" branch any more (2026-09-30, the owner's call: simpler to just give the
// account an effectively bottomless balance than to special-case every place a cost gets checked). The normal
// spendableCoins()/deduction code then runs completely unconditionally for every uid, admin included - it just
// never runs out, since this gets forced back to the same huge number on the very next read regardless of
// whatever got deducted last time (the deduction is real, but self-healing: nothing ever persists it downward
// for long). Same magnitude as the LOCAL god-mode convention (src/economy.js fillGod, 999999999) purely for
// consistency - not read by, or shared with, that entirely separate (client-only, never-synced) mechanism.
const ADMIN_COINS = 999999999;

// Every callable Function's first check, no exceptions (the owner's explicit call, 2026-09-29 - see the plan's
// Part 3): a signed-out client must never be able to call anything that touches the economy, trading included.
// Throws "unauthenticated" (functions.https.onCall turns this into the error the client's .catch() sees) rather
// than returning a falsy value, so a caller can never accidentally treat "not signed in" as "signed in as nobody."
function requireAuth(context) {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError("unauthenticated", "Sign in first.");
  }
  return context.auth.uid;
}

function isAdmin(uid) {
  return uid === ADMIN_UID;
}

module.exports = { ADMIN_UID, ADMIN_COINS, requireAuth, isAdmin };
