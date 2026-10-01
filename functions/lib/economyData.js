// Loads the SAME economy.json the client reads from, so prices/odds/rarities can never drift between the two -
// there is exactly one source of truth for game numbers, same as before this migration.
//
// FIX (2026-10-02, the first real `firebase deploy` hit exactly the gap this file used to flag as a future
// risk): `firebase deploy --only functions` only uploads what's inside `functions/` (per firebase.json's
// functions.source) - the old `require("../../economy.json")` reached outside that directory, which works fine
// locally/in the emulator (same filesystem) but isn't in the real deploy bundle at all, so every function
// failed to even load ("Cannot find module '../../economy.json'"). Fixed via firebase.json's own `predeploy`
// hook, which copies the real repo-root economy.json into functions/economy.json right before every real
// deploy - still exactly one source of truth (the root file), just automatically synced into the deploy bundle
// instead of manually duplicated. functions/economy.json itself is gitignored - a build artifact, never
// hand-edited, and never present for local dev (the emulator never runs predeploy hooks) - so this tries that
// copy FIRST (what a real deployed function actually has) and falls back to the real repo-root file (what local
// dev/the emulator actually has) rather than picking one and breaking the other.
let eco;
try {
  eco = require("../economy.json");
} catch (e) {
  eco = require("../../economy.json");
}

const rarityIndex = new Map((eco.rarities || []).map((r) => [r.id, r]));
const boxOdds = eco.boxOdds || {};
const boxDefs = new Map((eco.boxes || []).map((b) => [b.kind, b]));
const shopItemIndex = new Map((eco.shop.items || []).map((it) => [it.id, it]));
const projectileIndex = eco.projectiles || {};

const KIND_LISTS = { character: eco.characters || [], scenery: eco.sceneries || [], weather: eco.weathers || [] };

function skinList(kind) {
  return KIND_LISTS[kind] || [];
}

function skinItem(kind, id) {
  return skinList(kind).find((it) => it.id === id) || null;
}

// Every non-default skin of a kind - a box's prize pool, exactly mirroring boxes.js's own poolFor().
function boxPool(kind) {
  return skinList(kind).filter((it) => it.rarity !== "default");
}

function rarityProjectileHitValue(rarityId) {
  const r = rarityIndex.get(rarityId);
  return r ? r.projectileHitValue : 0;
}

// The base coins one hit with this projectile pays (before buffs/events) - projectiles[id].hitValue overrides the
// rarity default (the HEAVY HITTERS: stone, egg, grenade, rowan_berry - see economy.json's _raritiesNote).
function projectileHitValue(projectileId) {
  const p = projectileIndex[projectileId];
  if (!p) return null;
  return typeof p.hitValue === "number" ? p.hitValue : rarityProjectileHitValue(p.rarity);
}

// The rarity id of a shop item - mirrors src/rarity.js's Rarity.ofItem exactly: a projectile-category item's
// rarity lives with the projectile's own numbers (projectiles.<id>.rarity), a consumable's on the item itself.
function rarityOfItem(item) {
  if (item.category === "projectile") {
    const p = projectileIndex[item.id];
    return p ? p.rarity : undefined;
  }
  return item.rarity;
}

// What ONE costs - mirrors src/shop.js's own price() exactly: a stack item (category "projectile") is always its
// fixed unitPrice (bought one unit at a time - see functions/shop.js's purchase()); everything else is its fixed
// price UNLESS ignorePriceOverride is false/absent, in which case the shop-wide testing override
// (economy.json shop.priceOverride) replaces it. Every item in today's catalog sets ignorePriceOverride: true, so
// priceOverride is currently inert for all of them - ported faithfully anyway in case that ever changes.
function priceOf(item) {
  if (item.amount) return item.unitPrice;
  if (item.ignorePriceOverride) return item.price;
  const o = eco.shop.priceOverride;
  return o !== null && o !== undefined ? o : item.price;
}

// Every event claimThrow (functions/economy.js) can honor a faceHit for, and the shop item whose use (functions/
// economy.js's useBuff) summons it. Real, exact faceMultiplier values straight from economy.json - once a claim
// is verified as legitimate (see below), it's paid EXACTLY this, never a fudge-factor ceiling.
const EVENT_DEFS = {
  face: { buffId: "tomato_juice", faceMultiplier: eco.events.faceWindow.faceMultiplier },
  disco: { buffId: "disco_ticket", faceMultiplier: eco.events.discoWindow.faceMultiplier },
  guitar: { buffId: "guitar_pick", faceMultiplier: eco.events.guitarWindow.faceMultiplier },
  heavy_guitar: { buffId: "heavy_guitar_pick", faceMultiplier: eco.events.heavyGuitarWindow.faceMultiplier },
};

// How long a summon-triggered song event's face-hit window is treated as open server-side, for events whose
// REAL duration is the length of an audio file (disco.mp3 etc.) - not a number that exists anywhere in
// economy.json, only in the client's loaded Sound objects (src/main.js songTimes(): `this.songSounds[name]
// .duration * 1000`). Deliberately a generous, hand-picked upper bound (comfortably longer than any real song)
// rather than trying to keep an exact duration in sync with whatever audio file happens to be loaded - a claim
// arriving a little "late" relative to the real song length still gets honored; the only thing at stake in
// picking this too generously is a slightly longer window an already-used buff's face-hit bonus could be
// claimed in, not an unbounded one. `face` (the banana event) doesn't need this - its duration is a real
// economy.json number (events.faceWindow.durationMs) and useBuff uses that exactly, via the same `buffs` array
// entry every other timed buff already gets.
const GENEROUS_SONG_EVENT_MS = 90000;

module.exports = {
  eco,
  rarityIndex,
  boxOdds,
  boxDefs,
  shopItemIndex,
  projectileIndex,
  skinList,
  skinItem,
  boxPool,
  rarityProjectileHitValue,
  projectileHitValue,
  rarityOfItem,
  priceOf,
  EVENT_DEFS,
  GENEROUS_SONG_EVENT_MS,
};
