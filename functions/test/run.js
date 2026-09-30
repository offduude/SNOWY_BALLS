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
const { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, serverTimestamp, collection, query, where, getDocs } = require("firebase/firestore");

const PROJECT_ID = "snowy-balls-5f7a5"; // same id as production - safe: emulators never touch the real project regardless (see firebase.json's own note)
const ADMIN_UID = "zrHVHG8QVXfZfMhUn0PJHf9TEKO2"; // must match functions/lib/auth.js exactly
const UID_A = "test-trader-a";
const UID_B = "test-trader-b";

process.env.GCLOUD_PROJECT = PROJECT_ID;
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const clientApp = initializeApp({ projectId: PROJECT_ID, apiKey: "emulator-fake-key" }, "test-client");
const clientAuth = getAuth(clientApp);
connectAuthEmulator(clientAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099"}`, { disableWarnings: true });
const clientFunctions = getFunctions(clientApp);
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

async function asUid(uid) {
  await signOut(clientAuth).catch(() => {});
  if (uid === null) return; // stay signed out
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
  await check("purchase charges the real price and grants the item", async () => {
    const before = (await db.collection("saves").doc(UID_A).get()).data().coins;
    const res = await call("purchase", { itemId: "water_bottle" }); // price 4
    assert.strictEqual(res.data.coins, before - 4);
    assert.strictEqual(res.data.buffItems.water_bottle, 1);
    const stock = (await db.collection("shopStock").doc("current").get()).data();
    assert.strictEqual(stock.stock[0], null, "a consumable's slot must clear on any single purchase");
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
  await seedSave(UID_A, { coins: 50000 }); // reset for the rest of the tests below
  await check("purchase of a projectile stack grants exactly one unit and decrements the SHARED remaining amount", async () => {
    const before = (await db.collection("saves").doc(UID_A).get()).data().coins;
    const res = await call("purchase", { itemId: "grenade" }); // unitPrice 1875, 2 left in the seeded stock
    assert.strictEqual(res.data.coins, before - 1875);
    assert.strictEqual(res.data.projectiles.grenade, 1); // exactly one, never the item's amount range
    let stock = (await db.collection("shopStock").doc("current").get()).data();
    assert.strictEqual(stock.offers[2].amount, 1, "one left after the first purchase");
    assert.strictEqual(stock.stock[2], "grenade", "slot stays filled while stock remains");
    await call("purchase", { itemId: "grenade" }); // the last one
    stock = (await db.collection("shopStock").doc("current").get()).data();
    assert.strictEqual(stock.stock[2], null, "slot clears once the shared stack hits zero");
    try {
      await call("purchase", { itemId: "grenade" }); // nothing left
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "functions/failed-precondition");
    }
  });

  await check("useBuff starts a timed buff", async () => {
    await seedSave(UID_A, { buffItems: { snowy_cube: 1 } });
    const res = await call("useBuff", { buffId: "snowy_cube" }); // duration 120s, coinMultiplier 1.1
    assert.strictEqual(res.data.buffItems.snowy_cube, undefined);
    assert.strictEqual(res.data.buffs.length, 1);
    assert.strictEqual(res.data.buffs[0].id, "snowy_cube");
  });

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

  console.log("\n-- claimThrow's saveProjectile roll is taken server-side now, not trusted from (or mirrored to) the client (2026-09-30) --");
  await resetRateLimit(UID_A); // a clean claimThrow counter - the section above already used several calls of its own
  await check("no active saveProjectile buff: never saved, always consumes (chance 0 is deterministic, no RNG needed to prove it)", async () => {
    await seedSave(UID_A, { buffs: [], projectiles: { chestnut: 5 } });
    const res = await call("claimThrow", { projectileId: "chestnut", hit: true });
    assert.strictEqual(res.data.saved, false);
    assert.strictEqual(res.data.projectiles.chestnut, 4);
  });
  await check("a real, stacked saveProjectile buff genuinely saves most throws - a real independent roll against real buff data, not a client-trusted flag", async () => {
    // water_bottle (10%) + mints (20%) + mints_epic (50%) + stanczak_mayo (50%), all real shop items with a real
    // saveProjectile effect: combined chance = 1 - (0.9 x 0.8 x 0.5 x 0.5) = 82%.
    const endsAt = Date.now() + 60000;
    await seedSave(UID_A, {
      buffs: [
        { id: "water_bottle", endsAt },
        { id: "mints", endsAt },
        { id: "mints_epic", endsAt },
        { id: "stanczak_mayo", endsAt },
      ],
      projectiles: { chestnut: 500 },
    });
    const TRIALS = 20;
    let saved = 0;
    for (let i = 0; i < TRIALS; i++) {
      const res = await call("claimThrow", { projectileId: "chestnut", hit: true });
      if (res.data.saved) saved++;
    }
    // A generous floor (expected ~16.4 of 20 at 82%) - astronomically unlikely to false-fail (binomial tail),
    // while still only passing if the roll is genuinely reading the real 82% instead of, say, always false.
    assert.ok(saved >= 10, `expected most of ${TRIALS} throws to be saved at an 82% chance, only ${saved} were`);
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
    const res = await call("sellSkin", { kind: "character", id: "pryk", n: 1 }); // sellPrice 37496
    assert.strictEqual(res.data.coins, before + 37496);
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
  await check("shopStock/current is readable by a signed-OUT client (public read, per firestore.rules)", async () => {
    await asUid(null); // still signed out from the auth-gate section's own asUid(null) - explicit here for clarity
    const snap = await getDoc(doc(clientDb, "shopStock", "current"));
    assert.ok(snap.exists(), "a signed-out client should be able to read the public shop stock doc");
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

  console.log("\n-- Admin account: free economy, but normal trading --");
  await check("purchase is free for the admin uid", async () => {
    await asUid(ADMIN_UID);
    await seedSave(ADMIN_UID, { coins: 0 });
    await seedStock(["daniels_coin"], [null]); // needs to actually be in stock too - admin gets no special-casing on THAT check
    const res = await call("purchase", { itemId: "daniels_coin" }); // price 6750 - would fail for anyone else at 0 coins
    assert.strictEqual(res.data.coins, 0); // never charged
    assert.strictEqual(res.data.buffItems.daniels_coin, 1);
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

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Test run crashed:", e);
  process.exit(1);
});
