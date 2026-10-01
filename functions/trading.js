// proposeTrade / acceptTrade / declineTrade / cancelTrade - Part 2/3 of the plan. Hard escrow: the offered
// coins/skins lock the instant a trade is proposed (`reserved`/`outgoingTradeId` on the sender's own saves/{uid}
// doc), so "the item is no longer available" by the time someone accepts is structurally impossible under normal
// play, not just detected-and-refunded after the fact.
//
// Deliberately NO admin (ADMIN_UID) special-casing anywhere in this file - the owner's explicit call (2026-09-29,
// see docs/NOTES.md and the snowy-balls-blaze-migration memory item 10): the admin/testing account trades under
// exactly the same rules as everyone else here, since it can already mint real inventory for free through
// purchase/useBuff/openBox/sellSkin (functions/economy.js) - nothing to bypass in the trade math itself.
//
// `runWith({ maxInstances: PLAYER_MAX_INSTANCES })` (2026-10-01) on every export here - see lib/scaling.js and
// functions/economy.js's own matching note. `.region("europe-central2")` (2026-10-02) likewise - see
// functions/economy.js's own note on why (the real project's Firestore lives there, not us-central1).
const functions = require("firebase-functions");
const { db, FieldValue } = require("./lib/admin");
const { requireAuth } = require("./lib/auth");
const { applyRateLimits } = require("./lib/rateLimit");
const { normalize, spendableCoins, spendableSkinCount, savesRef, leaderboardRef, inventoryMirrorRef, writeSave, writeLeaderboardMirror, writeInventoryMirror } = require("./lib/saves");
const { requireMinVersion } = require("./lib/version");
const { readIncomingTradeGuard, declineUncoverableIncomingTrades } = require("./lib/tradeGuard");
const { PLAYER_MAX_INSTANCES } = require("./lib/scaling");
const eco = require("./lib/economyData");

function bad(msg) {
  return new functions.https.HttpsError("invalid-argument", msg);
}

const TRADES_COLLECTION = "trades";

// Structural validation only (shapes, types, real item ids, no default-rarity skins) - NOT a balance check. The
// offer side is balance-checked against the sender in proposeTrade; the request side is balance-checked against
// the accepter only at acceptTrade time, since the target isn't guaranteed to hold it at propose time.
function cleanSide(raw) {
  const coins = Number.isInteger(raw && raw.coins) && raw.coins >= 0 ? raw.coins : 0;
  const skinsIn = Array.isArray(raw && raw.skins) ? raw.skins : [];
  const skins = [];
  for (const s of skinsIn) {
    if (!s || !["character", "scenery", "weather"].includes(s.kind) || typeof s.id !== "string" || !Number.isInteger(s.qty) || s.qty <= 0) {
      throw bad("Malformed trade item.");
    }
    const item = eco.skinItem(s.kind, s.id);
    if (!item || item.rarity === "default") throw bad(`${s.id} isn't tradeable.`);
    skins.push({ kind: s.kind, id: s.id, qty: s.qty });
  }
  return { coins, skins };
}

function sideIsEmpty(side) {
  return side.coins === 0 && side.skins.length === 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Read-only: what the trade-compose "YOU WANT" picker actually shows for a target's inventory (2026-10-01,
// replacing a direct client read of leaderboard/{uid}.skinCounts - see inventoryMirrorRef's own note,
// functions/lib/saves.js, and the matching client change in src/saves.js targetSkinsCatalog). The one thing this
// must get right: a target who has since gone private must never have their real inventory disclosed here, no
// matter who's asking or how - openInspect's disabled TRADE button is just the honest UI reflection of this
// check, not the enforcement itself; a modified client could still call this directly, bypassing that button
// entirely, which is exactly why the refusal lives here instead.
//
// FIX (2026-10-02, found reviewing this function): every OTHER callable in this project gets a dedicated
// applyRateLimits check - this one didn't, so it was the one place a signed-in (allowlisted) account could call
// unboundedly, costing a real Firestore read each time. Wrapped in a transaction (previously two plain .get()
// calls) purely to give applyRateLimits a tx to work with - reads still happen in the same order as before,
// just inside db.runTransaction, with the rate-limit check (itself a read-then-write) last, after both real
// reads, same "all reads before any writes" discipline every other callable here already follows.
exports.getTargetInventory = functions.region("europe-central2").runWith({ maxInstances: PLAYER_MAX_INSTANCES }).https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  await requireMinVersion(data);
  const toUid = typeof data.toUid === "string" ? data.toUid : null;
  if (!toUid) throw bad("Missing toUid.");

  return db.runTransaction(async (tx) => {
    const lbSnap = await tx.get(leaderboardRef(toUid));
    const isPrivate = lbSnap.exists && lbSnap.data().privateInventory === true;
    const invSnap = isPrivate ? null : await tx.get(inventoryMirrorRef(toUid));

    await applyRateLimits(tx, [{ uid, key: "getTargetInventory", limit: 20, windowMs: 60000 }]);

    if (isPrivate) return { skinCounts: null }; // private - never disclosed, regardless of who's asking
    return { skinCounts: (invSnap.exists && invSnap.data().skinCounts) || null };
  });
});

