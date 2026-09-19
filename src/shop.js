// Shop: 6 slots pinned to the cork board. Buying an item spends coins and empties its slot ("SOLD OUT")
// for economy.json shop.restockSeconds; when the timer ends the slot restocks with a different item.
// Timers are device-clock timestamps saved with the stock (Economy.getShopState()), so they keep
// running while the app is closed and leaving/re-entering can not reroll anything.
//
// Effects (coinMultiplier, aimSpeedMultiplier, ...) are NOT applied yet - buying currently just
// spends coins and records the purchase.
const Shop = (() => {
  let eco = null;
  let root = null;

  const CATEGORY_LABEL = { accessory: "ACCESSORY", buff: "BUFF", projectile: "PROJECTILE" };

  // ---------- rules ----------

  function price(item) {
    const o = eco.shop.priceOverride; // placeholder pricing switch, see economy.json
    return o !== null && o !== undefined ? o : item.price;
  }

  function itemById(id) {
    return eco.shop.items.find((it) => it.id === id) || null;
  }

  function isOwnedPermanent(item) {
    return item.kind === "permanent" && Economy.getShopState().owned.includes(item.id);
  }

  function eligible(excludeIds) {
    return eco.shop.items.filter((it) => !isOwnedPermanent(it) && !excludeIds.includes(it.id));
  }

  function averageHitCoins() {
    const w = Object.values(eco.rewards.windows);
    return w.reduce((a, b) => a + b, 0) / w.length;
  }

  function isCheap(item, cfg) {
    return price(item) <= cfg.maxPriceInAverageHits * averageHitCoins();
  }

  function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  // Choose an item for one slot. `shownOthers` = ids in the OTHER slots; `justBought` never
  // comes straight back into the slot it left.
  function pickFor(shownOthers, justBought) {
    const refill = eco.shop.refill;
    // The same item must never be on sale in two slots at once - not configurable, it's an invariant.
    const exclude = [...shownOthers];
    if (justBought) exclude.push(justBought);
    const pool = eligible(exclude);
    if (!pool.length) return null;

    let candidate = pickRandom(pool);

    // Safety net: never let the shop end up with nothing the player could reasonably afford.
    const g = refill.guaranteeCheapItem;
    if (g && g.enabled) {
      const othersHaveCheap = shownOthers.some((id) => id && itemById(id) && isCheap(itemById(id), g));
      if (!othersHaveCheap && !isCheap(candidate, g)) {
        const cheap = pool.filter((it) => isCheap(it, g));
        if (cheap.length) candidate = pickRandom(cheap);
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

  // Make the saved stock valid (right length, real items, nothing owned, no duplicates), restock
  // slots whose timer has run out, and fill any other gap.
  function ensureStock() {
    const st = Economy.getShopState();
    const slots = eco.shop.slots;
    const now = Date.now();
    let stock = Array.isArray(st.stock) ? st.stock.slice(0, slots) : [];
    while (stock.length < slots) stock.push(null);
    const restock = Array.isArray(st.restock) ? st.restock.slice(0, slots) : [];
    while (restock.length < slots) restock.push(null);

    // Invalid entries (item removed from economy.json, already owned, duplicate) become empty slots.
    stock = stock.map((id) => {
      const it = id && itemById(id);
      return it && !isOwnedPermanent(it) ? id : null;
    });
    stock = stock.map((id, i) => (id && stock.indexOf(id) !== i ? null : id));

    for (let i = 0; i < slots; i++) {
      if (stock[i] !== null) {
        restock[i] = null;
        continue;
      }
      const t = restock[i];
      if (t && typeof t.at === "number") {
        // The device clock was set back: never wait longer than one full timer.
        if (t.at - now > restockMs() + 1000) t.at = now + restockMs();
        if (now < t.at) continue; // still counting down
      }
      const others = stock.filter((id, j) => j !== i && id);
      stock[i] = pickFor(others, t ? t.prev : null); // nothing eligible -> stays SOLD OUT, no timer
      restock[i] = null;
    }
    st.stock = stock;
    st.restock = restock;
    Economy.saveShop();
    return stock;
  }

  function buy(slot) {
    const st = Economy.getShopState();
    const id = st.stock && st.stock[slot];
    const item = id && itemById(id);
    if (!item) return { ok: false, reason: "empty" };
    if (!Economy.spendCoins(price(item))) return { ok: false, reason: "funds" };

    if (item.kind === "permanent") st.owned.push(item.id);
    else st.consumables[item.id] = (st.consumables[item.id] || 0) + 1;

    st.stock[slot] = null;
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
      return `<div class="shop-card empty"><span class="shop-name">SOLD OUT</span>${timer}</div>`;
    }
    const p = price(item);
    const afford = Economy.getCoins() >= p;
    return (
      `<button class="shop-card ${afford ? "" : "cant"}" data-slot="${slot}" type="button">` +
      `<span class="shop-cat">${CATEGORY_LABEL[item.category] || ""}</span>` +
      `<span class="shop-pic"></span>` + // reserved for the item's picture
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

  // Once a second while the shop is on screen: count the timers down, and restock a slot the moment
  // its time is up. Also runs when the app comes back to the foreground.
  function tick() {
    if (!eco || !document.getElementById("game-container").classList.contains("shop-open")) return;
    const now = Date.now();
    let expired = false;
    root.querySelectorAll(".shop-timer").forEach((el) => {
      const left = Number(el.dataset.at) - now;
      if (left <= 0) expired = true;
      else el.textContent = formatTime(left);
    });
    if (expired) {
      ensureStock();
      render();
    }
  }

  function onClick(e) {
    const btn = e.target.closest(".shop-card[data-slot]");
    if (!btn) return;
    // A just-bought card lingers ~220ms while it fades; a quick double-tap on it must not count as
    // another purchase attempt.
    if (btn.classList.contains("bought")) return;
    const result = buy(Number(btn.dataset.slot));
    const game = window.snowyBallsGame;
    if (result.ok) {
      if (game) game.sound.play("click", { volume: 0.8 });
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
      ensureStock(); // generate / repair / restock the saved stock right away, before the shop is ever opened
      setInterval(tick, 1000);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) tick();
      });
    },
    // Called every time the shop screen opens.
    onOpen() {
      if (!eco) return;
      ensureStock();
      render();
    },
  };
})();
