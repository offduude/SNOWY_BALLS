// The leaderboard: sign in with a Google account (Firebase Auth), then the player's CURRENT coin count is kept in one small
// public document - collection "leaderboard", one doc per player, id = their Google account id, fields { name, coins,
// updatedAt }. Nothing else about a save is ever sent anywhere: no projectiles, no buffs, no shop state, nothing private -
// just the number already shown on screen (the coin counter) and the player's Google display name.
//
// FIREBASE_CONFIG below is NOT a secret - Firebase's own docs say this web config is safe to ship in a public site; what
// keeps the data safe is the Firestore security rules (see firestore.rules in the repo root), not hiding this object. It is
// still a placeholder until a real Firebase project exists for this game - see docs/NOTES.md for the setup steps (the
// owner's part) and what this file does once it is filled in.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC9pnWLKw0yADf79MKMyR1JWOaOQetLGh0",
  authDomain: "snowy-balls-5f7a5.firebaseapp.com",
  projectId: "snowy-balls-5f7a5",
  storageBucket: "snowy-balls-5f7a5.firebasestorage.app",
  messagingSenderId: "555349371621",
  appId: "1:555349371621:web:25810d924ee66ea305820c",
};

// WRITE TIMING (the owner's call, 2026-09-22): current coins go up AND down (buying something spends them), so - unlike a
// best-streak record - there is no "only write on a new high" shortcut; the leaderboard just mirrors whatever the local
// coin count is, on this cadence. A sync writes only if the coins actually changed since the last successful write (so
// sitting idle, or in the shop without buying, costs nothing) and never while Economy.isGod() (a god save's coins are not
// a real number - see docs/NOTES.md). SYNC_INTERVAL_MS is the safety-net cadence while the tab stays open and active; the
// tab being backgrounded/closed (visibilitychange, pagehide) also triggers one right away, since that is the reliable
// signal here - not "the tab closing", which mobile browsers do not always report.
const SYNC_INTERVAL_MS = 60 * 1000;
const LEADERBOARD_SIZE = 20; // plenty for a 5-person group with room to grow

