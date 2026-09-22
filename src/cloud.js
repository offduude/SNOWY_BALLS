// The account system: sign in with Google (Firebase Auth), and this device's save is linked to that account from then on.
//
// Two collections. "leaderboard/{uid}" is PUBLIC to read (anyone can see the standings) - just { name, coins, character,
// updatedAt }, enough to show a card and rank people; a player may only ever write their own. "saves/{uid}" is PRIVATE (only
// that uid can read or write it) - { data: <the whole save, JSON>, updatedAt, session } - the actual cloud save, plus a
// SESSION TOKEN (2026-09-22) that stops the same account being played on two devices at once from clobbering each other:
// whichever device most recently claimed the account (a fresh sign-in) owns the current token; every other device notices
// the mismatch on its own next check (see checkSession) and signs itself out rather than keep writing over a save it's no
// longer the source of truth for. Detection is bounded by SYNC_INTERVAL_MS, not instant - a genuinely simultaneous couple
// of seconds on two devices could still race, but sustained double-play cannot.
//
// THE DIRECTION (the owner's call, 2026-09-22, like a normal mobile game's account link - Clash Royale is the example
// given): signing in is not a backup that quietly starts mirroring outward. If the Google account you sign into already has
// a save, that save IS the account's save - signing in DOWNLOADS it and REPLACES whatever is on this device (a warning
// names the existing save and asks first; declining signs back out, nothing is touched). If the account has never been
// used before, there is nothing to download: THIS device's current save becomes its save instead (no warning needed -
// nothing is lost). From then on this device keeps pushing its local changes up on the sync cadence below; nothing is ever
// pulled down again until a FRESH interactive sign-in happens (a page reload that merely restores an already-signed-in
// session never re-asks or re-downloads - see signIn() vs the plain onAuthStateChanged restore path).
//
// FIREBASE_CONFIG below is NOT a secret - Firebase's own docs say this web config is safe to ship in a public site; what
// keeps the data safe is the Firestore security rules (see firestore.rules in the repo root), not hiding this object.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC9pnWLKw0yADf79MKMyR1JWOaOQetLGh0",
  authDomain: "snowy-balls-5f7a5.firebaseapp.com",
  projectId: "snowy-balls-5f7a5",
  storageBucket: "snowy-balls-5f7a5.firebasestorage.app",
  messagingSenderId: "555349371621",
  appId: "1:555349371621:web:25810d924ee66ea305820c",
};

// WRITE TIMING: a sync pushes the leaderboard card AND the full save together (one batched write - two documents, one round
// trip) only if something actually changed since the last successful write, and never while Economy.isGod() (see
// window.godMode in main.js - and note signIn()/godMode() each refuse to run while the other's state is active, so a god
// save can never become, or overwrite, a real signed-in save). SYNC_INTERVAL_MS is the safety-net cadence while the tab
// stays open and active; the tab being backgrounded/closed (visibilitychange, pagehide) also triggers one right away, since
// that is the reliable signal here - not "the tab closing", which mobile browsers do not always report.
const SYNC_INTERVAL_MS = 30 * 1000;
const LEADERBOARD_SIZE = 20; // plenty for a 5-person group with room to grow
const SAVES_COLLECTION = "saves";
const SESSION_KEY = "snowyBallsSession"; // this device's own remembered { uid, token } - separate from Economy's save data (see resetLocalSave/claimSession)
const SESSION_ACTIVE_WINDOW_MS = SYNC_INTERVAL_MS * 3; // how recently saves/{uid} must have been touched to count as "someone is actively playing on it right now" (see signIn())

