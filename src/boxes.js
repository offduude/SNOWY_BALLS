// BOXES: three always-available mystery boxes (character / scenery / weather), bought with coins from the
// corkboard grid the SHOP tab used to own (see shop.js's own note on #boxes-board/#boxes-items, 2026-09-27).
// A box's prize pool is that kind's own master list in economy.json (characters / sceneries / weathers) - the
// same list the SKINS menu equips from. A draw is weighted by the shared rarity chances (economy.json
// "rarities"), the same idea as a shop slot's own rarity roll (see shop.js pickWeighted) but scoped to one
// kind's pool instead of the whole shop catalog. There's no "already owned" case to special-case: skins are
// stackable now (Economy.addSkin), so every draw - new or a duplicate - is a real, useful outcome.
//
// The bottom row (seasonal boxes) is a static "Coming Soon..." placeholder for now - no logic, no data.
const Boxes = (() => {
  let eco = null;
  let root = null; // #boxes-items

  const KINDS = ["character", "scenery", "weather"];
  const KIND_LIST = { character: "characters", scenery: "sceneries", weather: "weathers" };
  const KIND_LABEL = { character: "CHARACTER", scenery: "SCENERY", weather: "WEATHER" };

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

  // Per-kind animation state: "shaking" while a purchase is resolving (bought, drawing), then the won item
  // shows in its place for a moment before the box reverts to its normal mystery-box look. Both are transient
  // (never saved) - a reload mid-animation just shows the box normally, nothing is lost (the coins were already
  // spent and the skin already added the moment the reveal is decided, not when its display times out).
  let shaking = {};
  let reveal = {}; // kind -> { item }

  function boxCardHtml(kind) {
    const def = boxDef(kind);
    if (!def) return `<div class="shop-card empty"><span class="shop-name">(TBD)</span></div>`;
    if (reveal[kind]) {
      const it = reveal[kind].item;
      return (
        `<div class="shop-card${Rarity.cardClass(it.rarity)}" data-kind="${esc(kind)}">` +
        `<span class="shop-top"><span class="shop-cat">${KIND_LABEL[kind]}</span>${Rarity.labelHtml(it.rarity, "shop-rarity", true)}</span>` +
        `<span class="shop-pic">${it.image ? `<img src="${esc(it.image)}" alt="" draggable="false" />` : ""}</span>` +
        `<span class="shop-name">${esc(it.name)}</span>` +
        `</div>`
      );
    }
    const afford = Economy.getCoins() >= def.price;
    return (
      `<button class="shop-card${afford ? "" : " cant"}${shaking[kind] ? " shake" : ""}" data-kind="${esc(kind)}" type="button">` +
      `<span class="shop-top"><span class="shop-cat">${KIND_LABEL[kind]}</span></span>` +
      `<span class="shop-pic"><span class="box-mystery">?</span></span>` +
      `<span class="shop-name">${esc(def.name)}</span>` +
      `<span class="shop-bottom"><span class="shop-price"><i class="coin"></i>${def.price}</span><span></span></span>` +
      `</button>`
    );
  }

  function render() {
    if (!root) return;
    const soon = `<div class="shop-card empty"><span class="shop-name">Coming Soon...</span></div>`;
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
      }, 300); // just the shake, same as a shop card that can't be afforded
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

  function onClick(e) {
    const btn = e.target.closest(".shop-card[data-kind]");
    if (!btn || btn.classList.contains("empty")) return;
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
    },
    // Called every time the BOXES screen opens.
    onOpen() {
      if (!eco) return;
      shaking = {};
      reveal = {};
      render();
    },
  };
})();
