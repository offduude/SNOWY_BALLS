// The PROJECTILES / CHARACTERS lists: a finger-scrollable list in the middle of the screen with
// name, picture, description and an EQUIP button per entry. Only one list is open at a time.
// What's equipped is saved (Economy.getEquipped) but not applied to gameplay yet - there is only
// one character and one projectile so far.
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
          image: "assets/snowball/snowball.png",
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
        },
      ],
    },
  };

  let container, titleEl, scrollEl, buttons;
  let openKind = null;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function rowHtml(kind, item) {
    return (
      `<div class="pick-row" data-id="${esc(item.id)}">` +
      `<img class="pick-pic" src="${esc(item.image)}" alt="" draggable="false" />` +
      `<div class="pick-text"><div class="pick-name">${esc(item.name)}</div>` +
      `<div class="pick-desc">${esc(item.description)}</div></div>` +
      `<button class="pick-equip" type="button" data-id="${esc(item.id)}"></button>` +
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

  function open(kind) {
    openKind = kind;
    titleEl.textContent = CATALOG[kind].title;
    scrollEl.innerHTML = CATALOG[kind].items.map((it) => rowHtml(kind, it)).join("");
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
    buttons.character?.classList.remove("active");
  }

  function click() {
    const game = window.snowyBallsGame;
    if (game) game.sound.play("click", { volume: 0.8 });
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
  }

  return {
    isOpen: () => openKind !== null,
    close,
    init() {
      container = document.getElementById("game-container");
      titleEl = document.getElementById("list-title");
      scrollEl = document.getElementById("list-scroll");
      buttons = {
        projectile: document.getElementById("projectiles-btn"),
        character: document.getElementById("characters-btn"),
      };
      buttons.projectile.addEventListener("click", () => toggle("projectile"));
      buttons.character?.addEventListener("click", () => toggle("character")); // no CHARACTERS button for now
      scrollEl.addEventListener("click", onEquip);
      // Tapping the dimmed game area outside the list closes it.
      document.getElementById("list-backdrop").addEventListener("click", close);
    },
  };
})();
