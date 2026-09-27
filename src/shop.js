// Shop: a plain list of every projectile/buff, greyed out when not currently in the roll (2026-09-27 redesign -
// it used to be a 3x2 grid of 6 rolled slots pinned to the cork board; see docs/NOTES.md). Underneath, the roll
// itself is unchanged: 6 "slots" still exist (Economy.getShopState().stock), each still independently timed and
// rerolled - the list just shows every catalog item and looks up whether it's in that stock right now, instead of
// rendering the stock array directly as cards. Buying empties an item's slot ("SOLD OUT") for
// economy.json shop.restockSeconds; when the timer ends the slot restocks (with a fresh pick, possibly a
// different item). Timers are device-clock timestamps saved with the stock, so they keep running while the app
// is closed and leaving/re-entering can not reroll anything.
//
// Item types: "consumable" (a timed buff, the same one can be on sale in several slots) and "projectile" (a
// STACK of consumable projectiles: the amount and the price of one are rolled at random each time it is put
// on sale, the slot's price is amount x unit price). Skins (character/scenery/weather) used to be a third,
// one-time-unlock type sold here too, but were pulled from the shop's pool entirely (2026-09-27, owner's call)
// - they're bought from the new BOXES feature instead, as stackable items (see Economy.addSkin).
// Any item can be on sale in several slots at once - each slot has its own offer.
// When a slot restocks while the shop is closed, the SHOP button gets a dot and a sound plays.
//
// Effects (coinMultiplier, aimSpeedMultiplier, ...) are NOT applied yet - buying currently just
// spends coins and records the purchase.
// Every UI button click (SHOP/BACK, buying, equipping, list buttons) goes through here.
const UI_CLICK_VOLUME = 0.4; // half of the old 0.8
function playUiClick() {
  const game = window.snowyBallsGame;
  if (game) game.sound.play("click", { volume: UI_CLICK_VOLUME });
}

