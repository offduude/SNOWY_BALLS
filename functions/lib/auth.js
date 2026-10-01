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

// Invite-only allowlist (2026-10-01 - the owner's own ask, after asking "can someone overload my Firebase limits
// with botted accounts?"): any Google account can complete a real sign-in (Firebase Auth itself has no concept of
// "invited"), but ONLY these emails may ever get past requireAuth below - everyone else's calls are refused before
// touching Firestore, no exceptions, no matter how many accounts they create. Lowercase, compared case-
// insensitively (Gmail addresses are case-insensitive in practice). Mirrored by hand in firestore.rules (its own
// isAllowedEmail() function) - rules can't require() this file, so the two lists must be kept in sync manually,
// same as ADMIN_UID already is across this file and src/main.js.
const ALLOWED_EMAILS = new Set([
  "joatre2741@gmail.com",
  "t4backupemail2@gmail.com",
  "domimarzec111@gmail.com",
  "kubamolo592@gmail.com",
  "offduude@gmail.com",
  "snowyballs759@gmail.com", // the admin/testing account's own real sign-in - isAdmin(uid) below is a second,
  // independent path to the same allowance, so the owner is never locked out even if this email ever changes.
]);

// Every callable Function's first check, no exceptions (the owner's explicit call, 2026-09-29 - see the plan's
// Part 3): a signed-out client must never be able to call anything that touches the economy, trading included.
// Throws "unauthenticated" (functions.https.onCall turns this into the error the client's .catch() sees) rather
// than returning a falsy value, so a caller can never accidentally treat "not signed in" as "signed in as nobody."
//
// Extended 2026-10-01 with the allowlist above: being signed in is no longer enough on its own - the account's
// own email (from the real Google ID token, not anything a client can forge) must also be on the list, or
// isAdmin(uid) must already say yes. Throws "permission-denied" (a real, distinct refusal, not "you're not signed
// in") so this reads honestly in a client's own .catch() - the account IS authenticated, it's just not invited.
function requireAuth(context) {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError("unauthenticated", "Sign in first.");
  }
  const email = context.auth.token && typeof context.auth.token.email === "string" ? context.auth.token.email.toLowerCase() : null;
  if (!isAdmin(context.auth.uid) && (!email || !ALLOWED_EMAILS.has(email))) {
    throw new functions.https.HttpsError("permission-denied", "This account isn't invited to play.");
  }
  return context.auth.uid;
}

function isAdmin(uid) {
  return uid === ADMIN_UID;
}

module.exports = { ADMIN_UID, ADMIN_COINS, ALLOWED_EMAILS, requireAuth, isAdmin };
