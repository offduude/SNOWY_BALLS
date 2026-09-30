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
// (pushes { id, endsAt } onto `buffs` - claimThrow reads this to know which coinMultiplier buffs, and which
// summoned events, are genuinely active). A `charge`-type item (Diamond Cross, Toy Tank, the song-summon items)
// normally has no duration of its own - it's a one-shot trigger the client plays out - EXCEPT the four
// triggerEvent items claimThrow can honor a faceHit bonus for (see functions/lib/economyData.js's EVENT_DEFS):
// those ALSO get a `buffs` entry now, purely so claimThrow has a real, server-known window to check a faceHit
// claim against - Toy Tank (no face, no payout of its own) and Diamond Cross (its guaranteed-hit effect is
// entirely subsumed into the `hit` claim claimThrow now trusts directly - see that function's own note) still
// get none.
const EVENT_TRIGGER_BUFF_IDS = new Set(Object.values(eco.EVENT_DEFS).map((d) => d.buffId));

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
    if (item.duration) {
      save.buffs.push({ id: buffId, endsAt: now + item.duration.seconds * 1000 });
    } else if (EVENT_TRIGGER_BUFF_IDS.has(buffId)) {
      // A generous, hand-picked window for the song-summon items (their real duration is an audio file's
      // length, not known here - see GENEROUS_SONG_EVENT_MS's own note); tomato_juice already has a real
      // `duration` of its own (20s, matching economy.json events.faceWindow.durationMs) and takes the branch
      // above instead.
      save.buffs.push({ id: buffId, endsAt: now + eco.GENEROUS_SONG_EVENT_MS });
    }

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
// claimThrow({ projectileId, hit, faceHit, eventName, clientVersion }) - v2 (2026-09-29, replacing the v1 range
// check). The owner's own call on where the trust line sits: the actual aiming skill (timing a fast-moving
// marker) happens entirely client-side with nothing server-verifiable about it short of the server timing every
// tap itself (a real round-trip per aim phase, not just per throw - rejected for the traffic/latency cost it
// would add to the game's single most frequent interaction). So `hit` is TRUSTED, same trust level as every
// other client-reported fact this migration didn't try to re-derive from first principles. What this function
// does NOT trust, and computes itself instead of reading from the claim: the REWARD. There is no
// `claimedReward` input at all any more - a hit always pays EXACTLY `baseHitValue x realActiveCoinMultipliers
// x (a verified event's real faceMultiplier, if any)`, using the real economy.json catalog and the real
// `buffs` array (server's own clock, checked at the moment THIS call is processed - i.e. right after the throw
// resolves, not whatever buffs were running back when the player first tapped "TAP to aim" - closing exactly
// the gap the owner flagged: a buff that would have run out mid-aim/mid-flight no longer silently still counts).
// A client can therefore never claim an inflated number for a real hit; the only residual gap is claiming MORE
// HITS than genuinely happened, bounded by the rate limit and real projectile consumption below.
//
// `faceHit`/`eventName` get a real, but partial, verification: `eventName` must be a real event AND the matching
// summon buff (functions/lib/economyData.js EVENT_DEFS) must currently be active in the caller's OWN `buffs`
// array (real server state, written by useBuff) for the bonus to be honored - a NATURAL (non-buff) event spawn
// isn't tracked server-side at all yet (that RNG still lives entirely client-side, see src/main.js
// rollNaturalEvent), so a faceHit claimed against one is simply not honored (pays the plain hit value, no event
// bonus) rather than trusted blind - the owner's own reasoning for trusting `hit` doesn't extend to a 1.5-1.75x
// bonus on top of it, which is a meaningfully larger thing to get wrong on every single throw. Flagged as a
// known, deliberate gap, not silently shipped: closing it fully means moving natural event spawning
// server-side too (own future work, not part of this pass).
//
// The saveProjectile roll (Water Bottle etc.) is now taken HERE, server-side (2026-09-30) - not trusted from
// the client at all, and not mirroring a client-side roll either. `src/main.js consumeProjectile()` still rolls
// its OWN chance locally, at aim time, purely for the instant "Saved Projectile" message and the client's own
// (still-local, still-unreconciled) inventory count - see main.js reportThrowToServer's own note on why that
// stays. This roll is the actual, authoritative one that decides whether saves/{uid}.projectiles moves, using
// the REAL active buffs (same list useBuff populates, same "count buffs realistically at the moment of the
// throw" discipline the coinMultiplier/faceHit checks already use) - not the unconditional "always deduct one"
// v1 had, which meant the two projectile counts could only ever drift apart in ONE direction, growing every
// single time a save-chance buff actually saved something locally. Rolling independently server-side doesn't
// make the two sides agree on any INDIVIDUAL throw (the client already decided and displayed its own outcome
// before this call resolves - blocking on a round trip for that would cost this migration's whole "Option B"
// smoothness point), but it does mean the drift is now an unbiased random walk around zero instead of a
// one-way ratchet - both sides losing roughly the same share of their ammo over time, not one side bleeding out
// relative to the other.
function saveProjectileChance(buffs) {
  let notSaved = 1;
  for (const b of buffs) {
    const it = eco.shopItemIndex.get(b.id);
    const eff = it && (it.effects || []).find((e) => e.type === "saveProjectile");
    if (eff) notSaved *= 1 - eff.value; // independent rolls, same formula src/buffs.js modifiers() uses
  }
  const cap = eco.eco.buffCaps && typeof eco.eco.buffCaps.saveProjectile === "number" ? eco.eco.buffCaps.saveProjectile : 0.9;
  return Math.min(cap, 1 - notSaved);
}