const Cloud = (() => {
  let app = null;
  let auth = null;
  let db = null;
  let ready = false; // FIREBASE_CONFIG looks real and the SDK loaded - false leaves every call below a harmless no-op
  let user = null; // { uid, name } | null
  let dirty = false; // coins changed locally since the last successful leaderboard write
  let lastWrittenCoins = null;
  let leaderboardRows = null; // cache of the last fetch: [{ name, coins }], newest first by coins; null = not fetched yet (or signed out)
  let leaderboardLoading = false;
  let signingIn = false; // true for the whole span of an interactive Cloud.signIn() call - tells onAuthStateChanged a fresh
  // sign-in (which drives its own sync below, after the "already has a save" check) apart from a page reload that merely
  // restores an already-signed-in session (which is synced right away too, but never asks that question again)
  let confirmOverwrite = null; // set by saves.js: (existingLeaderboardDoc) => Promise<boolean> - see setConfirmOverwrite
  let authError = null; // the last sign-in failure, as a short readable line - shown in the ACCOUNT section (see saves.js) so it's
  // diagnosable without opening devtools; null once sign-in succeeds, restores a session, or the player just closed the popup themselves
  const authListeners = [];

  function isConfigured() {
    return Object.values(FIREBASE_CONFIG).every((v) => typeof v === "string" && v && !v.includes("REPLACE_ME"));
  }

  function onAuthChange(fn) {
    authListeners.push(fn);
    fn(user);
  }
  function notifyAuth() {
    authListeners.forEach((fn) => fn(user));
  }

  function init() {
    if (!isConfigured() || typeof firebase === "undefined") return; // no Firebase project set up yet, or its scripts didn't load - the game must not depend on either
    try {
      app = firebase.initializeApp(FIREBASE_CONFIG);
      auth = firebase.auth();
      db = firebase.firestore();
      ready = true;
    } catch (e) {
      return; // a bad config, or the SDK failed some other way: the game carries on without the leaderboard
    }
    auth.onAuthStateChanged((u) => {
      user = u ? { uid: u.uid, name: u.displayName || "Player" } : null;
      if (user) authError = null; // any stale failure from an earlier attempt is done being relevant once we're actually signed in
      notifyAuth();
      if (user && !signingIn) {
        // A restored session (the page was reloaded while already signed in) - not a fresh interactive sign-in, which drives
        // its own sync explicitly below (after the "already has a save" check). Still worth syncing promptly rather than
        // waiting for the next scheduled trigger, and never needs to ask the overwrite question again.
        dirty = true;
        lastWrittenCoins = null;
        syncNow();
      }
    });
    if (typeof Economy !== "undefined") {
      Economy.onCoinsChange(() => {
        dirty = true;
      });
    }
    setInterval(syncNow, SYNC_INTERVAL_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) syncNow();
    });
    window.addEventListener("pagehide", syncNow);
  }

  function getAuthError() {
    return authError;
  }

  // Error codes that are not real failures worth showing the player: they closed the popup themselves, or a second sign-in
  // attempt cancelled an earlier one (only possible if `signingIn` somehow didn't already stop it - kept as a backstop).
  const BENIGN_AUTH_ERRORS = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request"]);

  function setConfirmOverwrite(fn) {
    confirmOverwrite = fn;
  }

  function signIn() {
    if (!ready || signingIn) return; // already mid-attempt: a second click must not fire a second popup (that is what produced auth/cancelled-popup-request)
    signingIn = true;
    authError = null;
    notifyAuth(); // clears any old error line immediately, before the new attempt resolves
    auth
      .signInWithPopup(new firebase.auth.GoogleAuthProvider())
      .then(async (result) => {
        // This account may already have a save on the leaderboard (another device, or an earlier test) - signing in here
        // never downloads it, it only starts overwriting it with THIS device's numbers, so ask first. Only for a FRESH
        // interactive sign-in (this function), never for onAuthStateChanged restoring an existing session on page load.
        let existing = null;
        try {
          const doc = await db.collection("leaderboard").doc(result.user.uid).get();
          if (doc.exists) existing = doc.data();
        } catch (e) {
          /* couldn't check (offline, or not readable) - proceed rather than block sign-in over a read failure */
        }
        if (existing && confirmOverwrite) {
          const proceed = await confirmOverwrite(existing);
          if (!proceed) {
            await auth.signOut();
            return;
          }
        }
        dirty = true; // a fresh sign-in should show up right away, not wait for the next coin change
        lastWrittenCoins = null;
        syncNow();
      })
      .catch((e) => {
        if (e && BENIGN_AUTH_ERRORS.has(e.code)) return;
        console.error("Cloud.signIn failed:", e);
        authError = (e && e.code) || (e && e.message) || "sign-in failed";
        notifyAuth();
      })
      .finally(() => {
        signingIn = false;
      });
  }

  function signOut() {
    if (!ready) return;
    auth.signOut();
  }

  function getUser() {
    return user;
  }

  // Writes the leaderboard doc if signed in, not in god mode, and the coins actually changed since the last successful
  // write. Called on the timer and on the two "the player is leaving" signals above - never on every single coin change.
  function syncNow() {
    if (!ready || !user || !dirty) return;
    if (typeof Economy !== "undefined" && Economy.isGod()) return; // a god save's coins are not real - never published
    const coins = typeof Economy !== "undefined" ? Economy.getCoins() : 0;
    if (coins === lastWrittenCoins) {
      dirty = false;
      return;
    }
    db.collection("leaderboard")
      .doc(user.uid)
      .set({ name: user.name, coins, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
      .then(() => {
        lastWrittenCoins = coins;
        dirty = false;
      })
      .catch(() => {
        /* offline, or the write was refused (see firestore.rules) - dirty stays true, the next trigger tries again */
      });
  }

  // The last-fetched rows, read-only, no network call: what the OPTIONS list actually renders every time it draws
  // (opening it, dragging the volume slider, anything) - so redrawing never itself triggers another read.
  function getLeaderboardCache() {
    return leaderboardRows; // null = never fetched yet (or signed out / not configured)
  }

  // Read-on-open, not a live listener (see docs/NOTES.md: cheap and predictable rather than real-time). Call this once when
  // the player actually OPENS the leaderboard - never from inside the render itself, or every redraw would trigger another
  // read. `onUpdated` fires once, only when a fresh read lands (not for an already-in-flight one this call reuses).
  function refreshLeaderboard(onUpdated) {
    if (!ready || leaderboardLoading) return;
    leaderboardLoading = true;
    db.collection("leaderboard")
      .orderBy("coins", "desc")
      .limit(LEADERBOARD_SIZE)
      .get()
      .then((snap) => {
        leaderboardRows = snap.docs.map((d) => ({ name: d.data().name, coins: d.data().coins }));
        leaderboardLoading = false;
        if (onUpdated) onUpdated();
      })
      .catch(() => {
        leaderboardLoading = false; // offline, or not configured yet: whatever was cached (maybe nothing) is all there is
      });
  }

  return { init, isConfigured, onAuthChange, signIn, signOut, getUser, getAuthError, setConfirmOverwrite, getLeaderboardCache, refreshLeaderboard };
})();
