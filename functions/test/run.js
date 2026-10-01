// Emulator-only smoke test (see docs/NOTES.md, snowy-balls-blaze-migration memory): exercises the real callable
// Functions against the Firestore/Functions/Auth emulator, never the real project. Run via `npm run emulators:test`
// (wraps this in `firebase emulators:exec`, which starts the emulators, sets FIRESTORE_EMULATOR_HOST /
// FIREBASE_AUTH_EMULATOR_HOST / FUNCTIONS_EMULATOR_HOST for this process automatically, runs this script, then
// tears the emulators back down - nothing here persists between runs and nothing here can reach production).
//
// Uses firebase-admin (server-side) to seed test saves directly, and the regular firebase client SDK (pointed at
// the emulators) to actually CALL the Functions as each test account would - signInWithCustomToken stands in for
// a real Google sign-in, since the Auth emulator accepts a custom token for any uid with no real OAuth involved.
const assert = require("assert");
const admin = require("firebase-admin");
const { initializeApp } = require("firebase/app");
const { getAuth, connectAuthEmulator, signInWithCustomToken, signOut } = require("firebase/auth");
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require("firebase/functions");
const { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, serverTimestamp, collection, query, where, orderBy, limit, getDocs } = require("firebase/firestore");

const PROJECT_ID = "snowy-balls-5f7a5"; // same id as production - safe: emulators never touch the real project regardless (see firebase.json's own note)
const ADMIN_UID = "zrHVHG8QVXfZfMhUn0PJHf9TEKO2"; // must match functions/lib/auth.js exactly
const ADMIN_COINS = 999999999; // must match functions/lib/auth.js exactly
const UID_A = "test-trader-a";
const UID_B = "test-trader-b";

