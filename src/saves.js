// OPTIONS list: ACCOUNT (sign in with Google - src/cloud.js) and VOLUME.
// The LEADERBOARD is its own top-level screen now (its own button under the ammo counter - see collection.js
// open("leaderboard") and index.html #leaderboard-btn), not part of OPTIONS.
//
// There used to be a SAVES section here (multiple named slots, export/import as a copy-paste code, a "god mode" import
// code) - removed 2026-09-22 (see docs/NOTES.md "The leaderboard"): there is only ever ONE save now (Economy's own
// localStorage entry), and it cannot be reset, deleted or renamed from the UI. What used to be the "god mode" import code
// is now a console-only dev tool, window.godMode() on localhost (see main.js) - the SAVES section was its only in-game
// door, so it needed a replacement.
const Saves = (() => {
  // ---------- popups (Cloud's "sign-in will replace your save" confirm - see wireCloudConfirm below) ----------
  let layer = null;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function closeModal() {
    if (layer) layer.remove();
    layer = null;
  }

  // buttons: [{ label, cls, onClick }]; onClick returns false to keep the popup open. Returns the panel element.
  function openModal(title, bodyHtml, buttons) {
    closeModal();
    layer = document.createElement("div");
    layer.id = "modal-layer";
    layer.innerHTML =
      `<div class="modal-panel"><div class="modal-title">${esc(title)}</div>${bodyHtml}` +
      `<div class="modal-buttons">${buttons.map((b, k) => `<button type="button" class="modal-btn ${b.cls || ""}" data-k="${k}">${esc(b.label)}</button>`).join("")}</div></div>`;
    // taps on the popup must not reach the game underneath
    ["touchstart", "touchend", "mousedown", "mouseup", "pointerdown", "pointerup", "click"].forEach((ev) => layer.addEventListener(ev, (e) => e.stopPropagation()));
    layer.addEventListener("click", (e) => {
      if (e.target === layer) return closeModal(); // the dimmed area around it: cancel
      const btn = e.target.closest(".modal-btn");
      if (!btn) return;
      if (typeof playUiClick === "function") playUiClick();
      const b = buttons[Number(btn.dataset.k)];
      const keep = b.onClick ? b.onClick(layer) : undefined;
      if (keep !== false) closeModal();
    });
    document.getElementById("game-container").appendChild(layer);
    return layer;
  }

  // Same shortening as the live coin counter (index.html): 1,234,000 -> "1M", so a big total never gets unreadable.
  function formatBoardCoins(n) {
    if (n >= 1e9) return Math.floor(n / 1e9) + "B";
    if (n >= 1e6) return Math.floor(n / 1e6) + "M";
    return String(n);
  }

  // ---------- ACCOUNT: an item card (picture, name, description, an action where EQUIP would be) - no rarity, no amount,
  // it isn't that kind of item. The PICTURE is the equipped CHARACTER's face (Collection.characterInfo) - "myself" is
  // currently represented by which character is picked, and that rides along on the normal sync cadence (the `character`
  // field on leaderboard/{uid}). The DESCRIPTION is a completely separate thing: the player's OWN short bio
  // (Economy.getAccountDescription - plain text, sanitized, capped - see economy.js), never the character's built-in
  // description. CHANGE (below the card) edits that bio, via showEditDescription - it does NOT open CHARACTERS (that
  // would need the SKINS menu, unrelated to this card). The card's BACKGROUND reflects the player's current LEADERBOARD
  // PLACE (boardTierClass, same rule as a leaderboard card) - for my own card that means whatever the last leaderboard
  // read (if any) said my rank was; unknown (never opened the leaderboard yet this session) reads as the plain look. ----
  function accountCardHtml(name, characterId, description, actionHtml, tierClass) {
    const charInfo = (typeof Collection !== "undefined" && Collection.characterInfo(characterId)) || { image: "" };
    const desc = description && description.trim() ? description : "No description yet.";
    return (
      `<div class="pick-row buff-row account-card${tierClass || ""}">` +
      `<img class="pick-pic" src="${esc(charInfo.image || "")}" alt="" draggable="false" />` +
      `<div class="pick-text"><div class="pick-name">${esc(name)}</div><div class="pick-desc">${esc(desc)}</div></div>` +
      `<div class="pick-action">${actionHtml}</div>` +
      `</div>`
    );
  }

  // My own current rank, if it happens to be known (only ever set by actually opening the LEADERBOARD screen this
  // session - this never triggers a read of its own, see docs/NOTES.md "read-on-open, not a live listener"). null if
  // unknown (never opened it yet, or signed out) - the card just uses the plain background in that case.
  function myRank() {
    const user = typeof Cloud !== "undefined" && Cloud.getUser();
    const rows = user && Cloud.getLeaderboardCache();
    if (!rows) return null;
    const i = rows.findIndex((r) => r.uid === user.uid);
    return i < 0 ? null : i + 1;
  }

  function accountSectionHtml() {
    if (typeof Cloud === "undefined" || !Cloud.isConfigured()) return ""; // no Firebase project set up yet: no dead button
    const user = Cloud.getUser();
    const myCharacter = typeof Economy !== "undefined" ? Economy.getEquipped("character") : null;
    const myDescription = typeof Economy !== "undefined" ? Economy.getAccountDescription() : "";
    const action = user
      ? `<button type="button" class="save-icon-btn" data-act="signout">SIGN OUT</button>`
      : `<button type="button" class="save-icon-btn" data-act="signin">SIGN IN</button>`;
    const card = accountCardHtml(user ? user.name : "Not signed in", myCharacter, myDescription, action, boardTierClass(myRank()));
    const hint = !user ? `<div class="account-hint">Signing in links this save to a Google account and joins the leaderboard.</div>` : "";
    const error = Cloud.getAuthError();
    const errorLine = error ? `<div class="account-error">${user ? "" : "Sign-in failed: "}${esc(error)}</div>` : "";
    const changeBtn = `<button type="button" class="save-icon-btn" data-act="editdesc">CHANGE</button>`;
    return `<div class="opt-section"><div class="opt-head">ACCOUNT</div>${card}${hint}${errorLine}${changeBtn}</div>`;
  }

  // The CHANGE button: edit the account's own bio line. Sanitized and capped the same way on save as everywhere else
  // (Economy.setAccountDescription does its own cleaning too - this is just for the live counter/preview here).
  function showEditDescription() {
    const current = typeof Economy !== "undefined" ? Economy.getAccountDescription() : "";
    const max = 60;
    const panel = openModal(
      "ACCOUNT DESCRIPTION",
      `<div class="modal-text">A short line other players see on your account card. Plain text only.</div>` +
        `<input class="modal-input" maxlength="${max}" value="${esc(current)}" spellcheck="false" />` +
        `<div class="modal-status"></div>`,
      [
        {
          label: "SAVE",
          onClick: (el) => {
            Economy.setAccountDescription(el.querySelector("input").value);
            if (typeof Cloud !== "undefined") Cloud.markDirty(); // picked up by the normal sync cadence, not sent instantly
            refresh();
          },
        },
        { label: "CANCEL", cls: "ghost" },
      ]
    );
    const input = panel.querySelector("input");
    const status = panel.querySelector(".modal-status");
    const show = () => {
      status.textContent = `${input.value.length}/${max}`;
    };
    show();
    input.addEventListener("input", show);
  }

  // ---------- the OPTIONS list (ACCOUNT, VOLUME) ----------
  let listEl = null; // the OPTIONS list's scroll area (set by renderOptions)

  function renderOptions(el) {
    listEl = el;
    el.innerHTML =
      accountSectionHtml() +
      `<div class="opt-section"><div class="opt-head">VOLUME</div><div class="vol-row" data-vol="master"><input class="vol-slider" type="range" min="0" max="100" step="1" aria-label="Volume" /><span class="vol-value"></span></div>` +
      `<div class="vol-name">Weather</div><div class="vol-row" data-vol="weather"><input class="vol-slider" type="range" min="0" max="100" step="1" aria-label="Weather" /><span class="vol-value"></span></div></div>`;
    wireVolume(el);
  }

  // The VOLUME sliders: dragging one sets its volume live (Volume.set / Volume.setWeather remember it on the device). The first is the master volume, the
  // second ("Weather") the volume of the weather's sound. They make no sound of their own (no click when one is let go). They show the volumes that are saved.
  function wireVolume(el) {
    el.querySelectorAll(".vol-row").forEach((row) => {
      const slider = row.querySelector(".vol-slider");
      const label = row.querySelector(".vol-value");
      const weather = row.dataset.vol === "weather";
      const show = () => {
        slider.style.setProperty("--p", slider.value + "%");
        label.textContent = slider.value + "%";
      };
      slider.value = Math.round((weather ? Volume.getWeather() : Volume.get()) * 100);
      show();
      slider.addEventListener("input", () => {
        if (weather) Volume.setWeather(slider.value / 100);
        else Volume.set(slider.value / 100);
        show();
      });
    });
  }

  function refresh() {
    if (listEl && listEl.dataset.kind === "options") renderOptions(listEl);
    if (boardEl && boardEl.dataset.kind === "leaderboard") renderLeaderboard(boardEl);
  }

  function onClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "signin" || b.dataset.act === "signout") {
      if (typeof playUiClick === "function") playUiClick();
      if (typeof Cloud !== "undefined") Cloud[b.dataset.act === "signin" ? "signIn" : "signOut"]();
    } else if (b.dataset.act === "editdesc") {
      if (typeof playUiClick === "function") playUiClick();
      showEditDescription();
    }
  }

  // Cloud (cloud.js) has no DOM/modal code of its own - it asks THIS module to confirm something with the player via this
  // hook, and gets a Promise<boolean> back (true = go ahead). Used for exactly one thing: "this Google account already has
  // a save - signing in will ERASE your current local progress and replace it with that one, like linking an account in
  // any other mobile game. Continue?" - shown once, right after a fresh interactive sign-in (never for a page reload that
  // merely restores an already-signed-in session - see cloud.js signIn()).
  function confirmCloudOverwrite(cloudSave) {
    let coinsText = "";
    try {
      coinsText = `, ${formatBoardCoins(JSON.parse(cloudSave.data).coins || 0)} coins`;
    } catch (e) {
      /* couldn't read a coin count out of it - the warning still makes sense without one */
    }
    return new Promise((resolve) => {
      openModal(
        "THIS ACCOUNT HAS A SAVE",
        `<div class="modal-text">Signing in will <b>erase your current progress</b> and replace it with the save already linked to this account${esc(coinsText)}. This cannot be undone. Continue?</div>`,
        [
          { label: "SIGN IN", cls: "danger", onClick: () => resolve(true) },
          { label: "CANCEL", cls: "ghost", onClick: () => resolve(false) },
        ]
      );
    });
  }

  // ---------- LEADERBOARD: its own top-level screen (collection.js open("leaderboard")), ranked by CURRENT coins.
  // A "leaderboard card" per player: place, a "|", name, coins on the right. Rank 1 gets the legendary shine, 2-3 the
  // epic tint, the rest the plain card background - a fixed-by-RANK look, not each player's own rarity (they have none).
  // Holding a card down inspects that player's account card (see wireLeaderboardHold) - the same card accountCardHtml
  // draws, showing their chosen character; the button there is SIGN IN/OUT only for the player's OWN card, everyone
  // else's shows their coins instead (there is nothing to press on somebody else's account). ----------
  let boardEl = null; // the leaderboard screen's own scroll area (set by renderLeaderboard)

  function boardTierClass(rank) {
    if (rank === 1) return " legendary";
    if (rank >= 2 && rank <= 3) return " epic"; // NOT just "rank <= 3" - null <= 3 is true in JS, which quietly gave an unranked player the epic tier
    return "";
  }

  function leaderboardCardHtml(row, rank) {
    return (
      `<div class="board-card${boardTierClass(rank)}" data-uid="${esc(row.uid)}">` +
      `<span class="board-place">${rank}</span><span class="board-sep">|</span>` +
      `<span class="board-name">${esc(row.name)}</span>` +
      `<span class="board-coins"><i class="coin"></i>${formatBoardCoins(row.coins)}</span></div>`
    );
  }

  function renderLeaderboard(el) {
    boardEl = el;
    if (typeof Cloud === "undefined" || !Cloud.isConfigured()) {
      el.innerHTML = `<div class="board-empty">Not set up yet.</div>`;
      return;
    }
    const rows = Cloud.getLeaderboardCache();
    el.innerHTML = !rows
      ? `<div class="board-empty">Loading...</div>`
      : rows.length
        ? rows.map((row, i) => leaderboardCardHtml(row, i + 1)).join("")
        : `<div class="board-empty">No scores yet.</div>`;
  }

  // ---- hold to inspect a leaderboard card (the same interaction as the shop's - see shop.js) ----
  const HOLD_MS = 450;
  const HOLD_SLOP = 10;
  let holdTimer = null;
  let holdFrom = null;
  let holdFired = false;
  let inspectEl = null;
  let inspectOpenedAt = 0;

  function cancelHold() {
    clearTimeout(holdTimer);
    holdTimer = null;
  }

  function closeInspect() {
    if (inspectEl) inspectEl.classList.remove("show");
  }

  function openInspect(uid) {
    const rows = Cloud.getLeaderboardCache() || [];
    const i = rows.findIndex((r) => r.uid === uid);
    if (i < 0 || !inspectEl) return;
    const row = rows[i];
    const me = Cloud.getUser();
    const isMe = me && me.uid === uid;
    const action = isMe
      ? `<button type="button" class="save-icon-btn" data-act="signout">SIGN OUT</button>`
      : `<span class="board-coins"><i class="coin"></i>${formatBoardCoins(row.coins)}</span>`;
    inspectOpenedAt = Date.now();
    inspectEl.querySelector("#board-inspect-card").innerHTML = accountCardHtml(row.name, row.character, row.description, action, boardTierClass(i + 1));
    inspectEl.classList.add("show");
  }

  function onInspectClick(e) {
    if (Date.now() - inspectOpenedAt < 350) return; // the finger that opened it must not also close/act on it
    const btn = e.target.closest("[data-act]");
    if (btn) {
      onClick(e); // SIGN OUT on your own inspected card - same handling as the ACCOUNT section's button
      closeInspect();
      return;
    }
    if (!e.target.closest(".pick-row")) closeInspect(); // outside the card
  }

  function wireLeaderboardHold(root) {
    inspectEl = document.getElementById("board-inspect");
    if (!inspectEl || inspectEl.dataset.wired) return;
    inspectEl.dataset.wired = "1";
    inspectEl.addEventListener("click", onInspectClick);
    root.addEventListener("pointerdown", (e) => {
      holdFired = false;
      const card = e.target.closest(".board-card[data-uid]");
      cancelHold();
      if (!card) return;
      holdFrom = { x: e.clientX, y: e.clientY };
      holdTimer = setTimeout(() => {
        holdTimer = null;
        holdFired = true;
        openInspect(card.dataset.uid);
      }, HOLD_MS);
    });
    root.addEventListener("pointermove", (e) => {
      if (holdTimer && holdFrom && Math.hypot(e.clientX - holdFrom.x, e.clientY - holdFrom.y) > HOLD_SLOP) cancelHold();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((t) => root.addEventListener(t, cancelHold));
    [root, inspectEl].forEach((el) => el.addEventListener("contextmenu", (e) => e.preventDefault())); // no image-save menu on a long press
    root.addEventListener("click", (e) => {
      if (holdFired) {
        holdFired = false; // the click that ends a hold (the inspect popup opened): not a tap on the card
        e.stopPropagation();
      }
    });
  }

  if (typeof Cloud !== "undefined") {
    Cloud.onAuthChange(() => refresh());
    Cloud.setConfirmOverwrite(confirmCloudOverwrite);
  }

  return { renderOptions, renderLeaderboard, wireLeaderboardHold, closeInspect, onClick, refresh };
})();
