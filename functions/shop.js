// rerollShop (Cloud Scheduler) + forceRerollShop (admin-only manual trigger) - Part of the plan's item 5. See
// functions/lib/shopStock.js for the actual generation logic this just calls on a schedule.
const functions = require("firebase-functions");
const { db } = require("./lib/admin");
const { requireAuth, isAdmin } = require("./lib/auth");
const { shopStockRef, generateStock, normalize, isDue, rerollMs } = require("./lib/shopStock");
const { requireMinVersion } = require("./lib/version");
const { ADMIN_MAX_INSTANCES } = require("./lib/scaling");

// Regenerates the stock doc if it's due (or unconditionally, if `force`) inside one transaction - a concurrent
// purchase() call (functions/economy.js) reading the same doc either sees the old roll or the new one, never a
// half-written mix. Returns { rerolled, stock } either way so a caller (the scheduled function, the admin
// trigger, or the test script) can tell whether anything actually changed.
async function rerollIfDue(force) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(shopStockRef());
    const current = normalize(snap.exists ? snap.data() : null);
    if (!force && !isDue(current, Date.now())) return { rerolled: false, stock: current };
    const fresh = generateStock();
    tx.set(shopStockRef(), fresh);
    return { rerolled: true, stock: fresh };
  });
}

// Cloud Scheduler's own cron granularity is whole minutes - this only lines up cleanly with economy.json's
// rerollSeconds when it divides evenly into minutes (300s = 5 minutes today; it has been changed before - see
// economy.json's _rerollNote history - so if it's ever set to something that doesn't divide evenly, this rounds
// rather than crashes, and isDue()'s own "never wait longer than one full cycle" guard keeps the actual stock
// timing honest either way, just possibly firing a little early/late relative to the schedule string).
const rerollMinutes = Math.max(1, Math.round(rerollMs() / 60000));

// The actual Cloud Scheduler trigger. Not exercised by the emulator smoke test directly (the Local Emulator
// Suite has no way to fast-forward a real 5-minutes-later clock tick) - functions/test/run.js instead calls
// rerollIfDue() below directly, in-process, which is exactly what this handler's body does anyway.
// `maxInstances: ADMIN_MAX_INSTANCES` on both exports below (2026-10-01, see lib/scaling.js's own note) - never
// more than one legitimate concurrent reroll anyway, scheduled or admin-triggered; the cap is cheap insurance,
// not something either path would ever actually hit under normal use. `.region("europe-central2")` likewise
// (2026-10-02) - see functions/economy.js's own note on why (the real project's Firestore lives there).
exports.rerollShop = functions.region("europe-central2").runWith({ maxInstances: ADMIN_MAX_INSTANCES }).pubsub.schedule(`every ${rerollMinutes} minutes`).onRun(async () => {
  await rerollIfDue(false);
});

// Admin-only (see lib/auth.js) - forces an immediate reroll, bypassing isDue() when `force: true` is passed.
// Exists for two reasons: the owner's own ability to reroll on demand while testing (rather than waiting up to
// rerollMinutes for the schedule), and so this whole path has an HTTP-callable, auth-gated surface a test can
// exercise the same way every other Function in this project is tested, not just the direct in-process call.
// Still reachable (and rejected) by ANY signed-in caller before the isAdmin check runs, same as every other
// callable - maxInstances caps that invocation layer regardless of who's calling.
exports.forceRerollShop = functions.region("europe-central2").runWith({ maxInstances: ADMIN_MAX_INSTANCES }).https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  await requireMinVersion(data);
  if (!isAdmin(uid)) throw new functions.https.HttpsError("permission-denied", "Admin only.");
  return rerollIfDue(!!(data && data.force === true));
});

exports.rerollIfDue = rerollIfDue; // for functions/test/run.js to call directly - see its own note
