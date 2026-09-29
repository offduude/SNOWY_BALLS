// The GLOBAL shop stock doc (`shopStock/current`) - Part of the plan's item 5 ("Move shop rerolling to a Cloud
// Scheduler job... writing one global stock doc; clients become read-only on stock"). This is what actually
// closes the multi-tab reroll exploit: today (src/shop.js rerollAll()) each browser tab computes its OWN random
// stock independently into its own local save, so opening several tabs and picking whichever roll looks best is
// free. One server-generated doc, read-only to every client, means there is only ever one roll to look at.
//
// The generation logic below (eligible/pickWeighted/pickForCategory/rollOffer/generateStock) is a faithful,
// line-by-line port of src/shop.js's own rerollAll()/pickForCategory()/pickWeighted()/pickWeightedFrom()/
// rollOffer() - same guaranteedIds, same per-category rolls, same rarity-weighted picks, same stack-amount rolls -
// so the SERVER'S roll behaves identically to what the client always did, just computed in one place instead of
// once per tab. See functions/shop.js for what actually calls this on a schedule.
const { db } = require("./admin");
const eco = require("./economyData");

function shopStockRef() {
  return db.collection("shopStock").doc("current");
}

function itemById(id) {
  return eco.shopItemIndex.get(id) || null;
}

function rerollMs() {
  const s = eco.eco.shop.rerollSeconds;
  return (s > 0 ? s : 1800) * 1000;
}

// Mirrors shop.js's eligible(): excludes godOnly test items and anything in shop.guaranteedIds (always in stock,
// never rolled for).
function eligible(cat) {
  const guaranteed = new Set(eco.eco.shop.guaranteedIds || []);
  return eco.eco.shop.items.filter((it) => !it.godOnly && it.category === cat && !guaranteed.has(it.id));
}

// Every item in a pool has equal weight today (mirrors shop.js's itemWeight(), always 1).
function pickWeightedFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// Mirrors shop.js's pickWeighted(): roll a rarity by its chance among rarities present in the pool, then pick
// uniformly among that rarity's items.
function pickWeighted(pool) {
  const rarities = (eco.eco.rarities || []).filter((r) => r.chance > 0);
  if (!rarities.length) return pickWeightedFrom(pool);
  const rid = (it) => (rarities.some((r) => r.id === eco.rarityOfItem(it)) ? eco.rarityOfItem(it) : rarities[0].id);
  const present = rarities.filter((r) => pool.some((it) => rid(it) === r.id));
  const total = present.reduce((sum, r) => sum + r.chance, 0);
  let roll = Math.random() * total;
  let chosen = present[present.length - 1];
  for (const r of present) {
    roll -= r.chance;
    if (roll < 0) {
      chosen = r;
      break;
    }
  }
  return pickWeightedFrom(pool.filter((it) => rid(it) === chosen.id));
}

// Mirrors shop.js's pickForCategory() minus the (currently disabled) guaranteeCheapItem safety net - economy.json
// shop.refill.guaranteeCheapItem.enabled is false today; ported here would be dead code until it's ever turned on.
function pickForCategory(cat, count) {
  const pool = eligible(cat);
  if (!pool.length) return [];
  const picks = [];
  for (let i = 0; i < count; i++) picks.push(pickWeighted(pool));
  return picks.map((it) => it.id);
}

// Mirrors shop.js's rollOffer(): only a stack item (category "projectile", has `amount`) gets a rolled amount.
function rollOffer(item) {
  if (!item || !item.amount) return null;
  return { amount: item.amount.min + Math.floor(Math.random() * (item.amount.max - item.amount.min + 1)) };
}

// Mirrors shop.js's rerollAll(): guaranteed ids unconditionally in, plus rollsPerCategory independent picks per
// category, deduped into a Set, each with its own rolled offer.
function generateStock() {
  const picked = new Set(eco.eco.shop.guaranteedIds || []);
  const rolls = eco.eco.shop.rollsPerCategory || 1;
  for (const cat of ["projectile", "consumable"]) {
    for (const id of pickForCategory(cat, rolls)) picked.add(id);
  }
  const stock = [...picked];
  const offers = stock.map((id) => rollOffer(itemById(id)));
  const now = Date.now();
  return { stock, offers, nextRerollAt: now + rerollMs(), generatedAt: now };
}

// Defensive-default normalization (same philosophy as lib/saves.js's normalize()) - a missing/malformed doc comes
// back as an empty, clearly-due stock rather than throwing.
function normalize(raw) {
  const p = raw || {};
  const stock = Array.isArray(p.stock) ? p.stock.map((id) => (typeof id === "string" ? id : null)) : [];
  const offersIn = Array.isArray(p.offers) ? p.offers : [];
  const offers = stock.map((_, i) => (offersIn[i] && Number.isInteger(offersIn[i].amount) ? { amount: offersIn[i].amount } : null));
  return {
    stock,
    offers,
    nextRerollAt: typeof p.nextRerollAt === "number" ? p.nextRerollAt : null,
    generatedAt: typeof p.generatedAt === "number" ? p.generatedAt : null,
  };
}

// Mirrors shop.js's isDue(): no stock yet, no valid timer, the timer's already passed, or the clock/cadence
// jumped further than one full cycle (never wait more than one rerollMs, same reasoning as the client's own
// device-clock-set-back guard). `stock.length === 0` covers the brand-new-doc case explicitly, since
// normalize(null) already coerces to a (valid, non-due-by-array-type) empty array.
function isDue(stock, now) {
  return (
    stock.stock.length === 0 ||
    typeof stock.nextRerollAt !== "number" ||
    now >= stock.nextRerollAt ||
    stock.nextRerollAt - now > rerollMs() + 1000
  );
}

module.exports = { shopStockRef, itemById, generateStock, normalize, isDue, rerollMs };
