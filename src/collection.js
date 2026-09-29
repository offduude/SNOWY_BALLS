// The PROJECTILES / CHARACTERS lists: a finger-scrollable list in the middle of the screen with
// name, picture, description and an EQUIP button per entry. Only one list is open at a time.
// What's equipped is saved (Economy.getEquipped). Equipping a projectile tells the game
// (MainScene.onProjectileEquipped); characters are not selectable yet (no CHARACTERS button).
// Only what the player has is listed: refilling projectiles (the snowball - its card stays even at x0, with a
// "+1 in 00:xx" timer under EQUIP) and projectiles they still have some of (consumable: one is used per throw, and a kind that runs out leaves the list).
// A red dot on the PROJECTILES button pops up when the list EXPANDS (a new kind arrives), not on a refill.
//
// To add an entry: add an object to the right array below. `id` is stored in saves, so never
// rename it once players have it. `image` is any picture URL (shown pixelated).
const Collection = (() => {
  const CATALOG = {
    projectile: {
      title: "PROJECTILES",
      items: [
        {
          id: "snowball",
          name: "Snowball",
          description: "The classic. Cold, round and reliable.",
          image: "assets/snowball/snowball_shop.png",
        },
        {
          id: "drone", // same id as its shop item and its economy.json "projectiles" entry
          name: "Drone",
          description: "I'm pretty sure my licence expired...",
          image: "assets/snowball/drone.png",
        },
        {
          id: "grenade", // same id as its shop item and its economy.json "projectiles" entry
          name: "Grenade",
          description: "What a great day to have one!",
          image: "assets/snowball/grenade.png",
        },
        {
          id: "onion", // same id as its shop item and its economy.json "projectiles" entry
          name: "Onion",
          description: '"Do you want one?"',
          image: "assets/snowball/onion.png",
        },
        {
          id: "chestnut", // same id as its shop item and its economy.json "projectiles" entry
          name: "Chestnut",
          description: "Found it in someone's backpack. How convenient!",
          image: "assets/snowball/chestnut.png",
        },
        {
          id: "potato", // same id as its shop item and its economy.json "projectiles" entry
          name: "Potato",
          description: "Meets the PC requirements for this game.",
          image: "assets/snowball/potato.png",
        },
        {
          id: "pinecone", // same id as its shop item and its economy.json "projectiles" entry
          name: "Pinecone",
          description: "Feels kinda sticky.",
          image: "assets/snowball/pine_cone.png?v=2",
        },
        {
          id: "stone", // same id as its shop item and its economy.json "projectiles" entry
          name: "Stone",
          description: "Vile snowball.",
          image: "assets/snowball/stone.png",
        },
        {
          id: "rowan_berry", // same id as its shop item and its economy.json "projectiles" entry
          name: "Rowan Berry",
          description: "Not yummy if you're not a bird.",
          image: "assets/snowball/rowan_berry.png",
        },
        {
          id: "test_very_heavy", // TEST projectile: economy.json projectiles.test_very_heavy is "godOnly", so only a god mode save lists it
          name: "Test Boulder",
          description: "Very heavy test projectile. God mode only.",
          image: "assets/snowball/stone.png",
        },
        {
          id: "tomato", // same id as its shop item and its economy.json "projectiles" entry
          name: "Tomato",
          description: "Tomato ketchup is a salad.",
          image: "assets/snowball/tomato.png",
        },
        {
          id: "egg", // same id as its shop item and its economy.json "projectiles" entry
          name: "Egg",
          description: "No chickens inside. Enough for a 'basic' omelette.",
          image: "assets/snowball/egg.png",
        },
      ],
    },
  };

  // SKINS (the SKINS button): a list with three buttons, CHARACTERS, SCENERIES and WEATHER, each opening a menu of cards (economy.json characters / sceneries / weathers).
  // Their cards are like the buff cards (name, description, rarity in the corner, the EQUIP button, the detail line at the bottom) without an amount:
  // they are never consumed and never unequipped - only by equipping another one (the equipped one's button just says EQUIPPED). Listed by
  // rarity, the rarest on top, the default one at the bottom.
  const SKIN_MENUS = ["character", "scenery", "weather"]; // the menus of cards (each kind's own list in economy.json: characters / sceneries / weathers)
  const SKIN_KINDS = ["skins", ...SKIN_MENUS];
  const SKIN_TITLES = { skins: "SKINS", character: "CHARACTERS", scenery: "SCENERIES", weather: "WEATHER" };
  const SKIN_LISTS = { character: "characters", scenery: "sceneries", weather: "weathers" };

  function skinItems(kind) {
    return (eco && eco[SKIN_LISTS[kind]]) || [];
  }

  let container, panelEl, titleEl, scrollEl, buttons, dotEl;
  let eco = null; // economy.json - set by the game scene (setEconomy); projectile numbers come from it
  let openKind = null;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // "x12" next to the name of a consumable projectile (the snowball is infinite: nothing).
  // The top-right corner of a card: the rarity label, then the amount ("x22") to its right. Either can be missing (the
  // snowball is infinite - no amount; an item without a rarity - no label).
  function cornerHtml(rarityId, countText) {
    const label = Rarity.labelHtml(rarityId, "pick-rarity", false);
    if (!label && !countText) return "";
    return `<span class="pick-corner">${label}${countText ? `<span class="pick-count">${countText}</span>` : ""}</span>`;
  }

  // "x12" - or "xINF" in god mode, where nothing is used up
  function countText(n) {
    return Economy.isGod() ? "xINF" : `x${n}`;
  }

  function projectileCorner(kind, item) {
    if (kind !== "projectile") return "";
    const p = eco && eco.projectiles && eco.projectiles[item.id];
    const finite = !(p && p.infinite);
    return cornerHtml(p && p.rarity, finite ? countText(Economy.getProjectileCount(item.id)) : "");
  }

  // "+1 in 00:27" under the EQUIP button of a refilling projectile ("MAX" while its stock is full).
  function regenText(id) {
    const info = Economy.regenInfo(id);
    if (!info) return "";
    return info.msToNext !== null ? `+1 in ${clock(info.msToNext)}` : "MAX";
  }

  function clock(ms) {
    const total = Math.ceil(ms / 1000);
    return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
  }

  function regenHtml(kind, item) {
    const p = kind === "projectile" && eco && eco.projectiles && eco.projectiles[item.id];
    return p && p.regen ? `<div class="pick-regen">${regenText(item.id)}</div>` : "";
  }

  function isListed(kind, it) {
    if (SKIN_MENUS.includes(kind)) return it.rarity === "default" || Economy.getSkinCount(kind, it.id) > 0; // the default ones are always there
    if (kind !== "projectile") return false;
    const p = eco && eco.projectiles && eco.projectiles[it.id];
    if (p && p.godOnly && !Economy.isGod()) return false; // a test projectile: god mode saves only
    if (p && (p.regen || p.infinite)) return true; // a refilling projectile never leaves the list, not even at x0
    return Economy.getProjectileCount(it.id) > 0;
  }

  // The two stats in ONE row along the bottom of the card, starting right after the picture (under the text and the
  // EQUIP button). Two fixed columns - the left is as wide as the longest weight word - so each stat is in the same
  // place on every card whatever the words' lengths.
  function statsHtml(kind, item) {
    const p = kind === "projectile" && eco && eco.projectiles && eco.projectiles[item.id];
    if (!p) return "";
    return (
      `<div class="pick-stats">` +
      `<span class="pick-stat">weight: ${esc(p.weightLabel || "?")}</span>` +
      `<span class="pick-stat">hit value: <i class="coin"></i>${p.hitValue}</span>` +
      `</div>`
    );
  }

  // Projectiles are listed by RARITY, the rarest first (economy.json projectiles.<id>.rarity, see rarity.js; an item
  // without a rarity goes last). Ties keep the older order: highest W20 base value first, then the catalog order.
  function sortedItems(kind, items) {
    if (SKIN_MENUS.includes(kind) && eco) {
      // by rarity, the rarest first (legendary on top, default at the bottom); equal rarities keep the file's order
      return items.map((it, i) => ({ it, i })).sort((a, b) => Rarity.rank(b.it.rarity) - Rarity.rank(a.it.rarity) || a.i - b.i).map((x) => x.it);
    }
    if (kind !== "projectile" || !eco) return items;
    const p = (it) => eco.projectiles[it.id] || { hitValue: 0 };
    return items
      .map((it, i) => ({ it, i }))
      .sort((a, b) => Rarity.rank(p(b.it).rarity) - Rarity.rank(p(a.it).rarity) || p(b.it).hitValue - p(a.it).hitValue || a.i - b.i)
      .map((x) => x.it);
  }

  // The red dot on the top-left corner of a card that is new (see Economy.isNewProjectile / isNewBuff).
  const NEW_DOT = '<span class="notif-dot pick-new show"></span>';

  function rowHtml(kind, item) {
    const stats = statsHtml(kind, item);
    const rarityId = kind === "projectile" && eco && eco.projectiles && eco.projectiles[item.id] ? eco.projectiles[item.id].rarity : undefined;
    return (
      `<div class="pick-row${stats ? " has-stats" : ""}${Rarity.cardClass(rarityId)}" data-id="${esc(item.id)}">` +
      (kind === "projectile" && Economy.isNewProjectile(item.id) ? NEW_DOT : "") +
      `<img class="pick-pic" src="${esc(item.image)}" alt="" draggable="false" />` +
      `<div class="pick-text"><div class="pick-name">${esc(item.name)}</div>` +
      `<div class="pick-desc">${esc(item.description)}</div></div>` +
      `<div class="pick-action"><button class="pick-equip" type="button" data-id="${esc(item.id)}"></button>${regenHtml(kind, item)}</div>` +
      projectileCorner(kind, item) + // rarity label + amount sit in the card's top-right corner
      stats +
      `</div>`
    );
  }

  // Sets each EQUIP button's label/state without rebuilding the list (that would jump the scroll). SELL no
  // longer has any equip-dependent state to sync here (2026-09-29, see skinActionHtml) - it doesn't go dead on
  // the equipped skin any more, and the default skin never renders one at all - so this is EQUIP-only again.
  function refreshButtons() {
    if (!openKind) return;
    const equipped = Economy.getEquipped(openKind);
    scrollEl.querySelectorAll(".pick-equip").forEach((b) => {
      const isOn = b.dataset.id === equipped;
      b.textContent = isOn ? "EQUIPPED" : "EQUIP";
      b.classList.toggle("on", isOn);
    });
  }

  // A character / scenery / weather card: picture, name, description, the rarity in the top-right corner, the EQUIP
  // button with how many the player has under it (stackable, never consumed - see Economy.getSkinCount), the detail
  // at the bottom. `action` replaces the EQUIP button (the SKINS list's CHANGE, the shop's price button), `extraClass`
  // is added to the card. `hideAmount` drops the owned-count line entirely (the BOXES inspect popup's item preview,
  // and - 2026-09-29 - every default skin's own card: it's always owned exactly one, so the count says nothing
  // an owned player doesn't already know).
  function skinRowHtml(kind, item, action, extraClass, dot, hideAmount) {
    const detail = item.detail ? `<div class="pick-stats"><span class="pick-stat">${esc(item.detail)}</span></div>` : "";
    const amount = hideAmount ? "" : `<div class="pick-regen"><span>${countText(Economy.getSkinCount(kind, item.id))}</span></div>`;
    return (
      `<div class="pick-row buff-row${item.detail ? " buff-detail" : ""}${extraClass || ""}${Rarity.cardClass(item.rarity)}" data-id="${esc(item.id)}">` +
      (dot ? NEW_DOT : "") +
      `<img class="pick-pic" src="${esc(item.image || "")}" alt="" draggable="false" />` +
      `<div class="pick-text"><div class="pick-name">${esc(item.name)}</div>` +
      `<div class="pick-desc">${esc(item.description || "")}</div></div>` +
      `<div class="pick-action">${action || `<button class="pick-equip" type="button" data-id="${esc(item.id)}"></button>`}${amount}</div>` +
      detail +
      cornerHtml(item.rarity, "") +
      `</div>`
    );
  }

  // The EQUIP-button replacement for a sellable skin card (2026-09-29): EQUIP itself, plus an always-active SELL
  // button beside it. The default skin of a kind has neither a price nor any point in one (it's free and
  // permanent) - it gets `null` here, which falls all the way back to skinRowHtml's own plain lone EQUIP button
  // (no SELL, and the caller also passes hideAmount for it - see the open() call below - so its card drops the
  // owned-count line too). Selling the EQUIPPED skin is allowed (the owner's call) - once wired for real, the
  // Cloud Function that actually performs the sale re-equips the kind's default the moment a sale empties out
  // whatever was equipped, so nothing is ever left "equipped" at 0 owned; nothing client-side needs to guard
  // against that today since selling itself is still inert (see handleSellClick).
  function skinActionHtml(kind, item) {
    if (item.rarity === "default" || !item.sellPrice) return null;
    const equip = `<button class="pick-equip" type="button" data-id="${esc(item.id)}"></button>`;
    const sell = `<button class="pick-sell" type="button" data-sell="${esc(item.id)}" data-kind="${esc(kind)}">SELL</button>`;
    return `<div class="pick-action-row">${equip}${sell}</div>`;
  }

  // ---- SELL (2026-09-29): a confirm popup (Saves.openModal - the same one CHANGE NAME's price warning uses)
  // instead of collection.js's own bespoke inline state. Styled `danger` (red, the same colour .pick-sell
  // itself uses in the list - the owner's ask) since it's the one confirm in the game that's genuinely
  // destructive. NOT wired to pay out yet on purpose (see economy.json _boxOddsSecurityNote and
  // _sellPriceNote) - selling has to become a server-authoritative Cloud Function alongside box-opening before
  // it can safely hand out real coins (and, once it is, before it can safely re-equip the default on your
  // behalf if you sold what you were wearing - see skinActionHtml above), so SELL in the popup is still a
  // no-op for now; only the price data and the UI are meant to be reviewed at this stage.
  function handleSellClick(btn) {
    const { kind, sell: id } = btn.dataset;
    const item = skinItems(kind).find((x) => x.id === id);
    if (!item || !item.sellPrice) return;
    Saves.openModal("SELL", `<div class="modal-text">Sell ${esc(item.name)} for ${item.sellPrice} coins?</div>`, [
      { label: "SELL", cls: "danger" }, // intentionally does nothing yet - see the note above
      { label: "CANCEL", cls: "ghost" },
    ]);
  }

  // The SKINS list itself: one card per category, and each is the card of the skin that is EQUIPPED in it (name, description, rarity, detail - exactly what
  // its own menu shows) with a CHANGE button in place of EQUIP that opens the category's menu. The three cards share the whole height of the list (see
  // the CSS for #list-scroll[data-kind="skins"]), so it never scrolls.
  function skinsMenuHtml() {
    return SKIN_MENUS.map((kind) => {
      const list = skinItems(kind);
      const it = list.find((x) => x.id === Economy.getEquipped(kind)) || list[0];
      return it ? skinRowHtml(kind, it, `<button class="pick-equip skins-change" type="button" data-skins="${kind}">CHANGE</button>`, " skins-category", Economy.kindHasUndisplayedSkins(kind)) : "";
    }).join("");
  }

  // ---- The SHOP's list row (shop.js): every projectile/buff, whether or not it's currently in the roll (item.category
  // is only ever "projectile" or "consumable" - skins left the shop's pool entirely, 2026-09-27). `action` is the BUY
  // button (always shown, even when not currently in stock - shop.js's own job to grey it out); `amountText`, when
  // given, is a stack's remaining "x14" for the CURRENT offer, shown under the button; `extraClass` marks a row
  // that isn't currently in stock; `dot` is the same "new, not yet scrolled into view" red dot the owned lists use
  // (Economy.isNewProjectile/isNewBuff), just for "newly in stock, haven't looked yet" instead - shop.js's own
  // tracking. A stack shows how many are ON SALE right now where the owned list shows how many the player HAS.
  function shopRowHtml(item, { offer, action, extraClass, amountText, dot } = {}) {
    const amount = amountText ? `<div class="shop-avail-row">${esc(amountText)}</div>` : "";
    if (item.category === "projectile") {
      const cat = CATALOG.projectile.items.find((i) => i.id === item.id) || { id: item.id, name: item.name, description: item.description, image: item.image };
      const stats = statsHtml("projectile", cat);
      const p = eco && eco.projectiles && eco.projectiles[item.id];
      return (
        `<div class="pick-row shop-row${stats ? " has-stats" : ""}${extraClass || ""}${Rarity.cardClass(p && p.rarity)}" data-id="${esc(item.id)}">` +
        (dot ? NEW_DOT : "") +
        `<img class="pick-pic" src="${esc(cat.image || "")}" alt="" draggable="false" />` +
        `<div class="pick-text"><div class="pick-name">${esc(cat.name)}</div><div class="pick-desc">${esc(cat.description || "")}</div></div>` +
        `<div class="pick-action">${action}${amount}</div>` +
        cornerHtml(p && p.rarity, "") + // the amount used to sit here too (redundant with the one under the button now) - just the rarity label
        stats +
        `</div>`
      );
    }
    // "consumable": the shop never lists anything else now (see shop.js's own header comment)
    const len = Buffs.summonMs(item);
    const maxText = len ? clock(len) : Buffs.isCharge(item) ? "+1" : clock(Buffs.durationMs(item)); // (how long it lasts, under the button like in the BUFFS list)
    const detail = item.detail ? `<div class="pick-stats"><span class="pick-stat">${esc(item.detail)}</span></div>` : "";
    return (
      `<div class="pick-row shop-row buff-row${item.detail ? " buff-detail" : ""}${extraClass || ""}${Rarity.cardClass(Rarity.ofItem(item))}" data-id="${esc(item.id)}">` +
      (dot ? NEW_DOT : "") +
      `<img class="pick-pic" src="${esc(item.image || "")}" alt="" draggable="false" />` +
      `<div class="pick-text"><div class="pick-name">${esc(item.name)}</div><div class="pick-desc">${esc(item.description || "")}</div></div>` +
      `<div class="pick-action">${action}${amount}<div class="pick-regen"><span>${maxText}</span></div></div>` +
      detail +
      cornerHtml(Rarity.ofItem(item), "") +
      `</div>`
    );
  }

  // ---- BUFFS list: the buffs the player has (bought, waiting) or is running. Same cards as the projectiles list without
  //      the bottom line: picture, name, description, the amount (x3) in the top-right corner, and where EQUIP would be
  //      a USE button - which turns into the running timer once the buff is used. ----

  function buffRowHtml(b) {
    const control = b.active
      ? `<div class="pick-timer">${Buffs.timeText(b.item, b.msLeft)}</div>`
      : `<button class="pick-equip pick-use${b.blocked ? " off" : ""}" type="button" data-id="${esc(b.id)}">USE</button>`; // (off: an event is running, an event buff cannot be used)
    // The bottom line (the item's `detail`, e.g. "Coin bonus: 1.2x."), drawn over the bottom of the card (it takes no
    // room of its own, so the card's height stays fixed).
    // Under the USE button: how long the buff lasts once used ("03:00") - the same style as "MAX" under a snowball's EQUIP button.
    // (Not the running timer: while the buff is active its own countdown takes the button's place, and this stays under it.)
    // ... followed by how many the player has: "02:00 x3" ("+1 x3" for a charge buff, "02:00 xINF" in god mode).
    // The time is at the button's left edge and the amount at its right edge (see .buff-row .pick-regen).
    const amount = b.count > 0 ? `<span>${countText(b.count)}</span>` : "";
    // (a charge buff shows "+1" - except a summon buff, the Disco Ticket: it shows how long its event lasts, "02:44")
    const len = Buffs.summonMs(b.item);
    const maxText = len ? clock(len) : Buffs.isCharge(b.item) ? "+1" : clock(Buffs.durationMs(b.item));
    const maxTime = `<div class="pick-regen"><span>${maxText}</span>${amount}</div>`;
    const detail = b.item.detail ? `<div class="pick-stats"><span class="pick-stat">${esc(b.item.detail)}</span></div>` : "";
    return (
      `<div class="pick-row buff-row${b.item.detail ? " buff-detail" : ""}${Rarity.cardClass(Rarity.ofItem(b.item))}" data-id="${esc(b.id)}">` +
      (Economy.isNewBuff(b.id) ? NEW_DOT : "") +
      `<img class="pick-pic" src="${esc(b.item.image || "")}" alt="" draggable="false" />` +
      `<div class="pick-text"><div class="pick-name">${esc(b.item.name)}</div>` +
      `<div class="pick-desc">${esc(b.item.description || "")}</div></div>` +
      `<div class="pick-action">${control}${maxTime}</div>` +
      detail +
      cornerHtml(Rarity.ofItem(b.item), "") + // the rarity label alone is in the top-right corner (the amount is under the button, see maxTime)
      `</div>`
    );
  }

  // A long name next to a wide corner ("legendary x99") would run into it: the name gets a max width that stops short of the
  // corner (so it wraps instead). Measured after the list is drawn; redone when the window is resized.
  // (Also: every card of the list is as tall as the TALLEST one - a card whose text needs more room (a long name and a long description)
  // makes all the others grow to match, in the BUFFS and the PROJECTILES list alike. Measured after the names are fitted, redone on a resize.)
  function fitNames() {
    const rows = [...scrollEl.querySelectorAll(".pick-row")];
    rows.forEach((row) => {
      row.style.minHeight = ""; // back to the natural height before measuring
    });
    rows.forEach((row) => {
      const name = row.querySelector(".pick-name");
      const corner = row.querySelector(".pick-corner");
      if (!name || !corner) return;
      name.style.maxWidth = "";
      const n = name.getBoundingClientRect();
      const c = corner.getBoundingClientRect();
      const inner = document.createRange();
      inner.selectNodeContents(name);
      const textRight = inner.getBoundingClientRect().right;
      const gap = 8; // px of air between the name and the label
      if (textRight > c.left - gap) name.style.maxWidth = Math.max(40, c.left - gap - n.left) + "px";
    });
    if (rows.length < 2) return;
    const tallest = Math.max(...rows.map((row) => row.getBoundingClientRect().height));
    rows.forEach((row) => {
      row.style.boxSizing = "border-box";
      row.style.minHeight = tallest + "px";
    });
  }

  // What the list shows, as a string: when it changes (used, expired, bought) the list is redrawn.
  function buffKey(list) {
    return list.map((b) => `${b.id}:${b.active ? 1 : 0}:${b.count}:${b.blocked ? 1 : 0}`).join("|");
  }

  let buffKeyShown = "";

  // Scrolls the list so the card `id` is in the MIDDLE of what is shown - so the one the player probably wants (what they have equipped, or used
  // last) is in sight and its neighbours are a short scroll away in both directions. Where the middle is impossible (the card is near the top or the
  // bottom of a long list) the list simply stops at its top / bottom; no id or no such card: the top. Call after the cards are drawn and fitted.
  function centerOn(id) {
    scrollEl.scrollTop = 0;
    if (!id) return;
    const row = [...scrollEl.querySelectorAll(".pick-row")].find((r) => r.dataset.id === id);
    if (!row) return;
    const r = row.getBoundingClientRect();
    const top = r.top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop; // the card's top inside the scrolled content
    const target = top + r.height / 2 - scrollEl.clientHeight / 2;
    scrollEl.scrollTop = Math.max(0, Math.min(target, scrollEl.scrollHeight - scrollEl.clientHeight));
  }

  // Full redraw (the scroll position is kept: a redraw because a buff was used or ran out must not throw the player back to the top)...
  function renderBuffList() {
    const list = Buffs.owned();
    buffKeyShown = buffKey(list);
    const keep = scrollEl.scrollTop;
    scrollEl.innerHTML = list.length
      ? list.map(buffRowHtml).join("")
      : `<div class="list-empty">NO BUFFS YET<br /><br />BUY ONE IN THE SHOP FIRST</div>`;
    fitNames();
    scrollEl.scrollTop = keep;
  }

  // ...and a cheap timer-only refresh twice a second while it's open.
  function tickBuffList() {
    if (openKind !== "buff") return;
    const list = Buffs.owned();
    if (buffKey(list) !== buffKeyShown) {
      renderBuffList();
      return;
    }
    list.forEach((b) => {
      const t = scrollEl.querySelector(`.pick-row[data-id="${b.id}"] .pick-timer`);
      if (t) t.textContent = Buffs.timeText(b.item, b.msLeft);
    });
  }

  // The player has looked at the list: its cards are no longer new.
  function markSeen() {
    if (openKind === "buff") Economy.clearNewBuffs();
    else if (openKind === "projectile") Economy.clearNewProjectiles();
    else if (SKIN_MENUS.includes(openKind)) Economy.closeSkinKind(openKind); // the dots of the new skins that were on display go when the menu is closed / left
  }

  // In a skin menu: a new skin whose card is on screen (at least half of it inside the visible part of the list) has been DISPLAYED - the player has seen it,
  // so its category's dot (in the SKINS list) goes. Checked when the menu opens and whenever it is scrolled.
  function checkDisplayed() {
    if (!SKIN_MENUS.includes(openKind)) return;
    const view = scrollEl.getBoundingClientRect();
    scrollEl.querySelectorAll(".pick-row").forEach((row) => {
      if (!Economy.isNewSkin(openKind, row.dataset.id)) return;
      const r = row.getBoundingClientRect();
      const visible = Math.min(r.bottom, view.bottom) - Math.max(r.top, view.top);
      if (visible >= r.height / 2) Economy.markSkinDisplayed(openKind, row.dataset.id);
    });
  }

  function open(kind) {
    markSeen(); // switching straight from one list to another
    Saves.closeInspect(); // ... and an inspected leaderboard card must not linger over whatever list comes next either
    // SHOP no longer greys these buttons out (2026-09-27, the owner's ask) - it stays open behind whatever list
    // you tap into unless told to close, so opening one closes SHOP the same way SHOP itself already closes any
    // open list (see the shop-btn handler in index.html). BOXES still has its own separate mutual-exclusion with
    // SHOP, untouched - only SHOP got this treatment.
    if (container.classList.contains("shop-open")) {
      container.classList.remove("shop-open");
      document.getElementById("shop-btn").textContent = "SHOP";
    }
    openKind = kind;
    scrollEl.dataset.kind = kind; // (the OPTIONS list redraws itself after a change, see Saves.refresh)
    panelEl.classList.toggle("options-open", kind === "options"); // (the version tag is shown in the OPTIONS list only)
    document.getElementById("version-tag").textContent = typeof GAME_VERSION_TEXT === "string" ? GAME_VERSION_TEXT : "";
    // Fixed under the whole tab, not scrolled away with the cards (moved out of Saves.renderLeaderboard's own
    // innerHTML, 2026-09-27 - the owner's ask, it used to be the last row of the scrollable list itself).
    document.getElementById("list-hint").textContent = kind === "leaderboard" ? "TAP to INSPECT" : "";
    buttons.buff.classList.toggle("active", kind === "buff");
    buttons.options.classList.toggle("active", kind === "options");
    buttons.leaderboard.classList.toggle("active", kind === "leaderboard");
    buttons.skins.classList.toggle("active", SKIN_KINDS.includes(kind));
    panelEl.classList.toggle("nested", SKIN_MENUS.includes(kind)); // (the BACK button of the skin menus)
    if (kind === "skins") {
      titleEl.textContent = SKIN_TITLES.skins;
      scrollEl.innerHTML = skinsMenuHtml();
      scrollEl.scrollTop = 0;
      container.classList.add("list-open");
      buttons.projectile.classList.remove("active");
      return;
    }
    if (SKIN_MENUS.includes(kind)) {
      titleEl.textContent = SKIN_TITLES[kind];
      scrollEl.innerHTML =
        sortedItems(kind, skinItems(kind).filter((it) => isListed(kind, it)))
          .map((it) => skinRowHtml(kind, it, skinActionHtml(kind, it), "", Economy.isNewSkin(kind, it.id), it.rarity === "default"))
          .join("") + `<div class="list-soon">More coming soon!</div>`; // (under the last card: the default one)
      fitNames();
      centerOn(Economy.getEquipped(kind)); // opens on what is equipped
      refreshButtons();
      container.classList.add("list-open");
      buttons.projectile.classList.remove("active");
      Economy.enterSkinKind(kind); // the SKINS button's dot goes: the category with the new skin was entered
      checkDisplayed(); // ... and if the new skin is already in view, the category's dot goes with it (otherwise: when it is scrolled to)
      return;
    }
    if (kind === "options") {
      titleEl.textContent = "OPTIONS";
      Saves.renderOptions(scrollEl);
      scrollEl.scrollTop = 0;
      container.classList.add("list-open");
      buttons.projectile.classList.remove("active");
      return;
    }
    if (kind === "leaderboard") {
      titleEl.textContent = "LEADERBOARD";
      Saves.renderLeaderboard(scrollEl);
      scrollEl.scrollTop = 0;
      container.classList.add("list-open");
      buttons.projectile.classList.remove("active");
      // A fresh read, only now (opening it) - not every time the list happens to redraw (see cloud.js). Guarded so a
      // fetch that resolves after the player already left this screen doesn't clobber whatever is open by then.
      if (typeof Cloud !== "undefined") Cloud.refreshLeaderboard(() => openKind === "leaderboard" && Saves.refresh());
      return;
    }
    if (kind === "buff") {
      Economy.clearUnseenBuffs(); // the player is looking at the tab now: its red dot goes
      titleEl.textContent = "BUFFS";
      renderBuffList();
      centerOn(Economy.getLastUsedBuff()); // opens on the buff used last (which may be running now)
      container.classList.add("list-open");
      buttons.projectile.classList.remove("active");
      return;
    }
    titleEl.textContent = CATALOG[kind].title;
    if (kind === "projectile") Economy.clearUnseenProjectiles(); // the player is looking at the list now: the dot goes
    scrollEl.innerHTML = sortedItems(kind, CATALOG[kind].items.filter((it) => isListed(kind, it)))
      .map((it) => rowHtml(kind, it))
      .join("");
    fitNames();
    centerOn(Economy.getEquipped("projectile")); // opens on the equipped projectile
    refreshButtons();
    container.classList.add("list-open");
    buttons.projectile.classList.toggle("active", kind === "projectile");
  }

  function close() {
    markSeen();
    openKind = null;
    container.classList.remove("list-open");
    scrollEl.dataset.kind = "";
    buttons.projectile.classList.remove("active");
    buttons.buff.classList.remove("active");
    buttons.options.classList.remove("active");
    buttons.leaderboard.classList.remove("active");
    buttons.skins.classList.remove("active");
    panelEl.classList.remove("nested");
    Saves.closeInspect(); // an inspected leaderboard card, then the whole panel closed: its popup must not linger
  }

  // The sound of drinking / using a buff (instead of the plain click).
  const BUFF_USE_VOLUME = 1;
  function playBuffUse() {
    const game = window.snowyBallsGame;
    if (game) game.sound.play("buff_use", { volume: BUFF_USE_VOLUME });
  }

  function click() {
    playUiClick();
  }

  // Pressing the open list's own button closes it; pressing the other one switches lists.
  function toggle(kind) {
    click();
    if (openKind === kind) close();
    else open(kind);
  }

  function onEquip(e) {
    const sell = e.target.closest(".pick-sell[data-sell]");
    if (sell) {
      if (sell.disabled) return;
      handleSellClick(sell);
      return;
    }
    const choice = e.target.closest(".skins-change");
    if (choice) {
      click();
      open(choice.dataset.skins); // CHARACTERS, SCENERIES or WEATHER
      return;
    }
    const use = e.target.closest(".pick-use");
    if (use) {
      Economy.clearNewBuff(use.dataset.id); // using a new buff takes its red dot away (the list redraws without it)
      if (use.classList.contains("off")) return; // dimmed: an event is running
      const summons = Buffs.isEventBuff(use.dataset.id); // Tomato Juice, the Disco Ticket: using it IS the event about to start
      if (Buffs.use(use.dataset.id)) {
        playBuffUse(); // takes one from the inventory and starts it; the list redraws itself (Buffs.onChange)
        if (summons) close(); // the owner's call, 2026-09-23: get the menu out of the way of the event it just summoned
      }
      return;
    }
    const btn = e.target.closest(".pick-equip");
    if (!btn) return;
    if (btn.classList.contains("on")) return;
    Economy.setEquipped(openKind, btn.dataset.id);
    if (SKIN_MENUS.includes(openKind)) {
      Economy.clearNewSkin(openKind, btn.dataset.id); // equipping a new skin takes its dot away
      const dot = btn.closest(".pick-row").querySelector(".pick-new");
      if (dot) dot.remove();
    }
    if (SKIN_MENUS.includes(openKind)) {
      // A character / scenery / weather is equipped in place: the list stays open (its buttons show the change), the game switches at once.
      click();
      refreshButtons();
      const game = window.snowyBallsGame;
      const scene = game && game.scene.getScene("main");
      if (scene) scene[{ character: "onCharacterEquipped", scenery: "onSceneryEquipped", weather: "onWeatherEquipped" }[openKind]](btn.dataset.id);
      return;
    }
    if (openKind === "projectile") {
      Economy.clearNewProjectile(btn.dataset.id); // equipping a new projectile takes its red dot away
      const dot = btn.closest(".pick-row").querySelector(".pick-new");
      if (dot) dot.remove();
    }
    click();
    refreshButtons();
    if (openKind === "projectile") {
      const game = window.snowyBallsGame;
      const scene = game && game.scene.getScene("main");
      if (scene && scene.onProjectileEquipped) scene.onProjectileEquipped(btn.dataset.id);
      close(); // equipping is the end of the errand: back to the game
    }
  }

  return {
    isOpen: () => openKind !== null,
    shopRowHtml,
    skinRowHtml, // the BOXES inspect popup's item detail card (boxes.js) reuses the same card the SKINS menu itself uses
    projectileImage: (id) => ((CATALOG.projectile.items.find((i) => i.id === id) || {}).image) || "", // (the counter under the top-right buttons)
    characterInfo: (id) => skinItems("character").find((c) => c.id === id) || null, // { id, name, description, image, ... } - the ACCOUNT card and the leaderboard's inspect popup (saves.js) use this for the picture + description
    close,
    setEconomy(economyJson) {
      eco = economyJson;
      const items = (eco.shop && eco.shop.items) || [];
      Economy.fillGod(
        Object.entries(eco.projectiles || {}).filter(([id, p]) => id !== "snowball" && !p.infinite && !p.regen).map(([id]) => id),
        items.filter((it) => it.category === "consumable").map((it) => it.id),
        { character: skinItems("character").map((s) => s.id), scenery: skinItems("scenery").map((s) => s.id), weather: skinItems("weather").map((s) => s.id) } // every skin
      );
    },
    init() {
      container = document.getElementById("game-container");
      panelEl = document.getElementById("list-panel");
      titleEl = document.getElementById("list-title");
      scrollEl = document.getElementById("list-scroll");
      buttons = {
        projectile: document.getElementById("projectiles-btn"),
        skins: document.getElementById("skins-btn"),
        buff: document.getElementById("buffs-btn"),
        options: document.getElementById("options-btn"),
        leaderboard: document.getElementById("leaderboard-btn"),
      };
      buttons.options.addEventListener("click", () => toggle("options"));
      buttons.leaderboard.addEventListener("click", () => toggle("leaderboard"));
      scrollEl.addEventListener("click", (e) => Saves.onClick(e)); // the ACCOUNT section's SIGN IN / SIGN OUT (the OPTIONS list's own onEquip handles the rest)
      Saves.wireLeaderboardClick(scrollEl); // click a leaderboard card to inspect it (only ever matches while LEADERBOARD is the open list)
      buttons.buff.addEventListener("click", () => toggle("buff"));
      // Red dot on the PROJECTILES button (same dot as the shop's, but silent).
      dotEl = document.getElementById("projectiles-dot");
      const updateDot = () => dotEl && dotEl.classList.toggle("show", Economy.hasUnseenProjectiles());
      Economy.onProjectilesChange(updateDot);
      updateDot();
      // While the PROJECTILES tab is open, keep the amounts and the "+1 in" timer live.
      setInterval(() => {
        if (openKind !== "projectile") return;
        scrollEl.querySelectorAll(".pick-row").forEach((row) => {
          const id = row.dataset.id;
          const p = eco && eco.projectiles && eco.projectiles[id];
          const count = row.querySelector(".pick-count");
          if (count && p && !p.infinite) count.textContent = countText(Economy.getProjectileCount(id));
          const regen = row.querySelector(".pick-regen");
          if (regen) regen.textContent = regenText(id);
        });
      }, 500);
      // Red dot on the top-right corner of the SKINS button: a skin was unlocked and its category has not been entered yet.
      const skinsDot = document.getElementById("skins-dot");
      const updateSkinsDot = () => skinsDot && skinsDot.classList.toggle("show", Economy.hasNewSkinsToEnter());
      Economy.onSkinsChange(updateSkinsDot);
      updateSkinsDot();
      // Red dot on the top-right corner of the OPTIONS button: a reminder to sign in, not a "something new" notice -
      // it stays on for as long as the player is signed out (2026-09-23), unlike every other dot here which clears
      // once looked at. Only shown once Cloud actually has a project configured - nothing to sign into otherwise.
      const optionsDot = document.getElementById("options-dot");
      const updateOptionsDot = () => optionsDot && optionsDot.classList.toggle("show", typeof Cloud !== "undefined" && Cloud.isConfigured() && !Cloud.getUser());
      if (typeof Cloud !== "undefined") Cloud.onAuthChange(updateOptionsDot);
      updateOptionsDot();
      scrollEl.addEventListener("scroll", checkDisplayed);
      // Red dot on the top-left corner of the BUFFS button: a new kind of buff arrived (not more of one already there).
      const buffDot = document.getElementById("buffs-dot");
      const updateBuffDot = () => buffDot && buffDot.classList.toggle("show", Economy.hasUnseenBuffs());
      Economy.onBuffsChange(updateBuffDot);
      updateBuffDot();
      Buffs.onChange(tickBuffList);
      Buffs.onTick(tickBuffList); // the list's timers ride on the buffs' own clock, so they change at the same moment as the cards on screen
      buttons.projectile.addEventListener("click", () => toggle("projectile"));
      // SKINS: opens its list (three buttons); pressing it while any skin list is open closes it. BACK (in the CHARACTERS / SCENERIES / WEATHER menus) returns to it.
      buttons.skins.addEventListener("click", () => {
        click();
        if (SKIN_KINDS.includes(openKind)) close();
        else open("skins");
      });
      document.getElementById("list-back").addEventListener("click", () => {
        click();
        open("skins");
      });
      scrollEl.addEventListener("click", onEquip);
      window.addEventListener("resize", () => openKind && fitNames());
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => openKind && fitNames()); // (the pixel font arriving changes every height)
      // Tapping the dimmed game area outside the list closes it.
      document.getElementById("list-backdrop").addEventListener("click", close);
    },
  };
})();