const Shop = (() => {
  let eco = null;
  let root = null;
  let dotEl = null;

  // ---------- rules ----------

  function randInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  // Items that come in stacks have an `amount` and a `unitPrice` range; each time one is put on sale a concrete
  // offer is rolled: { amount, unitPrice }. Saved with the stock so leaving the shop can't reroll it.
  // A single item can have a `priceRange` {min, max} instead of a fixed price: each time it is put on sale its price is
  // rolled in that range (the offer is then { price }).
  function rollOffer(item) {
    if (!item) return null;
    if (item.amount && item.unitPrice) {
      return { amount: randInt(item.amount.min, item.amount.max), unitPrice: randInt(item.unitPrice.min, item.unitPrice.max) };
    }
    if (item.priceRange) return { price: randInt(item.priceRange.min, item.priceRange.max) };
    return null;
  }

  function needsOffer(item) {
    return !!(item && ((item.amount && item.unitPrice) || item.priceRange));
  }

  // Is the saved offer a usable one for this item (an old save, or an edited economy.json, may not match)?
  function offerValid(offer, item) {
    if (!offer) return false;
    if (item.amount && item.unitPrice) return offer.amount > 0 && offer.unitPrice > 0;
    return offer.price > 0;
  }

  // What the slot costs. `offer` is the rolled offer for stack items.
  function price(item, offer) {
    if (offer && offer.price) return offer.price;
    if (offer) return offer.amount * offer.unitPrice;
    if (item.ignorePriceOverride) return item.price;
    const o = eco.shop.priceOverride; // placeholder pricing switch, see economy.json
    return o !== null && o !== undefined ? o : item.price;
  }

  // The cheapest a stack item can be (for the "always show something affordable" safety net).
  function minPrice(item) {
    if (item.amount && item.unitPrice) return item.amount.min * item.unitPrice.min;
    if (item.priceRange) return item.priceRange.min;
    return price(item);
  }

  function itemById(id) {
    return eco.shop.items.find((it) => it.id === id) || null;
  }

  // Items that may go into a slot: all of them - nothing is unique any more (the same item, projectiles included,
  // can be on sale in any number of slots; every slot rolls its own amount and price).
  // (An item with "godOnly" - a test buff - is never sold: a god mode save just has it, see Economy.fillGod.)
  function eligible() {
    return eco.shop.items.filter((it) => !it.godOnly);
  }

  function averageHitCoins() {
    return eco.projectiles.snowball.hitValue; // what a normal hit pays
  }

  function isCheap(item, cfg) {
    return minPrice(item) <= cfg.maxPriceInAverageHits * averageHitCoins();
  }

  // Every item in a rarity pool is drawn with equal weight now that skins (which used to be thinned to half
  // weight here, see git history) aren't in the pool at all any more.
  function itemWeight(item) {
    return 1;
  }

  function pickWeightedFrom(list) {
    const total = list.reduce((sum, it) => sum + itemWeight(it), 0);
    let roll = Math.random() * total;
    for (const it of list) {
      roll -= itemWeight(it);
      if (roll < 0) return it;
    }
    return list[list.length - 1];
  }

  // The pick for a slot is by RARITY: first a rarity is rolled by its chance (economy.json "rarities"; only rarities that
  // have an item in the pool take part, their chances are rescaled to 100%), then one of that rarity's items is picked
  // (weighted - see pickWeightedFrom/itemWeight above). An item with no rarity counts as the most common one.
  function pickWeighted(pool) {
    // Only rarities with a chance above 0 can be rolled (the "default" one has 0: it is the snowball's, not for sale).
    const rarities = (eco.rarities || []).filter((r) => r.chance > 0);
    if (!rarities.length) return pickWeightedFrom(pool);
    const rid = (it) => (rarities.some((r) => r.id === Rarity.ofItem(it)) ? Rarity.ofItem(it) : rarities[0].id);
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

  // Choose an item for one slot. `shownOthers` = ids in the OTHER slots.
  function pickFor(shownOthers) {
    const refill = eco.shop.refill;
    const pool = eligible();
    if (!pool.length) return null;

    let candidate = pickWeighted(pool);

    // Safety net: never let the shop end up with nothing the player could reasonably afford.
    const g = refill.guaranteeCheapItem;
    if (g && g.enabled) {
      const othersHaveCheap = shownOthers.some((id) => id && itemById(id) && isCheap(itemById(id), g));
      if (!othersHaveCheap && !isCheap(candidate, g)) {
        const cheap = pool.filter((it) => isCheap(it, g));
        if (cheap.length) candidate = pickWeighted(cheap);
      }
    }
    return candidate.id;
  }

  // ---------- sold-out timers ----------
  // Buying an item empties its slot ("SOLD OUT") and starts a timer. The timer is a timestamp on the SHOP'S CLOCK (Economy.shopNow(): the device's
  // clock, sped up by any equipped skin's shopSpeed effect (economy.js) - nothing has one today, Frosty Night's 1.2x was removed 2026-09-23) saved with the stock, so it keeps running while the
  // app is closed: when the player comes back, every slot whose time has passed is restocked. Every time below is in shop time (ms of it);
  // what the player is shown is real time: shop time / Economy.shopRate().
  const shopNow = () => Economy.shopNow();
  const realMs = (shopMs) => shopMs / Economy.shopRate();

  function restockMs() {
    return (eco.shop.restockSeconds > 0 ? eco.shop.restockSeconds : 3600) * 1000;
  }

  // How long an item stays on sale before its slot rerolls: by its rarity (economy.json rarities[].availabilitySeconds); an item
  // with no rarity counts as common, like everywhere else in the shop. 0 = no timer.
  function availMs(item) {
    const rarities = eco.rarities || [];
    let r = rarities.find((x) => x.id === Rarity.ofItem(item));
    if (!r || !r.availabilitySeconds) r = rarities.find((x) => x.chance > 0) || r;
    return r && r.availabilitySeconds > 0 ? r.availabilitySeconds * 1000 : 0;
  }

  // 1799000 ms -> "29:59", 3 h 59 min -> "3:59:00" (the same look as the max time in the BUFFS tab, hours when there are any)
  function availText(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000 - 0.001)); // (the small allowance: 1500000.0000000002 ms must read 25:00, not 25:01)
    const h = Math.floor(total / 3600);
    const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const ss = String(total % 60).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  // A slot's new item takes over the clock of the one it replaces: its availability starts when the previous one ran out (or
  // when the sold-out slot came back), NOT when the player happens to open the app. If that is already over too (the app was
  // closed for a long time) the slot is rerolled again, and again, until the item that would be on sale right now is found -
  // so time away is used up, never refunded as a fresh timer. Returns { id, expires } (id null: nothing eligible).
  function rollFrom(startAt, others, now) {
    let at = startAt;
    let id = null;
    let d = 0;
    for (let n = 0; n < 500; n++) {
      id = pickFor(others);
      if (id === null) return { id: null, expires: null };
      d = availMs(itemById(id));
      if (!d) return { id, expires: null }; // an item without a timer
      at += d;
      if (at > now) return { id, expires: at };
    }
    return { id, expires: now + d }; // (safety net for an absurd absence: the last pick gets a full timer)
  }

  // Make the saved stock valid (right length, real items, nothing owned, no duplicate projectiles), restock
  // slots whose timer has run out, and fill any other gap. Returns how many slots just came back from SOLD OUT.
  function ensureStock() {
    const st = Economy.getShopState();
    const slots = eco.shop.slots;
    const now = shopNow();
    let restocked = 0; // slots that just came back from a SOLD OUT timer or rerolled because their item ran out
    let stock = Array.isArray(st.stock) ? st.stock.slice(0, slots) : [];
    while (stock.length < slots) stock.push(null);
    const restock = Array.isArray(st.restock) ? st.restock.slice(0, slots) : [];
    while (restock.length < slots) restock.push(null);
    const offers = Array.isArray(st.offers) ? st.offers.slice(0, slots) : [];
    while (offers.length < slots) offers.push(null);
    const expires = Array.isArray(st.expires) ? st.expires.slice(0, slots) : [];
    while (expires.length < slots) expires.push(null);

    // Invalid entries (an id removed from economy.json since this was saved) become empty slots.
    stock = stock.map((id) => (id && itemById(id) ? id : null));

    for (let i = 0; i < slots; i++) {
      if (stock[i] !== null) {
        restock[i] = null;
        // A stack item on sale needs its rolled offer (an old save from before offers existed has none).
        const it = itemById(stock[i]);
        if (needsOffer(it) && !offerValid(offers[i], it)) offers[i] = rollOffer(it);
        if (!needsOffer(it)) offers[i] = null;
        // The availability timer of the item on sale (by its rarity).
        const dur = availMs(it);
        if (!dur) {
          expires[i] = null;
        } else if (typeof expires[i] !== "number") {
          expires[i] = now + dur; // freshly stocked, or a save from before this timer existed
        } else if (expires[i] - now > dur + 1000) {
          expires[i] = now + dur; // the device clock was set back: never longer than one full timer
        } else if (now >= expires[i]) {
          // Ran out: the slot rerolls - a new pick with a fresh amount and price. Its timer continues from where the old one ended
          // (see rollFrom), so if the app was closed for a while it may already have been replaced again in between.
          const others = stock.filter((id, j) => j !== i && id);
          const r = rollFrom(expires[i], others, now);
          stock[i] = r.id;
          offers[i] = r.id !== null ? rollOffer(itemById(r.id)) : null;
          expires[i] = r.expires;
          if (stock[i] !== null) restocked++;
        }
        continue;
      }
      expires[i] = null;
      const t = restock[i];
      if (t && typeof t.at === "number") {
        // The device clock was set back: never wait longer than one full timer.
        if (t.at - now > restockMs() + 1000) t.at = now + restockMs();
        if (now < t.at) continue; // still counting down
      }
      const others = stock.filter((id, j) => j !== i && id);
      // The new item's availability timer starts when the sold-out timer ended (or now, for a first stocking) - see rollFrom.
      const r = rollFrom(t && typeof t.at === "number" ? t.at : now, others, now);
      stock[i] = r.id; // nothing eligible (an empty item list) -> stays empty, shown as (TBD)
      offers[i] = stock[i] !== null ? rollOffer(itemById(stock[i])) : null; // a fresh amount and price on every (re)stock
      if (t && stock[i] !== null) restocked++;
      restock[i] = null;
      expires[i] = r.expires;
    }
    st.stock = stock;
    st.restock = restock;
    st.offers = offers;
    st.expires = expires;
    Economy.saveShop();
    return restocked;
  }

  // A buff can't be held in more than Economy.getBuffMax() (99) copies.
  function isMaxed(item) {
    return item.category === "consumable" && Economy.getBuffCount(item.id) >= Economy.getBuffMax();
  }

  // The list (see render() below) shows every catalog item, not a slot - so buying is keyed by item id: it resolves
  // to whichever slot currently has it in stock (the first one, if it somehow rolled into more than one at once).
  function buy(itemId) {
    const st = Economy.getShopState();
    const slot = st.stock ? st.stock.indexOf(itemId) : -1;
    if (slot === -1) return { ok: false, reason: "unavailable" }; // not currently in the roll: greyed out, can't be bought
    const item = itemById(itemId);
    if (!item) return { ok: false, reason: "empty" };
    if (isMaxed(item)) return { ok: false, reason: "max" }; // already holding the most of this buff: nothing is charged
    const offer = (st.offers || [])[slot] || null;
    if (!Economy.spendCoins(price(item, offer))) return { ok: false, reason: "funds" };

    if (item.category === "projectile") {
      // The whole stack goes into the inventory. If this is a kind the player had none of, the PROJECTILES
      // list expands and its red dot comes on (Economy raises it; more of a kind they already have doesn't).
      Economy.addProjectiles(item.id, offer ? offer.amount : 1);
    } else {
      Economy.addBuffs(item.id, 1); // a buff goes into the inventory; it is USED from the BUFFS tab (see buffs.js)
    }

    st.stock[slot] = null;
    st.offers[slot] = null;
    if (st.expires) st.expires[slot] = null; // sold: no availability timer, the sold-out timer runs instead
    st.restock[slot] = { at: shopNow() + restockMs(), prev: item.id };
    Economy.saveShop();
    return { ok: true, item };
  }

  // ---------- UI ----------
  // The SHOP tab is a plain list of every projectile/buff (2026-09-27) - one row per catalog item, not one card per
  // rolled slot. An item currently in the roll (Economy.getShopState().stock) shows its real rolled price and a
  // working BUY button; one that isn't shows a greyed row instead (its cheapest possible price, as a "from" hint,
  // via minPrice - there's no rolled offer to show an exact one). PROJECTILES / BUFFS is which catalog is showing.

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  let openCat = "projectile"; // the shop always opens on this (the owner's ask), then follows the category buttons

  function categoryItems(cat) {
    return eco.shop.items.filter((it) => it.category === cat);
  }

  // One row. `slot` is the item's first matching slot in the current roll, or -1 if it isn't in stock right now.
  function rowHtml(item) {
    const st = Economy.getShopState();
    const slot = st.stock ? st.stock.indexOf(item.id) : -1;
    const available = slot !== -1;
    const offer = available ? (st.offers || [])[slot] || null : null;
    const p = available ? price(item, offer) : minPrice(item);
    const afford = available && Economy.getCoins() >= p && !isMaxed(item); // a maxed-out buff looks unbuyable, like a too-expensive one
    const at = available ? (st.expires || [])[slot] : null;
    const avail = typeof at === "number" ? availText(realMs(at - shopNow())) : null;
    const action =
      `<button class="pick-equip shop-buy${afford ? "" : " cant"}" type="button" data-id="${esc(item.id)}">` +
      (available ? "" : `<span class="shop-from">from </span>`) +
      `<i class="coin"></i><span>${p}</span></button>`;
    return Collection.shopRowHtml(item, { offer, action, extraClass: available ? "" : " unavailable", availText: avail });
  }

  function render() {
    if (!root) return;
    root.innerHTML = categoryItems(openCat).map(rowHtml).join("");
  }

  function updateCatButtons() {
    const p = document.getElementById("shop-cat-projectile");
    const b = document.getElementById("shop-cat-buff");
    if (p) p.classList.toggle("active", openCat === "projectile");
    if (b) b.classList.toggle("active", openCat === "consumable");
  }

  function setCat(cat) {
    if (openCat === cat) return;
    openCat = cat;
    updateCatButtons();
    render();
  }

  function isShopOpen() {
    return document.getElementById("game-container").classList.contains("shop-open");
  }

  // A full, unconditional reset of the shop - every slot, including one currently SOLD OUT, gets a brand new item,
  // amount/price and availability timer right now, as if all six had just been freshly stocked (the owner's call,
  // 2026-09-23: ALL 6 slots, not just the ones currently on sale - a SOLD OUT slot's own countdown is skipped too,
  // not left running). Used by the Toy Tank event (main.js fireTank) - "the entire shop should reroll the exact
  // time the tank fires".
  function rerollAll() {
    const st = Economy.getShopState();
    const slots = eco.shop.slots;
    const now = shopNow();
    const stock = new Array(slots).fill(null);
    const offers = new Array(slots).fill(null);
    const expires = new Array(slots).fill(null);
    for (let i = 0; i < slots; i++) {
      const others = stock.filter((id, j) => j !== i && id);
      const id = pickFor(others);
      stock[i] = id;
      offers[i] = id !== null ? rollOffer(itemById(id)) : null;
      const dur = id !== null ? availMs(itemById(id)) : 0;
      expires[i] = dur ? now + dur : null;
    }
    st.stock = stock;
    st.offers = offers;
    st.expires = expires;
    st.restock = new Array(slots).fill(null);
    Economy.saveShop();
    if (isShopOpen()) render();
  }

  function setDot(on) {
    if (dotEl) dotEl.classList.toggle("show", !!on);
  }

  // `count` = slots that just restocked. `live` = the player is in the app right now (a timer ran
  // out while playing / the app came back to the foreground), as opposed to the game only just
  // loading with timers that ran out while it was closed - a sound there would blast out on the
  // first tap. If the shop isn't open the SHOP button gets a dot, which stays (it is saved) until the
  // shop is opened. The sound plays whenever it's live, open or not.
  function announceRestock(count, live) {
    if (!count) return;
    const st = Economy.getShopState();
    const open = isShopOpen();
    // The dot is already up and nobody has opened the shop yet: this restock is just more of the
    // same news, so no second sound (however much later it happens).
    const alreadyAnnounced = !open && st.unseen;
    if (!open) {
      st.unseen = true;
      Economy.saveShop();
      setDot(true);
    }
    const game = window.snowyBallsGame;
    if (live && game && !alreadyAnnounced) game.sound.play("shop_restock", { volume: 0.9 });
  }

  // Once a second (and when the app returns to the foreground): restock any slot whose time is up, and while the
  // shop is on screen just re-render - the list is small and nothing here needs the finer-grained "update just the
  // timer text nodes" approach the old per-slot grid used (that existed to not disturb an in-progress hold-to-inspect,
  // which this list doesn't have any more).
  function tick() {
    if (!eco) return;
    const st = Economy.getShopState();
    const open = isShopOpen();
    const now = shopNow();
    const limit = restockMs() + 1000;
    // due = a timer ran out, or the device clock was set back so a deadline is absurdly far away
    const due =
      (st.restock || []).some((t) => t && typeof t.at === "number" && (t.at <= now || t.at - now > limit)) ||
      // ... or an item's availability ran out (the slot rerolls), or that clock was set back too
      (st.expires || []).some((x) => typeof x === "number" && (x <= now || x - now > 4 * 3600 * 1000 + 1000));
    if (due) announceRestock(ensureStock(), true);
    if (open) render(); // keeps the "available: MM:SS" countdowns live, not just on a reroll
  }

  function onClick(e) {
    const btn = e.target.closest(".shop-buy[data-id]");
    if (!btn) return;
    const result = buy(btn.dataset.id);
    if (result.ok) {
      playUiClick();
      if (typeof Cloud !== "undefined") Cloud.notePurchase();
      render();
    } else if (result.reason === "funds" || result.reason === "max") {
      btn.classList.remove("shake");
      void btn.offsetWidth; // restart the animation if they tap repeatedly
      btn.classList.add("shake");
    }
  }

  return {
    isReady: () => !!eco,
    init(economyJson) {
      eco = economyJson;
      if (eco.shop && eco.shop.buffMax) Economy.setBuffMax(eco.shop.buffMax);
      // The shop's clock runs at the product of the equipped skins' `shopSpeed` effects (nothing has one today - Frosty Night's 1.2x was removed
      // 2026-09-23, but a future skin could still use it): set now (a save may have been loaded with one equipped) and again every time something is equipped.
      const syncRate = () => Economy.setShopRate(Economy.skinEffects(eco).filter((e) => e.type === "shopSpeed").reduce((a, e) => a * e.value, 1));
      Economy.setEquippedHook(syncRate);
      syncRate();
      root = document.getElementById("shop-scroll");
      root.addEventListener("click", onClick);
      document.getElementById("shop-cat-projectile").addEventListener("click", () => setCat("projectile"));
      document.getElementById("shop-cat-buff").addEventListener("click", () => setCat("consumable")); // economy.json's own category id for a buff
      dotEl = document.getElementById("shop-dot");
      // generate / repair / restock the saved stock right away, before the shop is ever opened
      announceRestock(ensureStock(), false); // timers that ran out while the app was closed: dot, no sound
      setDot(Economy.getShopState().unseen);
      setInterval(tick, 1000);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) tick();
      });
    },
    // Called every time the shop screen opens. Always opens on PROJECTILES (the owner's ask) - the BUFFS tab, if it
    // was open last time, is not remembered across visits.
    onOpen() {
      if (!eco) return;
      ensureStock();
      openCat = "projectile";
      updateCatButtons();
      // The player is looking at the shop now, so whatever the dot was about is seen.
      Economy.getShopState().unseen = false;
      Economy.saveShop();
      setDot(false);
      render();
    },
    rerollAll, // exposed for the Toy Tank event (main.js fireTank) - see rerollAll's own comment
  };
})();
