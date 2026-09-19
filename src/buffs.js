// Timed buffs: bought in the shop (a consumable item with `effects` and a `duration.seconds` in
// economy.json), active for that long, and saved as device-clock timestamps (Economy.getBuffList()) so
// they keep counting down while the app is closed.
//
// The game only reads the buffs at ONE moment - when the player taps "TAP to aim" - via
// Buffs.modifiers(); that snapshot is used for the whole throw, so a buff running out (or being bought)
// mid-aim never changes the sliders under the player's finger.
//
// Effect types (economy.json item `effects`: [{ "type", "value" }], values multiply if several buffs share a type):
//   precision        x     offset (angle) slider: its range shrinks to 1/x, so the same marker movement is finer
//   strengthControl  x     strength (power) slider: same, its range shrinks to 1/x (around the middle)
//   coinMultiplier   x     multiplies the coins of a hit
// This file also draws the buff cards at the top of the screen (next to the live display); tapping a card cancels its buff.
const Buffs = (() => {
  let eco = null;
  let hudEl = null;
  let renderedKey = "";
  const listeners = [];

  function itemById(id) {
    return eco.shop.items.find((it) => it.id === id) || null;
  }

  function durationMs(item) {
    const s = item.duration && item.duration.seconds;
    return (s > 0 ? s : 60) * 1000;
  }

  // Drops expired buffs (and ones whose item no longer exists in economy.json); returns what's left.
  function prune() {
    const list = Economy.getBuffList();
    const now = Date.now();
    const keep = list.filter((b) => b.endsAt > now && itemById(b.id));
    if (keep.length !== list.length) {
      list.length = 0;
      list.push(...keep);
      Economy.saveBuffs();
    }
    return list;
  }

  // Active buffs, oldest first: [{ item, id, endsAt, msLeft }]
  function active() {
    const now = Date.now();
    return prune().map((b) => ({ id: b.id, item: itemById(b.id), endsAt: b.endsAt, msLeft: b.endsAt - now }));
  }

  // The combined effect of everything active right now. Read this once per throw (see the top comment).
  function modifiers() {
    const m = { precision: 1, strengthControl: 1, coinMultiplier: 1 };
    for (const b of active()) {
      for (const e of b.item.effects || []) {
        if (e.type in m) m[e.type] *= e.value;
      }
    }
    return m;
  }

  // Buying an active buff again restarts its timer (it does not stack the effect).
  function activate(item) {
    const list = Economy.getBuffList();
    const at = Date.now() + durationMs(item);
    const existing = list.find((b) => b.id === item.id);
    if (existing) existing.endsAt = at;
    else list.push({ id: item.id, endsAt: at });
    Economy.saveBuffs();
    changed();
  }

  // Tapping a buff card in the game cancels that buff for good.
  function cancel(id) {
    const list = Economy.getBuffList();
    const i = list.findIndex((b) => b.id === id);
    if (i === -1) return;
    list.splice(i, 1);
    Economy.saveBuffs();
    changed();
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const ss = String(s).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  }

  function changed() {
    render();
    listeners.forEach((fn) => fn());
  }

  // The cards: icon + timer. Rebuilt only when the set of buffs changes; every tick just rewrites the timer text.
  function render() {
    if (!hudEl) return;
    const list = active();
    const key = list.map((b) => b.id).join(",");
    if (key !== renderedKey) {
      renderedKey = key;
      hudEl.innerHTML = list
        .map(
          (b) =>
            `<div class="buff-card" data-id="${b.id}">` +
            (b.item.image ? `<img src="${b.item.image}" alt="" draggable="false" />` : `<span class="buff-noimg"></span>`) +
            `<span class="buff-timer">${formatTime(b.msLeft)}</span></div>`
        )
        .join("");
    } else {
      list.forEach((b) => {
        const t = hudEl.querySelector(`.buff-card[data-id="${b.id}"] .buff-timer`);
        if (t) t.textContent = formatTime(b.msLeft);
      });
    }
  }

  return {
    init(economyJson) {
      eco = economyJson;
      hudEl = document.getElementById("buff-hud");
      hudEl.addEventListener("click", (e) => {
        const card = e.target.closest(".buff-card");
        if (!card) return;
        if (typeof playUiClick === "function") playUiClick();
        cancel(card.dataset.id);
      });
      render();
      // Twice a second: refresh timers, drop expired buffs (and tell the BUFFS list to redraw).
      setInterval(() => {
        const before = Economy.getBuffList().length;
        render();
        if (Economy.getBuffList().length !== before) listeners.forEach((fn) => fn());
      }, 500);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) changed();
      });
    },
    active,
    modifiers,
    activate,
    cancel,
    formatTime,
    onChange: (fn) => listeners.push(fn),
  };
})();
