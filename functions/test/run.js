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

  console.log("\n-- purchase / useBuff / openBox / sellSkin --");
  await asUid(UID_A);
  await check("purchase charges the real price and grants the item", async () => {
    const before = (await db.collection("saves").doc(UID_A).get()).data().coins;
    const res = await call("purchase", { itemId: "water_bottle" }); // price 4
    assert.strictEqual(res.data.coins, before - 4);
    assert.strictEqual(res.data.buffItems.water_bottle, 1);
  });
  await check("purchase rejects an unaffordable item", async () => {
    try {
      await call("purchase", { itemId: "daniels_coin" }); // price 6750, UID_A now has far less after other tests drain it below
      await seedSave(UID_A, { coins: 1 }); // force it unaffordable regardless of ordering
      await call("purchase", { itemId: "daniels_coin" });
      throw new Error("did not throw");
    } catch (e) {
      assert.strictEqual(e.code, "functions/failed-precondition");
    }
  });
  await seedSave(UID_A, { coins: 50000 }); // reset for the rest of the trading tests below

  await check("useBuff starts a timed buff", async () => {
    await seedSave(UID_A, { buffItems: { snowy_cube: 1 } });
    const res = await call("useBuff", { buffId: "snowy_cube" }); // duration 120s, coinMultiplier 1.1
    assert.strictEqual(res.data.buffItems.snowy_cube, undefined);
    assert.strictEqual(res.data.buffs.length, 1);
    assert.strictEqual(res.data.buffs[0].id, "snowy_cube");
  });

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

  console.log("\n-- Trading: full propose -> accept flow --");
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

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Test run crashed:", e);
  process.exit(1);
});
