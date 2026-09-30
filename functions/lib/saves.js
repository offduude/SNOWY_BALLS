// The SERVER-OWNED half of saves/{uid} (Part 3 of the plan - the client keeps its own `data` blob for cosmetic/
// prefs fields, untouched by any of this). These are the fields only a Cloud Function may ever write once
// firestore.rules locks the client out of them - see the plan's Part 2 ("Escrow lives in the player's own save").
//
// NOT YET SAFE TO WIRE THE CLIENT UP TO THIS, found while building these Functions (2026-09-29) - flagged here so
// it isn't missed when that step (the plan's Sequencing step 5, "Client UI wave") actually starts: src/cloud.js's
// syncNow() writes BOTH saves/{uid} and leaderboard/{uid} with a plain `batch.set(ref, {...})` - a FULL document
// overwrite, not `{merge: true}`. Harmless today (nothing writes the new server-owned fields yet, so there's
// nothing for it to clobber), but the moment the client is wired to read them, that same periodic sync would
// silently WIPE whatever a Cloud Function just wrote (coins, skinCounts, a trade's escrow, the leaderboard's own
// mirrored skinCounts) back down to whatever the client still has in memory. Both `batch.set(...)` calls in
// syncNow() need `{ merge: true }` before the client-wiring step ships - a one-line fix each, but easy to miss
// since nothing observable breaks until real server-owned data exists to lose.
const { db } = require("./admin");

function savesRef(uid) {
  return db.collection("saves").doc(uid);
}

function leaderboardRef(uid) {
  return db.collection("leaderboard").doc(uid);
}

// Every server-owned top-level field on saves/{uid} - see defaults() below.
const SERVER_OWNED_FIELDS = ["coins", "lifetimeCoins", "skinCounts", "buffItems", "projectiles", "buffs", "equipped", "reserved", "outgoingTradeId", "personalShopStock"];

// Writes the server-owned half of a save, found the hard way (2026-09-29, emulator smoke test) to need
// `{ mergeFields: SERVER_OWNED_FIELDS }`, NOT a plain `{ merge: true }`: Firestore's `merge: true` recursively
// deep-merges nested maps like `skinCounts.character` key by key, so a count this function deleted from the JS
// object (the normal "sold/spent down to zero" pattern - see sellSkin/useBuff/claimThrow/acceptTrade) never
// actually disappears from the stored document - merge only ever ADDS/overwrites keys present in the new data,
// it can't tell "absent because deleted" from "absent because never touched." `mergeFields` sidesteps this
// entirely: each listed top-level field (skinCounts, buffItems, projectiles, ...) is replaced WHOLESALE with
// whatever's in `save` - correctly dropping anything this function deleted - while leaving `data`/`updatedAt`/
// `session` (the client-owned fields, not in this list) completely untouched, same as `{merge: true}` would.
function writeSave(tx, uid, save) {
  tx.set(savesRef(uid), save, { mergeFields: SERVER_OWNED_FIELDS });
}

// Same reasoning as writeSave above, for the public leaderboard mirror - `fields` is e.g. `{ coins }` or
// `{ skinCounts }` or both; each key gets replaced wholesale rather than deep-merged.
function writeLeaderboardMirror(tx, uid, fields) {
  tx.set(leaderboardRef(uid), fields, { mergeFields: Object.keys(fields) });
}

// `defaults()` gives every field a sane value the same way economy.js's own `clean()` does for the client save -
// a doc that's missing a field (brand new, or a legacy doc not yet through the one-time migration - see the
// blaze-migration memory item 6) gets the default rather than being treated as an error. This is what keeps
// every function in this directory safe to run against a doc in ANY state, not just a fully-migrated one.
function defaults() {
  return {
    coins: 0,
    lifetimeCoins: 0,
    skinCounts: { character: {}, scenery: {}, weather: {} },
    buffItems: {},
    projectiles: {},
    buffs: [], // active timed buffs: { id, endsAt }
    equipped: { character: "andek", scenery: "frosty", weather: "snow", projectile: "snowball" },
    reserved: { coins: 0, skins: [] }, // trade escrow - see functions/trading.js
    outgoingTradeId: null,
    personalShopStock: null, // a Toy Tank private reroll (2026-09-30 - see functions/economy.js useBuff's own note): { stock, offers, expiresAt } | null
  };
}

