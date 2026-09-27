// BOXES: three always-available mystery boxes (character / scenery / weather), bought with coins from the
// corkboard grid the SHOP tab used to own (see shop.js's own note on #boxes-board/#boxes-items, 2026-09-27).
// A box's prize pool is that kind's own master list in economy.json (characters / sceneries / weathers) - the
// same list the SKINS menu equips from, and (2026-09-27) EVERY non-default skin that exists today is in one of
// these three pools already, just by virtue of poolFor() excluding only the default (see below) - there's
// nothing else to add. A draw is weighted by the shared rarity chances (economy.json "rarities"), the same idea
// as a shop slot's own rarity roll (see shop.js pickWeighted) but scoped to one kind's pool instead of the whole
// shop catalog. There's no "already owned" case to special-case: skins are stackable now (Economy.addSkin), so
// every draw - new or a duplicate - is a real, useful outcome.
//
// Redesigned 2026-09-27: bright colour buttons instead of the shop's old pinned-leaflet look (no category label
// any more, box.png as the closed-box art, price centered), plus a HOLD-to-inspect popup (same convention as the
// old shop's hold-to-inspect) showing every possible item in a box - just its picture and a "chance%" caption,
// styled like the game's own "TAP to AIM" message - tapping one of THOSE opens its own full item card on top.
//
// The bottom row (seasonal boxes) is a static "Coming Soon..." placeholder for now - no logic, no data.
const Boxes = (() => {
  let eco = null;
  let root = null; // #boxes-items
  let inspectEl = null; // #boxes-inspect (the odds grid)
  let inspectGridEl = null;
  let itemEl = null; // #boxes-inspect-item (one item's own card, on top of the odds grid)
  let itemCardEl = null;

  const KINDS = ["character", "scenery", "weather"];
  const KIND_LIST = { character: "characters", scenery: "sceneries", weather: "weathers" };
  // Bright, distinct colour per kind - the owner's ask ("bright colour buttons" instead of the old
  // advertisement-leaflet look); no category label drawn on the card any more, the colour itself tells them apart.
  const KIND_COLOR = {
    character: "linear-gradient(160deg, #ff6b6b, #f06595)",
    scenery: "linear-gradient(160deg, #51cf66, #20c997)",
    weather: "linear-gradient(160deg, #339af0, #5c7cfa)",
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function boxDef(kind) {
    return (eco.boxes || []).find((b) => b.kind === kind) || null;
  }

  // Every real (non-default) skin of a kind: the default one is always already owned for free, never a prize.
  function poolFor(kind) {
    return (eco[KIND_LIST[kind]] || []).filter((it) => it.rarity !== "default");
  }

  // Weighted by economy.json's shared rarity chances - roll a rarity, then pick uniformly among this kind's
  // items at that rarity (an item with no rarity counts as the most common one, same convention as shop.js).
  function draw(kind) {
    const pool = poolFor(kind);
    if (!pool.length) return null;
    const rarities = (eco.rarities || []).filter((r) => r.chance > 0);
    if (!rarities.length) return pool[Math.floor(Math.random() * pool.length)];
    const rid = (it) => (rarities.some((r) => r.id === it.rarity) ? it.rarity : rarities[0].id);
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
    const atRarity = pool.filter((it) => rid(it) === chosen.id);
    return atRarity[Math.floor(Math.random() * atRarity.length)];
  }

  // The exact same math as draw() above, but as a percentage per item instead of one random pick - for the
  // inspect popup ("chance% below each item's picture"). Sorted biggest chance first (easiest to scan).
  function oddsFor(kind) {
    const pool = poolFor(kind);
    const rarities = (eco.rarities || []).filter((r) => r.chance > 0);
    if (!rarities.length) {
      const each = pool.length ? 100 / pool.length : 0;
      return pool.map((it) => ({ item: it, chance: each }));
    }
    const rid = (it) => (rarities.some((r) => r.id === it.rarity) ? it.rarity : rarities[0].id);
    const present = rarities.filter((r) => pool.some((it) => rid(it) === r.id));
    const total = present.reduce((sum, r) => sum + r.chance, 0);
    return pool
      .map((it) => {
        const r = present.find((x) => x.id === rid(it));
        const sameRarityCount = pool.filter((x) => rid(x) === rid(it)).length;
        const chance = r && total > 0 ? (r.chance / total / sameRarityCount) * 100 : 0;
        return { item: it, chance: Math.round(chance * 10) / 10 };
      })
      .sort((a, b) => b.chance - a.chance);
  }

  // Per-kind animation state: "shaking" while a purchase is resolving (bought, drawing), then the won item
  // shows in its place for a moment before the box reverts to its normal look. Both are transient (never saved)
  // - a reload mid-animation just shows the box normally, nothing is lost (the coins were already spent and the
  // skin already added the moment the reveal is decided, not when its display times out).
  let shaking = {};
  let reveal = {}; // kind -> { item }

  function boxCardHtml(kind) {
    const def = boxDef(kind);
    if (!def) return `<div class="box-btn box-soon"><span class="box-name">(TBD)</span></div>`;
    if (reveal[kind]) {
      const it = reveal[kind].item;
      return (
        `<div class="box-btn box-reveal${Rarity.cardClass(it.rarity)}" data-kind="${esc(kind)}" style="background:${KIND_COLOR[kind]}">` +
        Rarity.labelHtml(it.rarity, "box-reveal-rarity", true) +
        `<span class="box-pic">${it.image ? `<img src="${esc(it.image)}" alt="" draggable="false" />` : ""}</span>` +
        `<span class="box-name">${esc(it.name)}</span>` +
        `</div>`
      );
    }
    const afford = Economy.getCoins() >= def.price;
    return (
      `<button class="box-btn${afford ? "" : " cant"}${shaking[kind] ? " shake" : ""}" data-kind="${esc(kind)}" type="button" style="background:${KIND_COLOR[kind]}">` +
      `<span class="box-pic"><img src="assets/ui/box.png" alt="" draggable="false" /></span>` +
      `<span class="box-name">${esc(def.name)}</span>` +
      `<span class="box-price"><i class="coin"></i>${def.price}</span>` +
      `</button>`
    );
  }

  function render() {
    if (!root) return;
    const soon = `<div class="box-btn box-soon"><span class="box-name">Coming Soon...</span></div>`;
    root.innerHTML = `<div class="shop-grid">${KINDS.map(boxCardHtml).join("")}${soon}${soon}${soon}</div>`;
  }

  const SHAKE_MS = 500; // matches .shop-card.shake's own 0.3s animation with a little room to read as "something's happening"
  const REVEAL_MS = 1800; // how long the won item's card stays up before the box resets

  function openBox(kind) {
    if (shaking[kind] || reveal[kind]) return; // already mid-animation: ignore a second tap
    const def = boxDef(kind);
    if (!def) return;
    if (!Economy.spendCoins(def.price)) {
      shaking[kind] = true;
      render();
      setTimeout(() => {
        shaking[kind] = false;
        render();
      }, 300); // just the shake, same as a box that can't be afforded
      return;
    }
    const item = draw(kind);
    if (!item) {
      Economy.addCoins(def.price); // refund: this kind's pool is empty (shouldn't happen with real content)
      return;
    }
    shaking[kind] = true;
    render();
    setTimeout(() => {
      shaking[kind] = false;
      Economy.addSkin(kind, item.id, 1); // granted the moment the draw is decided, not when the reveal times out
      reveal[kind] = { item };
      render();
      setTimeout(() => {
        delete reveal[kind];
        render();
      }, REVEAL_MS);
    }, SHAKE_MS);
  }

  // ---------- HOLD to INSPECT (same convention as the old shop's hold-to-inspect) ----------
  const HOLD_MS = 450;
  const HOLD_SLOP = 10; // px the finger may move and still be a hold
  let holdTimer = null;
  let holdFrom = null;
  let holdFired = false;

  function cancelHold() {
    clearTimeout(holdTimer);
    holdTimer = null;
  }

  function closeItem() {
    if (itemEl) itemEl.classList.remove("show");
  }

  function closeInspect() {
    closeItem();
    if (inspectEl) inspectEl.classList.remove("show");
  }

  // The odds rectangle (index.html #boxes-inspect-grid: a real cream/brown panel now, 2026-09-27 - "give the box
  // inspect popup a background"): just each possible item's picture and its chance%, styled like "TAP to AIM"
  // (white, black-outlined text) - no other text at all, all in a single row inside that panel (2026-09-27, the
  // owner's ask - superseded the earlier ceil(sqrt(n)) grid attempt). Tapping a picture opens that item's own
  // card on top.
  function openInspect(kind) {
    const def = boxDef(kind);
    if (!def || !inspectGridEl) return;
    inspectGridEl.dataset.kind = kind;
    inspectGridEl.innerHTML = oddsFor(kind)
      .map(
        ({ item, chance }) =>
          `<div class="box-inspect-cell" data-id="${esc(item.id)}">` +
          `<img src="${esc(item.image || "")}" alt="" draggable="false" />` +
          `<div class="box-inspect-chance">${chance}%</div>` +
          `</div>`
      )
      .join("");
    inspectEl.classList.add("show");
  }

  function openItem(kind, id) {
    const item = poolFor(kind).find((it) => it.id === id);
    if (!item || !itemCardEl) return;
    // No EQUIP button (this is a preview, not owned yet a lot of the time) and no owned-count line either
    // (2026-09-27, the owner's ask: "the inspected item in the box shouldn't have its quantity displayed").
    itemCardEl.innerHTML = Collection.skinRowHtml(kind, item, "<span></span>", "", false, true);
    itemEl.classList.add("show");
  }

  function onInspectClick(e) {
    if (e.target.closest("#boxes-inspect-item")) return; // clicks inside the nested item card are its own business
    const cell = e.target.closest(".box-inspect-cell");
    if (cell) {
      openItem(inspectGridEl.dataset.kind, cell.dataset.id);
      return;
    }
    closeInspect(); // anywhere else in the odds grid/backdrop: close
  }

  function onItemClick(e) {
    if (!e.target.closest(".pick-row")) closeItem(); // outside the card: back to the odds grid
  }

  function onClick(e) {
    if (holdFired) {
      holdFired = false; // the click that ends a hold (the inspect popup opened): not a purchase
      return;
    }
    const btn = e.target.closest(".box-btn[data-kind]");
    if (!btn || btn.classList.contains("box-soon")) return;
    playUiClick();
    openBox(btn.dataset.kind);
  }

  return {
    isReady: () => !!eco,
    init(economyJson) {
      eco = economyJson;
      root = document.getElementById("boxes-items");
      root.addEventListener("click", onClick);
      root.addEventListener("contextmenu", (e) => e.preventDefault()); // no image-save menu on a held box card
      // hold to inspect
      root.addEventListener("pointerdown", (e) => {
        holdFired = false;
        const card = e.target.closest(".box-btn[data-kind]");
        cancelHold();
        if (!card || card.classList.contains("box-soon")) return;
        holdFrom = { x: e.clientX, y: e.clientY };
        holdTimer = setTimeout(() => {
          holdTimer = null;
          holdFired = true;
          openInspect(card.dataset.kind);
        }, HOLD_MS);
      });
      root.addEventListener("pointermove", (e) => {
        if (holdTimer && holdFrom && Math.hypot(e.clientX - holdFrom.x, e.clientY - holdFrom.y) > HOLD_SLOP) cancelHold();
      });
      ["pointerup", "pointercancel", "pointerleave"].forEach((t) => root.addEventListener(t, cancelHold));
      inspectEl = document.getElementById("boxes-inspect");
      inspectGridEl = document.getElementById("boxes-inspect-grid");
      itemEl = document.getElementById("boxes-inspect-item");
      itemCardEl = document.getElementById("boxes-inspect-item-card");
      inspectEl.addEventListener("click", onInspectClick);
      itemEl.addEventListener("click", onItemClick);
      [root, inspectEl].forEach((el) => el.addEventListener("contextmenu", (e) => e.preventDefault()));
    },
    // Called every time the BOXES screen opens.
    onOpen() {
      if (!eco) return;
      shaking = {};
      reveal = {};
      closeInspect();
      render();
    },
  };
})();
