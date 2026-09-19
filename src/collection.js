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
          id: "chestnut", // same id as its shop item and its economy.json "projectiles" entry
          name: "Chestnut",
          description: "Easier to aim and pays more, but it bounces off the wall, leaves no mark and is used up.",
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

  function rowHtml(kind, item) {
    return (
      `<div class="pick-row" data-id="${esc(item.id)}">` +
      `<img class="pick-pic" src="${esc(item.image)}" alt="" draggable="false" />` +
      `<div class="pick-text"><div class="pick-name">${esc(item.name)}</div>` +
      `<div class="pick-desc">${esc(item.description)}</div></div>` +
      `<button class="pick-equip" type="button" data-id="${esc(item.id)}"></button>` +
      countHtml(kind, item) + // the amount sits in the card's top-right corner
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

  // ---- BUFFS list: same panel, smaller, live timers instead of an EQUIP button ----

  function buffRowHtml(b) {
    return (
      `<div class="pick-row" data-id="${esc(b.id)}">` +
      `<img class="pick-pic" src="${esc(b.item.image || "")}" alt="" draggable="false" />` +
      `<div class="pick-text"><div class="pick-name">${esc(b.item.name)}</div>` +
      `<div class="pick-desc">${esc(b.item.description || "")}</div></div>` +
      `<div class="pick-timer">${Buffs.formatTime(b.msLeft)}</div>` +
      `</div>`
    );
  }

  // Full redraw (when the set of buffs changes or the list opens)...
  function renderBuffList() {
    const list = Buffs.active();
    scrollEl.innerHTML = list.length
      ? list.map(buffRowHtml).join("")
      : `<div class="list-empty">NO BUFFS YET<br /><br />BUY ONE IN THE SHOP FIRST</div>`;
  }

  // ...and a cheap timer-only refresh twice a second while it's open.
  function tickBuffList() {
    if (openKind !== "buff") return;
    const list = Buffs.active();
    const shown = [...scrollEl.querySelectorAll(".pick-row")].map((r) => r.dataset.id).join(",");
    if (shown !== list.map((b) => b.id).join(",")) {
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
    panelEl.classList.toggle("small", kind === "buff");
    buttons.buff.classList.toggle("active", kind === "buff");
    if (kind === "buff") {
      titleEl.textContent = "BUFFS";
      renderBuffList();
      scrollEl.scrollTop = 0;
      container.classList.add("list-open");
      buttons.projectile.classList.remove("active");
      return;
    }
    titleEl.textContent = CATALOG[kind].title;
    if (kind === "projectile") Economy.clearUnseenProjectiles(); // the player is looking at the list now: the dot goes
    scrollEl.innerHTML = CATALOG[kind].items
      .filter((it) => isListed(kind, it))
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
