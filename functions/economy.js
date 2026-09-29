// purchase / useBuff / openBox / sellSkin / claimThrow - the non-trading half of the server-authoritative economy
// (Part 3 of the plan). Every export here is a `functions.https.onCall` - see functions/index.js for how these
// get wired up. Each one: requireAuth first (no exceptions - see lib/auth.js), rate-limit + read + validate +
// write inside a single db.runTransaction so a rate-limit check and its own mutation can never be split apart by
// a retry or a concurrent call, then returns the caller's updated totals - the client applies ONLY this returned
// value, never an optimistic local guess (same discipline the plan's trading Functions use).
const functions = require("firebase-functions");
const { db } = require("./lib/admin");
const { requireAuth, isAdmin } = require("./lib/auth");
const { applyRateLimits } = require("./lib/rateLimit");
const { normalize, spendableCoins, spendableSkinCount, savesRef, writeSave, writeLeaderboardMirror } = require("./lib/saves");
const { shopStockRef, normalize: normalizeStock } = require("./lib/shopStock");
const eco = require("./lib/economyData");

function bad(msg) {
  return new functions.https.HttpsError("invalid-argument", msg);
}

// ---------------------------------------------------------------------------------------------------------------
// purchase({ itemId, clientVersion }) - buys a shop item (a consumable buff, or one unit of a projectile stack),
// validated against the REAL global stock doc (functions/shop.js, functions/lib/shopStock.js - the item 5 Cloud
// Scheduler piece) rather than trusting the client's word for what's currently on sale. Mirrors src/shop.js's own
// buy() exactly: a projectile-category item always grants exactly ONE unit per call (never a client-chosen
// amount - "clicking it once buys only a single projectile" per that file's own comment) at its fixed unitPrice,
// decrementing the SHARED slot's remaining offer.amount (clearing the slot at 0); a consumable always empties its
// slot on any single purchase, same as the client always has. Reading+writing both saves/{uid} AND shopStock/
// current inside the SAME transaction is what makes two players racing for the last unit in a slot resolve
// correctly - Firestore's optimistic-concurrency retry means only one of them can actually win it.
exports.purchase = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const itemId = typeof data.itemId === "string" ? data.itemId : null;
  const item = itemId ? eco.shopItemIndex.get(itemId) : null;
  if (!item || (item.category !== "consumable" && item.category !== "projectile")) throw bad("Unknown item.");

  return db.runTransaction(async (tx) => {
    const stockSnap = await tx.get(shopStockRef());
    const stock = normalizeStock(stockSnap.exists ? stockSnap.data() : null);
    const snap = await tx.get(savesRef(uid));
    const save = normalize(snap.exists ? snap.data() : null);

    await applyRateLimits(tx, [{ uid, key: "purchase", limit: 20, windowMs: 60000 }]);

    const slot = stock.stock.indexOf(itemId);
    if (slot === -1) throw new functions.https.HttpsError("failed-precondition", "Not currently in stock.");

    const cost = eco.priceOf(item);
    if (!isAdmin(uid)) {
      const buffMax = eco.eco.shop.buffMax;
      if (item.category === "consumable" && Number.isInteger(buffMax) && (save.buffItems[itemId] || 0) >= buffMax) {
        throw new functions.https.HttpsError("failed-precondition", "Already holding the most of this buff.");
      }
      if (spendableCoins(save) < cost) throw new functions.https.HttpsError("failed-precondition", "Not enough coins.");
      save.coins -= cost;
    }

    if (item.category === "consumable") {
      save.buffItems[itemId] = (save.buffItems[itemId] || 0) + 1;
      stock.stock[slot] = null;
      stock.offers[slot] = null;
    } else {
      save.projectiles[itemId] = (save.projectiles[itemId] || 0) + 1;
      const offer = stock.offers[slot];
      const remaining = (offer && offer.amount > 0 ? offer.amount : 0) - 1;
      if (remaining > 0) {
        stock.offers[slot] = { amount: remaining };
      } else {
        stock.stock[slot] = null;
        stock.offers[slot] = null;
      }
    }

    tx.set(shopStockRef(), { stock: stock.stock, offers: stock.offers, nextRerollAt: stock.nextRerollAt, generatedAt: stock.generatedAt });
    writeSave(tx, uid, save);
    return { coins: save.coins, buffItems: save.buffItems, projectiles: save.projectiles };
  });
});

