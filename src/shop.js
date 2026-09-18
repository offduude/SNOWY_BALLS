// Shop: 6 slots pinned to the cork board. Buying an item spends coins and a *different* item
// takes its slot. What's on sale is saved (Economy.getShopState().stock) so leaving and
// re-entering the game can't reroll it. All numbers come from economy.json ("shop" section).
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

  // Identifies the item list in economy.json; changes when items are added or removed.
  function catalogKey() {
    return eco.shop.items.map((it) => it.id).sort().join(",");
  }

  // Make the saved stock valid (right length, real items, nothing owned, no duplicates) and fill
  // gaps. A slot that is empty because the pool ran dry ("SOLD OUT") is NOT refilled just because
  // the shop was reopened - otherwise the item you just bought (consumables never leave the pool)
  // would pop straight back. Empty slots only refill when the item list in economy.json changes.
  function ensureStock() {
    const st = Economy.getShopState();
    const slots = eco.shop.slots;
    const fresh = !Array.isArray(st.stock);
    let stock = fresh ? [] : st.stock.slice(0, slots);
    while (stock.length < slots) stock.push(null);

    const wasEmpty = stock.map((id) => id === null); // sold out on purpose
    const catalog = catalogKey();
    const catalogChanged = st.catalog !== catalog;

    // Invalid entries (item removed from economy.json, already owned, duplicate) become gaps that DO get refilled.
    stock = stock.map((id) => {
      const it = id && itemById(id);
      return it && !isOwnedPermanent(it) ? id : null;
    });
    stock = stock.map((id, i) => (id && stock.indexOf(id) !== i ? null : id));

    for (let i = 0; i < slots; i++) {
      if (stock[i] !== null) continue;
      if (wasEmpty[i] && !fresh && !catalogChanged) continue; // stays SOLD OUT
      const others = stock.filter((id, j) => j !== i && id);
      stock[i] = pickFor(others, null);
    }
    st.stock = stock;
    st.catalog = catalog;
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

    const others = st.stock.filter((x, j) => j !== slot && x);
    st.stock[slot] = pickFor(others, item.id);
    Economy.saveShop();
    return { ok: true, item };
  }

  // ---------- UI ----------

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function cardHtml(id, slot) {
    const item = id && itemById(id);
    if (!item) {
      return `<div class="shop-card empty"><span class="shop-name">SOLD OUT</span></div>`;
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

  function onClick(e) {
    const btn = e.target.closest(".shop-card[data-slot]");
    if (!btn) return;
    // A just-bought card lingers ~220ms while it fades; a quick double-tap must not buy the
    // replacement item that has already been swapped in behind it.
    if (btn.classList.contains("bought")) return;
    const result = buy(Number(btn.dataset.slot));
    const game = window.snowyBallsGame;
    if (result.ok) {
      if (game) game.sound.play("click", { volume: 0.8 });
      btn.classList.add("bought");
      setTimeout(render, 220); // let the "bought" flash play, then show the replacement
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
      ensureStock(); // generate (or repair) the saved stock right away, before the shop is ever opened
    },
    // Called every time the shop screen opens.
    onOpen() {
      if (!eco) return;
      ensureStock();
      render();
    },
  };
})();
