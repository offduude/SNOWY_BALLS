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
//   miracle          1     Diamond Cross: the NEXT throw is helped if it misses (see main.js resolveMiracleThrow) and the buff is used up by
//                          that throw. A "charge" buff (`charge: true` on the item, no `duration`): no timer, its card shows "+1" instead
//   centerLine       1     draws ONE green line on each slider, at the middle of the hit zone (the middle of the offset bar; the middle of the
//                          strength band that hits W20 from the chosen offset) - Blue Skyr. Any active source turns it on; it works with or without guideLines
//   eventHitzone     1     shows the HITZONE that marks the running event's face on both sliders (yellow for the banana face, purple for the disco, orange for the guitar) -
//                          the actual full width/band that hits it, not a smaller "safe" marker; without a buff with this effect nothing is drawn - the epic Skyr. Any active source turns it on
//   precision        x     offset (angle) slider: its hit zone gets x times bigger (x1.2 = 20% bigger, e.g. 25% of the bar -> 30%, never over
//                          100%), so the bar's range shrinks to 1/x and the same marker movement is finer
//   strengthControl  x     strength (power) slider: same, its range shrinks to 1/x (around the middle)
//   coinMultiplier   x     multiplies the coins of a hit (whole coins are paid, the fraction is carried to the next payout). Buffs STACK:
//                          they multiply each other (1.1 x 1.2 = 1.32), no cap
//   offsetCenter     c     the OFFSET slider's hit zone is centered at c of the bar (0.5 = the middle, the normal; the Blizzard weather: 0.25); the
//                          green lines, the centre line and the event hitzone follow it. Not a buff: only a skin's effect (see below)
//   offsetSpeed      x     the OFFSET slider's marker moves at x times its speed (0.8 = 20% slower, steadier); the strength slider is not
//                          affected. Buffs STACK: they multiply (0.9 x 0.8 = 0.72), no floor
//   saveProjectile   p     chance (0-1) that a throw does NOT use up its projectile. Buffs STACK as INDEPENDENT ROLLS: each has its own chance,
//                          so the chance that one of them saves it is 1 - (1-a)(1-b)... (10% + 20% = 28%), never above
//                          `buffCaps.saveProjectile` (0.9); modifiers() also says which buff has the highest chance (saveProjectileBy),
//                          it is shown on the result message when it saves a projectile
//   triggerEvent     name  while it runs, that event ("face" = the banana face) is on, for as long as the buff lasts; when the event ends
//                          (the player hits the face) the buff ends with it, and when the buff ends (timer / cancelled) so does the
//                          event. The game (main.js syncBuffEvent) starts and stops the event; this file only reports the buff.
// The `effects` of the EQUIPPED skins (economy.json characters / sceneries / weathers, Economy.skinEffects) are read in modifiers() like an always-on buff
// (coinMultiplier: the Blizzard's 1.05, offsetCenter). A skin's shopSpeed is not read here: it is the shop's clock (economy.js shopNow, shop.js).
// This file also draws the buff cards at the top of the screen (next to the live display); tapping a card cancels its buff - except an EVENT buff
// (one with a triggerEvent effect: Tomato Juice, the Disco Ball): once used, its event cannot be cancelled (canCancel).
const Buffs = (() => {
  let eco = null;
  let hudEl = null;
  let renderedKey = "";
  const listeners = [];
  const tickListeners = []; // called on every tick of the clock below

  // An event buff (effect triggerEvent: Tomato Juice, later the disco one) cannot be used while ANY event is running (the scene says so
  // through the gate) or while another event buff is running. The BUFFS list shows such a USE button dimmed.
  let eventGate = null;

  function hasTrigger(item) {
    return !!(item && (item.effects || []).some((e) => e.type === "triggerEvent"));
  }

  function eventBlocked(item) {
    if (!hasTrigger(item)) return false;
    return (!!eventGate && !!eventGate()) || active().some((b) => hasTrigger(b.item));
  }

  function itemById(id) {
    return eco.shop.items.find((it) => it.id === id) || null;
  }

  // A charge buff (item.charge) has no timer: it stays until the throw it is for uses it up (so: "forever" on the device clock).
  const CHARGE_MS = 10 * 365 * 24 * 3600 * 1000;

  function isCharge(item) {
    return !!(item && item.charge);
  }

  // The length of the event a SUMMON buff (a charge buff with a triggerEvent effect: the Disco Ticket) starts, in ms - the scene knows it (the
  // disco is as long as its song) - or null for any other buff. Such a buff shows that length as its time, like a timed buff.
  let eventLength = null;

  function summonMs(item) {
    if (!isCharge(item) || !hasTrigger(item) || !eventLength) return null;
    const e = item.effects.find((x) => x.type === "triggerEvent");
    const ms = eventLength(e.value);
    return ms > 0 ? Math.floor(ms / 1000) * 1000 : null; // (whole seconds, rounded down: the song is 2:44.4 long and reads 2:44, as in a music player)
  }

  // What a card shows as its time: mm:ss, or "+1" for a charge buff that has no length (Diamond Cross). A summon buff shows its event's length
  // while it waits and counts it down once the event has started.
  function timeText(item, ms) {
    if (isCharge(item) && ms > CHARGE_MS / 2) {
      const len = summonMs(item);
      return len ? formatTime(len) : "+1";
    }
    return formatTime(ms);
  }

  function durationMs(item) {
    if (isCharge(item)) return CHARGE_MS;
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
    let notSaved = 1; // the chance that no running buff saves the projectile
    let bestSave = 0;
    const m = { guideLines: 0, centerLine: 0, eventHitzone: 0, precision: 1, strengthControl: 1, coinMultiplier: 1, saveProjectile: 0, saveProjectileBy: null, offsetSpeed: 1, offsetCenter: 0.5, miracle: 0, miracleBy: null };
    // the running buffs, then the equipped skins (an always-on source with no id)
    const sources = [...active().map((b) => ({ id: b.id, effects: b.item.effects || [] })), { id: null, effects: Economy.skinEffects(eco) }];
    for (const b of sources) {
      for (const e of b.effects) {
        if (!(e.type in m)) continue;
        if (e.type === "miracle") {
          m.miracle += e.value;
          m.miracleBy = b.id;
        } else if (e.type === "offsetCenter") m.offsetCenter = e.value; // (only a skin has it)
        else if (e.type === "guideLines" || e.type === "centerLine" || e.type === "eventHitzone") m[e.type] += e.value; // a switch: any active source turns it on
        else if (e.type === "saveProjectile") {
          notSaved *= 1 - e.value; // independent rolls: the projectile is used up only if EVERY buff's roll fails
          if (e.value > bestSave) {
            bestSave = e.value;
            m.saveProjectileBy = b.id; // the strongest one gets the credit on the result message
          }
        } else m[e.type] *= e.value; // coinMultiplier, offsetSpeed (and precision, strengthControl) multiply
      }
    }
    // Only the save chance is limited (economy.json buffCaps.saveProjectile) so a pile of buffs can never make throws free;
    // coin multipliers and the offset slow-down stack without a limit.
    const cap = eco && eco.buffCaps && typeof eco.buffCaps.saveProjectile === "number" ? eco.buffCaps.saveProjectile : 0.9;
    m.saveProjectile = Math.min(cap, 1 - notSaved);
    return m;
  }

  // A SUMMON buff: a charge buff (no timer) whose effect is triggerEvent <name> (the disco ball): using it means "start that event as soon as
  // no throw is being made and no event runs" (main.js syncSummonBuff); the charge is used up when the event starts. Returns { id, event }
  // or null.
  function summonBuff() {
    const b = active().find((x) => isCharge(x.item) && hasTrigger(x.item) && x.msLeft > CHARGE_MS / 2); // (waiting: not started yet)
    if (!b) return null;
    const e = b.item.effects.find((x) => x.type === "triggerEvent");
    return { id: b.id, event: e.value };
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
      .filter((it) => it.category === "consumable" && !(it.godOnly && !Economy.isGod())) // (a test buff: god mode saves only)
      .map((it, i) => {
        const r = running.get(it.id);
        return { id: it.id, item: it, i, count: Economy.getBuffCount(it.id), active: !!r, msLeft: r ? r.msLeft : 0, blocked: !r && eventBlocked(it) };
      })
      .filter((b) => b.count > 0 || b.active)
      .sort((a, b) => Rarity.rank(Rarity.ofItem(b.item)) - Rarity.rank(Rarity.ofItem(a.item)) || a.i - b.i);
  }

  // USE: takes one from the inventory and starts it. Refused while the same buff is already running (its button is
  // a timer then) or when there is none left.
  function use(id) {
    const item = itemById(id);
    if (!item || active().some((b) => b.id === id)) return false;
    if (eventBlocked(item)) return false; // an event is running: no second one
    if (!Economy.takeBuff(id)) return false;
    activate(item);
    Economy.setLastUsedBuff(id); // the BUFFS list opens on the buff used last
    // Push this use to the cloud right away, not on the normal cadence - see Cloud.noteBuffUse's own note.
    if (typeof Cloud !== "undefined" && Cloud.noteBuffUse) Cloud.noteBuffUse();
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

  // A summon buff whose event is running counts it down: from `endsAt` on the card shows a real timer instead of "+1".
  function setBuffEnd(id, endsAt) {
    const b = Economy.getBuffList().find((x) => x.id === id);
    if (!b) return;
    b.endsAt = endsAt;
    Economy.saveBuffs();
    changed();
  }

  // Can the player cancel this buff by tapping its card? Not an event buff (Tomato Juice, the Disco Ball): the event it summoned, or is about to
  // start, cannot be cancelled. (The game itself still removes such a buff when it is over - cancel() below has no such rule.)
  function canCancel(id) {
    return !hasTrigger(itemById(id));
  }

  // Removes a buff for good (the tap on its card - if canCancel -, a face hit ending Tomato Juice, a used-up charge).
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

  // The background tint of a card: its rarity's colour (economy.json rarities) at ~22% (the class/style part of the card's HTML); the
  // legendary rainbow gets an animated rainbow background instead (.buff-card.rainbow in index.html). "" if the item has no rarity.
  function tintAttrs(item) {
    const r = Rarity.info(Rarity.ofItem(item));
    if (!r) return "";
    if (r.color === "rainbow") return ' rainbow';
    const m = /^#([0-9a-f]{6})$/i.exec(r.color || "");
    if (!m) return "";
    const n = parseInt(m[1], 16);
    return ` tinted" style="--tint: rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.22)`;
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
            `<div class="buff-card${tintAttrs(b.item)}" data-id="${b.id}">` +
            (b.item.image ? `<img src="${b.item.image}" alt="" draggable="false" />` : `<span class="buff-noimg"></span>`) +
            `<span class="buff-timer">${timeText(b.item, b.msLeft)}</span></div>`
        )
        .join("");
    } else {
      list.forEach((b) => {
        const t = hudEl.querySelector(`.buff-card[data-id="${b.id}"] .buff-timer`);
        if (t) t.textContent = timeText(b.item, b.msLeft);
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
        if (!canCancel(card.dataset.id)) return; // an event buff: its event cannot be cancelled (no click, nothing)
        if (typeof playUiClick === "function") playUiClick();
        cancel(card.dataset.id);
      });
      render();
      // ONE clock for every buff timer on screen (the cards at the top and the BUFFS list): four times a second it refreshes
      // the cards, drops expired buffs (and tells the BUFFS list to redraw), then lets the list refresh its timers in the
      // same tick - so both always show the same second.
      setInterval(() => {
        const before = Economy.getBuffList().length;
        render();
        if (Economy.getBuffList().length !== before) listeners.forEach((fn) => fn());
        tickListeners.forEach((fn) => fn());
      }, 250);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) changed();
      });
    },
    active,
    summonMs,
    setEventLength: (fn) => {
      eventLength = fn;
    },
    summonBuff,
    setBuffEnd,
    eventBlocked,
    setEventGate: (fn) => {
      eventGate = fn;
    },
    durationMs,
    isCharge,
    timeText,
    consumeCharge: cancel, // a charge buff is used up: its card goes
    isEventBuff: (id) => hasTrigger(itemById(id)), // true for a summon buff (Tomato Juice, the Disco Ticket) - see collection.js onEquip
    canCancel,
    owned,
    use,
    modifiers,
    eventBuff,
    activate,
    cancel,
    formatTime,
    onChange: (fn) => listeners.push(fn),
    onTick: (fn) => tickListeners.push(fn),
  };
})();