exports.proposeTrade = functions.region("europe-central2").runWith({ maxInstances: PLAYER_MAX_INSTANCES }).https.onCall(async (data, context) => {
  const fromUid = requireAuth(context);
  await requireMinVersion(data);
  const toUid = typeof data.toUid === "string" ? data.toUid : null;
  if (!toUid || toUid === fromUid) throw bad("Invalid trade target.");
  const offer = cleanSide(data.offer);
  const request = cleanSide(data.request);
  if (sideIsEmpty(offer) && sideIsEmpty(request)) throw bad("Offer at least a coin or a skin on one side first.");

  const tradeRef = db.collection(TRADES_COLLECTION).doc();

  return db.runTransaction(async (tx) => {
    const fromSnap = await tx.get(savesRef(fromUid));
    const toLbSnap = await tx.get(leaderboardRef(toUid));
    const fromSave = normalize(fromSnap.exists ? fromSnap.data() : null);

    await applyRateLimits(tx, [{ uid: fromUid, key: "proposeTrade", limit: 3, windowMs: 300000 }]);

    if (fromSave.outgoingTradeId) throw new functions.https.HttpsError("failed-precondition", "You already have an outgoing trade offer.");
    if (toLbSnap.exists && toLbSnap.data().privateInventory === true) {
      throw new functions.https.HttpsError("failed-precondition", "This player isn't accepting trades.");
    }
    if (spendableCoins(fromSave) < offer.coins) throw new functions.https.HttpsError("failed-precondition", "Not enough spendable coins.");
    for (const s of offer.skins) {
      if (spendableSkinCount(fromSave, s.kind, s.id) < s.qty) {
        throw new functions.https.HttpsError("failed-precondition", `Not enough spendable ${s.id} to offer.`);
      }
    }

    fromSave.reserved = { coins: offer.coins, skins: offer.skins };
    fromSave.outgoingTradeId = tradeRef.id;

    tx.set(tradeRef, {
      fromUid,
      toUid,
      status: "pending",
      offer,
      request,
      createdAt: FieldValue.serverTimestamp(),
      resolvedAt: null,
      reason: null,
      clientVersion: typeof data.clientVersion === "string" ? data.clientVersion : null,
    });
    writeSave(tx, fromUid, fromSave);

    return { tradeId: tradeRef.id };
  });
});

