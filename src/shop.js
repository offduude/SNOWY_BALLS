// Shop: 6 slots pinned to the cork board. Buying an item spends coins and empties its slot ("SOLD OUT")
// for economy.json shop.restockSeconds; when the timer ends the slot restocks.
// Timers are device-clock timestamps saved with the stock (Economy.getShopState()), so they keep
// running while the app is closed and leaving/re-entering can not reroll anything.
//
// Two item types: "consumable" (a timed buff, the same one can be on sale in several slots) and
// "projectile" (a STACK of consumable projectiles: the amount and the price of one are rolled at random
// each time it is put on sale, the slot's price is amount x unit price; never on sale twice at once).
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

  const CATEGORY_LABEL = { consumable: "BUFF", projectile: "PROJECTILE" };

  // ---------- rules ----------

  function randInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  // Items that come in stacks have an `amount` and a `unitPrice` range; each time one is put on sale a concrete
  // offer is rolled: { amount, unitPrice }. Saved with the stock so leaving the shop can't reroll it.
  function rollOffer(item) {
    if (!item || !item.amount || !item.unitPrice) return null;
    return { amount: randInt(item.amount.min, item.amount.max), unitPrice: randInt(item.unitPrice.min, item.unitPrice.max) };
  }

  function needsOffer(item) {
    return !!(item && item.amount && item.unitPrice);
  }

  // What the slot costs. `offer` is the rolled offer for stack items.
  function price(item, offer) {
    if (offer) return offer.amount * offer.unitPrice;
    if (item.ignorePriceOverride) return item.price;
    const o = eco.shop.priceOverride; // placeholder pricing switch, see economy.json
    return o !== null && o !== undefined ? o : item.price;
  }

  // The cheapest a stack item can be (for the "always show something affordable" safety net).
  function minPrice(item) {
    return needsOffer(item) ? item.amount.min * item.unitPrice.min : price(item);
  }

  function itemById(id) {
    return eco.shop.items.find((it) => it.id === id) || null;
  }

  // A projectile stack is never on sale in two slots at once (buffs may be).
  function isUnique(item) {
    return item.category === "projectile";
  }

  // Items that may go into a slot right now: everything except a unique item that is already on sale elsewhere, or
  // that another slot just sold and is still waiting to restock (`reserved`) - otherwise an empty slot would grab it
  // at once and the sold-out timer would mean nothing.
  // (Projectiles can be bought again and again - they're consumable - so owning some doesn't exclude them.)
  function eligible(shownOthers, reserved) {
    const shownUnique = shownOthers.filter((id) => {
      const it = itemById(id);
      return it && isUnique(it);
    });
    const blocked = shownUnique.concat(reserved || []);
    return eco.shop.items.filter((it) => !(isUnique(it) && blocked.includes(it.id)));
  }

  function averageHitCoins() {
    const w = Object.values(eco.projectiles.snowball.rewards); // what a normal hit pays
    return w.reduce((a, b) => a + b, 0) / w.length;
  }

  function isCheap(item, cfg) {
    return minPrice(item) <= cfg.maxPriceInAverageHits * averageHitCoins();
  }

  function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  // Picks the item TYPE first by economy.json refill.categoryWeights (that is what makes projectiles
  // rare), then a random item of that type. Types with nothing eligible are skipped.
  function pickWeighted(pool) {
    const weights = eco.shop.refill.categoryWeights || {};
    const cats = [...new Set(pool.map((it) => it.category))];
    const w = cats.map((c) => (weights[c] !== undefined ? weights[c] : 1));
    let roll = Math.random() * w.reduce((a, b) => a + b, 0);
    let cat = cats[cats.length - 1];
    for (let i = 0; i < cats.length; i++) {
      roll -= w[i];
      if (roll < 0) {
        cat = cats[i];
        break;
      }
    }
    return pickRandom(pool.filter((it) => it.category === cat));
  }

  // Choose an item for one slot. `shownOthers` = ids in the OTHER slots.
  function pickFor(shownOthers, reserved) {
    const refill = eco.shop.refill;
    const pool = eligible(shownOthers, reserved);
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
  // Buying an item empties its slot ("SOLD OUT") and starts a timer. The timer is a wall-clock
  // timestamp (Date.now() = the device's clock) saved with the stock, so it keeps running while the
  // app is closed: when the player comes back, every slot whose time has passed is restocked.

  function restockMs() {
    return (eco.shop.restockSeconds > 0 ? eco.shop.restockSeconds : 3600) * 1000;
  }

  // Make the saved stock valid (right length, real items, nothing owned, no duplicate projectiles), restock
  // slots whose timer has run out, and fill any other gap. Returns how many slots just came back from SOLD OUT.
  function ensureStock() {
    const st = Economy.getShopState();
    const slots = eco.shop.slots;
    const now = Date.now();
    let restocked = 0; // slots that just came back from a SOLD OUT timer
    let stock = Array.isArray(st.stock) ? st.stock.slice(0, slots) : [];
    while (stock.length < slots) stock.push(null);
    const restock = Array.isArray(st.restock) ? st.restock.slice(0, slots) : [];
    while (restock.length < slots) restock.push(null);
    const offers = Array.isArray(st.offers) ? st.offers.slice(0, slots) : [];
    while (offers.length < slots) offers.push(null);

    // Invalid entries (item removed from economy.json, duplicate unique item) become empty slots.
    stock = stock.map((id) => (id && itemById(id) ? id : null));
    // Only projectiles must be unique; a duplicated buff is allowed.
    stock = stock.map((id, i) => (id && isUnique(itemById(id)) && stock.indexOf(id) !== i ? null : id));

    for (let i = 0; i < slots; i++) {
      if (stock[i] !== null) {
        restock[i] = null;
        // A stack item on sale needs its rolled offer (an old save from before offers existed has none).
        const it = itemById(stock[i]);
        if (needsOffer(it) && !(offers[i] && offers[i].amount > 0 && offers[i].unitPrice > 0)) offers[i] = rollOffer(it);
        if (!needsOffer(it)) offers[i] = null;
        continue;
      }
      const t = restock[i];
      if (t && typeof t.at === "number") {
        // The device clock was set back: never wait longer than one full timer.
        if (t.at - now > restockMs() + 1000) t.at = now + restockMs();
        if (now < t.at) continue; // still counting down
      }
      const others = stock.filter((id, j) => j !== i && id);
      // Unique items that OTHER slots sold and are still counting down for stay theirs until their timer ends.
      const reserved = restock.filter((r, j) => j !== i && r && typeof r.at === "number" && r.at > now).map((r) => r.prev);
      stock[i] = pickFor(others, reserved); // nothing eligible -> stays empty, shown as (TBD)
      offers[i] = stock[i] !== null ? rollOffer(itemById(stock[i])) : null; // a fresh amount and price on every (re)stock
      if (t && stock[i] !== null) restocked++;
      restock[i] = null;
    }
    st.stock = stock;
    st.restock = restock;
    st.offers = offers;
    Economy.saveShop();
    return restocked;
  }

  function buy(slot) {
    const st = Economy.getShopState();
    const id = st.stock && st.stock[slot];
    const item = id && itemById(id);
    if (!item) return { ok: false, reason: "empty" };
    const offer = (st.offers || [])[slot] || null;
    if (!Economy.spendCoins(price(item, offer))) return { ok: false, reason: "funds" };

    if (item.category === "projectile") {
      // The whole stack goes into the inventory. If this is a kind the player had none of, the PROJECTILES
      // list expands and its red dot comes on (Economy raises it; more of a kind they already have doesn't).
      Economy.addProjectiles(item.id, offer ? offer.amount : 1);
    } else {
      Buffs.activate(item); // a consumable is a timed buff: it starts right now (see buffs.js)
    }

    st.stock[slot] = null;
    st.offers[slot] = null;
    st.restock[slot] = { at: Date.now() + restockMs(), prev: item.id };
    Economy.saveShop();
    return { ok: true, item };
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  }

  // ---------- UI ----------

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function cardHtml(id, slot) {
    const item = id && itemById(id);
    if (!item) {
      const t = (Economy.getShopState().restock || [])[slot];
      const timer = t && typeof t.at === "number" ? `<span class="shop-timer" data-at="${t.at}">${formatTime(t.at - Date.now())}</span>` : "";
      // A slot with a timer is SOLD OUT; a slot with nothing to sell at all is (TBD) - there are no items for it yet.
      return `<div class="shop-card empty"><span class="shop-name">${timer ? "SOLD OUT" : "(TBD)"}</span>${timer}</div>`;
    }
    const offer = (Economy.getShopState().offers || [])[slot] || null;
    const p = price(item, offer);
    const afford = Economy.getCoins() >= p;
    const amountLabel = offer ? ` x${offer.amount}` : ""; // a stack: "PROJECTILE x14"
    return (
      `<button class="shop-card ${afford ? "" : "cant"}" data-slot="${slot}" type="button">` +
      `<span class="shop-cat">${CATEGORY_LABEL[item.category] || ""}${amountLabel}</span>` +
      `<span class="shop-pic">${item.image ? `<img src="${esc(item.image)}" alt="" draggable="false" />` : ""}</span>` +
      `<span class="shop-name">${esc(item.name)}</span>` +
      `<span class="shop-price"><i class="coin"></i>${p}</span>` +
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
    const now = Date.now();
    const limit = restockMs() + 1000;
    // due = a timer ran out, or the device clock was set back so a deadline is absurdly far away
    const due = (st.restock || []).some((t) => t && typeof t.at === "number" && (t.at <= now || t.at - now > limit));
    if (due) {
      announceRestock(ensureStock(), true);
      if (open) render();
    }
    if (open) {
      root.querySelectorAll(".shop-timer").forEach((el) => {
        el.textContent = formatTime(Number(el.dataset.at) - now);
      });
    }
  }

  function onClick(e) {
    const btn = e.target.closest(".shop-card[data-slot]");
    if (!btn) return;
    // A just-bought card lingers ~220ms while it fades; a quick double-tap on it must not count as
    // another purchase attempt.
    if (btn.classList.contains("bought")) return;
    const result = buy(Number(btn.dataset.slot));
    if (result.ok) {
      playUiClick();
      btn.classList.add("bought");
      setTimeout(render, 220); // let the "bought" flash play, then show SOLD OUT + its timer
    } else if (result.reason === "funds") {
      btn.classList.remove("shake");
      void btn.offsetWidth; // restart the animation if they tap repeatedly
      btn.classList.add("shake");
    }
  }

  return {
    isReady: () => !!eco,
    init(economyJson) {
      eco = economyJson;
      root = document.getElementById("shop-items");
      root.addEventListener("click", onClick);
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
      ensureStock();
      // The player is looking at the shop now, so whatever the dot was about is seen.
      Economy.getShopState().unseen = false;
      Economy.saveShop();
      setDot(false);
      render();
    },
  };
})();
