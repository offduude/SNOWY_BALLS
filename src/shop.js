// Shop: 6 slots pinned to the cork board. Buying an item spends coins and empties its slot ("SOLD OUT")
// for economy.json shop.restockSeconds; when the timer ends the slot restocks.
// Timers are device-clock timestamps saved with the stock (Economy.getShopState()), so they keep
// running while the app is closed and leaving/re-entering can not reroll anything.
//
// Item types: "consumable" (a timed buff, the same one can be on sale in several slots),
// "projectile" (a STACK of consumable projectiles: the amount and the price of one are rolled at random
// each time it is put on sale, the slot's price is amount x unit price) and the three SKIN types "character",
// "scenery" and "weather" (bought once: the item's id is the skin's id in economy.json characters / sceneries /
// weathers and buying unlocks it - it is then equipped from the SKINS menu; the card's label says which kind it is).
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

  // The label in the top-left corner of a card, by the item's category.
  const CATEGORY_LABEL = { consumable: "BUFF", projectile: "PROJECTILE", character: "CHARACTER", scenery: "SCENERY", weather: "WEATHER" };
  const SKIN_CATEGORIES = ["character", "scenery", "weather"];
  const ownedSkin = (item) => SKIN_CATEGORIES.includes(item.category) && Economy.isUnlocked(item.category, item.id);

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
  // (A skin the player already has is not sold again.)
  function eligible() {
    return eco.shop.items.filter((it) => !it.godOnly && !ownedSkin(it));
  }

  function averageHitCoins() {
    return eco.projectiles.snowball.hitValue; // what a normal hit pays
  }

  function isCheap(item, cfg) {
    return minPrice(item) <= cfg.maxPriceInAverageHits * averageHitCoins();
  }

  // A skin (character/scenery/weather) is worth HALF as much as anything else once an item is actually being picked
  // FROM a rarity - the rarity roll itself (below) is untouched, this only thins skins out among whatever else
  // shares that rarity, so the shop doesn't always have one waiting and flood the SKINS menu (the owner's call,
  // 2026-09-23: "all skins appear twice as rarely"). A straight half WEIGHT in the draw, not a separate coin-flip
  // first: with one legendary skin next to two ordinary legendary items, its chance is 0.5 / (1 + 1 + 0.5) = 20% -
  // exactly 0.5/N (the owner's own example) in the limit where every OTHER item sharing its rarity is weight 1 and
  // it is the only skin; with more than one skin in the same rarity pool they only thin each other a little further.
  function itemWeight(item) {
    return SKIN_CATEGORIES.includes(item.category) ? 0.5 : 1;
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

    // Invalid entries (item removed from economy.json, duplicate unique item, or a skin that got bought/unlocked
    // some other way while it was still sitting on sale - see ownedSkin) become empty slots. This is the general
    // safety net; buy() below also clears a skin's OTHER slots the instant it's bought, so this mostly only ever
    // has to catch a skin unlocked by some other means (the owner's report, 2026-09-23: "wasting slots" - an
    // owned skin must never sit on sale, however it became owned).
    stock = stock.map((id) => (id && itemById(id) && !ownedSkin(itemById(id)) ? id : null));

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

  // A buff can't be held in more than Economy.getBuffMax() (99) copies; a skin only once (a card still on sale after it was bought in another slot cannot be bought).
  function isMaxed(item) {
    return (item.category === "consumable" && Economy.getBuffCount(item.id) >= Economy.getBuffMax()) || ownedSkin(item);
  }

  function buy(slot) {
    const st = Economy.getShopState();
    const id = st.stock && st.stock[slot];
    const item = id && itemById(id);
    if (!item) return { ok: false, reason: "empty" };
    if (isMaxed(item)) return { ok: false, reason: "max" }; // already holding the most of this buff: nothing is charged
    const offer = (st.offers || [])[slot] || null;
    if (!Economy.spendCoins(price(item, offer))) return { ok: false, reason: "funds" };

    if (item.category === "projectile") {
      // The whole stack goes into the inventory. If this is a kind the player had none of, the PROJECTILES
      // list expands and its red dot comes on (Economy raises it; more of a kind they already have doesn't).
      Economy.addProjectiles(item.id, offer ? offer.amount : 1);
    } else if (SKIN_CATEGORIES.includes(item.category)) {
      Economy.unlock(item.category, item.id); // a character / scenery / weather is unlocked: it shows up in its SKINS menu, equipped from there
      // The same skin can be on sale in several slots at once - every OTHER one showing it is stale the instant
      // it's bought anywhere, so clear it right now too (ensureStock's own stock-validation step is the general
      // safety net for every other way a skin can become owned while stocked; this is the immediate path for the
      // one that can happen inside a single shop visit - the owner's report, 2026-09-23: "wasting slots").
      st.stock.forEach((otherId, i) => {
        if (i !== slot && otherId === item.id) {
          st.stock[i] = null;
          st.offers[i] = null;
          if (st.expires) st.expires[i] = null;
          st.restock[i] = { at: shopNow() + restockMs(), prev: item.id };
        }
      });
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

  function formatTime(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000 - 0.001));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  }

  // ---------- UI ----------

  // HOLD TO INSPECT: holding a card down (HOLD_MS, without moving) opens an inspect popup - the item's card from its own list (Collection.shopCardHtml) with a
  // button that shows the price and buys it - and a tap on a card still buys at once, as before. A click anywhere outside the popup's card closes it. The
  // release of the hold must not count as a tap (holdFired), and the popup ignores clicks for a moment after it opens so the finger that is still on it can't buy.
  const HOLD_MS = 450;
  const HOLD_SLOP = 10; // px the finger may move and still be a hold
  let holdTimer = null;
  let holdFrom = null;
  let holdFired = false;
  let inspectEl = null;
  let inspecting = null; // { slot, id } of the card in the popup
  let inspectOpenedAt = 0;

  function cancelHold() {
    clearTimeout(holdTimer);
    holdTimer = null;
  }

  function closeInspect() {
    inspecting = null;
    if (inspectEl) inspectEl.classList.remove("show");
  }

  function openInspect(slot) {
    const st = Economy.getShopState();
    const id = st.stock && st.stock[slot];
    const item = id && itemById(id);
    if (!item || !inspectEl) return;
    const offer = (st.offers || [])[slot] || null;
    const p = price(item, offer);
    const afford = Economy.getCoins() >= p && !isMaxed(item);
    inspecting = { slot, id };
    inspectOpenedAt = Date.now();
    inspectEl.querySelector("#shop-inspect-card").innerHTML = Collection.shopCardHtml(
      item,
      offer,
      `<button class="pick-equip shop-buy${afford ? "" : " cant"}" type="button"><i class="coin"></i><span>${p}</span></button>`
    );
    inspectEl.classList.add("show");
  }

  function onInspectClick(e) {
    if (Date.now() - inspectOpenedAt < 350) return;
    const btn = e.target.closest(".shop-buy");
    if (!btn) {
      if (!e.target.closest(".pick-row")) closeInspect(); // outside the card
      return;
    }
    if (!inspecting) return;
    const { slot, id } = inspecting;
    const st = Economy.getShopState();
    if (!st.stock || st.stock[slot] !== id) {
      closeInspect(); // the slot changed meanwhile (its timer ran out): not the item that was inspected any more
      render();
      return;
    }
    const result = buy(slot);
    if (result.ok) {
      playUiClick();
      if (typeof Cloud !== "undefined") Cloud.notePurchase();
      closeInspect();
      render();
    } else {
      btn.classList.remove("shake");
      void btn.offsetWidth;
      btn.classList.add("shake");
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // The availability timer in the top-left of the picture rectangle: how long until this item is replaced.
  function availHtml(slot) {
    const at = (Economy.getShopState().expires || [])[slot];
    return typeof at === "number" ? `<span class="shop-avail" data-at="${at}">${availText(realMs(at - shopNow()))}</span>` : "";
  }

  function cardHtml(id, slot) {
    const item = id && itemById(id);
    if (!item) {
      const t = (Economy.getShopState().restock || [])[slot];
      const timer = t && typeof t.at === "number" ? `<span class="shop-timer" data-at="${t.at}">${formatTime(realMs(t.at - shopNow()))}</span>` : "";
      // A slot with a timer is SOLD OUT; a slot with nothing to sell at all is (TBD) - there are no items for it yet.
      return `<div class="shop-card empty"><span class="shop-name">${timer ? "SOLD OUT" : "(TBD)"}</span>${timer}</div>`;
    }
    const offer = (Economy.getShopState().offers || [])[slot] || null;
    const p = price(item, offer);
    const afford = Economy.getCoins() >= p && !isMaxed(item); // a maxed-out buff looks unbuyable, like a too-expensive one
    // Bottom row: the price at the left, the amount of a stack ("x14") at the right (a single item has no amount).
    const amountHtml = offer && offer.amount ? `<span class="shop-amount">x${offer.amount}</span>` : `<span></span>`;
    return (
      `<button class="shop-card ${afford ? "" : "cant"}${Rarity.cardClass(Rarity.ofItem(item))}" data-slot="${slot}" type="button">` +
      `<span class="shop-top"><span class="shop-cat">${CATEGORY_LABEL[item.category] || ""}</span>${Rarity.labelHtml(Rarity.ofItem(item), "shop-rarity", true)}</span>` +
      `<span class="shop-pic">${availHtml(slot)}${item.image ? `<img src="${esc(item.image)}" alt="" draggable="false" />` : ""}</span>` +
      `<span class="shop-name">${esc(item.name)}</span>` +
      `<span class="shop-bottom"><span class="shop-price"><i class="coin"></i>${p}</span>${amountHtml}</span>` +
      `</button>`
    );
  }

  function render() {
    if (!root) return;
    const stock = Economy.getShopState().stock || [];
    root.innerHTML = `<div class="shop-grid">${stock.map(cardHtml).join("")}</div>`;
  }

  function isShopOpen() {
    return document.getElementById("game-container").classList.contains("shop-open");
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

  // Once a second (and when the app returns to the foreground): restock any slot whose time is up,
  // and while the shop is on screen count the timers down.
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
    if (due) {
      announceRestock(ensureStock(), true);
      if (open) render();
    }
    if (open) {
      root.querySelectorAll(".shop-timer").forEach((el) => {
        el.textContent = formatTime(realMs(Number(el.dataset.at) - now));
      });
      root.querySelectorAll(".shop-avail").forEach((el) => {
        el.textContent = availText(realMs(Number(el.dataset.at) - now));
      });
    }
  }

  function onClick(e) {
    if (holdFired) {
      holdFired = false; // the click that ends a hold (the inspect popup opened): not a purchase
      return;
    }
    const btn = e.target.closest(".shop-card[data-slot]");
    if (!btn) return;
    // A just-bought card lingers ~220ms while it fades; a quick double-tap on it must not count as
    // another purchase attempt.
    if (btn.classList.contains("bought")) return;
    const result = buy(Number(btn.dataset.slot));
    if (result.ok) {
      playUiClick();
      if (typeof Cloud !== "undefined") Cloud.notePurchase();
      btn.classList.add("bought");
      setTimeout(render, 220); // let the "bought" flash play, then show SOLD OUT + its timer
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
      root = document.getElementById("shop-items");
      root.addEventListener("click", onClick);
      inspectEl = document.getElementById("shop-inspect");
      inspectEl.addEventListener("click", onInspectClick);
      // hold to inspect; and no browser menu for an image / a card that is held down (it offered to save or share the picture)
      root.addEventListener("pointerdown", (e) => {
        holdFired = false;
        const card = e.target.closest(".shop-card[data-slot]");
        cancelHold();
        if (!card) return;
        holdFrom = { x: e.clientX, y: e.clientY };
        holdTimer = setTimeout(() => {
          holdTimer = null;
          holdFired = true;
          openInspect(Number(card.dataset.slot));
        }, HOLD_MS);
      });
      root.addEventListener("pointermove", (e) => {
        if (holdTimer && holdFrom && Math.hypot(e.clientX - holdFrom.x, e.clientY - holdFrom.y) > HOLD_SLOP) cancelHold();
      });
      ["pointerup", "pointercancel", "pointerleave"].forEach((t) => root.addEventListener(t, cancelHold));
      [root, inspectEl].forEach((el) => el.addEventListener("contextmenu", (e) => e.preventDefault()));
      dotEl = document.getElementById("shop-dot");
      // generate / repair / restock the saved stock right away, before the shop is ever opened
      announceRestock(ensureStock(), false); // timers that ran out while the app was closed: dot, no sound
      setDot(Economy.getShopState().unseen);
      setInterval(tick, 1000);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) tick();
      });
    },
    // Called every time the shop screen opens.
    onOpen() {
      if (!eco) return;
      closeInspect();
      ensureStock();
      // The player is looking at the shop now, so whatever the dot was about is seen.
      Economy.getShopState().unseen = false;
      Economy.saveShop();
      setDot(false);
      render();
    },
  };
})();