// ---------------------------------------------------------------------------------------------------------------
exports.acceptTrade = functions.region("europe-central2").runWith({ maxInstances: PLAYER_MAX_INSTANCES }).https.onCall(async (data, context) => {
  const accepterUid = requireAuth(context);
  await requireMinVersion(data);
  const tradeId = typeof data.tradeId === "string" ? data.tradeId : null;
  if (!tradeId) throw bad("Missing tradeId.");
  const tradeRef = db.collection(TRADES_COLLECTION).doc(tradeId);

  const result = await db.runTransaction(async (tx) => {
    const tradeSnap = await tx.get(tradeRef);
    if (!tradeSnap.exists) throw new functions.https.HttpsError("not-found", "Trade not found.");
    const trade = tradeSnap.data();
    if (trade.status !== "pending") throw new functions.https.HttpsError("failed-precondition", "This trade is no longer pending.");
    if (trade.toUid !== accepterUid) throw new functions.https.HttpsError("permission-denied", "This trade isn't addressed to you.");

    const fromSnap = await tx.get(savesRef(trade.fromUid));
    const toSnap = await tx.get(savesRef(accepterUid));
    const fromSave = normalize(fromSnap.exists ? fromSnap.data() : null);
    const toSave = normalize(toSnap.exists ? toSnap.data() : null);
    // The accepter's own coins/skins can move here too (paying out `trade.request`) - if they have ANY OTHER
    // pending incoming offer, accepting this one could leave that other one uncoverable. Read now (excluding
    // THIS trade itself, which this same transaction is about to mark "accepted") - see lib/tradeGuard.js's own
    // note on why this can't wait until after toSave's balance actually changes below.
    const tradeGuard = await readIncomingTradeGuard(tx, accepterUid, tradeId);

    await applyRateLimits(tx, [{ uid: accepterUid, key: "acceptTrade", limit: 10, windowMs: 60000 }]);

    // Integrity check (should always hold under escrow - this is the safety net, not the primary mechanism; see
    // the plan's Part 3): the sender's save must still genuinely cover what it offered. If it doesn't, something
    // desynced the escrow rather than the normal flow - auto-decline with reason "integrity" instead of executing
    // a partial trade.
    //
    // FIX (2026-10-01, a real bug caught live-testing the accept flow): this branch used to `throw` here, inside
    // the transaction, right after queueing the decline's own writes - but throwing from inside a
    // db.runTransaction callback ABORTS the whole transaction, discarding every write queued in it. The decline
    // never actually happened: the trade doc stayed "pending" and the sender's escrow stayed reserved forever,
    // even though the caller got told it was "auto-declined". `return` a sentinel instead - letting THIS
    // transaction commit normally with the decline's writes intact - and throw the user-facing error below,
    // safely outside the transaction, once that commit has already succeeded.
    const fromCovers =
      fromSave.outgoingTradeId === tradeId &&
      fromSave.coins >= trade.offer.coins &&
      trade.offer.skins.every((s) => ((fromSave.skinCounts[s.kind] && fromSave.skinCounts[s.kind][s.id]) || 0) >= s.qty);
    if (!fromCovers) {
      fromSave.reserved = { coins: 0, skins: [] };
      fromSave.outgoingTradeId = null;
      writeSave(tx, trade.fromUid, fromSave);
      tx.update(tradeRef, { status: "declined", reason: "integrity", resolvedAt: FieldValue.serverTimestamp() });
      return { integrityFailed: true };
    }

    if (spendableCoins(toSave) < trade.request.coins) throw new functions.https.HttpsError("failed-precondition", "You don't have enough coins to cover this trade.");
    for (const s of trade.request.skins) {
      if (spendableSkinCount(toSave, s.kind, s.id) < s.qty) {
        throw new functions.https.HttpsError("failed-precondition", `You don't have enough ${s.id} to cover this trade.`);
      }
    }

    // The swap, both sides at once.
    fromSave.coins = fromSave.coins - trade.offer.coins + trade.request.coins;
    toSave.coins = toSave.coins - trade.request.coins + trade.offer.coins;
    for (const s of trade.offer.skins) {
      fromSave.skinCounts[s.kind][s.id] = ((fromSave.skinCounts[s.kind] && fromSave.skinCounts[s.kind][s.id]) || 0) - s.qty;
      if (fromSave.skinCounts[s.kind][s.id] <= 0) delete fromSave.skinCounts[s.kind][s.id];
      toSave.skinCounts[s.kind][s.id] = ((toSave.skinCounts[s.kind] && toSave.skinCounts[s.kind][s.id]) || 0) + s.qty;
    }
    for (const s of trade.request.skins) {
      toSave.skinCounts[s.kind][s.id] = ((toSave.skinCounts[s.kind] && toSave.skinCounts[s.kind][s.id]) || 0) - s.qty;
      if (toSave.skinCounts[s.kind][s.id] <= 0) delete toSave.skinCounts[s.kind][s.id];
      fromSave.skinCounts[s.kind][s.id] = ((fromSave.skinCounts[s.kind] && fromSave.skinCounts[s.kind][s.id]) || 0) + s.qty;
    }
    fromSave.reserved = { coins: 0, skins: [] };
    fromSave.outgoingTradeId = null;

    // CORRECTED (2026-10-02, an earlier version of this comment described a write-collision that can't actually
    // happen - re-derived while reviewing this rollout): declineUncoverableIncomingTrades (below) writes to each
    // GUARDED trade's own t.data.fromUid, and the line right after writes to THIS trade's trade.fromUid - a
    // collision would need some guarded trade to share its fromUid with trade.fromUid. But proposeTrade's own
    // `if (fromSave.outgoingTradeId) throw ...` guarantees any one account has at most ONE outgoing trade at a
    // time, and `readIncomingTradeGuard`'s own `excludeTradeId` already excludes THIS trade from the guard set -
    // so no guarded trade can ever have been sent by trade.fromUid (they're already fully spoken for by the one
    // being accepted right now). No two writes here can ever target the same saves/{uid} doc.
    declineUncoverableIncomingTrades(tx, tradeGuard, toSave);
    writeSave(tx, trade.fromUid, fromSave);
    writeSave(tx, accepterUid, toSave);
    // skinCounts split OUT of the public leaderboard mirror into its own non-public one (2026-10-01) - see
    // inventoryMirrorRef's own note (functions/lib/saves.js).
    writeLeaderboardMirror(tx, trade.fromUid, { coins: fromSave.coins });
    writeLeaderboardMirror(tx, accepterUid, { coins: toSave.coins });
    writeInventoryMirror(tx, trade.fromUid, fromSave.skinCounts);
    writeInventoryMirror(tx, accepterUid, toSave.skinCounts);
    tx.update(tradeRef, { status: "accepted", resolvedAt: FieldValue.serverTimestamp() });

    return { coins: toSave.coins, skinCounts: toSave.skinCounts };
  });

  // Outside the transaction, now that a decline (if any) has already been committed - see this function's own
  // note above on why this can't throw from inside db.runTransaction.
  if (result.integrityFailed) {
    throw new functions.https.HttpsError("failed-precondition", "This trade is no longer valid and has been auto-declined.");
  }
  return result;
});

