// A proactive safety net (2026-10-01, the owner's ask: "cancel trades immediately when either player doesn't
// have as many coins as specified"), on top of acceptTrade's own existing reactive integrity check (which only
// ever runs at the moment someone tries to accept). The SENDER's offer side can never actually go uncoverable -
// hard escrow (spendableCoins/spendableSkinCount, which every coin/skin-spending Function already checks
// against) makes that structurally impossible. The RECIPIENT's request side has no such protection: nothing
// reserves anything on their side until they actually accept, so their own spending elsewhere (a purchase, a
// box, another trade) can leave a pending incoming offer un-acceptable with nobody ever finding out until they
// try.
//
// Split into two phases because of a hard Firestore rule every transaction in this project already works
// around (see lib/rateLimit.js's own note): ALL reads in a transaction must happen before ANY writes. The
// caller doesn't know until AFTER its own deduction is computed (in-memory, not yet written) which of this
// player's pending incoming trades - if any - just became uncoverable, so every POSSIBLY-relevant doc (the
// pending-trades query, and every sender's own save) has to be read eagerly, before anything else in the
// transaction writes - typically 0-2 extra reads, since a player realistically has 0 or 1 pending incoming
// offer at a time.
const { db, FieldValue } = require("./admin");
const { normalize, spendableCoins, spendableSkinCount, savesRef, writeSave } = require("./saves");

const TRADES_COLLECTION = "trades";

// Phase 1 - call EARLY, alongside the caller's own initial reads, before applyRateLimits or anything else in
// the transaction writes. `excludeTradeId` skips the trade the caller is itself in the middle of accepting
// (still "pending" from this read's point of view, about to be marked "accepted" by the caller's own later
// write) - pass null from a caller that isn't accepting a trade itself (purchase, openBox).
async function readIncomingTradeGuard(tx, uid, excludeTradeId) {
  const pendingSnap = await tx.get(db.collection(TRADES_COLLECTION).where("toUid", "==", uid).where("status", "==", "pending"));
  const trades = pendingSnap.docs.filter((d) => d.id !== excludeTradeId).map((d) => ({ ref: d.ref, id: d.id, data: d.data() }));
  const fromSaves = new Map();
  for (const t of trades) {
    if (!fromSaves.has(t.data.fromUid)) {
      const snap = await tx.get(savesRef(t.data.fromUid));
      fromSaves.set(t.data.fromUid, normalize(snap.exists ? snap.data() : null));
    }
  }
  return { trades, fromSaves };
}

// Phase 2 - call LATE, alongside the caller's own final writes, once `save` reflects the real post-spend state.
// Declines (status: "declined", reason: "insufficient") every guarded trade `save` can no longer cover,
// releasing each one's sender's own escrow in the same pass - uses only the already-read data from phase 1, so
// this never performs a read itself (safe to call after other writes have already been queued).
function declineUncoverableIncomingTrades(tx, guard, save) {
  for (const t of guard.trades) {
    const coversCoins = spendableCoins(save) >= t.data.request.coins;
    const coversSkins = t.data.request.skins.every((s) => spendableSkinCount(save, s.kind, s.id) >= s.qty);
    if (coversCoins && coversSkins) continue;
    const fromSave = guard.fromSaves.get(t.data.fromUid);
    if (fromSave.outgoingTradeId === t.id) {
      fromSave.reserved = { coins: 0, skins: [] };
      fromSave.outgoingTradeId = null;
      writeSave(tx, t.data.fromUid, fromSave);
    }
    tx.update(t.ref, { status: "declined", reason: "insufficient", resolvedAt: FieldValue.serverTimestamp() });
  }
}

module.exports = { readIncomingTradeGuard, declineUncoverableIncomingTrades };
