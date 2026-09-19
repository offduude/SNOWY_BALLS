// The PROJECTILES / CHARACTERS lists: a finger-scrollable list in the middle of the screen with
// name, picture, description and an EQUIP button per entry. Only one list is open at a time.
// What's equipped is saved (Economy.getEquipped). Equipping a projectile tells the game
// (MainScene.onProjectileEquipped); characters are not selectable yet (no CHARACTERS button).
// Only what the player has is listed: `free`/`infinite` entries (the snowball never runs out) and projectiles
// they still have some of (consumable: one is used per throw, and a kind that runs out leaves the list).
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
          infinite: true,
        },
        {
          id: "grenade", // same id as its shop item and its economy.json "projectiles" entry
          name: "Grenade",
          description: "no description",
          image: "assets/snowball/grenade.png",
        },
        {
          id: "chestnut", // same id as its shop item and its economy.json "projectiles" entry
          name: "Chestnut",
          description: "Found it in someone's backpack. How convenient!",
          image: "assets/snowball/chestnut.png",
        },
      ],
    },
    character: {
      title: "CHARACTERS",
      items: [
        {
          id: "default",
          name: "Character 1",
          description: "Your starting thrower. Bundled up and ready.",
          image: "assets/character/character1_idle.png",
          free: true,
        },
      ],
    },
  };

  let container, panelEl, titleEl, scrollEl, buttons, dotEl;
  let eco = null; // economy.json - set by the game scene (setEconomy); projectile numbers come from it
  let openKind = null;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // "x12" next to the name of a consumable projectile (the snowball is infinite: nothing).
  function countHtml(kind, item) {
    if (kind !== "projectile" || item.infinite) return "";
    return `<span class="pick-count">x${Economy.getProjectileCount(item.id)}</span>`;
  }

  function isListed(kind, it) {
    if (it.free || it.infinite) return true;
    return kind === "projectile" && Economy.getProjectileCount(it.id) > 0;
  }

  // The word for a projectile's weight (never the number): the LAST weightLabels entry whose `from` is <= the weight.
  function weightWord(weight) {
    const labels = (eco && eco.weightLabels) || [];
    let hit = null;
    for (const l of labels) if (weight >= l.from) hit = l;
    return hit ? hit.label : "?";
  }

  // The two stats in ONE row along the bottom of the card, starting right after the picture (under the text and the
  // EQUIP button). Two fixed columns - the left is as wide as the longest weight word - so each stat is in the same
  // place on every card whatever the words' lengths.
  function statsHtml(kind, item) {
    const p = kind === "projectile" && eco && eco.projectiles && eco.projectiles[item.id];
    if (!p) return "";
    return (
      `<div class="pick-stats">` +
      `<span class="pick-stat">weight: ${esc(weightWord(p.weight))}</span>` +
      `<span class="pick-stat">hit value: <i class="coin"></i>${p.rewards.W20}</span>` +
      `</div>`
    );
  }

  // Projectiles are listed by RARITY, the rarest first (economy.json projectiles.<id>.rarity - a number, bigger = rarer;
  // placeholders for now). Ties keep the older order: highest W20 base value first, then the catalog order.
  function sortedItems(kind, items) {
    if (kind !== "projectile" || !eco) return items;
    const p = (it) => eco.projectiles[it.id] || { rarity: 0, rewards: { W20: 0 } };
    return items
      .map((it, i) => ({ it, i }))
      .sort((a, b) => (p(b.it).rarity || 0) - (p(a.it).rarity || 0) || p(b.it).rewards.W20 - p(a.it).rewards.W20 || a.i - b.i)
      .map((x) => x.it);
  }

  function rowHtml(kind, item) {
    const stats = statsHtml(kind, item);
    return (
      `<div class="pick-row${stats ? " has-stats" : ""}" data-id="${esc(item.id)}">` +
      `<img class="pick-pic" src="${esc(item.image)}" alt="" draggable="false" />` +
      `<div class="pick-text"><div class="pick-name">${esc(item.name)}</div>` +
      `<div class="pick-desc">${esc(item.description)}</div></div>` +
      `<button class="pick-equip" type="button" data-id="${esc(item.id)}"></button>` +
      countHtml(kind, item) + // the amount sits in the card's top-right corner
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

  // ---- BUFFS list: the buffs the player has (bought, waiting) or is running. Same cards as the projectiles list without
  //      the bottom line: picture, name, description, the amount (x3) in the top-right corner, and where EQUIP would be
  //      a USE button - which turns into the running timer once the buff is used. ----

  function buffRowHtml(b) {
    const control = b.active
      ? `<div class="pick-timer">${Buffs.formatTime(b.msLeft)}</div>`
      : `<button class="pick-equip pick-use" type="button" data-id="${esc(b.id)}">USE</button>`;
    return (
      `<div class="pick-row" data-id="${esc(b.id)}">` +
      `<img class="pick-pic" src="${esc(b.item.image || "")}" alt="" draggable="false" />` +
      `<div class="pick-text"><div class="pick-name">${esc(b.item.name)}</div>` +
      `<div class="pick-desc">${esc(b.item.description || "")}</div></div>` +
      control +
      (b.count > 0 ? `<span class="pick-count">x${b.count}</span>` : "") +
      `</div>`
    );
  }

  // What the list shows, as a string: when it changes (used, expired, bought) the list is redrawn.
  function buffKey(list) {
    return list.map((b) => `${b.id}:${b.active ? 1 : 0}:${b.count}`).join("|");
  }

  let buffKeyShown = "";

  // Full redraw...
  function renderBuffList() {
    const list = Buffs.owned();
    buffKeyShown = buffKey(list);
    scrollEl.innerHTML = list.length
      ? list.map(buffRowHtml).join("")
      : `<div class="list-empty">NO BUFFS YET<br /><br />BUY ONE IN THE SHOP FIRST</div>`;
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
      if (t) t.textContent = Buffs.formatTime(b.msLeft);
    });
  }

  function open(kind) {
    openKind = kind;
    buttons.buff.classList.toggle("active", kind === "buff");
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
    scrollEl.scrollTop = 0;
    refreshButtons();
    container.classList.add("list-open");
    buttons.projectile.classList.toggle("active", kind === "projectile");
    buttons.character?.classList.toggle("active", kind === "character");
  }

  function close() {
    openKind = null;
    container.classList.remove("list-open");
    buttons.projectile.classList.remove("active");
    buttons.buff.classList.remove("active");
    buttons.character?.classList.remove("active");
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
    const use = e.target.closest(".pick-use");
    if (use) {
      click();
      Buffs.use(use.dataset.id); // takes one from the inventory and starts it; the list redraws itself (Buffs.onChange)
      return;
    }
    const btn = e.target.closest(".pick-equip");
    if (!btn || btn.classList.contains("on")) return;
    Economy.setEquipped(openKind, btn.dataset.id);
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
    close,
    setEconomy(economyJson) {
      eco = economyJson;
    },
    init() {
      container = document.getElementById("game-container");
      panelEl = document.getElementById("list-panel");
      titleEl = document.getElementById("list-title");
      scrollEl = document.getElementById("list-scroll");
      buttons = {
        projectile: document.getElementById("projectiles-btn"),
        character: document.getElementById("characters-btn"),
        buff: document.getElementById("buffs-btn"),
      };
      buttons.buff.addEventListener("click", () => toggle("buff"));
      // Red dot on the PROJECTILES button (same dot as the shop's, but silent).
      dotEl = document.getElementById("projectiles-dot");
      const updateDot = () => dotEl && dotEl.classList.toggle("show", Economy.hasUnseenProjectiles());
      Economy.onProjectilesChange(updateDot);
      updateDot();
      // Red dot on the top-left corner of the BUFFS button: a new kind of buff arrived (not more of one already there).
      const buffDot = document.getElementById("buffs-dot");
      const updateBuffDot = () => buffDot && buffDot.classList.toggle("show", Economy.hasUnseenBuffs());
      Economy.onBuffsChange(updateBuffDot);
      updateBuffDot();
      Buffs.onChange(tickBuffList);
      setInterval(tickBuffList, 500);
      buttons.projectile.addEventListener("click", () => toggle("projectile"));
      buttons.character?.addEventListener("click", () => toggle("character")); // no CHARACTERS button for now
      scrollEl.addEventListener("click", onEquip);
      // Tapping the dimmed game area outside the list closes it.
      document.getElementById("list-backdrop").addEventListener("click", close);
    },
  };
})();
