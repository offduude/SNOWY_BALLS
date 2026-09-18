// Persistent wallet + streak record, backed by localStorage.
const Economy = (() => {
  const KEY = "snowyBallsSave";

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { coins: 0, bestStreak: 0, unlockedCharacters: ["default"] };
      const parsed = JSON.parse(raw);
      return {
        coins: parsed.coins || 0,
        bestStreak: parsed.bestStreak || 0,
        unlockedCharacters: parsed.unlockedCharacters || ["default"],
      };
    } catch (e) {
      return { coins: 0, bestStreak: 0, unlockedCharacters: ["default"] };
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

  function addCoins(amount) {
    state.coins += amount;
    save();
    return state.coins;
  }

  function getCoins() {
    return state.coins;
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

  return { addCoins, getCoins, reportStreak, getBestStreak };
})();