// ---------------------------------------------------------------------------------------------------------------
exports.declineTrade = functions.region("europe-central2").runWith({ maxInstances: PLAYER_MAX_INSTANCES }).https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  await requireMinVersion(data);
  const tradeId = typeof data.tradeId === "string" ? data.tradeId : null;
  if (!tradeId) throw bad("Missing tradeId.");
  const tradeRef = db.collection(TRADES_COLLECTION).doc(tradeId);

  return db.runTransaction(async (tx) => {
    const tradeSnap = await tx.get(tradeRef);
    if (!tradeSnap.exists) throw new functions.https.HttpsError("not-found", "Trade not found.");
    const trade = tradeSnap.data();
    if (trade.status !== "pending") throw new functions.https.HttpsError("failed-precondition", "This trade is no longer pending.");
    if (trade.toUid !== uid) throw new functions.https.HttpsError("permission-denied", "Only the recipient can decline this trade.");

    const fromSnap = await tx.get(savesRef(trade.fromUid));
    const fromSave = normalize(fromSnap.exists ? fromSnap.data() : null);

    await applyRateLimits(tx, [{ uid, key: "declineTrade", limit: 10, windowMs: 60000 }]);

    if (fromSave.outgoingTradeId === tradeId) {
      fromSave.reserved = { coins: 0, skins: [] };
      fromSave.outgoingTradeId = null;
      writeSave(tx, trade.fromUid, fromSave);
    }
    tx.update(tradeRef, { status: "declined", reason: "declined", resolvedAt: FieldValue.serverTimestamp() });

    return { ok: true };
  });
});

// ---------------------------------------------------------------------------------------------------------------
exports.cancelTrade = functions.region("europe-central2").runWith({ maxInstances: PLAYER_MAX_INSTANCES }).https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  await requireMinVersion(data);
  const tradeId = typeof data.tradeId === "string" ? data.tradeId : null;
  if (!tradeId) throw bad("Missing tradeId.");
  const tradeRef = db.collection(TRADES_COLLECTION).doc(tradeId);

  return db.runTransaction(async (tx) => {
    const tradeSnap = await tx.get(tradeRef);
    if (!tradeSnap.exists) throw new functions.https.HttpsError("not-found", "Trade not found.");
    const trade = tradeSnap.data();
    if (trade.status !== "pending") throw new functions.https.HttpsError("failed-precondition", "This trade is no longer pending.");
    if (trade.fromUid !== uid) throw new functions.https.HttpsError("permission-denied", "Only the sender can cancel this trade.");

    const fromSnap = await tx.get(savesRef(uid));
    const fromSave = normalize(fromSnap.exists ? fromSnap.data() : null);

    await applyRateLimits(tx, [{ uid, key: "cancelTrade", limit: 10, windowMs: 60000 }]);

    if (fromSave.outgoingTradeId === tradeId) {
      fromSave.reserved = { coins: 0, skins: [] };
      fromSave.outgoingTradeId = null;
      writeSave(tx, uid, fromSave);
    }
    tx.update(tradeRef, { status: "cancelled", reason: "cancelled", resolvedAt: FieldValue.serverTimestamp() });

    return { ok: true };
  });
});
