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
          id: "grenade", // same id as its shop item and its economy.json "projectiles" entry
          name: "Grenade",
          description: "What a great day to have one!",
          image: "assets/snowball/grenade.png",
        },
        {
          id: "chestnut", // same id as its shop item and its economy.json "projectiles" entry
          name: "Chestnut",
          description: "Found it in someone's backpack. How convenient!",
          image: "assets/snowball/chestnut.png",
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

  // SKINS (the SKINS button): a list with two buttons, CHARACTERS and SCENERIES, each opening a menu of cards (economy.json characters / sceneries).
  // Their cards are like the buff cards (name, description, rarity in the corner, the EQUIP button, the detail line at the bottom) without an amount:
  // they are never consumed and never unequipped - only by equipping another one (the equipped one's button just says EQUIPPED). Listed by
  // rarity, the rarest on top, the default one at the bottom.
  const SKIN_KINDS = ["skins", "character", "scenery"];
  const SKIN_TITLES = { skins: "SKINS", character: "CHARACTERS", scenery: "SCENERIES" };

  function skinItems(kind) {
    return (eco && eco[kind === "character" ? "characters" : "sceneries"]) || [];
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
    if (kind === "character" || kind === "scenery") return it.rarity === "default" || Economy.isUnlocked(kind, it.id); // the default ones are always there
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
    if ((kind === "character" || kind === "scenery") && eco) {
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
    return (
      `<div class="pick-row${stats ? " has-stats" : ""}" data-id="${esc(item.id)}">` +
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

  // Sets each EQUIP button's label/state without rebuilding the list (that would jump the scroll).
  function refreshButtons() {
    if (!openKind) return;
    const equipped = Economy.getEquipped(openKind);
    scrollEl.querySelectorAll(".pick-equip").forEach((b) => {
      const isOn = b.dataset.id === equipped;
      b.textContent = isOn ? "EQUIPPED" : "EQUIP";
      b.classList.toggle("on", isOn);
    });
  }

  // A character / scenery card: picture, name, description, the rarity in the top-right corner (no amount), the EQUIP button, the detail at the bottom.
  function skinRowHtml(item) {
    const detail = item.detail ? `<div class="pick-stats"><span class="pick-stat">${esc(item.detail)}</span></div>` : "";
    return (
      `<div class="pick-row buff-row${item.detail ? " buff-detail" : ""}" data-id="${esc(item.id)}">` +
      `<img class="pick-pic" src="${esc(item.image || "")}" alt="" draggable="false" />` +
      `<div class="pick-text"><div class="pick-name">${esc(item.name)}</div>` +
      `<div class="pick-desc">${esc(item.description || "")}</div></div>` +
      `<div class="pick-action"><button class="pick-equip" type="button" data-id="${esc(item.id)}"></button></div>` +
      detail +
      cornerHtml(item.rarity, "") +
      `</div>`
    );
  }

  // The SKINS list itself: the two buttons, each with the name of what is equipped now.
  function skinsMenuHtml() {
    const now = (kind) => {
      const it = skinItems(kind).find((x) => x.id === Economy.getEquipped(kind));
      return it ? esc(it.name) : "";
    };
    return (
      `<button class="skins-choice" type="button" data-skins="character"><span class="skins-choice-name">CHARACTERS</span><span class="skins-choice-now">${now("character")}</span></button>` +
      `<button class="skins-choice" type="button" data-skins="scenery"><span class="skins-choice-name">SCENERIES</span><span class="skins-choice-now">${now("scenery")}</span></button>`
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
      `<div class="pick-row buff-row${b.item.detail ? " buff-detail" : ""}" data-id="${esc(b.id)}">` +
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

  // Full redraw...
  function renderBuffList() {
    const list = Buffs.owned();
    buffKeyShown = buffKey(list);
    scrollEl.innerHTML = list.length
      ? list.map(buffRowHtml).join("")
      : `<div class="list-empty">NO BUFFS YET<br /><br />BUY ONE IN THE SHOP FIRST</div>`;
    fitNames();
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
  }

  function open(kind) {
    markSeen(); // switching straight from one list to another
    openKind = kind;
    scrollEl.dataset.kind = kind; // (the OPTIONS list redraws itself after a change, see Saves.refresh)
    panelEl.classList.toggle("options-open", kind === "options"); // (the version tag is shown in the OPTIONS list only)
    document.getElementById("version-tag").textContent = typeof GAME_VERSION_TEXT === "string" ? GAME_VERSION_TEXT : "";
    buttons.buff.classList.toggle("active", kind === "buff");
    buttons.options.classList.toggle("active", kind === "options");
    buttons.skins.classList.toggle("active", SKIN_KINDS.includes(kind));
    panelEl.classList.toggle("nested", kind === "character" || kind === "scenery"); // (the BACK button of the two skin menus)
    if (kind === "skins") {
      titleEl.textContent = SKIN_TITLES.skins;
      scrollEl.innerHTML = skinsMenuHtml();
      scrollEl.scrollTop = 0;
      container.classList.add("list-open");
      buttons.projectile.classList.remove("active");
      return;
    }
    if (kind === "character" || kind === "scenery") {
      titleEl.textContent = SKIN_TITLES[kind];
      scrollEl.innerHTML =
        sortedItems(kind, skinItems(kind).filter((it) => isListed(kind, it)))
          .map(skinRowHtml)
          .join("") + `<div class="list-soon">More coming soon!</div>`; // (under the last card: the default one)
      fitNames();
      scrollEl.scrollTop = 0;
      refreshButtons();
      container.classList.add("list-open");
      buttons.projectile.classList.remove("active");
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
    if (kind === "buff") {
      Economy.clearUnseenBuffs(); // the player is looking at the tab now: its red dot goes
      titleEl.textContent = "BUFFS";
      renderBuffList();
      scrollEl.scrollTop = 0;
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
    scrollEl.scrollTop = 0;
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
    buttons.skins.classList.remove("active");
    panelEl.classList.remove("nested");
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
    const choice = e.target.closest(".skins-choice");
    if (choice) {
      click();
      open(choice.dataset.skins); // CHARACTERS or SCENERIES
      return;
    }
    const use = e.target.closest(".pick-use");
    if (use) {
      Economy.clearNewBuff(use.dataset.id); // using a new buff takes its red dot away (the list redraws without it)
      if (use.classList.contains("off")) return; // dimmed: an event is running
      if (Buffs.use(use.dataset.id)) playBuffUse(); // takes one from the inventory and starts it; the list redraws itself (Buffs.onChange)
      return;
    }
    const btn = e.target.closest(".pick-equip");
    if (!btn || btn.classList.contains("on")) return;
    Economy.setEquipped(openKind, btn.dataset.id);
    if (openKind === "character" || openKind === "scenery") {
      // A character / scenery is equipped in place: the list stays open (its buttons show the change), the game switches at once.
      click();
      refreshButtons();
      const game = window.snowyBallsGame;
      const scene = game && game.scene.getScene("main");
      if (scene) (openKind === "character" ? scene.onCharacterEquipped : scene.onSceneryEquipped).call(scene, btn.dataset.id);
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
    projectileImage: (id) => ((CATALOG.projectile.items.find((i) => i.id === id) || {}).image) || "", // (the counter under the top-right buttons)
    close,
    setEconomy(economyJson) {
      eco = economyJson;
      const items = (eco.shop && eco.shop.items) || [];
      Economy.fillGod(
        Object.entries(eco.projectiles || {}).filter(([id, p]) => id !== "snowball" && !p.infinite && !p.regen).map(([id]) => id),
        items.filter((it) => it.category === "consumable").map((it) => it.id)
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
      };
      buttons.options.addEventListener("click", () => toggle("options"));
      scrollEl.addEventListener("click", (e) => Saves.onClick(e)); // the SAVES section of the OPTIONS list
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
      // Red dot on the top-left corner of the BUFFS button: a new kind of buff arrived (not more of one already there).
      const buffDot = document.getElementById("buffs-dot");
      const updateBuffDot = () => buffDot && buffDot.classList.toggle("show", Economy.hasUnseenBuffs());
      Economy.onBuffsChange(updateBuffDot);
      updateBuffDot();
      Buffs.onChange(tickBuffList);
      Buffs.onTick(tickBuffList); // the list's timers ride on the buffs' own clock, so they change at the same moment as the cards on screen
      buttons.projectile.addEventListener("click", () => toggle("projectile"));
      // SKINS: opens its list (two buttons); pressing it while any skin list is open closes it. BACK (in the CHARACTERS / SCENERIES menus) returns to it.
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
