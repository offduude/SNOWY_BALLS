// Timed buffs: a consumable item with `effects` and a `duration.seconds` in economy.json. Buying one only puts
// it in the inventory (Economy.getBuffCount); it is USED from the BUFFS tab (Buffs.use), which takes one out of the
// inventory and starts it for that long. Running buffs are saved as device-clock timestamps (Economy.getBuffList())
// so they keep counting down while the app is closed.
//
// The game only reads the buffs at ONE moment - when the player taps "TAP to aim" - via
// Buffs.modifiers(); that snapshot is used for the whole throw, so a buff running out (or being bought)
// mid-aim never changes the sliders under the player's finger.
//
// Effect types (economy.json item `effects`: [{ "type", "value" }], values multiply if several buffs share a type):
//   guideLines       1     shows the green guarantee lines on both sliders (hidden without this buff)
//   precision        x     offset (angle) slider: its range shrinks to 1/x, so the same marker movement is finer
//   strengthControl  x     strength (power) slider: same, its range shrinks to 1/x (around the middle)
//   coinMultiplier   x     multiplies the coins of a hit
//   saveProjectile   p     chance (0-1) that a throw does NOT use up its projectile. Several such buffs can run at once (all keep
//                          their timers) but only the HIGHEST chance counts - they do not add up or combine; modifiers() also says
//                          which buff that is (saveProjectileBy), it is shown on the result message when it saves a projectile
//   triggerEvent     name  while it runs, that event ("face" = the banana face) is on, for as long as the buff lasts; when the event ends
//                          (the player hits the face) the buff ends with it, and when the buff ends (timer / cancelled) so does the
//                          event. The game (main.js syncBuffEvent) starts and stops the event; this file only reports the buff.
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
    const m = { guideLines: 0, precision: 1, strengthControl: 1, coinMultiplier: 1, saveProjectile: 0, saveProjectileBy: null };
    for (const b of active()) {
      for (const e of b.item.effects || []) {
        if (!(e.type in m)) continue;
        if (e.type === "guideLines") m.guideLines += e.value; // a switch: any active source turns it on
        else if (e.type === "saveProjectile") {
          if (e.value > m.saveProjectile) {
            m.saveProjectile = e.value; // only the best one counts
            m.saveProjectileBy = b.id;
          }
        }
        else m[e.type] *= e.value;
      }
    }
    return m;
  }

  // The running buff that switches the event `name` on, or null: { id, msLeft }.
  function eventBuff(name) {
    const b = active().find((x) => (x.item.effects || []).some((e) => e.type === "triggerEvent" && e.value === name));
    return b ? { id: b.id, msLeft: b.msLeft } : null;
  }

  // Every buff the BUFFS tab shows: the ones in the inventory (count > 0) and the ones running right now, the RAREST
  // first (the item's `rarity` in economy.json, see rarity.js; equal rarities keep the order of the file):
  // [{ id, item, count, active, msLeft }]
  function owned() {
    const running = new Map(active().map((b) => [b.id, b]));
    return eco.shop.items
      .filter((it) => it.category === "consumable")
      .map((it, i) => {
        const r = running.get(it.id);
        return { id: it.id, item: it, i, count: Economy.getBuffCount(it.id), active: !!r, msLeft: r ? r.msLeft : 0 };
      })
      .filter((b) => b.count > 0 || b.active)
      .sort((a, b) => Rarity.rank(Rarity.ofItem(b.item)) - Rarity.rank(Rarity.ofItem(a.item)) || a.i - b.i);
  }

  // USE: takes one from the inventory and starts it. Refused while the same buff is already running (its button is
  // a timer then) or when there is none left.
  function use(id) {
    const item = itemById(id);
    if (!item || active().some((b) => b.id === id)) return false;
    if (!Economy.takeBuff(id)) return false;
    activate(item);
    return true;
  }

  // Starts the buff (a running one restarts its timer - it does not stack the effect).
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
    owned,
    use,
    modifiers,
    eventBuff,
    activate,
    cancel,
    formatTime,
    onChange: (fn) => listeners.push(fn),
  };
})();
