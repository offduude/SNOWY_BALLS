// Persistent save data, backed by localStorage: wallet, streak record, and everything the shop
// needs to remember. The shop's *current stock* is saved on purpose - if it lived only in memory,
// leaving and re-entering the game would reroll it, which is an exploit (reroll until the item
// you want shows up).
const Economy = (() => {
  const KEY = "snowyBallsSave";
  // THE GRAND RESET: every save records the reset number it was made under. A save without it, or with a lower one, belongs to
  // an earlier economy: it is thrown away on load and the player starts a new game (and sees "The grand cleansing has struck."
  // once, see wasCleansed). To reset everybody again, raise this number.
  const SAVE_EPOCH = 1;
  let cleansed = false; // this page load threw an existing save away (kept in memory only, so the message shows once)

  function fresh() {
    return {
      epoch: SAVE_EPOCH,
      coins: 0,
      lifetimeCoins: 0, // total ever EARNED (never goes down when spending) - gates shop tiers
      bestStreak: 0,
      newBuffs: [], // ids of the buffs that are NEW in the BUFFS tab: each card shows a red dot until the tab is closed
      newProjectiles: [], // same for the PROJECTILES list
      buffsUnseen: false, // a NEW kind of buff arrived and the player hasn't opened the BUFFS tab yet (red dot)
      buffItems: {}, // how many of each buff the player has bought and not used yet (id -> count); using one starts it (see buffs.js)
      projectiles: {}, // how many of each consumable projectile the player has (not the snowball - see regen)
      regen: {}, // projectiles that refill over time (the snowball): id -> { count, next } - `next` is the Date.now() timestamp (device clock) at which the next one arrives, null while the stock is full
      projectilesUnseen: false, // a NEW kind of projectile arrived and the player hasn't opened the list yet (red dot)
      god: false, // GOD MODE (the import code "god mode", see saves.js): nothing is ever used up or paid for - coins, projectiles and buffs are infinite
      coinCarry: 0, // the fraction of a coin left over from a payout with a coin multiplier (0 <= x < 1), added to the next payout
      aiming: false, // true from the tap on "TAP to aim" until the ball is thrown - if the game starts with this still set, the aim was abandoned (the app was closed)
      streak: 0, // the CURRENT streak (hits in a row) - kept across reloads, projectile changes, closing the app
      unlockedCharacters: ["default"],
      equipped: { character: "default", projectile: "snowball" }, // what the player currently uses
      buffs: [], // active timed buffs: { id, endsAt } - endsAt is a Date.now() timestamp (device clock)
      shop: {
        offers: [], // per slot: null, or { amount, unitPrice } rolled for a stack item on sale there
        stock: null, // array of item ids currently on sale, one per slot; null = not generated yet
        owned: [], // ids of permanent items bought
        consumables: {}, // id -> how many bought and not yet used
        restock: [], // per slot: null, or { at: ms timestamp (device clock) the slot restocks, prev: id sold there }
        expires: [], // per slot: null (sold out), or the timestamp (device clock) at which the item on sale there runs out and the slot REROLLS
        unseen: false, // a slot restocked while the shop was closed and the player has not looked yet (SHOP button dot)
      },
    };
  }

  function cleanCounts(obj) {
    const out = {};
    if (obj && typeof obj === "object") {
      for (const [id, n] of Object.entries(obj)) if (Number.isInteger(n) && n > 0) out[id] = n;
    }
    return out;
  }

  function cleanIds(list) {
    return Array.isArray(list) ? [...new Set(list.filter((x) => typeof x === "string"))] : [];
  }

  function cleanRegen(obj) {
    const out = {};
    if (obj && typeof obj === "object") {
      for (const [id, r] of Object.entries(obj)) {
        if (r && Number.isInteger(r.count) && r.count >= 0) out[id] = { count: r.count, next: typeof r.next === "number" ? r.next : null };
      }
    }
    return out;
  }

  // The save as it is stored, cleaned into the shape the game expects (anything missing gets its default).
  function clean(p, base) {
    const shop = p.shop || {};
    return {
      epoch: SAVE_EPOCH,
      coins: p.coins || 0,
      // Saves from before lifetimeCoins existed: the best honest guess is what they hold now.
      lifetimeCoins: p.lifetimeCoins != null ? p.lifetimeCoins : p.coins || 0,
      bestStreak: p.bestStreak || 0,
      streak: Number.isInteger(p.streak) && p.streak > 0 ? p.streak : 0,
      god: p.god === true,
      coinCarry: typeof p.coinCarry === "number" && p.coinCarry >= 0 && p.coinCarry < 1 ? p.coinCarry : 0,
      aiming: p.aiming === true,
      projectiles: cleanCounts(p.projectiles),
      regen: cleanRegen(p.regen),
      buffItems: cleanCounts(p.buffItems),
      newBuffs: cleanIds(p.newBuffs),
      newProjectiles: cleanIds(p.newProjectiles),
      buffsUnseen: p.buffsUnseen === true,
      projectilesUnseen: p.projectilesUnseen === true,
      unlockedCharacters: p.unlockedCharacters || base.unlockedCharacters,
      equipped: { ...base.equipped, ...(p.equipped && typeof p.equipped === "object" ? p.equipped : {}) },
      buffs: Array.isArray(p.buffs) ? p.buffs.filter((b) => b && typeof b.id === "string" && typeof b.endsAt === "number") : [],
      shop: {
        stock: Array.isArray(shop.stock) ? shop.stock : null,
        offers: Array.isArray(shop.offers) ? shop.offers : [],
        owned: Array.isArray(shop.owned) ? shop.owned : [],
        consumables: shop.consumables && typeof shop.consumables === "object" ? shop.consumables : {},
        restock: Array.isArray(shop.restock) ? shop.restock : [],
        expires: Array.isArray(shop.expires) ? shop.expires.map((x) => (typeof x === "number" ? x : null)) : [],
        unseen: shop.unseen === true,
      },
    };
  }

  // A save that came from somewhere else (an imported code): the cleaned save, or null if it is not a save of the current
  // reset (see SAVE_EPOCH).
  function sanitize(p) {
    if (!p || typeof p !== "object" || !(typeof p.epoch === "number" && p.epoch >= SAVE_EPOCH)) return null;
    try {
      return clean(p, fresh());
    } catch (e) {
      return null;
    }
  }

  function load() {
    const base = fresh();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return base;
      const p = JSON.parse(raw);
      if (!(typeof p.epoch === "number" && p.epoch >= SAVE_EPOCH)) {
        cleansed = true; // an old save: the grand reset - start again
        return base;
      }
      return clean(p, base);
    } catch (e) {
      return base;
    }
  }

  // While the save slots are being swapped (see saves.js) nothing may write this page's old state over the new one.
  // (Declared BEFORE the first save() below: calling save() before this line ran crashed Economy on the cleansing path.)
  let locked = false;

  let state = load();
  if (cleansed) save(); // write the fresh save over the old one right away, so it can only ever be cleansed once

  function save() {
    if (locked) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      // localStorage unavailable (private mode, quota) - progress just won't persist this session
    }
  }

  // Listeners are told the new balance whenever it changes (the on-screen coin counter).
  const listeners = [];
  function onCoinsChange(fn) {
    listeners.push(fn);
    fn(state.coins);
  }
  function notify() {
    listeners.forEach((fn) => fn(state.coins));
  }

  // A payout that is not a whole number of coins (a hit x a coin multiplier, e.g. 5 x 1.1 = 5.5): pays the whole coins and keeps the
  // fraction for the next payout, so a small multiplier is never rounded away - over time the player gets exactly what the
  // multiplier says. Returns the whole coins to pay out (the caller adds them with addCoins).
  function takePayout(amount) {
    const total = Math.round((amount + state.coinCarry) * 1e6) / 1e6; // (rounds away float dust like 5.500000000000001)
    const whole = Math.floor(total);
    state.coinCarry = Math.max(0, Math.round((total - whole) * 1e6) / 1e6);
    save();
    return whole;
  }

  function addCoins(amount) {
    state.coins += amount;
    if (amount > 0) state.lifetimeCoins += amount;
    save();
    notify();
    return state.coins;
  }

  // Returns false (and changes nothing) if the player can't afford it.
  function spendCoins(amount) {
    if (state.god) return true; // god mode: everything is free
    if (amount > state.coins) return false;
    state.coins -= amount;
    save();
    notify();
    return true;
  }

  function getCoins() {
    return state.coins;
  }

  function getLifetimeCoins() {
    return state.lifetimeCoins;
  }

  function reportStreak(streak) {
    if (streak > state.bestStreak) {
      state.bestStreak = streak;
      save();
    }
    return state.bestStreak;
  }

  // ---- projectile inventory (consumable projectiles) ----
  const projectileListeners = [];
  function onProjectilesChange(fn) {
    projectileListeners.push(fn);
  }
  function projectilesChanged() {
    projectileListeners.forEach((fn) => fn());
  }

  // ---- refilling stocks (the snowball): capped at `max`, +1 every `everyMs`, counted by the device clock so the timer
  //      keeps running while the app is closed. The numbers come from economy.json via setRegenConfig. ----
  const regenCfg = {}; // id -> { max, everyMs }

  function setRegenConfig(cfg) {
    for (const [id, c] of Object.entries(cfg)) {
      regenCfg[id] = c;
      // A new player starts with a full stock.
      if (!state.regen[id]) state.regen[id] = { count: c.max, next: null };
      if (state.regen[id].count > c.max) state.regen[id].count = c.max;
    }
    for (const id of Object.keys(cfg)) syncRegen(id);
  }

  // Adds whatever arrived since the last look (several may have, if the app was closed for a while). Returns true if
  // anything changed.
  function syncRegen(id) {
    const c = regenCfg[id];
    const r = state.regen[id];
    if (!c || !r) return false;
    const now = Date.now();
    let changed = false;
    if (r.count >= c.max) {
      if (r.count > c.max || r.next !== null) changed = true;
      r.count = c.max;
      r.next = null;
    } else {
      if (r.next === null) {
        r.next = now + c.everyMs;
        changed = true;
      }
      // The device clock was set back: never wait longer than one full period.
      if (r.next - now > c.everyMs + 1000) {
        r.next = now + c.everyMs;
        changed = true;
      }
      if (now >= r.next) {
        const n = Math.floor((now - r.next) / c.everyMs) + 1;
        r.count = Math.min(c.max, r.count + n);
        r.next = r.count >= c.max ? null : r.next + n * c.everyMs;
        changed = true;
      }
    }
    if (changed) {
      save();
      projectilesChanged();
    }
    return changed;
  }

  // { count, max, msToNext } for a refilling projectile (msToNext is null when it is full).
  function regenInfo(id) {
    syncRegen(id);
    const c = regenCfg[id];
    const r = state.regen[id];
    if (!c || !r) return null;
    return { count: r.count, max: c.max, msToNext: r.next === null ? null : Math.max(0, r.next - Date.now()) };
  }

  function getProjectileCount(id) {
    if (regenCfg[id]) {
      syncRegen(id);
      return state.regen[id].count;
    }
    return state.projectiles[id] || 0;
  }

  // Adds `n` of a projectile. If the player had none of that kind, the list "expands": the red dot is
  // raised (unless `silent`, used for refunds). Getting more of a kind they already have raises nothing.
  function addProjectiles(id, n, silent) {
    if (regenCfg[id]) {
      state.regen[id].count = Math.min(regenCfg[id].max, getProjectileCount(id) + n);
      save();
      projectilesChanged();
      return;
    }
    const before = getProjectileCount(id);
    state.projectiles[id] = before + n;
    if (before === 0 && n > 0 && !silent) {
      state.projectilesUnseen = true;
      if (!state.newProjectiles.includes(id)) state.newProjectiles.push(id);
    }
    save();
    projectilesChanged();
  }

  // Uses up one. Returns false (and changes nothing) if there is none.
  function useProjectile(id) {
    const n = getProjectileCount(id);
    if (n <= 0) return false;
    if (state.god) return true; // god mode: never used up
    if (regenCfg[id]) {
      const r = state.regen[id];
      r.count = n - 1;
      if (r.next === null) r.next = Date.now() + regenCfg[id].everyMs; // the refill timer starts with the first one used
      save();
      projectilesChanged();
      return true;
    }
    if (n === 1) delete state.projectiles[id];
    else state.projectiles[id] = n - 1;
    save();
    projectilesChanged();
    return true;
  }

  // ---- buff inventory (bought buffs waiting to be used) ----
  function getBuffCount(id) {
    return state.buffItems[id] || 0;
  }

  const buffListeners = [];
  function onBuffsChange(fn) {
    buffListeners.push(fn);
  }

  // Adds `n` of a buff. If the buff wasn't in the BUFFS tab before (none in the inventory and none running), the tab
  // "expands": the red dot is raised. More of a buff the player already has (in the inventory or running) raises nothing.
  // (An inventory can be limited to getBuffMax() of one buff - set with `shop.buffMax` in economy.json; there is no limit unless that is set.)
  let buffMax = Infinity;

  function setBuffMax(n) {
    if (n > 0) buffMax = Math.floor(n);
  }

  function getBuffMax() {
    return buffMax;
  }

  function addBuffs(id, n) {
    const before = getBuffCount(id);
    const running = state.buffs.some((b) => b.id === id && b.endsAt > Date.now());
    state.buffItems[id] = Math.min(buffMax, before + n);
    if (before === 0 && !running && n > 0) {
      state.buffsUnseen = true;
      if (!state.newBuffs.includes(id)) state.newBuffs.push(id);
    }
    save();
    buffListeners.forEach((fn) => fn());
  }

  function hasUnseenBuffs() {
    return state.buffsUnseen;
  }

  function clearUnseenBuffs() {
    if (!state.buffsUnseen) return;
    state.buffsUnseen = false;
    save();
    buffListeners.forEach((fn) => fn());
  }

  // Takes one out of the inventory. Returns false (and changes nothing) if there is none.
  function takeBuff(id) {
    const n = getBuffCount(id);
    if (n <= 0) return false;
    if (state.god) return true; // god mode: never used up
    if (n === 1) delete state.buffItems[id];
    else state.buffItems[id] = n - 1;
    save();
    return true;
  }

  function hasUnseenProjectiles() {
    return state.projectilesUnseen;
  }

  function clearUnseenProjectiles() {
    if (!state.projectilesUnseen) return;
    state.projectilesUnseen = false;
    save();
    projectilesChanged();
  }

  // The per-card red dots: which projectiles / buffs are NEW. They stay until the player closes the list (the menu
  // button's dot goes as soon as it is opened, the cards' dots when it is closed again).
  function isNewProjectile(id) {
    return state.newProjectiles.includes(id);
  }

  function isNewBuff(id) {
    return state.newBuffs.includes(id);
  }

  // One card's dot goes when the player equips / uses that item.
  function clearNewProjectile(id) {
    const i = state.newProjectiles.indexOf(id);
    if (i < 0) return;
    state.newProjectiles.splice(i, 1);
    save();
  }

  function clearNewBuff(id) {
    const i = state.newBuffs.indexOf(id);
    if (i < 0) return;
    state.newBuffs.splice(i, 1);
    save();
  }

  function clearNewProjectiles() {
    if (!state.newProjectiles.length) return;
    state.newProjectiles = [];
    save();
  }

  function clearNewBuffs() {
    if (!state.newBuffs.length) return;
    state.newBuffs = [];
    save();
  }

  function wasAiming() {
    return state.aiming;
  }

  function setAiming(on) {
    if (state.aiming === on) return;
    state.aiming = on;
    save();
  }

  function getStreak() {
    return state.streak;
  }

  function setStreak(n) {
    if (state.streak === n) return;
    state.streak = n;
    save();
  }

  function getBestStreak() {
    return state.bestStreak;
  }

  // kind: "character" | "projectile"
  function getEquipped(kind) {
    return state.equipped[kind];
  }

  function setEquipped(kind, id) {
    state.equipped[kind] = id;
    save();
  }

  // The buff list is edited in place by the Buffs module, which then calls saveBuffs().
  function getBuffList() {
    return state.buffs;
  }

  function saveBuffs() {
    save();
  }

  // The shop mutates this object directly and then calls saveShop().
  function getShopState() {
    return state.shop;
  }

  function saveShop() {
    save();
  }

  return {
    onCoinsChange,
    addCoins,
    takePayout,
    spendCoins,
    getCoins,
    getLifetimeCoins,
    reportStreak,
    getBestStreak,
    getStreak,
    setStreak,
    wasAiming,
    setAiming,
    getBuffCount,
    addBuffs,
    onBuffsChange,
    hasUnseenBuffs,
    clearUnseenBuffs,
    takeBuff,
    setRegenConfig,
    wasCleansed: () => cleansed,
    sanitize,
    snapshot: () => JSON.stringify(state), // the save as it is right now (for exporting)
    isGod: () => state.god === true,
    // God mode: a god save made before an item existed has none of it - give 999 of every listed projectile / buff it lacks.
    fillGod: (projectileIds, buffIds) => {
      if (!state.god) return;
      let changed = false;
      for (const id of projectileIds) if (!state.projectiles[id]) ((state.projectiles[id] = 999), (changed = true));
      for (const id of buffIds) if (!state.buffItems[id]) ((state.buffItems[id] = 999), (changed = true));
      if (changed) save();
    },
    freshJson: () => JSON.stringify(fresh()), // a brand-new game
    lockSaves: () => {
      locked = true;
    },
    getEpoch: () => SAVE_EPOCH,
    storageKey: KEY,
    setBuffMax,
    getBuffMax,
    regenInfo,
    getProjectileCount,
    addProjectiles,
    useProjectile,
    isNewProjectile,
    isNewBuff,
    clearNewProjectiles,
    clearNewProjectile,
    clearNewBuff,
    clearNewBuffs,
    hasUnseenProjectiles,
    clearUnseenProjectiles,
    onProjectilesChange,
    getEquipped,
    setEquipped,
    getBuffList,
    saveBuffs,
    getShopState,
    saveShop,
  };
})();