process.env.GCLOUD_PROJECT = PROJECT_ID;
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const clientApp = initializeApp({ projectId: PROJECT_ID, apiKey: "emulator-fake-key" }, "test-client");
const clientAuth = getAuth(clientApp);
connectAuthEmulator(clientAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099"}`, { disableWarnings: true });
const clientFunctions = getFunctions(clientApp, "europe-central2"); // must match every exports.* function's own .region() (2026-10-02) - the client SDK defaults to us-central1 otherwise and would never find any of them
connectFunctionsEmulator(clientFunctions, "127.0.0.1", 5001); // matches firebase.json's emulators.functions.port
const clientDb = getFirestore(clientApp);
connectFirestoreEmulator(clientDb, "127.0.0.1", 8080); // matches firebase.json's emulators.firestore.port - used only to verify the shopStock read RULE (public, signed out included), everything else goes through Admin SDK `db` or the callable Functions

// The real generation logic (functions/lib/shopStock.js) via functions/shop.js's own direct export - see that
// file's header comment for why a scheduled trigger can't be exercised through the emulator's HTTP layer the way
// every other Function here is tested. Requiring it in THIS process reuses the admin app this file already
// initialized above (functions/lib/admin.js's own `if (admin.apps.length === 0)` guard sees it's already there).
const { rerollIfDue } = require("../shop");

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL - ${name}`);
    console.error(`    ${e && e.message ? e.message : e}`);
  }
}

async function seedSave(uid, fields) {
  await db.collection("saves").doc(uid).set(fields, { merge: true });
}

// Writes the shop stock doc DIRECTLY (Admin SDK, bypasses rules and the real reroll RNG entirely) so
// purchase()-against-real-stock tests are deterministic - which items are on sale, and with what remaining
// amount, needs to be known exactly rather than left to chance for a test to mean anything.
async function seedStock(stock, offers) {
  const now = Date.now();
  await db.collection("shopStock").doc("current").set({ stock, offers, nextRerollAt: now + 300000, generatedAt: now });
}

// Every test identity's real email claim (2026-10-01, the invite-only allowlist - see functions/lib/auth.js
// ALLOWED_EMAILS and firestore.rules isAllowedEmail). A custom token carries no email by default - without this,
// EVERY test in this file would start failing requireAuth the instant the allowlist shipped, not just the ones
// about it specifically. Which real allowed email a given test uid gets doesn't matter beyond membership - the
// allowlist checks the email claim alone, never a uid<->email correspondence (that pairing is something only a
// real Google sign-in itself enforces) - picked distinct ones below purely so a test reads like 5 different
// people, not because the code cares. `test-trader-not-invited` is the one deliberately or intentionally OMITTED
// here, so its real email (below) stays off the list - that's the whole point of the negative test that uses it.
const TEST_EMAILS = {
  "test-trader-a": "offduude@gmail.com",
  "test-trader-b": "domimarzec111@gmail.com",
  "test-trader-c": "kubamolo592@gmail.com",
  [ADMIN_UID]: "snowyballs759@gmail.com",
  "test-trader-not-invited": "a-real-stranger@gmail.com",
};

// `createCustomToken`'s own `additionalClaims` CANNOT set `email` (confirmed live - Firebase reserves certain
// claim names, email included, and silently drops them from a custom token; the resulting ID token had no email
// claim at all) - the real, working way to get a uid an email claim in the emulator is to give that uid an
// actual Auth user record with one FIRST (`createUser`), then mint a plain custom token for it - the ID token
// that comes back then carries the real user record's email, confirmed live via getIdTokenResult(). Idempotent
// (ignores "already exists" - this file signs in as the same handful of uids many times over the run).
const ensuredAuthUsers = new Set();
async function ensureAuthUser(uid, email) {
  if (ensuredAuthUsers.has(uid)) return;
  ensuredAuthUsers.add(uid);
  try {
    await admin.auth().createUser({ uid, email, emailVerified: true });
  } catch (e) {
    if (e.code !== "auth/uid-already-exists") throw e;
  }
}

async function asUid(uid) {
  await signOut(clientAuth).catch(() => {});
  if (uid === null) return; // stay signed out
  const email = TEST_EMAILS[uid] || "offduude@gmail.com"; // any allowed email works for an uid not listed above
  await ensureAuthUser(uid, email);
  const token = await admin.auth().createCustomToken(uid);
  await signInWithCustomToken(clientAuth, token);
}

function call(name, data) {
  return httpsCallable(clientFunctions, name)(data);
}

// Every test section below that calls proposeTrade more than a couple of times shares ONE uid's rate-limit
// counter (test-trader-a, 3 per 300s) - without resetting it between sections, an earlier section's calls trip
// the cap for a LATER section that isn't trying to test rate limiting at all. Deleting the doc directly (Admin
// SDK, bypasses everything) resets it cleanly between sections; the dedicated "Rate limiting" section still gets
// a clean counter to trip on its own.
async function resetRateLimit(uid) {
  await db.collection("rateLimits").doc(uid).delete();
}

async function main() {
  console.log("Seeding emulator Firestore...");
  await seedSave(UID_A, { coins: 50000, skinCounts: { character: { pryk: 1 }, scenery: {}, weather: {} } });
  await seedSave(UID_B, { coins: 100, skinCounts: { character: {}, scenery: {}, weather: {} } });
  await seedSave(ADMIN_UID, { coins: 0, skinCounts: { character: {}, scenery: {}, weather: {} } });

  console.log("\n-- Auth gate: signed-out callers must be refused --");
  await asUid(null);
  await check("proposeTrade refuses when signed out", async () => {
    try {
      await call("proposeTrade", { toUid: UID_B, offer: { coins: 10 }, request: {} });
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "functions/unauthenticated", `expected unauthenticated, got ${e.code}: ${e.message}`);
    }
  });
  await check("acceptTrade refuses when signed out", async () => {
    try {
      await call("acceptTrade", { tradeId: "whatever" });
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "functions/unauthenticated", `expected unauthenticated, got ${e.code}: ${e.message}`);
    }
  });
  await check("purchase refuses when signed out", async () => {
    try {
      await call("purchase", { itemId: "water_bottle" });
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "functions/unauthenticated", `expected unauthenticated, got ${e.code}: ${e.message}`);
    }
  });
  await check("claimThrow refuses when signed out", async () => {
    try {
      await call("claimThrow", { projectileId: "snowball", hit: true });
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "functions/unauthenticated", `expected unauthenticated, got ${e.code}: ${e.message}`);
    }
  });

  console.log("\n-- purchase / useBuff / openBox / sellSkin --");
  await asUid(UID_A);
  // Deterministic stock, not whatever a real reroll happens to roll: water_bottle (a consumable, price 4) and
  // daniels_coin (a consumable, price 6750) each in their own slot with no offer (consumables never have one -
  // see shopStock.js's rollOffer), grenade (a projectile stack, unitPrice 1875) with exactly 2 left.
  await seedStock(["water_bottle", "daniels_coin", "grenade"], [null, null, { amount: 2 }]);
  await check("purchase rejects an item that isn't currently in stock", async () => {
    try {
      await call("purchase", { itemId: "burger" }); // a real item, just not in the seeded stock above
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "functions/failed-precondition");
      assert.ok(/stock/i.test(e.message), `expected a "not in stock" message, got: ${e.message}`);
    }
  });
  await check("purchase charges the real price and grants the item - and does NOT touch the shared stock doc at all (2026-09-30)", async () => {
    const stockBefore = (await db.collection("shopStock").doc("current").get()).data();
    const before = (await db.collection("saves").doc(UID_A).get()).data().coins;
    const res = await call("purchase", { itemId: "water_bottle" }); // price 4
    assert.strictEqual(res.data.coins, before - 4);
    assert.strictEqual(res.data.buffItems.water_bottle, 1);
    const stockAfter = (await db.collection("shopStock").doc("current").get()).data();
    assert.deepStrictEqual(stockAfter, stockBefore, "the GLOBAL stock doc must be completely untouched by a purchase - it's a shared CATALOG now, not a shared pool");
    const saveA = (await db.collection("saves").doc(UID_A).get()).data();
    assert.strictEqual(saveA.shopBought.bought.water_bottle, 1, "this player's OWN purchase count is what actually tracks it");
  });
  await check("purchase rejects an unaffordable item (still in stock, just too expensive)", async () => {
    await seedSave(UID_A, { coins: 1 }); // force it unaffordable
    try {
      await call("purchase", { itemId: "daniels_coin" }); // price 6750, still in the seeded stock above
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "functions/failed-precondition");
      assert.ok(/coins/i.test(e.message), `expected a "not enough coins" message, got: ${e.message}`);
    }
  });
  await seedSave(UID_A, { coins: 50000, shopBought: { generatedAt: null, bought: {} } }); // reset for the rest of the tests below
  await check("purchase of a projectile stack grants exactly one unit and tracks THIS PLAYER's own remaining quota - the shared stock doc is never touched", async () => {
    const before = (await db.collection("saves").doc(UID_A).get()).data().coins;
    const res = await call("purchase", { itemId: "grenade" }); // unitPrice 1875, 2 rolled in the seeded stock
    assert.strictEqual(res.data.coins, before - 1875);
    assert.strictEqual(res.data.projectiles.grenade, 1); // exactly one, never the item's amount range
    assert.strictEqual(res.data.remaining, 1, "one left of MY OWN quota after the first purchase");
    const stock = (await db.collection("shopStock").doc("current").get()).data();
    assert.strictEqual(stock.offers[2].amount, 2, "the shared doc's own rolled amount must be completely unaffected");
    await call("purchase", { itemId: "grenade" }); // the second (and, for THIS player, last) one
    try {
      await call("purchase", { itemId: "grenade" }); // this player's own quota (2) is now used up
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "functions/failed-precondition");
    }
  });
  await check("a DIFFERENT player's purchases are completely independent - the whole point of this rework", async () => {
    // UID_A just bought out their own full quota of grenade (2/2) in the check above. UID_B, seeing the exact
    // same shared roll, must still be able to buy their own full 2 - proving nothing UID_A did affected them.
    await seedSave(UID_B, { coins: 50000, shopBought: { generatedAt: null, bought: {} } });
    await asUid(UID_B);
    const res1 = await call("purchase", { itemId: "grenade" });
    assert.strictEqual(res1.data.remaining, 1, "UID_B's own quota starts fresh regardless of what UID_A already bought");
    const res2 = await call("purchase", { itemId: "grenade" });
    assert.strictEqual(res2.data.remaining, 0);
    await asUid(UID_A); // back to the account the rest of this file's sections expect to be signed in as
  });
  await check("purchase against a NEW roll gives a fresh quota, even for the same item", async () => {
    await seedStock(["grenade"], [{ amount: 3 }]); // a brand-new roll (new generatedAt) - UID_A's old quota must NOT carry over
    const res = await call("purchase", { itemId: "grenade" });
    assert.strictEqual(res.data.remaining, 2, "a new roll resets this player's quota, even though they'd already used up their old one");
  });

  await check("useBuff starts a timed buff", async () => {
    await seedSave(UID_A, { buffItems: { snowy_cube: 1 } });
    const res = await call("useBuff", { buffId: "snowy_cube" }); // duration 120s, coinMultiplier 1.1
    assert.strictEqual(res.data.buffItems.snowy_cube, undefined);
    assert.strictEqual(res.data.buffs.length, 1);
    assert.strictEqual(res.data.buffs[0].id, "snowy_cube");
  });

  console.log("\n-- Toy Tank: a real per-player personal shop reroll (2026-09-30), not a client-side local one --");
  await seedStock(["water_bottle"], [null]); // a known GLOBAL stock, to prove personal purchases never touch it
  await check("useBuff on toy_tank generates a real personalShopStock, expiring exactly when the global stock would reroll next", async () => {
    await seedSave(UID_A, { buffItems: { toy_tank: 1 }, buffs: [] }); // buffs: [] - a real leftover buff from an earlier section would otherwise make the "no buffs entry" check below meaningless
    const globalBefore = (await db.collection("shopStock").doc("current").get()).data();
    const res = await call("useBuff", { buffId: "toy_tank" }); // charge item, no `duration` - only the personalShopStock branch should fire
    assert.ok(res.data.personalShopStock, "expected a personalShopStock in the response");
    assert.ok(Array.isArray(res.data.personalShopStock.stock) && res.data.personalShopStock.stock.length > 0, "expected a genuinely rolled stock, not an empty one");
    assert.strictEqual(res.data.personalShopStock.expiresAt, globalBefore.nextRerollAt, "a personal reroll must expire exactly when the real global reroll would happen, not on its own separate timer");
    assert.ok(!res.data.buffs.some((b) => b.id === "toy_tank"), "toy_tank itself still gets no `buffs` entry - unrelated to the personal reroll, see this function's own note");
    const saveA = (await db.collection("saves").doc(UID_A).get()).data();
    assert.deepStrictEqual(saveA.personalShopStock.stock, res.data.personalShopStock.stock, "must actually be persisted, not just returned");
  });
  await check("purchase prioritizes an active personal stock over the global one, and never touches the global doc", async () => {
    const saveA = (await db.collection("saves").doc(UID_A).get()).data();
    const personalItemId = saveA.personalShopStock.stock.find((id) => id); // any real (non-null) id from the personal roll
    await seedSave(UID_A, { coins: 50000, buffItems: {}, projectiles: {} }); // clean counters so "+1 after buying" is unambiguous regardless of which item got picked
    const globalBefore = (await db.collection("shopStock").doc("current").get()).data();
    const res = await call("purchase", { itemId: personalItemId });
    assert.strictEqual(res.data.usedPersonalStock, true);
    const globalAfter = (await db.collection("shopStock").doc("current").get()).data();
    assert.deepStrictEqual(globalAfter.stock, globalBefore.stock, "the GLOBAL stock must be completely untouched by a personal purchase");
    // Whether the slot itself clears depends on the item's OWN category (a consumable always empties its slot; a
    // projectile stack only does once its rolled amount hits 0 - already covered by the earlier, item-specific
    // global-stock tests) - what THIS test actually claims is just "the purchase was granted, from the personal
    // stock, real state changed", not the exact resulting stock shape for whichever id happened to get rolled.
    const granted = (res.data.buffItems && res.data.buffItems[personalItemId]) || (res.data.projectiles && res.data.projectiles[personalItemId]);
    assert.strictEqual(granted, 1, "exactly one unit of the bought item must have been granted");
  });
  await check("purchase rejects an item that's only in global stock while a personal stock is active and doesn't have it", async () => {
    // water_bottle is real, real GLOBAL stock (seeded above) - but not necessarily in the personal roll, and
    // personal takes priority whenever it's active, so this must fail exactly like "not currently in stock"
    // unless water_bottle genuinely happens to also be in the personal roll (a real, if unlikely, possibility -
    // guard against test flakiness by skipping the assertion in that one coincidental case).
    const saveA = (await db.collection("saves").doc(UID_A).get()).data();
    if (saveA.personalShopStock.stock.includes("water_bottle")) return; // coincidence - nothing meaningful to assert here
    try {
      await call("purchase", { itemId: "water_bottle" });
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "functions/failed-precondition");
    }
  });
  await check("an EXPIRED personal stock is ignored - purchase falls back to the real global stock", async () => {
    await seedSave(UID_A, { personalShopStock: { stock: ["daniels_coin"], offers: [null], expiresAt: Date.now() - 1000 } }); // already expired
    await seedStock(["daniels_coin"], [null]); // must now come from here, not the expired personal one
    const before = (await db.collection("saves").doc(UID_A).get()).data().coins;
    const res = await call("purchase", { itemId: "daniels_coin" }); // price 6750
    assert.strictEqual(res.data.usedPersonalStock, false);
    assert.strictEqual(res.data.coins, before - 6750);
  });
  await seedSave(UID_A, { personalShopStock: null }); // clean up for whatever runs after this section

  console.log("\n-- claimThrow: trusts hit/miss, computes (never trusts) the reward --");
  await seedSave(UID_A, { coins: 0, lifetimeCoins: 0, buffs: [], projectiles: {} });
  await check("a plain hit pays exactly the projectile's real base hit value", async () => {
    const res = await call("claimThrow", { projectileId: "snowball", hit: true }); // rarity "default", hitValue 4 - snowball is regen so no ownership check
    assert.strictEqual(res.data.reward, 4);
    assert.strictEqual(res.data.coins, 4);
  });
  await check("a miss pays exactly rewards.missCoins (0 today)", async () => {
    const before = (await db.collection("saves").doc(UID_A).get()).data().coins;
    const res = await call("claimThrow", { projectileId: "snowball", hit: false });
    assert.strictEqual(res.data.reward, 0);
    assert.strictEqual(res.data.coins, before);
  });
  await check("a real, owned consumable projectile is actually consumed", async () => {
    await seedSave(UID_A, { projectiles: { chestnut: 2 } });
    const res = await call("claimThrow", { projectileId: "chestnut", hit: false }); // miss, to isolate the consumption check
    assert.strictEqual(res.data.projectiles.chestnut, 1);
  });
  await check("a consumable the player doesn't own is refused", async () => {
    await seedSave(UID_A, { projectiles: {} });
    try {
      await call("claimThrow", { projectileId: "chestnut", hit: true });
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "functions/failed-precondition");
    }
  });
  // From here, chestnut (common, hitValue 16, no override) rather than snowball (rarity "default", hitValue 4) -
  // a plentiful stock so ownership never blocks these, and a base value that actually moves under a multiplier.
  await seedSave(UID_A, { projectiles: { chestnut: 99 } });
  await check("a REAL, currently-active coinMultiplier buff is applied exactly", async () => {
    await seedSave(UID_A, { buffs: [{ id: "snowy_cube", endsAt: Date.now() + 60000 }] }); // coinMultiplier 1.1
    const res = await call("claimThrow", { projectileId: "chestnut", hit: true });
    assert.strictEqual(res.data.reward, Math.round(16 * 1.1)); // 18
  });
  await check("an EXPIRED buff still sitting in the array does NOT count - evaluated at claim time, not aim time", async () => {
    await seedSave(UID_A, { buffs: [{ id: "snowy_cube", endsAt: Date.now() - 1000 }] }); // already ended
    const res = await call("claimThrow", { projectileId: "chestnut", hit: true });
    assert.strictEqual(res.data.reward, 16); // the multiplier must NOT apply
  });
  await check("a faceHit is honored (exact faceMultiplier) when the matching summon buff is genuinely active", async () => {
    await seedSave(UID_A, { buffs: [], buffItems: { tomato_juice: 1 } });
    await call("useBuff", { buffId: "tomato_juice" }); // real server-side "face" event window, 20s (economy.json faceWindow.durationMs)
    const res = await call("claimThrow", { projectileId: "chestnut", hit: true, faceHit: true, eventName: "face" });
    assert.strictEqual(res.data.reward, Math.round(16 * 1.5)); // faceWindow.faceMultiplier
    const saveA = (await db.collection("saves").doc(UID_A).get()).data();
    assert.ok(!saveA.buffs.some((b) => b.id === "tomato_juice"), "the event must be consumed - can't be claimed twice");
  });
  await check("a second faceHit claim against the same (now-consumed) event gets no bonus", async () => {
    const res = await call("claimThrow", { projectileId: "chestnut", hit: true, faceHit: true, eventName: "face" });
    assert.strictEqual(res.data.reward, 16); // plain hit value only
  });
  await check("a faceHit claimed with no server-verified active summon (e.g. a natural spawn) is not honored, not rejected", async () => {
    await seedSave(UID_A, { buffs: [] }); // nothing summoned
    const res = await call("claimThrow", { projectileId: "chestnut", hit: true, faceHit: true, eventName: "disco" });
    assert.strictEqual(res.data.reward, 16); // no bonus, but still a normal successful hit
  });

  console.log("\n-- claimThrow's `saved` claim is trusted directly from the client now, same trust level as `hit` (2026-09-30) --");
  await resetRateLimit(UID_A); // a clean claimThrow counter - the section above already used several calls of its own
  await check("no `saved` claim: consumes a real unit, regardless of buffs", async () => {
    await seedSave(UID_A, { buffs: [], projectiles: { chestnut: 5 } });
    const res = await call("claimThrow", { projectileId: "chestnut", hit: true });
    assert.strictEqual(res.data.saved, false);
    assert.strictEqual(res.data.projectiles.chestnut, 4);
  });
  await check("a `saved: true` claim is trusted directly - no unit consumed, even with zero active saveProjectile buffs", async () => {
    await seedSave(UID_A, { buffs: [], projectiles: { chestnut: 5 } });
    const res = await call("claimThrow", { projectileId: "chestnut", hit: true, saved: true });
    assert.strictEqual(res.data.saved, true);
    assert.strictEqual(res.data.projectiles.chestnut, 5); // unchanged - trusted, not re-derived from buffs
  });
  await check("a `saved` claim still requires genuinely owning the projectile", async () => {
    await seedSave(UID_A, { buffs: [], projectiles: {} });
    try {
      await call("claimThrow", { projectileId: "chestnut", hit: true, saved: true });
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "functions/failed-precondition");
    }
  });
  await seedSave(UID_A, { coins: 50000, buffs: [] }); // reset for the tests below, which assume a healthy balance

  await check("openBox draws from the real pool and charges the real price", async () => {
    const before = (await db.collection("saves").doc(UID_A).get()).data().coins;
    const res = await call("openBox", { kind: "character" }); // price 9999
    assert.strictEqual(res.data.coins, before - 9999);
    assert.ok(["black_andek", "cool_andek", "pryk", "banan"].includes(res.data.itemId));
  });

  await check("sellSkin credits the fixed sellPrice", async () => {
    await seedSave(UID_A, { skinCounts: { character: { pryk: 1 }, scenery: {}, weather: {} } });
    const before = (await db.collection("saves").doc(UID_A).get()).data().coins;
    const res = await call("sellSkin", { kind: "character", id: "pryk", n: 1 }); // sellPrice 13332 (2026-10-01 retune - was 37496)
    assert.strictEqual(res.data.coins, before + 13332);
  });
  await check("sellSkin selling out the EQUIPPED skin re-equips the kind's default (2026-09-30)", async () => {
    await seedSave(UID_A, { skinCounts: { character: { pryk: 1 }, scenery: {}, weather: {} }, equipped: { character: "pryk", scenery: "frosty", weather: "snow", projectile: "snowball" } });
    const res = await call("sellSkin", { kind: "character", id: "pryk", n: 1 });
    assert.strictEqual(res.data.equipped.character, "andek", "should fall back to the character kind's real default item");
    const saveA = (await db.collection("saves").doc(UID_A).get()).data();
    assert.strictEqual(saveA.equipped.character, "andek");
  });
  await check("sellSkin selling a skin that ISN'T equipped leaves `equipped` alone", async () => {
    await seedSave(UID_A, { skinCounts: { character: { pryk: 2 }, scenery: {}, weather: {} }, equipped: { character: "andek", scenery: "frosty", weather: "snow", projectile: "snowball" } });
    const res = await call("sellSkin", { kind: "character", id: "pryk", n: 1 }); // still 1 left, not emptied either way
    assert.strictEqual(res.data.equipped.character, "andek");
  });

  console.log("\n-- Shop stock (Cloud Scheduler) --");
  await check("rerollIfDue(true) generates real stock: guaranteed ids present, offers rolled correctly", async () => {
    await db.collection("shopStock").doc("current").delete(); // brand new, nothing seeded
    const result = await rerollIfDue(true);
    assert.strictEqual(result.rerolled, true);
    const guaranteedIds = ["chestnut", "potato", "stone", "skyr_blue", "water_bottle", "snowy_cube"];
    for (const id of guaranteedIds) assert.ok(result.stock.stock.includes(id), `guaranteed id ${id} missing from a fresh roll`);
    for (let i = 0; i < result.stock.stock.length; i++) {
      const id = result.stock.stock[i];
      const offer = result.stock.offers[i];
      // grenade/drone/tomato/... (category "projectile") always roll an { amount } offer; every consumable never does.
      if (["grenade", "drone", "tomato", "chestnut", "potato", "onion", "pinecone", "stone", "rowan_berry", "egg"].includes(id)) {
        assert.ok(offer && Number.isInteger(offer.amount) && offer.amount > 0, `${id} should have a positive rolled amount`);
      } else {
        assert.strictEqual(offer, null, `${id} is a consumable - it should never have an offer`);
      }
    }
    assert.ok(result.stock.nextRerollAt > Date.now(), "nextRerollAt should be in the future");
  });
  await check("rerollIfDue(false) is a no-op while the current stock isn't due yet", async () => {
    const before = (await db.collection("shopStock").doc("current").get()).data();
    const result = await rerollIfDue(false); // the doc from the test above is still fresh (nextRerollAt hasn't passed)
    assert.strictEqual(result.rerolled, false);
    const after = (await db.collection("shopStock").doc("current").get()).data();
    assert.strictEqual(after.generatedAt, before.generatedAt, "an undue reroll must not touch the stored doc");
  });
  await check("shopStock/current now REFUSES a signed-OUT client (2026-10-01, the invite-only allowlist - was public)", async () => {
    await asUid(null); // still signed out from the auth-gate section's own asUid(null) - explicit here for clarity
    try {
      await getDoc(doc(clientDb, "shopStock", "current"));
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "permission-denied");
    }
  });
  await check("forceRerollShop refuses a non-admin caller", async () => {
    await asUid(UID_A);
    try {
      await call("forceRerollShop", {});
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "functions/permission-denied");
    }
  });
  await check("forceRerollShop refuses when signed out", async () => {
    await asUid(null);
    try {
      await call("forceRerollShop", {});
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "functions/unauthenticated");
    }
  });
  await check("forceRerollShop works for the admin uid and actually rerolls", async () => {
    await asUid(ADMIN_UID);
    const before = (await db.collection("shopStock").doc("current").get()).data();
    const res = await call("forceRerollShop", { force: true });
    assert.strictEqual(res.data.rerolled, true);
    const after = (await db.collection("shopStock").doc("current").get()).data();
    assert.notStrictEqual(after.generatedAt, before.generatedAt, "a forced reroll must actually replace the stock doc");
  });
  await seedStock(["water_bottle"], [null]); // leave a known, simple stock behind for anything after this section

  console.log("\n-- Trading: full propose -> accept flow --");
  await asUid(UID_A); // the shop stock section above ends signed in as the admin uid - back to a normal account
  await seedSave(UID_A, { coins: 50000, skinCounts: { character: { pryk: 1 }, scenery: {}, weather: {} }, reserved: { coins: 0, skins: [] }, outgoingTradeId: null });
  await seedSave(UID_B, { coins: 100, skinCounts: { character: {}, scenery: {}, weather: {} } });
  let tradeId;
  await check("proposeTrade escrows the offer and creates a trade doc", async () => {
    const res = await call("proposeTrade", { toUid: UID_B, offer: { coins: 1000, skins: [{ kind: "character", id: "pryk", qty: 1 }] }, request: { coins: 50, skins: [] } });
    tradeId = res.data.tradeId;
    assert.ok(tradeId);
    const saveA = (await db.collection("saves").doc(UID_A).get()).data();
    assert.strictEqual(saveA.reserved.coins, 1000);
    assert.strictEqual(saveA.outgoingTradeId, tradeId);
  });
  await check("a second outgoing proposeTrade is refused while one is pending", async () => {
    try {
      await call("proposeTrade", { toUid: UID_B, offer: { coins: 1 }, request: {} });
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "functions/failed-precondition");
    }
  });
  await check("acceptTrade moves both sides atomically", async () => {
    await asUid(UID_B);
    const res = await call("acceptTrade", { tradeId });
    assert.strictEqual(res.data.coins, 100 - 50 + 1000);
    assert.strictEqual(res.data.skinCounts.character.pryk, 1);
    const saveA = (await db.collection("saves").doc(UID_A).get()).data();
    assert.strictEqual(saveA.coins, 50000 - 1000 + 50);
    assert.strictEqual(saveA.outgoingTradeId, null);
    assert.strictEqual(saveA.skinCounts.character.pryk, undefined);
    const trade = (await db.collection("trades").doc(tradeId).get()).data();
    assert.strictEqual(trade.status, "accepted");
    const lbA = (await db.collection("leaderboard").doc(UID_A).get()).data();
    assert.strictEqual(lbA.coins, 50000 - 1000 + 50);
  });

  // REGRESSION (2026-10-01): a real bug caught by live-testing, not by this suite - acceptTrade's integrity-check
  // branch used to `throw` from INSIDE the db.runTransaction callback right after queueing the decline's own
  // writes, which Firestore transaction semantics silently discard entirely (throwing aborts the whole
  // transaction). The trade stayed "pending" forever and the sender's escrow stayed reserved forever, even
  // though the caller was told it had been "auto-declined". Fixed by returning a sentinel and throwing OUTSIDE
  // the transaction, after the decline's own commit has already succeeded - this test asserts the decline
  // actually PERSISTS, not just that the call rejects (a check on the thrown error alone would have passed even
  // on the broken version).
  await check("acceptTrade's integrity-check auto-decline actually persists (not just rejects the call)", async () => {
    await asUid(UID_A);
    const res = await call("proposeTrade", { toUid: UID_B, offer: { coins: 500, skins: [] }, request: { coins: 0, skins: [] } });
    const desyncedTradeId = res.data.tradeId;
    // Desync the escrow directly (Admin SDK bypasses rules) - mimics whatever real-world drift this safety net
    // exists for, without needing to actually reproduce one.
    await db.collection("saves").doc(UID_A).update({ outgoingTradeId: null, reserved: { coins: 0, skins: [] } });
    await asUid(UID_B);
    try {
      await call("acceptTrade", { tradeId: desyncedTradeId });
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "functions/failed-precondition");
      assert.ok(/auto-declined/.test(e.message), `expected the auto-decline message, got: ${e.message}`);
    }
    const trade = (await db.collection("trades").doc(desyncedTradeId).get()).data();
    assert.strictEqual(trade.status, "declined", "the decline must actually persist, not just reject the call");
    assert.strictEqual(trade.reason, "integrity");
    const saveA = (await db.collection("saves").doc(UID_A).get()).data();
    assert.strictEqual(saveA.outgoingTradeId, null);
    assert.strictEqual(saveA.reserved.coins, 0);
  });

  console.log("\n-- Trading: cancel / decline --");
  await seedSave(UID_A, { coins: 50000, reserved: { coins: 0, skins: [] }, outgoingTradeId: null });
  await resetRateLimit(UID_A); // this section makes several proposeTrade calls that aren't testing the rate limit itself
  await check("cancelTrade releases the escrow", async () => {
    await asUid(UID_A);
    const proposed = await call("proposeTrade", { toUid: UID_B, offer: { coins: 500 }, request: {} });
    await call("cancelTrade", { tradeId: proposed.data.tradeId });
    const saveA = (await db.collection("saves").doc(UID_A).get()).data();
    assert.strictEqual(saveA.outgoingTradeId, null);
    assert.strictEqual(saveA.reserved.coins, 0);
    const trade = (await db.collection("trades").doc(proposed.data.tradeId).get()).data();
    assert.strictEqual(trade.status, "cancelled");
  });
  await check("declineTrade (by the recipient) releases the escrow", async () => {
    const proposed = await call("proposeTrade", { toUid: UID_B, offer: { coins: 500 }, request: {} });
    await asUid(UID_B);
    await call("declineTrade", { tradeId: proposed.data.tradeId });
    const saveA = (await db.collection("saves").doc(UID_A).get()).data();
    assert.strictEqual(saveA.outgoingTradeId, null);
    const trade = (await db.collection("trades").doc(proposed.data.tradeId).get()).data();
    assert.strictEqual(trade.status, "declined");
  });
  await check("only the recipient can decline (the sender gets permission-denied)", async () => {
    await asUid(UID_A);
    const proposed = await call("proposeTrade", { toUid: UID_B, offer: { coins: 10 }, request: {} });
    try {
      await call("declineTrade", { tradeId: proposed.data.tradeId }); // still signed in as A, the sender
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "functions/permission-denied");
    }
    await call("cancelTrade", { tradeId: proposed.data.tradeId }); // clean up the escrow for later tests
  });

  console.log("\n-- Private inventory blocks proposeTrade server-side --");
  await resetRateLimit(UID_A);
  await check("proposeTrade is refused against a private-inventory target, even with a valid offer", async () => {
    await db.collection("leaderboard").doc(UID_B).set({ privateInventory: true }, { merge: true });
    try {
      await call("proposeTrade", { toUid: UID_B, offer: { coins: 10 }, request: {} });
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "functions/failed-precondition");
    } finally {
      await db.collection("leaderboard").doc(UID_B).set({ privateInventory: false }, { merge: true });
    }
  });

  console.log("\n-- getTargetInventory: skinCounts moved off the public leaderboard doc (2026-10-01) --");
  // The owner's own question: "can we even make it that a modified client cannot read the private inventory?"
  // skinCounts used to live on leaderboard/{uid} (public read) - now it's inventoryMirror/{uid} (Admin SDK only),
  // disclosed to a client exclusively through this Function, which checks privacy server-side first.
  await db.collection("inventoryMirror").doc(UID_B).set({ skinCounts: { character: { pryk: 2 }, scenery: {}, weather: {} } });
  await check("getTargetInventory returns the real skinCounts for a non-private target", async () => {
    await asUid(UID_A);
    const res = await call("getTargetInventory", { toUid: UID_B });
    assert.strictEqual(res.data.skinCounts.character.pryk, 2);
  });
  await check("getTargetInventory refuses to disclose skinCounts for a private target, real data notwithstanding", async () => {
    await db.collection("leaderboard").doc(UID_B).set({ privateInventory: true }, { merge: true });
    try {
      const res = await call("getTargetInventory", { toUid: UID_B });
      assert.strictEqual(res.data.skinCounts, null);
    } finally {
      await db.collection("leaderboard").doc(UID_B).set({ privateInventory: false }, { merge: true });
    }
  });
  await check("a client can never read inventoryMirror/{uid} directly, not even their own", async () => {
    try {
      await getDoc(doc(clientDb, "inventoryMirror", UID_A));
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "permission-denied");
    }
  });
  await check("a client can never write inventoryMirror/{uid} directly", async () => {
    try {
      await setDoc(doc(clientDb, "inventoryMirror", UID_A), { skinCounts: { character: { pryk: 999 }, scenery: {}, weather: {} } });
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "permission-denied");
    }
  });
  await check("leaderboard/{uid} refuses a client write that still includes skinCounts (the old, now-removed shape)", async () => {
    try {
      await setDoc(
        doc(clientDb, "leaderboard", UID_A),
        { name: "Trader A", coins: 50000, character: "andek", description: "", updatedAt: serverTimestamp(), skinCounts: {} },
        { merge: true }
      );
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "permission-denied");
    }
  });

  console.log("\n-- Trading: a pending offer auto-declines the instant it becomes uncoverable (2026-10-01) --");
  // The SENDER's own offer can never actually go uncoverable (hard escrow - spendableCoins/spendableSkinCount
  // already protect it everywhere real coins/skins are spent, proven throughout this file already). This section
  // is specifically about the RECIPIENT's side - nothing reserves anything there until they actually accept, so
  // their own spending elsewhere has to be watched for instead. See lib/tradeGuard.js.
  await seedStock(["daniels_coin"], [null]); // a real consumable, price 6750 (economy.json) - the known spend this section uses throughout
  await check("purchase auto-declines a pending incoming offer this player can no longer cover", async () => {
    await resetRateLimit(UID_B);
    await seedSave(UID_A, { coins: 7000, reserved: { coins: 0, skins: [] }, outgoingTradeId: null });
    await seedSave(UID_B, { coins: 0, reserved: { coins: 0, skins: [] }, outgoingTradeId: null });
    await asUid(UID_B);
    const proposed = await call("proposeTrade", { toUid: UID_A, offer: { coins: 0, skins: [] }, request: { coins: 300, skins: [] } });
    await asUid(UID_A);
    await call("purchase", { itemId: "daniels_coin" }); // costs 6750, leaving A with 250 - below the 300 just requested
    const trade = (await db.collection("trades").doc(proposed.data.tradeId).get()).data();
    assert.strictEqual(trade.status, "declined");
    assert.strictEqual(trade.reason, "insufficient");
    const saveB = (await db.collection("saves").doc(UID_B).get()).data();
    assert.strictEqual(saveB.outgoingTradeId, null, "the sender's own escrow must be released too, not just the trade doc marked declined");
  });
  await check("...but a request that's STILL coverable after the same purchase is left alone", async () => {
    await resetRateLimit(UID_B);
    await seedStock(["daniels_coin"], [null]); // a FRESH roll (new generatedAt) - the check above already spent UID_A's one-per-roll quota of this item against the old one
    await seedSave(UID_A, { coins: 7000, reserved: { coins: 0, skins: [] }, outgoingTradeId: null });
    await seedSave(UID_B, { coins: 0, reserved: { coins: 0, skins: [] }, outgoingTradeId: null });
    await asUid(UID_B);
    const proposed = await call("proposeTrade", { toUid: UID_A, offer: { coins: 0, skins: [] }, request: { coins: 100, skins: [] } });
    await asUid(UID_A);
    await call("purchase", { itemId: "daniels_coin" }); // leaves A with 250, still >= the 100 requested
    const trade = (await db.collection("trades").doc(proposed.data.tradeId).get()).data();
    assert.strictEqual(trade.status, "pending", "a still-coverable request must not be touched");
    await asUid(UID_B);
    await call("cancelTrade", { tradeId: proposed.data.tradeId }); // clean up - don't leave this pending for a later section
  });
  await check("acceptTrade triggers the same guard for a DIFFERENT pending incoming offer, not just the one being accepted", async () => {
    const UID_C = "test-trader-c";
    await resetRateLimit(UID_B);
    await resetRateLimit(UID_C);
    await seedSave(UID_A, { coins: 300, reserved: { coins: 0, skins: [] }, outgoingTradeId: null, skinCounts: { character: {}, scenery: {}, weather: {} } });
    await seedSave(UID_B, { coins: 0, reserved: { coins: 0, skins: [] }, outgoingTradeId: null });
    await seedSave(UID_C, { coins: 0, reserved: { coins: 0, skins: [] }, outgoingTradeId: null });
    await asUid(UID_B);
    const fromB = await call("proposeTrade", { toUid: UID_A, offer: { coins: 0, skins: [] }, request: { coins: 250, skins: [] } });
    await asUid(UID_C);
    const fromC = await call("proposeTrade", { toUid: UID_A, offer: { coins: 0, skins: [] }, request: { coins: 100, skins: [] } });
    // A can cover EITHER request right now (300 spendable >= 250, and >= 100) but not both at once (250+100=350).
    await asUid(UID_A);
    await call("acceptTrade", { tradeId: fromB.data.tradeId }); // pays 250, leaving 50 spendable - below C's own 100 request
    const tradeB = (await db.collection("trades").doc(fromB.data.tradeId).get()).data();
    assert.strictEqual(tradeB.status, "accepted", "the trade actually being accepted must be unaffected by its own side-effect");
    const tradeC = (await db.collection("trades").doc(fromC.data.tradeId).get()).data();
    assert.strictEqual(tradeC.status, "declined");
    assert.strictEqual(tradeC.reason, "insufficient");
    const saveC = (await db.collection("saves").doc(UID_C).get()).data();
    assert.strictEqual(saveC.outgoingTradeId, null);
  });
  // REGRESSION (2026-10-02, a real gap found reviewing this rollout): sellSkin is the one function that actually
  // REMOVES skins - unlike purchase/openBox (coins only) it can make a SKIN-based incoming request uncoverable,
  // but it never called the trade guard at all until now. Also the only test in this whole section that exercises
  // declineUncoverableIncomingTrades' `coversSkins` branch - every check above only ever spent coins.
  await check("sellSkin auto-declines a pending incoming offer REQUESTING the exact skin just sold", async () => {
    await resetRateLimit(UID_A);
    await resetRateLimit(UID_B);
    await seedSave(UID_A, { coins: 50000, reserved: { coins: 0, skins: [] }, outgoingTradeId: null, skinCounts: { character: { pryk: 1 }, scenery: {}, weather: {} } });
    await seedSave(UID_B, { coins: 0, reserved: { coins: 0, skins: [] }, outgoingTradeId: null });
    await asUid(UID_B);
    const proposed = await call("proposeTrade", { toUid: UID_A, offer: { coins: 0, skins: [] }, request: { coins: 0, skins: [{ kind: "character", id: "pryk", qty: 1 }] } });
    await asUid(UID_A);
    await call("sellSkin", { kind: "character", id: "pryk", n: 1 }); // sells A's only pryk - B's own request can no longer be covered
    const trade = (await db.collection("trades").doc(proposed.data.tradeId).get()).data();
    assert.strictEqual(trade.status, "declined");
    assert.strictEqual(trade.reason, "insufficient");
    const saveB = (await db.collection("saves").doc(UID_B).get()).data();
    assert.strictEqual(saveB.outgoingTradeId, null, "the sender's own escrow must be released too, not just the trade doc marked declined");
  });

  console.log("\n-- Admin account: an effectively bottomless coin balance (2026-09-30), but normal trading --");
  await check("purchase never actually runs out for the admin uid - coins are FORCED to ADMIN_COINS on every read, not just skipped", async () => {
    await asUid(ADMIN_UID);
    await seedSave(ADMIN_UID, { coins: 0 }); // deliberately seeded at 0 - proves the override is unconditional, not "happened to already be enough"
    await seedStock(["daniels_coin"], [null]); // needs to actually be in stock too - admin gets no special-casing on THAT check
    const res = await call("purchase", { itemId: "daniels_coin" }); // price 6750 - would fail for anyone else at 0 coins
    assert.strictEqual(res.data.coins, ADMIN_COINS - 6750, "a REAL deduction from the forced balance, not a skipped check");
    assert.strictEqual(res.data.buffItems.daniels_coin, 1);
  });
  await check("openBox never actually runs out for the admin uid either", async () => {
    await seedSave(ADMIN_UID, { coins: 0 });
    const res = await call("openBox", { kind: "character" }); // price 9999
    assert.strictEqual(res.data.coins, ADMIN_COINS - 9999);
  });
  await check("trading applies zero special-casing to the admin uid - it still needs real inventory to offer", async () => {
    await seedSave(ADMIN_UID, { coins: 0, skinCounts: { character: {}, scenery: {}, weather: {} } });
    try {
      await call("proposeTrade", { toUid: UID_B, offer: { coins: 500 }, request: {} }); // admin has 0 spendable coins
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "functions/failed-precondition"); // same rejection anyone else would get - no bypass
    }
  });
  await check("...but a normal trade FROM the admin account (once funded) works exactly like any other trade", async () => {
    await seedSave(ADMIN_UID, { coins: 5000 });
    const proposed = await call("proposeTrade", { toUid: UID_B, offer: { coins: 500 }, request: {} });
    await asUid(UID_B);
    const before = (await db.collection("saves").doc(UID_B).get()).data().coins;
    const res = await call("acceptTrade", { tradeId: proposed.data.tradeId });
    assert.strictEqual(res.data.coins, before + 500);
  });

  console.log("\n-- Version gate (config/minVersion, functions/lib/version.js) --");
  await asUid(UID_A);
  await resetRateLimit(UID_A); // the sections above already used several claimThrow calls of their own
  await check("the gate is OFF by default - no config/minVersion doc, every call proceeds normally regardless of clientVersion", async () => {
    await db.collection("config").doc("minVersion").delete();
    const res = await call("claimThrow", { projectileId: "snowball", hit: false, clientVersion: "v0.0.1" });
    assert.ok(res.data);
  });
  await check("a stale build is refused with details.reason === 'outdated-client', not just any failed-precondition", async () => {
    await db.collection("config").doc("minVersion").set({ build: 9999999 });
    try {
      await call("claimThrow", { projectileId: "snowball", hit: false, clientVersion: "v1.1.1" });
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "functions/failed-precondition");
      assert.strictEqual(e.details && e.details.reason, "outdated-client", `got: ${JSON.stringify(e.details)}`);
    }
  });
  await check("a build at or above the minimum succeeds", async () => {
    await db.collection("config").doc("minVersion").set({ build: 100 });
    const res = await call("claimThrow", { projectileId: "snowball", hit: false, clientVersion: "v1.1.100" });
    assert.ok(res.data);
  });
  await check("a missing clientVersion is refused (fail closed) once the gate is on", async () => {
    try {
      await call("claimThrow", { projectileId: "snowball", hit: false });
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.details && e.details.reason, "outdated-client");
    }
  });
  await check("a misconfigured minVersion doc (non-numeric build) fails OPEN, not closed", async () => {
    await db.collection("config").doc("minVersion").set({ build: "not-a-number" });
    const res = await call("claimThrow", { projectileId: "snowball", hit: false, clientVersion: "v0.0.1" });
    assert.ok(res.data);
  });
  await check("config/minVersion now REFUSES a signed-OUT client (2026-10-01, the invite-only allowlist - was public)", async () => {
    await db.collection("config").doc("minVersion").set({ build: 1 });
    await asUid(null);
    try {
      await getDoc(doc(clientDb, "config", "minVersion"));
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "permission-denied");
    }
  });
  await check("config/minVersion can never be written by a client, even signed in", async () => {
    await asUid(UID_A);
    try {
      await setDoc(doc(clientDb, "config", "minVersion"), { build: 1 });
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "permission-denied", `expected the rule to reject this, got: ${e.code} ${e.message}`);
    }
  });
  await db.collection("config").doc("minVersion").delete(); // leave the gate OFF for every section after this one

  console.log("\n-- Rate limiting --");
  await check("proposeTrade trips its 3-per-5-minutes cap", async () => {
    await asUid(UID_A);
    await seedSave(UID_A, { coins: 100000, reserved: { coins: 0, skins: [] }, outgoingTradeId: null });
    await resetRateLimit(UID_A); // a clean counter to trip on its own terms, not whatever earlier sections left behind
    let sawLimit = false;
    for (let i = 0; i < 5; i++) {
      try {
        const res = await call("proposeTrade", { toUid: UID_B, offer: { coins: 1 }, request: {} });
        await call("cancelTrade", { tradeId: res.data.tradeId }); // so the NEXT loop iteration isn't blocked by "already has an outgoing offer" instead
      } catch (e) {
        if (e.code === "functions/resource-exhausted") {
          sawLimit = true;
          break;
        }
        throw e;
      }
    }
    assert.ok(sawLimit, "expected a resource-exhausted error within 5 rapid proposeTrade calls (limit is 3/300s)");
  });

  console.log("\n-- firestore.rules: saves/{uid} client sync survives once server-owned fields exist --");
  // This whole section exists because everything above uses the ADMIN SDK for saves/{uid} reads/writes (via `db`),
  // which BYPASSES firestore.rules entirely - none of it proves the RULE itself is correct. This project has been
  // bitten twice before by a rules bug that looked fine on paper (see docs/NOTES.md, the 2026-09-22 incident) -
  // worth the extra section to actually drive the CLIENT SDK against the real rules engine instead of trusting a
  // read-through.
  await check("a normal client sync (data/updatedAt/session only) still succeeds once the doc also has server-owned fields", async () => {
    await asUid(UID_A);
    // Seed a doc shaped like a real one: client-owned fields (as cloud.js's own syncNow() would have written) PLUS
    // server-owned ones (as a Cloud Function would have added since) - via Admin SDK, bypassing rules, just to set
    // up the starting state.
    await db.collection("saves").doc(UID_A).set({ data: "{}", updatedAt: new Date(), session: "tok", coins: 4242, skinCounts: { character: { pryk: 1 }, scenery: {}, weather: {} } });
    // The exact shape cloud.js's syncNow() sends, through the REAL client SDK, against the REAL rule -
    // serverTimestamp() is required here, not a literal Date: the rule checks updatedAt == request.time (the
    // server's own clock), which only the serverTimestamp() sentinel resolves to - a plain client-supplied
    // Date would never match and every write here would be rejected for that reason alone, real bug or not.
    await setDoc(doc(clientDb, "saves", UID_A), { data: "{\"updated\":true}", updatedAt: serverTimestamp(), session: "tok2" }, { merge: true });
    const after = (await db.collection("saves").doc(UID_A).get()).data();
    assert.strictEqual(after.data, "{\"updated\":true}", "the client's own fields must actually update");
    assert.strictEqual(after.coins, 4242, "a server-owned field the client never mentioned must survive the merge untouched");
    assert.deepStrictEqual(after.skinCounts, { character: { pryk: 1 }, scenery: {}, weather: {} }, "same for a nested server-owned map");
  });
  await check("a client CANNOT change a server-owned field by including it in its own write, even matching the allow-list", async () => {
    await db.collection("saves").doc(UID_A).set({ data: "{}", updatedAt: new Date(), session: "tok", coins: 500 });
    try {
      await setDoc(doc(clientDb, "saves", UID_A), { data: "{}", updatedAt: serverTimestamp(), session: "tok3", coins: 999999999 }, { merge: true });
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "permission-denied", `expected the rule to reject this, got: ${e.code} ${e.message}`);
    }
    const after = (await db.collection("saves").doc(UID_A).get()).data();
    assert.strictEqual(after.coins, 500, "the real value must be completely untouched by the rejected write");
  });

  console.log("\n-- Client-side leaderboard/trades reads (2026-09-30): what cloud.js's refreshLeaderboard/refreshTrades actually query, against the real rules --");
  // These exist for the same reason the saves/{uid} section above does - everything else in this file uses the
  // ADMIN SDK, which bypasses firestore.rules entirely. cloud.js never calls a Cloud Function to read the
  // leaderboard or trades - it queries Firestore directly with the client SDK, so THAT is what needs proving here,
  // not the Functions (already covered above).
  await check("syncNow()'s own leaderboard write shape (now including privateInventory) succeeds and reads back", async () => {
    await asUid(UID_A);
    await setDoc(
      doc(clientDb, "leaderboard", UID_A),
      { name: "Trader A", coins: 50000, character: "andek", description: "", privateInventory: true, updatedAt: serverTimestamp() },
      { merge: true }
    );
    const after = (await db.collection("leaderboard").doc(UID_A).get()).data();
    assert.strictEqual(after.privateInventory, true, "privateInventory must actually reach the doc, not just be allow-listed");
    // Reset to false for the trade-visibility checks below (a private target can't be proposed to - not what this section tests).
    await setDoc(doc(clientDb, "leaderboard", UID_A), { privateInventory: false, updatedAt: serverTimestamp() }, { merge: true });
  });

  await check("cloud.js refreshLeaderboard's own query+filter never surfaces the admin uid, even ranked #1 by coins", async () => {
    // Admin's coins are now effectively infinite (ADMIN_COINS) - if its leaderboard doc exists at all (a Cloud
    // Function's writeLeaderboardMirror can create a bare one), it would sort ahead of every real player. Seed
    // exactly that worst case directly (Admin SDK - a client could never write this itself, see firestore.rules'
    // own uid check) and prove the CLIENT's own query+filter (orderBy coins desc, limit(LEADERBOARD_SIZE+1),
    // then filter out ADMIN_UID and re-slice) still comes back clean.
    await db.collection("leaderboard").doc(ADMIN_UID).set({ skinCounts: {}, coins: ADMIN_COINS }, { merge: true });
    await asUid(UID_A);
    const snap = await getDocs(query(collection(clientDb, "leaderboard"), orderBy("coins", "desc"), limit(21)));
    const rows = snap.docs.filter((d) => d.id !== ADMIN_UID).slice(0, 20);
    assert.ok(!rows.some((d) => d.id === ADMIN_UID), "the admin uid must never survive the filter");
    assert.ok(rows.some((d) => d.id === UID_A), "a real player must still be present - the filter must not have swallowed everyone");
  });

  const UID_C = "test-trader-c"; // a genuine bystander - must see neither side of A<->B's trade below
  await check("cloud.js refreshTrades' own two-query pattern finds exactly the right trade for each participant, and nothing for a bystander", async () => {
    await resetRateLimit(UID_A);
    await asUid(UID_A);
    const proposed = await call("proposeTrade", { toUid: UID_B, offer: { coins: 50 }, request: {} });
    const tradesFor = async (uid) => {
      await asUid(uid);
      const col = collection(clientDb, "trades");
      const [fromSnap, toSnap] = await Promise.all([
        getDocs(query(col, where("fromUid", "==", uid), where("status", "==", "pending"))),
        getDocs(query(col, where("toUid", "==", uid), where("status", "==", "pending"))),
      ]);
      return [...fromSnap.docs, ...toSnap.docs].map((d) => d.id);
    };
    assert.deepStrictEqual(await tradesFor(UID_A), [proposed.data.tradeId], "the sender must see its own outgoing offer");
    assert.deepStrictEqual(await tradesFor(UID_B), [proposed.data.tradeId], "the recipient must see the same offer as incoming");
    assert.deepStrictEqual(await tradesFor(UID_C), [], "a bystander must see neither query return anything");
    await asUid(UID_A);
    await call("cancelTrade", { tradeId: proposed.data.tradeId }); // clean up - leaves no pending trade behind for a later run
  });

  console.log("\n-- Invite-only allowlist: signed in is no longer enough on its own (2026-10-01) --");
  // test-trader-not-invited is deliberately NOT in TEST_EMAILS' allowed set above - a REAL, successful sign-in
  // (the Auth emulator has no concept of "invited" either - Firebase Auth itself never did), just with an email
  // that was never added to ALLOWED_EMAILS/isAllowedEmail.
  await check("requireAuth refuses a signed-in account whose email isn't on the allowlist", async () => {
    await asUid("test-trader-not-invited");
    try {
      await call("claimThrow", { projectileId: "snowball", hit: false });
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "functions/permission-denied");
    }
  });
  await check("firestore.rules refuses the same account reading the leaderboard directly, not just Functions", async () => {
    await asUid("test-trader-not-invited");
    try {
      await getDocs(query(collection(clientDb, "leaderboard"), orderBy("coins", "desc"), limit(1)));
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "permission-denied");
    }
  });
  await check("firestore.rules refuses the same account reading shopStock/current directly", async () => {
    await asUid("test-trader-not-invited");
    try {
      await getDoc(doc(clientDb, "shopStock", "current"));
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "permission-denied");
    }
  });
  await check("an allowed account's own reads of leaderboard/shopStock still work (the gate isn't just 'deny everything')", async () => {
    await resetRateLimit(UID_A);
    await asUid(UID_A);
    const lb = await getDocs(query(collection(clientDb, "leaderboard"), orderBy("coins", "desc"), limit(1)));
    assert.ok(lb.docs.length > 0, "an allowed account must still see the leaderboard");
    const stock = await getDoc(doc(clientDb, "shopStock", "current"));
    assert.ok(stock.exists, "an allowed account must still see the shop stock");
  });
  await check("the admin account passes requireAuth via isAdmin(uid) alone, independent of its own email claim", async () => {
    await asUid(ADMIN_UID); // TEST_EMAILS maps this to the real admin email too, but isAdmin(uid) is the OTHER, independent path - see that function's own note
    const res = await call("getTargetInventory", { toUid: UID_A }); // a cheap, side-effect-free read - just needs to get PAST requireAuth
    assert.ok("skinCounts" in res.data);
  });

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Test run crashed:", e);
  process.exit(1);
});
