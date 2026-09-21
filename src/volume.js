// The game's master volume: a slider in the OPTIONS list (the VOLUME section). It is a setting of the DEVICE, not of a save, so it is kept in its
// own localStorage key and is the same whichever save is loaded, and when the app is opened again. 0 (silent) .. 1 (full); the game has always run
// at 0.5, so that is the default.
const Volume = (() => {
  const KEY = "snowyBallsVolume";
  const DEFAULT = 0.5;

  function get() {
    try {
      const v = parseFloat(localStorage.getItem(KEY));
      if (v >= 0 && v <= 1) return v;
    } catch (e) {
      /* no storage: the default */
    }
    return DEFAULT;
  }

  // Sets and remembers the volume (and applies it to the game at once, if it is up: MainScene also applies it when it starts).
  function set(v) {
    const x = Math.min(1, Math.max(0, Number(v) || 0));
    try {
      localStorage.setItem(KEY, String(x));
    } catch (e) {
      /* it just won't be remembered */
    }
    const game = window.snowyBallsGame;
    if (game) game.sound.volume = x;
    return x;
  }

  return { get, set };
})();
