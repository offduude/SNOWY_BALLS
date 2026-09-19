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
      unlockedCharacters: ["default"],
      equipped: { character: "default", projectile: "snowball" }, // what the player currently uses
      shop: {
        stock: null, // array of item ids currently on sale, one per slot; null = not generated yet
        owned: [], // ids of permanent items bought
        consumables: {}, // id -> how many bought and not yet used
        restock: [], // per slot: null, or { at: ms timestamp (device clock) the slot restocks, prev: id sold there }
        unseen: false, // a slot restocked while the shop was closed and the player has not looked yet (SHOP button dot)
      },
    };
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
        unlockedCharacters: p.unlockedCharacters || base.unlockedCharacters,
        equipped: { ...base.equipped, ...(p.equipped && typeof p.equipped === "object" ? p.equipped : {}) },
        shop: {
          stock: Array.isArray(shop.stock) ? shop.stock : null,
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
    getEquipped,
    setEquipped,
    getShopState,
    saveShop,
  };
})();