function cleanCounts(obj) {
  const out = {};
  if (obj && typeof obj === "object") {
    for (const [id, n] of Object.entries(obj)) if (Number.isInteger(n) && n > 0) out[id] = n;
  }
  return out;
}

// Normalizes whatever's actually in the doc (missing fields default, anything malformed is dropped rather than
// trusted) into the shape every function below can rely on. Never throws - a corrupt/partial doc just comes back
// as sensible defaults, same philosophy as economy.js's clean().
function normalize(raw) {
  const d = defaults();
  const p = raw || {};
  const skinCounts = { character: {}, scenery: {}, weather: {} };
  for (const kind of ["character", "scenery", "weather"]) {
    skinCounts[kind] = cleanCounts(p.skinCounts && p.skinCounts[kind]);
  }
  const reservedSkins = Array.isArray(p.reserved && p.reserved.skins)
    ? p.reserved.skins.filter(
        (s) => s && ["character", "scenery", "weather"].includes(s.kind) && typeof s.id === "string" && Number.isInteger(s.qty) && s.qty > 0
      )
    : [];
  // Shape-only validation, deliberately NOT expiry-filtered here (2026-09-30) - "is this still active" is a
  // per-call-site question (purchase/useBuff each check `expiresAt > Date.now()` themselves, the same way an
  // expired `buffs` entry is only ever pruned where it's actually read, not scrubbed centrally here).
  const pss = p.personalShopStock;
  const personalShopStock =
    pss && Array.isArray(pss.stock) && Array.isArray(pss.offers) && typeof pss.expiresAt === "number"
      ? { stock: pss.stock.map((id) => (typeof id === "string" ? id : null)), offers: pss.offers.map((o) => (o && Number.isInteger(o.amount) ? { amount: o.amount } : null)), expiresAt: pss.expiresAt }
      : null;
  return {
    coins: Number.isInteger(p.coins) && p.coins >= 0 ? p.coins : 0,
    lifetimeCoins: Number.isInteger(p.lifetimeCoins) && p.lifetimeCoins >= 0 ? p.lifetimeCoins : 0,
    skinCounts,
    buffItems: cleanCounts(p.buffItems),
    projectiles: cleanCounts(p.projectiles),
    buffs: Array.isArray(p.buffs) ? p.buffs.filter((b) => b && typeof b.id === "string" && typeof b.endsAt === "number") : [],
    equipped: { ...d.equipped, ...(p.equipped && typeof p.equipped === "object" ? p.equipped : {}) },
    reserved: {
      coins: Number.isInteger(p.reserved && p.reserved.coins) && p.reserved.coins >= 0 ? p.reserved.coins : 0,
      skins: reservedSkins,
    },
    outgoingTradeId: typeof p.outgoingTradeId === "string" ? p.outgoingTradeId : null,
    personalShopStock,
  };
}

function reservedSkinQty(save, kind, id) {
  const row = save.reserved.skins.find((s) => s.kind === kind && s.id === id);
  return row ? row.qty : 0;
}

function spendableCoins(save) {
  return Math.max(0, save.coins - save.reserved.coins);
}

function spendableSkinCount(save, kind, id) {
  const total = (save.skinCounts[kind] && save.skinCounts[kind][id]) || 0;
  return Math.max(0, total - reservedSkinQty(save, kind, id));
}

module.exports = { defaults, normalize, spendableCoins, spendableSkinCount, reservedSkinQty, savesRef, leaderboardRef, writeSave, writeLeaderboardMirror };