// ---------------------------------------------------------------------------------------------------------------
// useBuff({ buffId, clientVersion }) - takes one out of the buff inventory and, if it has a duration, starts it
// (pushes { id, endsAt } onto `buffs` - claimThrow reads this to know which coinMultiplier buffs are active). A
// `charge`-type item (Diamond Cross, Toy Tank, the song-summon items) has no duration - it's consumed instantly,
// its effect is a one-shot trigger the client plays out, not a timed state this function needs to track.
exports.useBuff = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const buffId = typeof data.buffId === "string" ? data.buffId : null;
  const item = buffId && eco.shopItemIndex.get(buffId);
  if (!item || item.category !== "consumable") throw bad("Unknown buff.");

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(savesRef(uid));
    const save = normalize(snap.exists ? snap.data() : null);

    await applyRateLimits(tx, [{ uid, key: "useBuff", limit: 20, windowMs: 60000 }]);

    if (!isAdmin(uid)) {
      if (!(save.buffItems[buffId] > 0)) throw new functions.https.HttpsError("failed-precondition", "You don't have that buff.");
      save.buffItems[buffId] -= 1;
      if (save.buffItems[buffId] <= 0) delete save.buffItems[buffId];
    }
    const now = Date.now();
    save.buffs = save.buffs.filter((b) => b.endsAt > now); // sweep expired ones while we're here
    if (item.duration) save.buffs.push({ id: buffId, endsAt: now + item.duration.seconds * 1000 });

    writeSave(tx, uid, save);
    return { buffItems: save.buffItems, buffs: save.buffs };
  });
});

// ---------------------------------------------------------------------------------------------------------------
// openBox({ kind, clientVersion }) - the exact same weighted draw as boxes.js's own draw(kind) (rarity roll
// against economy.json boxOdds, then uniform among that rarity's items in the kind's pool), just run server-side
// so the odds and the RNG are no longer something devtools can edit (closes the gap economy.json's own
// _boxOddsSecurityNote flags). Returns the drawn item so the client can play its reel animation against the REAL
// result instead of deciding one itself.
function drawBox(kind) {
  const pool = eco.boxPool(kind);
  if (!pool.length) return null;
  const rarities = [...eco.rarityIndex.values()].filter((r) => (eco.boxOdds[r.id] || 0) > 0);
  if (!rarities.length) return pool[Math.floor(Math.random() * pool.length)];
  const rid = (it) => (rarities.some((r) => r.id === it.rarity) ? it.rarity : rarities[0].id);
  const present = rarities.filter((r) => pool.some((it) => rid(it) === r.id));
  const total = present.reduce((sum, r) => sum + (eco.boxOdds[r.id] || 0), 0);
  let roll = Math.random() * total;
  let chosen = present[present.length - 1];
  for (const r of present) {
    roll -= eco.boxOdds[r.id] || 0;
    if (roll < 0) {
      chosen = r;
      break;
    }
  }
  const atRarity = pool.filter((it) => rid(it) === chosen.id);
  return atRarity[Math.floor(Math.random() * atRarity.length)];
}

exports.openBox = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const kind = typeof data.kind === "string" ? data.kind : null;
  const boxDef = kind && eco.boxDefs.get(kind);
  if (!boxDef) throw bad("Unknown box.");

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(savesRef(uid));
    const save = normalize(snap.exists ? snap.data() : null);

    await applyRateLimits(tx, [{ uid, key: "openBox", limit: 20, windowMs: 60000 }]);

    if (!isAdmin(uid)) {
      if (spendableCoins(save) < boxDef.price) throw new functions.https.HttpsError("failed-precondition", "Not enough coins.");
      save.coins -= boxDef.price;
    }
    const item = drawBox(kind);
    if (!item) throw new functions.https.HttpsError("internal", "This box's pool is empty.");
    save.skinCounts[kind][item.id] = (save.skinCounts[kind][item.id] || 0) + 1;

    writeSave(tx, uid, save);
    // Mirrored onto the PUBLIC leaderboard doc too (Admin SDK write, bypasses firestore.rules) - the read source
    // another player's profile-inspect popup uses for this account's skins gallery (saves/{uid} itself is private).
    writeLeaderboardMirror(tx, uid, { skinCounts: save.skinCounts });
    return { coins: save.coins, kind, itemId: item.id, rarity: item.rarity, skinCounts: save.skinCounts };
  });
});

