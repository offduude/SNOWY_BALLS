// Persistent save data, backed by localStorage: wallet, streak record, and everything the shop
// needs to remember. The shop's *current stock* is saved on purpose - if it lived only in memory,
// leaving and re-entering the game would reroll it, which is an exploit (reroll until the item
// you want shows up).
const Economy = (() => {
  const KEY = "snowyBallsSave";

  function fresh() {
    return {
      coins: 0,
      lifetimeCoins: 0, // total ever EARNED (never goes down when spending) - gates shop tiers
      bestStreak: 0,
      projectiles: {}, // how many of each consumable projectile the player has (the snowball is infinite and not listed)
      projectilesUnseen: false, // a NEW kind of projectile arrived and the player hasn't opened the list yet (red dot)
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

  function load() {
    const base = fresh();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return base;
      const p = JSON.parse(raw);
      const shop = p.shop || {};
      return {
        coins: p.coins || 0,
        // Saves from before lifetimeCoins existed: the best honest guess is what they hold now.
        lifetimeCoins: p.lifetimeCoins != null ? p.lifetimeCoins : p.coins || 0,
        bestStreak: p.bestStreak || 0,
        streak: Number.isInteger(p.streak) && p.streak > 0 ? p.streak : 0,
        projectiles: cleanCounts(p.projectiles),
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
          unseen: shop.unseen === true,
        },
      };
    } catch (e) {
      return base;
    }
  }

  let state = load();

  function save() {
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

  function addCoins(amount) {
    state.coins += amount;
    if (amount > 0) state.lifetimeCoins += amount;
    save();
    notify();
    return state.coins;
  }

  // Returns false (and changes nothing) if the player can't afford it.
  function spendCoins(amount) {
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

  function getProjectileCount(id) {
    return state.projectiles[id] || 0;
  }

  // Adds `n` of a projectile. If the player had none of that kind, the list "expands": the red dot is
  // raised (unless `silent`, used for refunds). Getting more of a kind they already have raises nothing.
  function addProjectiles(id, n, silent) {
    const before = getProjectileCount(id);
    state.projectiles[id] = before + n;
    if (before === 0 && n > 0 && !silent) state.projectilesUnseen = true;
    save();
    projectilesChanged();
  }

  // Uses up one. Returns false (and changes nothing) if there is none.
  function useProjectile(id) {
    const n = getProjectileCount(id);
    if (n <= 0) return false;
    if (n === 1) delete state.projectiles[id];
    else state.projectiles[id] = n - 1;
    save();
    projectilesChanged();
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
    spendCoins,
    getCoins,
    getLifetimeCoins,
    reportStreak,
    getBestStreak,
    getStreak,
    setStreak,
    getProjectileCount,
    addProjectiles,
    useProjectile,
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
