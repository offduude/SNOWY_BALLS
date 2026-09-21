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
  // ITEM ID RENAMES: every save records the version of the item ids it uses (idsV). A save with an older version has its ids renamed when it is
  // loaded / imported (clean()), so nobody loses or swaps an item. Version 2 (2026-09-20): the ids of the three Skyrs follow their names -
  // Orange Skyr was "skyr" -> "skyr_orange", Blue Skyr was "blue_skyr" -> "skyr_blue", and the epic Skyr, "skyr_epic", takes the id "skyr"
  // (the mapping is applied all at once, so the old "skyr" and the new "skyr" are never confused).
  const IDS_VERSION = 2;
  const ID_RENAMES_V2 = { skyr: "skyr_orange", blue_skyr: "skyr_blue", skyr_epic: "skyr" };
  let cleansed = false; // this page load threw an existing save away (kept in memory only, so the message shows once)

  function fresh() {
    return {
      epoch: SAVE_EPOCH,
      idsV: IDS_VERSION,
      coins: 0,
      lifetimeCoins: 0, // total ever EARNED (never goes down when spending) - gates shop tiers
      bestStreak: 0,
      newBuffs: [], // ids of the buffs that are NEW in the BUFFS tab: each card shows a red dot until the tab is closed
      newProjectiles: [], // same for the PROJECTILES list
      newSkins: [], // skins that were UNLOCKED and not dealt with yet: { kind, id, entered, displayed } - see the skin dots below
      buffsUnseen: false, // a NEW kind of buff arrived and the player hasn't opened the BUFFS tab yet (red dot)
      buffItems: {}, // how many of each buff the player has bought and not used yet (id -> count); using one starts it (see buffs.js)
      projectiles: {}, // how many of each consumable projectile the player has (not the snowball - see regen)
      regen: {}, // projectiles that refill over time (the snowball): id -> { count, next } - `next` is the Date.now() timestamp (device clock) at which the next one arrives, null while the stock is full
      projectilesUnseen: false, // a NEW kind of projectile arrived and the player hasn't opened the list yet (red dot)
      event: null, // the event that is running: { name, startedAt } (startedAt on the device clock) - it goes on while the app is closed, like the shop timers
      lastUsedBuff: null, // the id of the buff the player used last (the BUFFS list opens on it)
      god: false, // GOD MODE (the import code "god mode", see saves.js): nothing is ever used up or paid for - coins, projectiles and buffs are infinite
      coinCarry: 0, // the fraction of a coin left over from a payout with a coin multiplier (0 <= x < 1), added to the next payout
      aiming: false, // true from the tap on "TAP to aim" until the ball is thrown - if the game starts with this still set, the aim was abandoned (the app was closed)
      streak: 0, // the CURRENT streak (hits in a row) - kept across reloads, projectile changes, closing the app
      unlockedCharacters: ["andek"], // the ids of the characters the player has (the default one always)
      unlockedSceneries: ["frosty"], // ... and of the sceneries
      unlockedWeathers: ["snow"], // ... and of the weathers
      shopClock: { base: 0, shop: 0, rate: 1 }, // the SHOP's clock (see shopNow): shop time = shop + rate x (device time - base); the default is the device clock itself
      equipped: { character: "andek", scenery: "frosty", weather: "snow", projectile: "snowball" }, // what the player currently uses
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
    const ren = p.idsV === IDS_VERSION ? null : ID_RENAMES_V2; // an older save: its ids are renamed (see IDS_VERSION)
    const rn = (id) => (ren && typeof id === "string" && Object.prototype.hasOwnProperty.call(ren, id) ? ren[id] : id);
    const rnCounts = (o) => {
      const out = {};
      for (const [id, n] of Object.entries(o)) out[rn(id)] = (out[rn(id)] || 0) + n;
      return out;
    };
    return {
      epoch: SAVE_EPOCH,
      idsV: IDS_VERSION,
      coins: p.coins || 0,
      // Saves from before lifetimeCoins existed: the best honest guess is what they hold now.
      lifetimeCoins: p.lifetimeCoins != null ? p.lifetimeCoins : p.coins || 0,
      bestStreak: p.bestStreak || 0,
      streak: Number.isInteger(p.streak) && p.streak > 0 ? p.streak : 0,
      god: p.god === true,
      lastUsedBuff: typeof p.lastUsedBuff === "string" ? rn(p.lastUsedBuff) : null,
      event: p.event && typeof p.event === "object" && typeof p.event.name === "string" && typeof p.event.startedAt === "number" ? { name: p.event.name, startedAt: p.event.startedAt } : null,
      coinCarry: typeof p.coinCarry === "number" && p.coinCarry >= 0 && p.coinCarry < 1 ? p.coinCarry : 0,
      aiming: p.aiming === true,
      projectiles: cleanCounts(p.projectiles),
      regen: cleanRegen(p.regen),
      buffItems: rnCounts(cleanCounts(p.buffItems)),
      newBuffs: [...new Set(cleanIds(p.newBuffs).map(rn))],
      newProjectiles: cleanIds(p.newProjectiles),
      newSkins: Array.isArray(p.newSkins)
        ? p.newSkins
            .filter((n) => n && ["character", "scenery", "weather"].includes(n.kind) && typeof n.id === "string")
            .map((n) => ({ kind: n.kind, id: n.id, entered: n.entered === true, displayed: n.displayed === true }))
        : [],
      buffsUnseen: p.buffsUnseen === true,
      projectilesUnseen: p.projectilesUnseen === true,
      // (the default character used to be called "default": it is Andek now)
      unlockedCharacters: [...new Set([...base.unlockedCharacters, ...(Array.isArray(p.unlockedCharacters) ? p.unlockedCharacters : []).map((id) => (id === "default" ? "andek" : id))])],
      unlockedSceneries: [...new Set([...base.unlockedSceneries, ...(Array.isArray(p.unlockedSceneries) ? p.unlockedSceneries : [])])],
      unlockedWeathers: [...new Set([...base.unlockedWeathers, ...(Array.isArray(p.unlockedWeathers) ? p.unlockedWeathers : [])])],
      shopClock: (() => {
        const c = p.shopClock;
        return c && [c.base, c.shop, c.rate].every(Number.isFinite) && c.rate > 0 ? { base: c.base, shop: c.shop, rate: c.rate } : base.shopClock;
      })(),
      equipped: (() => {
        const eq = { ...base.equipped, ...(p.equipped && typeof p.equipped === "object" ? p.equipped : {}) };
        if (eq.character === "default") eq.character = "andek";
        if (eq.weather === "none") eq.weather = base.equipped.weather; // (weather could be turned off for a day: it cannot any more)
        return eq;
      })(),
      buffs: Array.isArray(p.buffs) ? p.buffs.filter((b) => b && typeof b.id === "string" && typeof b.endsAt === "number").map((b) => ({ ...b, id: rn(b.id) })) : [],
      shop: {
        stock: Array.isArray(shop.stock) ? shop.stock.map(rn) : null,
        offers: Array.isArray(shop.offers) ? shop.offers : [],
        owned: Array.isArray(shop.owned) ? shop.owned.map(rn) : [],
        consumables: shop.consumables && typeof shop.consumables === "object" ? rnCounts(shop.consumables) : {},
        restock: Array.isArray(shop.restock) ? shop.restock.map((t) => (t && typeof t === "object" ? { ...t, prev: rn(t.prev) } : t)) : [],
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

  const skinListeners = [];
  function onSkinsChange(fn) {
    skinListeners.push(fn);
  }
  function skinsChanged() {
    skinListeners.forEach((fn) => fn());
  }

  // The list of the ids the player has of a skin kind.
  function unlockedList(kind) {
    return kind === "character" ? state.unlockedCharacters : kind === "weather" ? state.unlockedWeathers : state.unlockedSceneries;
  }

  // kind: "character" | "scenery" | "weather" | "projectile"
  function getEquipped(kind) {
    return state.equipped[kind];
  }

  let equippedHook = null; // called after something is equipped (the shop uses it to follow the equipped skins' shopSpeed)
  function setEquipped(kind, id) {
    state.equipped[kind] = id;
    save();
    if (equippedHook) equippedHook(kind, id);
  }

  // ---- THE SHOP'S CLOCK ----
  // The shop's timers (how long an item stays on sale, the SOLD OUT timer) are timestamps on THIS clock, not on the device clock: it runs at `rate` x the
  // device clock (1, or 1.2 with Frosty Night equipped - a skin's `shopSpeed` effect). It is the device clock itself until the rate changes (base 0, shop 0,
  // rate 1), so saves from before it work unchanged. When the rate changes the clock is re-based at that moment (nothing jumps); it goes on at the saved rate while
  // the app is closed - the skin stays equipped - so the timers keep running faster offline too. Shop time to real time: divide by the rate.
  function shopNow() {
    const c = state.shopClock;
    return c.shop + c.rate * (Date.now() - c.base);
  }

  function shopRate() {
    return state.shopClock.rate;
  }

  function setShopRate(rate) {
    if (!(rate > 0) || Math.abs(state.shopClock.rate - rate) < 1e-9) return;
    state.shopClock = { shop: shopNow(), base: Date.now(), rate };
    save();
  }

  // The `effects` of the skins that are equipped now (economy.json characters / sceneries / weathers), given the economy data.
  function skinEffects(ecoJson) {
    const out = [];
    for (const [kind, list] of [["character", "characters"], ["scenery", "sceneries"], ["weather", "weathers"]]) {
      const it = ((ecoJson && ecoJson[list]) || []).find((x) => x.id === state.equipped[kind]);
      if (it && Array.isArray(it.effects)) out.push(...it.effects);
    }
    return out;
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
    getLastUsedBuff: () => state.lastUsedBuff,
    setLastUsedBuff: (id) => {
      state.lastUsedBuff = id;
      save();
    },
    getEvent: () => state.event,
    setEvent: (ev) => {
      state.event = ev || null;
      save();
    },
    // God mode: a god save made before an item existed has none of it - give 999 of every listed projectile / buff it lacks, and unlock every skin
    // (skins: { character: [ids], scenery: [ids], weather: [ids] }).
    fillGod: (projectileIds, buffIds, skins) => {
      if (!state.god) return;
      let changed = false;
      for (const id of projectileIds) if (!state.projectiles[id]) ((state.projectiles[id] = 999), (changed = true));
      for (const id of buffIds) if (!state.buffItems[id]) ((state.buffItems[id] = 999), (changed = true));
      for (const [kind, ids] of Object.entries(skins || {})) {
        const list = unlockedList(kind);
        for (const id of ids) if (!list.includes(id)) (list.push(id), (changed = true));
      }
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
    setEquippedHook: (fn) => {
      equippedHook = fn;
    },
    shopNow,
    shopRate,
    setShopRate,
    skinEffects,
    // Characters, sceneries and weathers the player has (kind: "character", "scenery" or "weather"); the default ones are always there.
    isUnlocked: (kind, id) => unlockedList(kind).includes(id),
    unlock: (kind, id) => {
      const list = unlockedList(kind);
      if (!list.includes(id)) {
        list.push(id);
        state.newSkins.push({ kind, id, entered: false, displayed: false }); // a new skin: the red dots (below)
        save();
        skinsChanged();
      }
    },
    // ---- THE RED DOTS OF A NEW SKIN (three of them, each with its own rule) ----
    //  - the SKINS button's: on while a new skin's category has not been ENTERED (opening the SKINS list itself does not count) - enterSkinKind
    //  - the category's (its card in the SKINS list): on until the new skin has been DISPLAYED, i.e. it was on screen in the category's menu (the player scrolls
    //    down to it unless it is already in view) - markSkinDisplayed
    //  - the skin's own card: on until the skin is EQUIPPED (clearNewSkin) or the menu is closed / left after the skin was displayed (closeSkinKind)
    onSkinsChange,
    hasNewSkinsToEnter: () => state.newSkins.some((n) => !n.entered),
    kindHasUndisplayedSkins: (kind) => state.newSkins.some((n) => n.kind === kind && !n.displayed),
    isNewSkin: (kind, id) => state.newSkins.some((n) => n.kind === kind && n.id === id),
    enterSkinKind: (kind) => {
      let changed = false;
      for (const n of state.newSkins) if (n.kind === kind && !n.entered) ((n.entered = true), (changed = true));
      if (changed) {
        save();
        skinsChanged();
      }
    },
    markSkinDisplayed: (kind, id) => {
      const n = state.newSkins.find((x) => x.kind === kind && x.id === id);
      if (!n || n.displayed) return;
      n.displayed = true;
      save();
      skinsChanged();
    },
    clearNewSkin: (kind, id) => {
      const before = state.newSkins.length;
      state.newSkins = state.newSkins.filter((n) => !(n.kind === kind && n.id === id));
      if (state.newSkins.length !== before) {
        save();
        skinsChanged();
      }
    },
    closeSkinKind: (kind) => {
      const before = state.newSkins.length;
      state.newSkins = state.newSkins.filter((n) => !(n.kind === kind && n.displayed));
      if (state.newSkins.length !== before) {
        save();
        skinsChanged();
      }
    },
    getBuffList,
    saveBuffs,
    getShopState,
    saveShop,
  };
})();