// ---------------------------------------------------------------------------------------------------------------
// sellSkin({ kind, id, n, clientVersion }) - the real payout collection.js's SELL button has been wired to a
// no-op handler for (see economy.json's _sellPriceNote for the pricing formula). Uses SPENDABLE count, not raw -
// a skin currently escrowed in an outgoing trade offer can't also be sold out from under it.
exports.sellSkin = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const kind = typeof data.kind === "string" ? data.kind : null;
  const id = typeof data.id === "string" ? data.id : null;
  const n = Number.isInteger(data.n) && data.n > 0 ? data.n : 1;
  const item = kind && id ? eco.skinItem(kind, id) : null;
  if (!item || !item.sellPrice) throw bad("This item can't be sold.");

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(savesRef(uid));
    const save = normalize(snap.exists ? snap.data() : null);

    await applyRateLimits(tx, [{ uid, key: "sellSkin", limit: 20, windowMs: 60000 }]);

    if (spendableSkinCount(save, kind, id) < n) throw new functions.https.HttpsError("failed-precondition", "You don't have that many to sell.");
    save.skinCounts[kind][id] -= n;
    if (save.skinCounts[kind][id] <= 0) delete save.skinCounts[kind][id];
    save.coins += item.sellPrice * n;

    writeSave(tx, uid, save);
    writeLeaderboardMirror(tx, uid, { skinCounts: save.skinCounts });
    return { coins: save.coins, skinCounts: save.skinCounts };
  });
});

// ---------------------------------------------------------------------------------------------------------------
// claimThrow({ projectileId, hit, claimedReward, clientVersion }) - v1, a RANGE check, not a full recomputation
// of the client's event/streak/window-hit logic (songs, the banana/guitar face windows, the tank, streak
// tracking) - reproducing all of that server-side is real future work, not something to fake here. What this DOES
// enforce: the projectile must actually be equipped/owned (consumed if it's a real consumable), a miss must pay
// exactly 0 (economy.json rewards.missCoins), and a hit's claimed reward must fall inside
// [0, baseHitValue x activeCoinMultipliers x MAX_EVENT_FACE_MULTIPLIER] - the most any legitimate combination of
// equipped projectile + active buffs + the best-paying event could produce. Anything outside that range is
// rejected outright; a client cannot claim more than the honest ceiling no matter which event it pretends fired.
exports.claimThrow = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const projectileId = typeof data.projectileId === "string" ? data.projectileId : null;
  const hit = data.hit === true;
  const claimedReward = Number.isFinite(data.claimedReward) ? data.claimedReward : null;
  const baseValue = projectileId ? eco.projectileHitValue(projectileId) : null;
  if (baseValue === null || claimedReward === null || claimedReward < 0) throw bad("Malformed throw claim.");

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(savesRef(uid));
    const save = normalize(snap.exists ? snap.data() : null);

    await applyRateLimits(tx, [{ uid, key: "claimThrow", limit: 30, windowMs: 60000 }]);

    const projDef = eco.projectileIndex[projectileId];
    const isConsumable = projDef && !projDef.infinite && !projDef.regen;
    if (isConsumable && !isAdmin(uid)) {
      if (!(save.projectiles[projectileId] > 0)) throw new functions.https.HttpsError("failed-precondition", "You don't have that projectile.");
      save.projectiles[projectileId] -= 1;
      if (save.projectiles[projectileId] <= 0) delete save.projectiles[projectileId];
    }

    if (!hit) {
      if (claimedReward !== 0) throw bad("A miss cannot pay out.");
    } else {
      const now = Date.now();
      const activeBuffIds = new Set(save.buffs.filter((b) => b.endsAt > now).map((b) => b.id));
      let multiplier = 1;
      for (const id of activeBuffIds) {
        const it = eco.shopItemIndex.get(id);
        const eff = it && (it.effects || []).find((e) => e.type === "coinMultiplier");
        if (eff) multiplier *= eff.value;
      }
      const ceiling = baseValue * multiplier * eco.MAX_EVENT_FACE_MULTIPLIER;
      if (!isAdmin(uid) && claimedReward > ceiling + 1e-6) {
        throw new functions.https.HttpsError("failed-precondition", "Claimed reward exceeds the legitimate range.");
      }
      save.coins += Math.round(claimedReward);
      save.lifetimeCoins += Math.round(claimedReward);
    }

    writeSave(tx, uid, save);
    return { coins: save.coins, projectiles: save.projectiles };
  });
});