const Cloud = (() => {
  let app = null;
  let auth = null;
  let db = null;
  let ready = false; // FIREBASE_CONFIG looks real and the SDK loaded - false leaves every call below a harmless no-op
  let user = null; // { uid, name } | null
  let revealUser = true; // false only while a fresh interactive signIn() is still deciding upload vs download - see
  // getUser()/notifyAuth() below: while false, the account looks signed OUT everywhere, even though Firebase itself
  // already completed the popup sign-in, so nothing (the ACCOUNT card, the mutual god-mode guard, anything else reading
  // Cloud.getUser()) can show "signed in" before the overwrite question has actually been answered.
  let dirty = false; // something worth syncing changed locally since the last successful write
  let lastWrittenCoins = null;
  let lastWrittenCharacter = null;
  let lastWrittenSave = null; // the exact JSON string last written to saves/{uid} - cheap way to skip a no-op write
  let leaderboardRows = null; // cache of the last fetch: [{ name, coins }], newest first by coins; null = not fetched yet (or signed out)
  let leaderboardLoading = false;
  let signingIn = false; // true for the whole span of an interactive Cloud.signIn() call - tells onAuthStateChanged a fresh
  // sign-in (which drives its own sync below, after the download-or-link decision) apart from a page reload that merely
  // restores an already-signed-in session (which is synced right away too, but never asks anything or downloads anything)
  let mySession = null; // { uid, token } | null - this device's own claim on the currently signed-in account (see checkSession)
  let confirmOverwrite = null; // set by saves.js: (existingSave) => Promise<boolean> - see setConfirmOverwrite
  let authError = null; // the last sign-in failure, as a short readable line - shown in the ACCOUNT section (see saves.js) so it's
  // diagnosable without opening devtools; null once sign-in succeeds, restores a session, or the player just closed the popup themselves
  const authListeners = [];

  function isConfigured() {
    return Object.values(FIREBASE_CONFIG).every((v) => typeof v === "string" && v && !v.includes("REPLACE_ME"));
  }

  function visibleUser() {
    return revealUser ? user : null;
  }

  function onAuthChange(fn) {
    authListeners.push(fn);
    fn(visibleUser());
  }
  function notifyAuth() {
    authListeners.forEach((fn) => fn(visibleUser()));
  }

  function init() {
    if (!isConfigured() || typeof firebase === "undefined") return; // no Firebase project set up yet, or its scripts didn't load - the game must not depend on either
    try {
      app = firebase.initializeApp(FIREBASE_CONFIG);
      auth = firebase.auth();
      db = firebase.firestore();
      ready = true;
    } catch (e) {
      return; // a bad config, or the SDK failed some other way: the game carries on without the account system
    }
    mySession = loadMySession();
    // The real bug this fixes: without this, `dirty` was only ever set right after a sign-in or a name/description
    // edit - ordinary play (coins, shop purchases, buffs, equipping something) never marked the save dirty, so the
    // periodic sync below had nothing to do almost all the time. Economy.onSave fires after EVERY local save, so this
    // is the one place that can't miss a kind of change.
    if (typeof Economy !== "undefined" && Economy.onSave) Economy.onSave(() => { dirty = true; });
    auth.onAuthStateChanged((u) => {
      const wasSignedIn = !!user;
      // The Google display name has no length limit of its own (unlike a custom account name - see Economy.accountNameMax)
      // - truncated here, once, at the source, so it can never stick out of the card or the leaderboard's name column.
      const nameMax = (typeof Economy !== "undefined" && Economy.accountNameMax) || 16;
      user = u ? { uid: u.uid, name: (u.displayName || "Player").slice(0, nameMax) } : null;
      if (user) authError = null; // any stale failure from an earlier attempt is done being relevant once we're actually signed in
      if (wasSignedIn && !user) {
        // Signed out for ANY reason - the SIGN OUT button (which already resets this itself, see signOut()), a revoked
        // or expired session, another tab signing out, the browser clearing site data, Firebase simply failing to
        // restore the session on this load - not just the button. This device's local save must never keep carrying
        // that account's progress once its auth session is gone: the next sign-in (this account or a different one)
        // must not upload/duplicate it. Reloading keeps the running game (Economy's in-memory state) from carrying on
        // with numbers that no longer match what was just written to localStorage.
        resetLocalSave();
        location.reload();
        return;
      }
      notifyAuth();
      if (user && !signingIn) {
        // A restored session (the page was reloaded while already signed in) - not a fresh interactive sign-in, which
        // drives its own sync explicitly below (after the download-or-link decision). Still worth syncing promptly
        // rather than waiting for the next scheduled trigger; never downloads anything or asks the linking question again.
        dirty = true;
        lastWrittenCoins = null;
        lastWrittenCharacter = null;
        lastWrittenSave = null;
        syncNow();
      }
    });
    // checkSession first, syncNow only if it didn't just start signing this device out - a displaced device must not
    // also push a write in the same tick it discovers it's no longer the account's active session.
    const heartbeat = () => checkSession().then((displaced) => { if (!displaced) syncNow(); });
    setInterval(heartbeat, SYNC_INTERVAL_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) syncNow();
      else heartbeat(); // returning to the tab: don't wait up to a minute to notice another device took over while it was away
    });
    window.addEventListener("pagehide", syncNow);
    // Fetch the standings once right away, not only the first time the LEADERBOARD screen is opened - otherwise the
    // account card's own rank-tier background stays "unranked" for a whole session until that screen gets visited.
    // The leaderboard is public to read, so this needs no signed-in user; Saves.refresh() is a safe no-op if nothing
    // that shows a rank (OPTIONS/LEADERBOARD) has rendered yet.
    refreshLeaderboard(() => {
      if (typeof Saves !== "undefined") Saves.refresh();
    });
  }

  function getAuthError() {
    return authError;
  }

  // Error codes that are not real failures worth showing the player: they closed the popup themselves, or a second sign-in
  // attempt cancelled an earlier one (only possible if `signingIn` somehow didn't already stop it - kept as a backstop).
  const BENIGN_AUTH_ERRORS = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request"]);

  // Resets THIS DEVICE's local save to a brand-new game - never the account itself (the cloud save under a uid is
  // untouched). Used whenever an auth session ends (see onAuthStateChanged above and signOut() below) so a save can
  // never ride along to a different account: without this, signing out with real progress and signing into a
  // different (or brand-new) account would upload/duplicate that progress there too. Deliberately does NOT clear
  // mySession (see below) - this device still needs to remember the last token it held for this account so a quick
  // sign-out/sign-back-in on the SAME device isn't mistaken, by signIn()'s "someone else is actively playing this
  // right now" guard, for a different device trying to hijack an active session.
  function resetLocalSave() {
    if (typeof Economy === "undefined") return;
    Economy.lockSaves(); // nothing may write the old save back over this in the moment before the reload
    try {
      localStorage.setItem(Economy.storageKey, Economy.freshJson());
    } catch (e) {
      /* storage unavailable - the reload will just keep whatever was there, no harm done */
    }
  }

  // ---- session tokens: which device is the current, active owner of a signed-in account (see the file header) ----
  function loadMySession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed.uid === "string" && typeof parsed.token === "string" ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function saveMySession(uid, token) {
    mySession = { uid, token };
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(mySession));
    } catch (e) {
      /* storage unavailable - this device just can't reliably detect being displaced; sync itself still works */
    }
  }

  function newSessionToken() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`; // any browser old enough to lack randomUUID
  }

  // Claiming happens by simply writing a new token into the next real save (see syncNow) - reading it back and
  // finding it changed is how every OTHER device notices it has been displaced. Called on the timer/visibility cadence
  // (not only when dirty - a device with nothing new to sync still needs to notice it's been kicked). Returns a
  // promise resolving to true if this device was displaced (and has already started signing itself out).
  function checkSession() {
    if (!ready || !user || !mySession || mySession.uid !== user.uid) return Promise.resolve(false);
    return db
      .collection(SAVES_COLLECTION)
      .doc(user.uid)
      .get()
      .then((doc) => {
        const remoteSession = doc.exists ? doc.data().session : null;
        if (remoteSession && remoteSession !== mySession.token) {
          // A different device signed into this account more recently and is now its active session - this device
          // must stop syncing (it would just fight over the save) rather than silently keep overwriting the newer
          // one. Signing out routes through the usual onAuthStateChanged cleanup (resetLocalSave + reload).
          console.warn("Cloud: this account is signed in on another device now - signing out here.");
          auth.signOut();
          return true;
        }
        return false;
      })
      .catch(() => false); // offline, or a transient read failure - try again next cycle rather than treat it as a real displacement
  }

  function setConfirmOverwrite(fn) {
    confirmOverwrite = fn;
  }

  function signIn() {
    if (!ready || signingIn) return; // already mid-attempt: a second click must not fire a second popup (that is what produced auth/cancelled-popup-request)
    if (typeof Economy !== "undefined" && Economy.isGod()) {
      // The other half of the godMode()/signIn() mutual guard (see main.js): a god save's numbers must never reach a real
      // account, in either direction - refused here just as plainly as godMode() refuses while signed in.
      authError = "sign out of the test (god mode) save first";
      notifyAuth();
      return;
    }
    signingIn = true;
    revealUser = false; // hidden until we know this is either a fresh account (nothing to ask) or the overwrite question has been answered
    authError = null;
    notifyAuth(); // clears any old error line immediately, before the new attempt resolves
    auth
      .signInWithPopup(new firebase.auth.GoogleAuthProvider())
      .then(async (result) => {
        const uid = result.user.uid;
        let cloudSave = null;
        let checkFailed = false;
        try {
          const doc = await db.collection(SAVES_COLLECTION).doc(uid).get();
          if (doc.exists) cloudSave = doc.data();
        } catch (e) {
          checkFailed = true; // offline, or the rules aren't published yet - see below: this must NOT be treated as "no save"
        }
        if (checkFailed) {
          // Not knowing whether this account has a save is NOT the same as it having none - guessing "none" here is
          // exactly how a real cloud save gets silently overwritten by whatever's on this device instead of downloaded
          // (this bit a real sign-in: a fresh account read back 36 coins, the player played a bit signed OUT - device-only,
          // never synced - then signed back in and the account showed 40, because the existence check failed and the code
          // used to fall through to "first time, upload this device's save" instead of refusing). Abort and sign back out;
          // signing in again retries the check rather than guessing.
          authError = "couldn't check this account for an existing save - try again";
          notifyAuth();
          await auth.signOut();
          return;
        }
        if (cloudSave) {
          // CRITICAL: the CURRENTLY ACTIVE session must win, never a fresh sign-in elsewhere - otherwise a player could
          // sign into a second device mid-session to hijack/reset the first one, then sign back in there to download
          // the last-synced (pre-hijack) save: re-attempting a hard shot or a shop reroll by discarding whatever
          // hadn't synced yet on the original device. Only refuse when it's genuinely a DIFFERENT device: this same
          // device reconnecting to an account it already held the session for (mySession still remembers that exact
          // token - sign-out no longer clears it, see resetLocalSave) is always allowed through immediately.
          const sameDevice = mySession && mySession.uid === uid && cloudSave.session && mySession.token === cloudSave.session;
          if (!sameDevice && cloudSave.session) {
            const updatedMs = cloudSave.updatedAt && cloudSave.updatedAt.toMillis ? cloudSave.updatedAt.toMillis() : 0;
            if (Date.now() - updatedMs < SESSION_ACTIVE_WINDOW_MS) {
              authError = "this account is being played on another device right now - try again in a few minutes";
              notifyAuth();
              await auth.signOut();
              return;
            }
          }
          const proceed = confirmOverwrite ? await confirmOverwrite(cloudSave) : true;
          if (!proceed) {
            await auth.signOut();
            return;
          }
          // DOWNLOAD: this account's save replaces whatever is on this device. Validated the same way an imported save
          // code used to be (Economy.sanitize) so a corrupted cloud document can't brick the next load.
          let clean = null;
          try {
            clean = Economy.sanitize(JSON.parse(cloudSave.data));
          } catch (e) {
            /* not valid JSON at all */
          }
          if (!clean) {
            authError = "the save on this account could not be read - nothing was changed";
            notifyAuth();
            await auth.signOut();
            return;
          }
          Economy.lockSaves(); // nothing may write the old save back over this in the moment before the reload
          try {
            localStorage.setItem(Economy.storageKey, JSON.stringify(clean));
          } catch (e) {
            /* storage unavailable - the reload will just keep the local save as it was, no harm done */
          }
          // Claim the session for THIS device, displacing whatever device (if any) held it before - taking over the
          // account via a fresh sign-in is exactly the moment that should happen. The restored-session sync that runs
          // right after reload pushes this token to saves/{uid} along with the rest, so no separate write is needed here.
          saveMySession(uid, newSessionToken());
          location.reload();
          return;
        }
        // First time this account has been used: nothing to download, nothing to ask - safe to reveal immediately. THIS
        // device's current save becomes its save.
        revealUser = true;
        notifyAuth();
        dirty = true;
        lastWrittenCoins = null;
        lastWrittenCharacter = null;
        lastWrittenSave = null;
        // Refresh the leaderboard only AFTER the write actually lands (syncNow now resolves once its commit settles) -
        // otherwise the read can beat the write and the account card keeps showing "unranked" until the next time
        // LEADERBOARD happens to be opened, even though this player is on the board now.
        syncNow().then(() => refreshLeaderboard(() => { if (typeof Saves !== "undefined") Saves.refresh(); }));
      })
      .catch((e) => {
        if (e && BENIGN_AUTH_ERRORS.has(e.code)) return;
        console.error("Cloud.signIn failed:", e);
        authError = (e && e.code) || (e && e.message) || "sign-in failed";
        notifyAuth();
      })
      .finally(() => {
        signingIn = false;
        // Safety net: whatever path was taken above already revealed (or left null) the right thing - this just makes
        // sure a future normal auth event can never stay stuck hidden because of some path here that didn't.
        if (!revealUser) {
          revealUser = true;
          notifyAuth();
        }
      });
  }

  function signOut() {
    if (!ready) return;
    // Flush first (a real bug: a name/description edit, or the last few seconds of coins, made right before clicking
    // SIGN OUT could still be `dirty` and not yet synced - resetLocalSave() would silently wipe it before it ever
    // reached the account). Only the explicit button does this: a PASSIVE sign-out (checkSession() finding this
    // device has been displaced by another one, or any other cause routed through onAuthStateChanged below) must NOT
    // flush - that would overwrite whatever the account's current, more-authoritative source of truth already has.
    syncNow().finally(() => {
      resetLocalSave();
      auth.signOut().finally(() => location.reload());
    });
  }

  function getUser() {
    return visibleUser();
  }

  // Something worth syncing changed that Economy has no change-listener for (the account description - see saves.js's
  // edit dialog). Just flips the same flag a coin change would; the next trigger (timer / backgrounding) picks it up.
  function markDirty() {
    dirty = true;
  }

  // A shop purchase is worth syncing sooner than the normal cadence - it's real coins spent and a real item gained,
  // exactly the kind of thing worth protecting against a lost/crashed tab. Debounced: several purchases in quick
  // succession (buying out a slot, then another) only schedule ONE sync, 5s after the LATEST one, not one per purchase.
  let purchaseFlushTimer = null;
  function notePurchase() {
    dirty = true; // onSave already does this (Economy.spendCoins/addProjectiles/etc. all save()), but cheap to be explicit
    clearTimeout(purchaseFlushTimer);
    purchaseFlushTimer = setTimeout(() => {
      purchaseFlushTimer = null;
      syncNow();
    }, 5000);
  }

  // Pushes the leaderboard card AND the full save together (one batched write) if signed in, not in god mode, and
  // something actually changed since the last successful write. Called on the timer and on the two "the player is
  // leaving" signals above - never on every single coin/character change. Returns a promise that resolves once the
  // write (or the decision to skip it) has settled - signIn()'s first-time-upload path waits on this before refreshing
  // the leaderboard, so it doesn't read before its own write has landed.
  function syncNow() {
    if (!ready || !user || !dirty) return Promise.resolve();
    if (typeof Economy !== "undefined" && Economy.isGod()) return Promise.resolve(); // a god save is never published, in either collection
    // Claim a session for this account if this device doesn't already have one - the normal case right after a
    // first-time sign-in (see signIn()); the download path claims its own token earlier, before the reload that leads
    // here (see signIn()'s DOWNLOAD branch) - either way, syncNow() is what actually gets it onto saves/{uid}.
    if (!mySession || mySession.uid !== user.uid) saveMySession(user.uid, newSessionToken());
    const coins = typeof Economy !== "undefined" ? Economy.getCoins() : 0;
    const character = typeof Economy !== "undefined" ? Economy.getEquipped("character") : null;
    const saveJson = typeof Economy !== "undefined" ? Economy.snapshot() : null;
    if (coins === lastWrittenCoins && character === lastWrittenCharacter && saveJson === lastWrittenSave) {
      dirty = false;
      return Promise.resolve();
    }
    const description = typeof Economy !== "undefined" ? Economy.getAccountDescription() : "";
    // A custom name (set via CHANGE NAME) overrides the Google account name everywhere the leaderboard shows it; "" means
    // it was never set, so the Google name is still what publishes.
    const name = (typeof Economy !== "undefined" && Economy.getAccountName()) || user.name;
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(db.collection("leaderboard").doc(user.uid), { name, coins, character, description, updatedAt: now });
    if (saveJson !== null) batch.set(db.collection(SAVES_COLLECTION).doc(user.uid), { data: saveJson, updatedAt: now, session: mySession.token });
    return batch
      .commit()
      .then(() => {
        lastWrittenCoins = coins;
        lastWrittenCharacter = character;
        lastWrittenSave = saveJson;
        dirty = false;
      })
      .catch(() => {
        /* offline, or the write was refused (see firestore.rules) - dirty stays true, the next trigger tries again */
      });
  }

  // The last-fetched rows, read-only, no network call: what the leaderboard list actually renders every time it draws -
  // so redrawing never itself triggers another read (see collection.js open("leaderboard"), the only thing that does).
  function getLeaderboardCache() {
    return leaderboardRows; // null = never fetched yet (or signed out / not configured)
  }

  // Read-on-open, not a live listener (cheap and predictable rather than real-time). Call this once when the player
  // actually OPENS the leaderboard. `onUpdated` fires once, only when a fresh read lands (not for an already-in-flight
  // one this call reuses).
  function refreshLeaderboard(onUpdated) {
    if (!ready || leaderboardLoading) return;
    leaderboardLoading = true;
    db.collection("leaderboard")
      .orderBy("coins", "desc")
      .limit(LEADERBOARD_SIZE)
      .get()
      .then((snap) => {
        leaderboardRows = snap.docs.map((d) => ({ uid: d.id, name: d.data().name, coins: d.data().coins, character: d.data().character || null, description: d.data().description || "" }));
        leaderboardLoading = false;
        if (onUpdated) onUpdated();
      })
      .catch(() => {
        leaderboardLoading = false; // offline, or not configured yet: whatever was cached (maybe nothing) is all there is
      });
  }

  return {
    init,
    isConfigured,
    onAuthChange,
    signIn,
    signOut,
    getUser,
    markDirty,
    notePurchase,
    getAuthError,
    setConfirmOverwrite,
    getLeaderboardCache,
    refreshLeaderboard,
    checkSession, // exposed mainly for testing - the timer/visibility cadence already calls this itself
  };
})();