exports.claimThrow = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const projectileId = typeof data.projectileId === "string" ? data.projectileId : null;
  const hit = data.hit === true;
  const faceHit = hit && data.faceHit === true; // a miss can never face-hit, whatever the client sends
  const eventName = typeof data.eventName === "string" ? data.eventName : null;
  const baseValue = projectileId ? eco.projectileHitValue(projectileId) : null;
  if (baseValue === null) throw bad("Unknown projectile.");

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(savesRef(uid));
    const save = normalize(snap.exists ? snap.data() : null);

    await applyRateLimits(tx, [{ uid, key: "claimThrow", limit: 30, windowMs: 60000 }]);

    const now = Date.now();
    save.buffs = save.buffs.filter((b) => b.endsAt > now); // sweep expired ones once, up front - shared by the save-roll below (hit or miss) and the reward math further down (hit only)

    const projDef = eco.projectileIndex[projectileId];
    const isConsumable = projDef && !projDef.infinite && !projDef.regen;
    let saved = false; // whether THIS throw's projectile was saved server-side - applies regardless of hit/miss, same as the client's own roll
    if (isConsumable && !isAdmin(uid)) {
      if (!(save.projectiles[projectileId] > 0)) throw new functions.https.HttpsError("failed-precondition", "You don't have that projectile.");
      saved = Math.random() < saveProjectileChance(save.buffs);
      if (!saved) {
        save.projectiles[projectileId] -= 1;
        if (save.projectiles[projectileId] <= 0) delete save.projectiles[projectileId];
      }
    }

    let reward;
    if (!hit) {
      reward = eco.eco.rewards.missCoins || 0; // economy.json rewards.missCoins - 0 today, respected either way
    } else {
      let multiplier = 1;
      for (const b of save.buffs) {
        const it = eco.shopItemIndex.get(b.id);
        const eff = it && (it.effects || []).find((e) => e.type === "coinMultiplier");
        if (eff) multiplier *= eff.value;
      }
      reward = baseValue * multiplier;

      if (faceHit && eventName && eco.EVENT_DEFS[eventName]) {
        const def = eco.EVENT_DEFS[eventName];
        const buffIdx = save.buffs.findIndex((b) => b.id === def.buffId);
        if (buffIdx !== -1) {
          reward *= def.faceMultiplier;
          save.buffs.splice(buffIdx, 1); // a face hit ends the event - this bonus can't be claimed twice
        }
        // else: claimed against an event this account has no server-verified active summon for (most likely a
        // natural spawn) - not honored, falls through with the plain hit value only, per this function's own note.
      }
    }
    reward = Math.round(reward);
    save.coins += reward;
    save.lifetimeCoins += reward;

    writeSave(tx, uid, save);
    return { coins: save.coins, projectiles: save.projectiles, reward, saved };
  });
});
