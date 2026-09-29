// Loads the SAME economy.json the client reads from, so prices/odds/rarities can never drift between the two -
// there is exactly one source of truth for game numbers, same as before this migration.
//
// NOTE for the real deploy (not the emulator): `firebase deploy --only functions` only uploads what's inside
// `functions/` (per firebase.json's functions.source) - a `require("../economy.json")` reaching outside that
// directory works fine locally (same filesystem, what the emulator uses) but will NOT be included in an actual
// deployment bundle. Before ever running a real `firebase deploy`, either copy economy.json into functions/ (and
// update this require) or point `functions.source` at the project root - flagged here rather than silently
// deploying a Functions build with no economy data. Not a concern yet: nothing in this migration has been
// deployed for real, only run against the Local Emulator Suite.
const eco = require("../../economy.json");

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

// The highest faceMultiplier any event can pay (economy.json events._eventSummonPricingNote /
// heavyGuitarWindow/discoWindow) - used as a generous, honest upper bound for claimThrow's range check (see
// functions/economy.js) rather than simulating which specific event is actually active. 1.75 is both the disco's
// and the heavy guitar's faceMultiplier today - if a future event pays more, this constant needs bumping too.
const MAX_EVENT_FACE_MULTIPLIER = 1.75;

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
  MAX_EVENT_FACE_MULTIPLIER,
};
