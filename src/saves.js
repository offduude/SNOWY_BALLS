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

  // buttons: [{ label, cls, html, onClick }]; onClick returns false to keep the popup open. `html: true` renders `label`
  // as raw markup instead of escaping it - only for a button whose label is built from trusted, fixed pieces (e.g. the
  // CHANGE NAME price button's coin icon), never from player-typed text. Returns the panel element. Exported
  // (2026-09-29) - collection.js's SELL confirm reuses this same popup instead of its own.
  function openModal(title, bodyHtml, buttons) {
    closeModal();
    layer = document.createElement("div");
    layer.id = "modal-layer";
    layer.innerHTML =
      `<div class="modal-panel"><div class="modal-title">${esc(title)}</div>${bodyHtml}` +
      `<div class="modal-buttons">${buttons.map((b, k) => `<button type="button" class="modal-btn ${b.cls || ""}" data-k="${k}">${b.html ? b.label : esc(b.label)}</button>`).join("")}</div></div>`;
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
  function accountCardHtml(name, characterId, description, actionHtml, tierClass, rank) {
    const charInfo = (typeof Collection !== "undefined" && Collection.characterInfo(characterId)) || { image: "" };
    const desc = description && description.trim() ? description : "No description.";
    const corner = rank ? `<span class="pick-corner"><span class="pick-count">#${rank}</span></span>` : "";
    return (
      `<div class="pick-row buff-row account-card${tierClass || ""}">` +
      corner +
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
    // The corner dot (the same NEW_DOT markup collection.js uses, just its own position - see .signin-dot) is
    // persistent on the SIGN IN button itself now (moved off the card, 2026-09-23, the owner's call) - baked
    // straight into this markup, so it's there for as long as the button renders, gone the moment SIGN OUT takes
    // its place (matches the OPTIONS button's own dot, which is never "something new to look at" either).
    const action = user
      ? `<button type="button" class="save-icon-btn" data-act="signout">SIGN OUT</button>`
      : `<button type="button" class="save-icon-btn" data-act="signin">SIGN IN</button><span class="notif-dot signin-dot show"></span>`;
    // Signed out: no picture, no description - there is no account to show yet, just "Not signed in" next to SIGN IN
    // (the plain .pick-row/.pick-text/.pick-action pieces accountCardHtml also uses, without its picture or bio).
    const card = user
      ? accountCardHtml(
          (typeof Economy !== "undefined" && Economy.getAccountName()) || user.name,
          typeof Economy !== "undefined" ? Economy.getEquipped("character") : null,
          typeof Economy !== "undefined" ? Economy.getAccountDescription() : "",
          action,
          boardTierClass(myRank())
        )
      : `<div class="pick-row buff-row account-card"><div class="pick-text center-self"><div class="pick-name">Not signed in.</div></div><div class="pick-action">${action}</div></div>`;
    const error = Cloud.getAuthError();
    const errorLine = error ? `<div class="account-error">${user ? "" : "Sign-in failed: "}${esc(error)}</div>` : "";
    // CHANGE NAME / CHANGE DESCRIPTION only mean anything once there's an account to attach them to.
    const btnRow = user
      ? `<div class="account-btn-row"><button type="button" class="save-icon-btn" data-act="editname">CHANGE NAME</button><button type="button" class="save-icon-btn" data-act="editdesc">CHANGE DESCRIPTION</button></div>`
      : "";
    return `<div class="opt-section"><div class="opt-head">ACCOUNT</div>${card}${errorLine}${btnRow}</div>`;
  }

  // PRIVATE INVENTORY (2026-09-29): on = other players can't see your skins from your LEADERBOARD profile, and
  // can't propose a trade with you at all - Economy.getPrivateInventory/setPrivateInventory, synced to the
  // cloud immediately via Cloud.notePrivacyChange (see that function's own note, src/cloud.js). Real, server-
  // enforced privacy as of 2026-10-01 (functions/trading.js getTargetInventory) - not just a greyed-out button.
  //
  // RATE LIMITS (2026-10-01, replacing the old plain-English "Hides your skins..." note) - the owner's own ask:
  // don't sugarcoat these, show the real server-side numbers in the same terms the code itself uses
  // (functions/economy.js, functions/trading.js), so no player is ever surprised by one. Same row styling as
  // Private Inventory above (.account-row), a SEE button opening showRateLimits() below instead of a toggle.
  function tradingSectionHtml() {
    if (typeof Economy === "undefined") return "";
    const on = Economy.getPrivateInventory();
    return (
      `<div class="opt-section"><div class="opt-head">TRADING</div>` +
      `<div class="account-row"><span>Private Inventory</span>` +
      `<button type="button" class="save-icon-btn${on ? " on" : ""}" data-act="toggle-private">${on ? "ON" : "OFF"}</button></div>` +
      `<div class="account-row"><span>Rate Limits</span>` +
      `<button type="button" class="save-icon-btn" data-act="rate-limits">SEE</button></div></div>`
    );
  }

  // Plain, undecorated numbers - straight from the actual applyRateLimits(...) calls in functions/economy.js and
  // functions/trading.js (kept in sync with those by hand; nothing generates this list automatically). Deliberately
  // using the real callable names as they appear in code (claimThrow, not "throwing a snowball") - the owner's own
  // ask, "dont sugarcoat them in nice words."
  function showRateLimits() {
    const lines = [
      "claimThrow: 30 / 60s",
      "useBuff: 20 / 60s",
      "openBox: 20 / 60s",
      "sellSkin: 20 / 60s",
      "purchase: 20 / 60s",
      "getTargetInventory: 20 / 60s",
      "proposeTrade: 3 / 300s",
      "acceptTrade: 10 / 60s",
      "declineTrade: 10 / 60s",
      "cancelTrade: 10 / 60s",
    ];
    openModal("RATE LIMITS", `<div class="modal-text">${lines.map(esc).join("<br>")}</div>`, [{ label: "OK" }]);
  }

  // CHANGE DESCRIPTION: edit the account's own bio line. Sanitized and capped the same way on save as everywhere else
  // (Economy.setAccountDescription does its own cleaning too - this is just for the live counter/preview here).
  function showEditDescription() {
    const current = typeof Economy !== "undefined" ? Economy.getAccountDescription() : "";
    const max = 60;
    const panel = openModal(
      "DESCRIPTION",
      `<input class="modal-input" maxlength="${max}" value="${esc(current)}" spellcheck="false" />` + `<div class="modal-status"></div>`,
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

  // CHANGE NAME: no explanatory text under the title - the price button IS the explanation. The first rename is free,
  // but clicking it still warns that every rename AFTER this one costs Economy.accountNameChangeCost coins (so nobody
  // spends their one free rename without knowing that); once that free one is used, the button already reads the real
  // price and clicking it renames directly - nothing left to warn about, it costs the same every time from then on.
  // `prefill` / `errorMsg` let CANCEL on the warning step return here with what was typed and, on a failed attempt,
  // the reason - see attemptRename below.
  function showEditName(prefill, errorMsg) {
    const current = prefill !== undefined ? prefill : (typeof Economy !== "undefined" && Economy.getAccountName()) || "";
    const cost = typeof Economy !== "undefined" ? Economy.getAccountNameChangeCost() : 0;
    const max = 16;
    const priceLabel = cost > 0 ? `<i class="coin"></i>${formatBoardCoins(cost)}` : "FREE";
    const panel = openModal(
      "CHANGE NAME",
      `<input class="modal-input" maxlength="${max}" value="${esc(current)}" spellcheck="false" />` + `<div class="modal-status${errorMsg ? " bad" : ""}">${esc(errorMsg || "")}</div>`,
      [
        {
          label: priceLabel,
          html: true,
          onClick: (el) => {
            const value = el.querySelector("input").value;
            if (cost > 0) attemptRename(value);
            else showConfirmFirstRename(value); // free right now - but warn what the NEXT one costs before spending it
            return false; // attemptRename/showConfirmFirstRename decide whether the popup closes
          },
        },
        { label: "CANCEL", cls: "ghost" },
      ]
    );
    const input = panel.querySelector("input");
    const status = panel.querySelector(".modal-status");
    const showCount = () => {
      status.classList.remove("bad");
      status.textContent = `${input.value.length}/${max}`;
    };
    if (!errorMsg) showCount(); // an error stays showing until the player edits again, then it's back to the live counter
    input.addEventListener("input", showCount);
    input.focus();
  }

  // The one-time warning shown only when THIS rename is free (see showEditName) - it's about the rename AFTER this one,
  // not this one. YES spends the free rename; CANCEL goes back to the name editor with what was typed still there.
  function showConfirmFirstRename(value) {
    openModal(
      "CHANGE NAME",
      `<div class="modal-text">Next change ${Economy.accountNameChangeCost} coins. Proceed?</div>`,
      [
        {
          label: "YES",
          onClick: () => {
            attemptRename(value); // closes (success) or reopens the editor with an error (failure) itself - either way, this modal must not also auto-close on top of that
            return false;
          },
        },
        {
          label: "CANCEL",
          cls: "ghost",
          onClick: () => {
            showEditName(value); // goes back to the editor (already opens its own fresh modal) - must not also auto-close on top of that
            return false;
          },
        },
      ]
    );
  }

  // Shared by both the free and paid paths (see showEditName): does the actual rename, and either closes with a fresh
  // OPTIONS render (success) or drops the player back into the name editor with the reason it failed (empty after
  // sanitizing, or - only possible on the paid path - not enough coins).
  function attemptRename(value) {
    const result = Economy.setAccountName(value);
    if (!result.ok) {
      showEditName(value, result.reason === "cant-afford" ? `Not enough coins - needs ${formatBoardCoins(Economy.getAccountNameChangeCost())}.` : "Enter a name.");
      return;
    }
    if (typeof Cloud !== "undefined") Cloud.markDirty(); // picked up by the normal sync cadence, not sent instantly
    closeModal();
    refresh();
  }

  // ---------- the OPTIONS list (ACCOUNT, VOLUME, TRADING - 2026-10-01: TRADING moved below VOLUME, the owner's ask) ----------
  let listEl = null; // the OPTIONS list's scroll area (set by renderOptions)

  function renderOptions(el) {
    listEl = el;
    el.innerHTML =
      accountSectionHtml() +
      `<div class="opt-section"><div class="opt-head">VOLUME</div><div class="vol-row" data-vol="master"><input class="vol-slider" type="range" min="0" max="100" step="1" aria-label="Volume" /><span class="vol-value"></span></div>` +
      `<div class="vol-name">Weather</div><div class="vol-row" data-vol="weather"><input class="vol-slider" type="range" min="0" max="100" step="1" aria-label="Weather" /><span class="vol-value"></span></div></div>` +
      tradingSectionHtml();
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

  // The LEADERBOARD side button's own background follows the signed-in player's current rank-tier, same rule as the
  // account/leaderboard cards - no rank (signed out, or not on the board yet) just leaves it the plain button colour.
  function updateLeaderboardButton() {
    const btn = document.getElementById("leaderboard-btn");
    if (!btn) return;
    btn.classList.remove("epic", "legendary");
    const tier = boardTierClass(myRank()).trim();
    if (tier) btn.classList.add(tier);
  }

  // Red dot on the LEADERBOARD button's own top-left corner (2026-10-01, the owner's ask) - a player shouldn't
  // have to open LEADERBOARD -> INBOX just to find out something's waiting; this is the same "at least one
  // pending incoming offer" check #inbox-dot already makes, just visible from the main HUD instead of only once
  // that screen is already open. Unconditional in refresh() (unlike renderBoardContent, which only runs while
  // LEADERBOARD is the open screen) and also driven live by Cloud.onTradesChange - see this file's own
  // subscription near the bottom - so it reacts the instant a trade is offered, not on the next redraw.
  function updateLeaderboardDot() {
    const dot = document.getElementById("leaderboard-dot");
    if (!dot) return;
    const rows = Cloud.getTradesCache() || [];
    const me = Cloud.getUser();
    const pendingIncoming = me ? rows.filter((t) => t.toUid === me.uid).length : 0;
    dot.classList.toggle("show", pendingIncoming > 0);
  }

  function refresh() {
    if (listEl && listEl.dataset.kind === "options") renderOptions(listEl);
    if (boardEl && boardEl.dataset.kind === "leaderboard") renderBoardContent(); // whichever of leaderboard/INBOX is currently showing, not reset to the leaderboard
    updateLeaderboardButton();
    updateLeaderboardDot();
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
    } else if (b.dataset.act === "editname") {
      if (typeof playUiClick === "function") playUiClick();
      showEditName();
    } else if (b.dataset.act === "toggle-private") {
      if (typeof playUiClick === "function") playUiClick();
      Economy.setPrivateInventory(!Economy.getPrivateInventory());
      // Immediate, not the generic dirty-flag-and-wait every other Economy change gets (2026-10-01 - see
      // cloud.js notePrivacyChange's own note): this is a real enforcement gate, not a cosmetic field, so the
      // server must learn about it right away, not whenever the next ~30s heartbeat happens to land.
      if (typeof Cloud !== "undefined") Cloud.notePrivacyChange();
      renderOptions(listEl);
    } else if (b.dataset.act === "rate-limits") {
      if (typeof playUiClick === "function") playUiClick();
      showRateLimits();
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
          { label: "CONTINUE", cls: "danger", onClick: () => resolve(true) },
          { label: "CANCEL", cls: "ghost", onClick: () => resolve(false) },
        ]
      );
    });
  }

  // ---------- LEADERBOARD: its own top-level screen (collection.js open("leaderboard")), ranked by CURRENT coins.
  // A "leaderboard card" per player: place, a "|", name, coins on the right. Rank 1 gets the legendary shine, everyone
  // else (2nd place down) the plain card background - a fixed-by-RANK look, not each player's own rarity (they have
  // none). Clicking a card inspects that player's account card (see wireLeaderboardClick) - the same card
  // accountCardHtml draws, showing their chosen character; the button there is SIGN IN/OUT only for the player's OWN
  // card, everyone else's shows their coins instead (there is nothing to press on somebody else's account). ----------
  let boardEl = null; // the leaderboard screen's own scroll area (set by renderLeaderboard)

  function boardTierClass(rank) {
    return rank === 1 ? " legendary" : ""; // only #1 gets a tier colour now (2nd/3rd used to get the epic tint - owner's call, 2026-09-23)
  }

  function leaderboardCardHtml(row, rank) {
    const me = typeof Cloud !== "undefined" && Cloud.getUser();
    // The PLACE is always the real rank number now (it used to say "YOU" here, replacing the number - the owner's
    // call, 2026-09-23: a rank is useful information on its own row too). "YOU" moved to the NAME instead, styled
    // distinctly (.board-you) rather than as plain name text - a player could otherwise set their own account name
    // to literally "YOU" (CHANGE NAME has no such restriction) and be indistinguishable from the real thing.
    const name = me && me.uid === row.uid ? `<span class="board-you">YOU</span>` : esc(row.name);
    return (
      `<div class="board-card${boardTierClass(rank)}" data-uid="${esc(row.uid)}">` +
      `<span class="board-place">${rank}</span><span class="board-sep">|</span>` +
      `<span class="board-name">${name}</span>` +
      `<span class="board-coins"><i class="coin"></i>${formatBoardCoins(row.coins)}</span></div>`
    );
  }

  // Opening the LEADERBOARD screen always starts on the actual leaderboard, never wherever INBOX was left last
  // time - `inboxOpen` only flips via the INBOX button itself (toggleInbox) from here on.
  function renderLeaderboard(el) {
    boardEl = el;
    inboxOpen = false;
    renderBoardContent();
  }

  function renderBoardContent() {
    if (!boardEl) return;
    updateInboxButton();
    const titleEl = document.getElementById("list-title");
    if (titleEl) titleEl.textContent = inboxOpen ? "INBOX" : "LEADERBOARD";
    const hintEl = document.getElementById("list-hint");
    if (hintEl) hintEl.textContent = inboxOpen ? "" : "TAP to INSPECT";
    if (inboxOpen) {
      renderInbox(boardEl);
      return;
    }
    if (typeof Cloud === "undefined" || !Cloud.isConfigured()) {
      boardEl.innerHTML = `<div class="board-empty">Not set up yet.</div>`;
      return;
    }
    const rows = Cloud.getLeaderboardCache();
    if (!rows) {
      boardEl.innerHTML = `<div class="board-empty">Loading...</div>`;
      return;
    }
    if (!rows.length) {
      boardEl.innerHTML = `<div class="board-empty">No scores yet.</div>`;
      return;
    }
    // The "TAP to INSPECT" hint used to be the last row here, scrolled away with the cards - it's now a fixed
    // footer under the whole tab instead (index.html #list-hint, toggled by collection.js's open()).
    boardEl.innerHTML = rows.map((row, i) => leaderboardCardHtml(row, i + 1)).join("");
  }

  // ---------- INBOX (2026-09-29, wired to real trades 2026-09-30): a sub-view of the LEADERBOARD screen
  // (top-right button, #inbox-btn), meant to hold both trade offers and - later, the owner's own idea - a
  // "letter"/postcard item's messages, in one newest-first feed (each row still just `{type:"trade",...}` shaped
  // today, so a future `{type:"letter",...}` can slot into the same list later without restructuring this).
  // Reads Cloud.getTradesCache() - real trades/{tradeId} docs, fetched read-on-open the same way the leaderboard
  // itself is (see collection.js open("leaderboard")) plus a light heartbeat() piggyback (cloud.js) so the
  // notification dot stays current even while this screen isn't open.
  let inboxOpen = false;

  function tradeRowHtml(trade) {
    const me = Cloud.getUser();
    const isOutgoing = me && trade.fromUid === me.uid;
    const otherUid = isOutgoing ? trade.toUid : trade.fromUid;
    const otherRow = (Cloud.getLeaderboardCache() || []).find((r) => r.uid === otherUid);
    const name = esc(otherRow ? otherRow.name : "a player");
    const actions = isOutgoing
      ? `<button type="button" class="save-icon-btn ghost" data-trade-act="cancel" data-trade-id="${esc(trade.id)}">CANCEL</button>`
      : `<button type="button" class="save-icon-btn" data-trade-act="accept" data-trade-id="${esc(trade.id)}">ACCEPT</button>` +
        `<button type="button" class="save-icon-btn ghost" data-trade-act="decline" data-trade-id="${esc(trade.id)}">DECLINE</button>`;
    return (
      `<div class="inbox-row">` +
      `<div class="inbox-row-head">${isOutgoing ? "TO" : "FROM"} ${name}</div>` +
      `<div class="trade-confirm-block">` +
      `<div class="trade-confirm-row"><span class="trade-confirm-label">GIVES</span><span>${tradeSummaryLine(trade.offer)}</span></div>` +
      `<div class="trade-confirm-row"><span class="trade-confirm-label">WANTS</span><span>${tradeSummaryLine(trade.request)}</span></div>` +
      `</div>` +
      `<div class="inbox-row-actions">${actions}</div>` +
      `</div>`
    );
  }

  function renderInbox(el) {
    // Signed out is a DIFFERENT reason for an empty cache than "still fetching" (Cloud.refreshTrades is a no-op
    // while signed out - see its own guard - so `rows` would otherwise stay null forever and this would show
    // "Loading..." permanently instead of the real reason).
    if (!Cloud.getUser()) {
      el.innerHTML = `<div class="board-empty">Sign in to see trade offers.</div>`;
      return;
    }
    const rows = Cloud.getTradesCache();
    if (rows === null) {
      el.innerHTML = `<div class="board-empty">Loading...</div>`;
      return;
    }
    if (!rows.length) {
      el.innerHTML = `<div class="board-empty">No trade offers yet.</div>`;
      return;
    }
    el.innerHTML = rows.map(tradeRowHtml).join("");
  }

  // Rebuilds the button's whole innerHTML every call (not just its label via textContent) - textContent would
  // wipe out #inbox-dot along with the old label text, since it's a child of this same button (a real bug this
  // fixes, 2026-09-30: the dot could never have shown before, it got deleted the first time this ran). Doubles as
  // the dot's own update: "show" whenever this account has at least one pending INCOMING offer.
  function updateInboxButton() {
    const btn = document.getElementById("inbox-btn");
    if (!btn) return;
    const rows = Cloud.getTradesCache() || [];
    const me = Cloud.getUser();
    const pendingIncoming = me ? rows.filter((t) => t.toUid === me.uid).length : 0;
    btn.innerHTML = `${inboxOpen ? "LEADERBOARD" : "INBOX"}<span id="inbox-dot" class="notif-dot${pendingIncoming > 0 ? " show" : ""}"></span>`;
  }

  function toggleInbox() {
    if (typeof playUiClick === "function") playUiClick();
    inboxOpen = !inboxOpen;
    renderBoardContent();
  }

  // ACCEPT/DECLINE/CANCEL (2026-09-30) - ACCEPT gets its own confirm (real coins/skins move immediately and
  // irreversibly, same "danger" weight as SEND OFFER below); DECLINE/CANCEL just void an offer, no confirm needed.
  //
  // FIX (2026-10-01, a real bug: accepting a trade had ZERO effect on the accepter's own coin counter): the
  // server's acceptTrade already does the real, atomic transfer and was always meant to be applied client-side
  // too ("the client applies ONLY this returned value, never an optimistic local guess" - the original design)
  // but nothing here ever actually read it. Rather than trust the response's raw totals (a blind set risks
  // clobbering other still-local-only state, the same reason every other wired Function uses a delta), apply the
  // exact, already-known mutation instead - same "the outcome was already known, just apply it" discipline
  // collection.js applySoldLocally uses for sellSkin: the accepter RECEIVES `trade.offer` and GIVES
  // `trade.request`, and both are already sitting right here in the trades cache (the INBOX row couldn't have
  // rendered an ACCEPT button without them).
  function runTradeAction(fnName, tradeId) {
    const trade = (Cloud.getTradesCache() || []).find((t) => t.id === tradeId);
    Cloud.callFunction(fnName, { tradeId })
      .then(() => {
        if (fnName === "acceptTrade" && trade) {
          const delta = trade.offer.coins - trade.request.coins;
          if (delta !== 0) Economy.addCoins(delta);
          trade.offer.skins.forEach((s) => Economy.addSkin(s.kind, s.id, s.qty));
          trade.request.skins.forEach((s) => Economy.removeSkin(s.kind, s.id, s.qty));
          // Auto-refresh the leaderboard the instant a trade actually completes (2026-10-01, the owner's ask) -
          // an ACCEPT is the one trade outcome that moves real coins/skins between two real leaderboard rows
          // (both of them, not just this account's own); DECLINE/CANCEL just void an offer, nothing to refresh.
          // A forced re-fetch, not waiting for this screen to be closed and reopened (refreshLeaderboard's own
          // normal read-on-open cadence) - see the matching call in onOutgoingTradeResolved below for the OTHER
          // side of this same accept, whichever device happens to be looking at the leaderboard when it lands.
          Cloud.refreshLeaderboard(() => refresh());
        }
        // CANCEL refunds the sender's own pre-deducted offer (see sendTradeOffer's own note) - routed through the
        // same reported-resolution path the live listener uses for a DECLINE, so there's exactly one place that
        // ever applies this reaction (Cloud's own de-dup guard keeps a declined-by-the-time-cancel-also-fires race
        // from double-refunding).
        if (fnName === "cancelTrade" && trade) {
          Cloud.reportOutgoingTradeResolved({ id: tradeId, status: "cancelled", offer: trade.offer, request: trade.request });
        }
        Cloud.refreshTrades(() => refresh());
      })
      .catch((err) => {
        openModal("TRADE", `<div class="modal-text">${esc((err && err.message) || "Something went wrong.")}</div>`, [{ label: "OK" }]);
      });
  }

  function onInboxAction(action, tradeId) {
    if (typeof playUiClick === "function") playUiClick();
    if (action === "accept") {
      openModal(
        "ACCEPT TRADE?",
        `<div class="modal-text">This exchanges coins/skins immediately. This cannot be undone.</div>`,
        [
          { label: "ACCEPT", cls: "danger", onClick: () => runTradeAction("acceptTrade", tradeId) },
          { label: "CANCEL", cls: "ghost" },
        ]
      );
      return;
    }
    runTradeAction(action === "decline" ? "declineTrade" : "cancelTrade", tradeId);
  }

  // ---- click a leaderboard card to inspect it ----
  let inspectEl = null;
  let inspectOpenedAt = 0;

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
    // TRADE: never shown on your own card. On someone else's, greyed out and inert (2026-10-01, the owner's ask -
    // was hidden outright before) once they've gone private - `row.privateInventory` is synced both ways
    // (cloud.js syncNow() pushes Economy.getPrivateInventory(), refreshLeaderboard reads it back). The real
    // `disabled` attribute, not just a CSS look, so it genuinely can't fire `onInspectClick`'s own `data-act`
    // handling - proposeTrade's own server-side check is still the actual enforcement (a modified client could
    // still try to call it directly), this is the honest UI reflection of that.
    const tradeBtn = isMe
      ? ""
      : row.privateInventory
      ? `<button type="button" class="save-icon-btn" disabled>TRADE</button>`
      : `<button type="button" class="save-icon-btn" data-act="trade" data-uid="${esc(uid)}">TRADE</button>`;
    // Coins + TRADE stacked in their own column with real spacing between them (2026-09-29 - they used to just
    // sit side by side in .pick-action's own flow with no gap, reading as cramped once TRADE was added next to
    // the coins) instead of both loose inside .pick-action.
    const action = isMe
      ? `<button type="button" class="save-icon-btn" data-act="signout">SIGN OUT</button>`
      : `<div class="board-action-col"><span class="board-coins"><i class="coin"></i>${formatBoardCoins(row.coins)}</span>${tradeBtn}</div>`;
    inspectOpenedAt = Date.now();
    inspectEl.querySelector("#board-inspect-card").innerHTML = accountCardHtml(row.name, row.character, row.description, action, boardTierClass(i + 1), i + 1);
    inspectEl.classList.add("show");
  }

  // The rarity-tint trick every icon-tile popup in the game uses (boxes.js tintAttrs is the original - duplicated
  // here rather than exported, since it's three lines and boxes.js has no reason to know saves.js exists). Used by
  // the trade-compose tiles below (the leaderboard inspect popup no longer shows any inventory of its own - see
  // targetSkinsCatalog's header note).
  function invTintAttrs(item) {
    const r = typeof Rarity !== "undefined" && Rarity.info(item.rarity);
    if (!r) return "";
    if (r.color === "rainbow") return " rainbow";
    const m = /^#([0-9a-f]{6})$/i.exec(r.color || "");
    if (!m) return "";
    const n = parseInt(m[1], 16);
    return ` box-inspect-icon tinted" style="--tint: rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.22)`;
  }

  function onInspectClick(e) {
    if (Date.now() - inspectOpenedAt < 350) return; // the finger that opened it must not also close/act on it
    const tradeBtn = e.target.closest('[data-act="trade"]');
    if (tradeBtn) {
      openTradeCompose(tradeBtn.dataset.uid); // opens the compose screen instead of the generic data-act handling below
      return;
    }
    const btn = e.target.closest("[data-act]");
    if (btn) {
      onClick(e); // SIGN OUT on your own inspected card - same handling as the ACCOUNT section's button
      closeInspect();
      return;
    }
    if (!e.target.closest(".pick-row")) closeInspect(); // outside the card
  }

  // ---------- Trade compose (2026-09-29, wired to the real proposeTrade Cloud Function 2026-09-30) ----------
  // SEND OFFER now calls Cloud.callFunction("proposeTrade", ...) for real (see sendTradeOffer below) - on the
  // emulator (127.0.0.1) this creates a genuine trades/{tradeId} doc and reserves the offered coins/skins
  // server-side; on the real (not yet deployed) project it fails cleanly with a "couldn't reach" error, same as
  // any other callFunction call before rules+Functions are published.
  let tradeComposeEl = null;
  let tradeTarget = null; // { uid, name, rank } | null
  let tradeGive = { coins: 0, skins: [] }; // skins: [{kind,id}] - one of each, no stacking (kept simple; sendTradeOffer adds qty:1 per entry when sending)
  let tradeWant = { coins: 0, skins: [] };
  // The target's real skinCounts for whichever uid tradeTarget currently points at, or null - either "still
  // loading" or "genuinely nothing to show" (not synced yet, or refused for being private). FIX (2026-10-01, the
  // owner's own question: "can a modified client read the private inventory?"): this used to just read
  // row.skinCounts straight off the public leaderboard cache - moved to a fetch-on-open from the new
  // getTargetInventory Cloud Function instead (see openTradeCompose below), which actually enforces privacy
  // server-side rather than merely reflecting it in a greyed-out button.
  let tradeTargetSkinCounts = null;

  // "YOU WANT" browses the target's REAL inventory (2026-09-30, moved off the public leaderboard doc 2026-10-01 -
  // see tradeTargetSkinCounts' own note above). A target whose inventory hasn't synced yet, or who's private,
  // honestly shows "nothing to pick from" rather than pretending every skin in the game is fair game to ask for.
  // This is also the ONLY place another player's inventory is ever shown - the leaderboard inspect popup's own
  // standalone preview below an account card was removed separately, per the owner's call: another player's
  // inventory is visible only at the moment it's actually useful (picking what to ask for), never as idle
  // browsing.
  // Rarest first, same convention the PROJECTILES/BUFFS/CHARACTERS tabs already use (Rarity.rank - see that
  // file's own header note) - a stable sort (ties keep their original, catalog order) via the index-tag trick
  // those other call sites use too, since Array.prototype.sort isn't guaranteed stable in every engine. Added
  // 2026-10-01, the owner's ask: "sort the items by rarity with legendary on top" for the trade-compose preview.
  function sortByRarityDesc(entries) {
    return entries
      .map((entry, i) => ({ entry, i }))
      .sort((a, b) => Rarity.rank(a.entry.item.rarity) !== Rarity.rank(b.entry.item.rarity) ? Rarity.rank(b.entry.item.rarity) - Rarity.rank(a.entry.item.rarity) : a.i - b.i)
      .map((x) => x.entry);
  }

  function targetSkinsCatalog() {
    const counts = tradeTargetSkinCounts;
    if (!counts) return null; // still loading, not synced yet, or refused (private) - all look the same here
    const out = [];
    for (const kind of ["character", "scenery", "weather"]) {
      for (const item of Collection.skinItems(kind)) {
        const n = (counts[kind] && counts[kind][item.id]) || 0;
        if (item.rarity !== "default" && n > 0) out.push({ kind, item, n });
      }
    }
    return sortByRarityDesc(out);
  }

  // The target's own real coin balance (2026-10-01, the owner's ask) - same leaderboard-cache lookup
  // targetSkinsCatalog already makes, just for `.coins` instead of `.skinCounts`. `null` (not 0) when the row
  // itself hasn't loaded at all yet, distinct from a real balance of zero.
  function targetCoins() {
    const row = tradeTarget && (Cloud.getLeaderboardCache() || []).find((r) => r.uid === tradeTarget.uid);
    return row ? row.coins : null;
  }

  function mySkinsCatalog() {
    const out = [];
    for (const kind of ["character", "scenery", "weather"]) {
      for (const item of Collection.skinItems(kind)) {
        if (item.rarity !== "default" && Economy.getSkinCount(kind, item.id) > 0) out.push({ kind, item });
      }
    }
    return sortByRarityDesc(out);
  }

  // `count` (the target's real owned amount) only ever shows on the WANT side - GIVE already only lists skins
  // you have at least one of (mySkinsCatalog), same as before.
  function tradeTileHtml(kind, item, selected, count) {
    return (
      `<div class="box-inspect-cell${selected ? " selected" : ""}" data-kind="${esc(kind)}" data-id="${esc(item.id)}" title="${esc(item.name)}">` +
      `<span class="box-inspect-icon${invTintAttrs(item)}"><img src="${esc(item.image || "")}" alt="" draggable="false" /></span>` +
      (typeof count === "number" ? `<span class="inv-count">x${count}</span>` : "") +
      `</div>`
    );
  }

  function renderTradeSide(side) {
    const state = side === "give" ? tradeGive : tradeWant;
    const grid = tradeComposeEl.querySelector(`.trade-skins-grid[data-side="${side}"]`);
    if (side === "give") {
      const catalog = mySkinsCatalog();
      grid.innerHTML = catalog.length
        ? catalog.map(({ kind, item }) => tradeTileHtml(kind, item, state.skins.some((s) => s.kind === kind && s.id === item.id))).join("")
        : `<div class="inv-note">You have no sellable skins yet.</div>`;
    } else {
      const catalog = targetSkinsCatalog();
      if (catalog === null) {
        grid.innerHTML = `<div class="inv-note">Their inventory hasn't synced yet.</div>`;
      } else if (!catalog.length) {
        grid.innerHTML = `<div class="inv-note">They own no tradeable skins yet.</div>`;
      } else {
        grid.innerHTML = catalog.map(({ kind, item, n }) => tradeTileHtml(kind, item, state.skins.some((s) => s.kind === kind && s.id === item.id), n)).join("");
      }
      const coins = targetCoins();
      const balanceEl = tradeComposeEl.querySelector("#trade-want-balance");
      balanceEl.textContent = coins === null ? "" : `They have ${formatBoardCoins(coins)} coins`;
      tradeComposeEl.querySelector('.trade-coins-input[data-side="want"]').max = coins === null ? "" : coins;
    }
    tradeComposeEl.querySelector(`.trade-coins-input[data-side="${side}"]`).value = state.coins;
  }

  function openTradeCompose(uid) {
    const rows = Cloud.getLeaderboardCache() || [];
    const i = rows.findIndex((r) => r.uid === uid);
    if (i < 0 || !tradeComposeEl) return;
    tradeTarget = { uid, name: rows[i].name, rank: i + 1 };
    tradeGive = { coins: 0, skins: [] };
    tradeWant = { coins: 0, skins: [] };
    tradeTargetSkinCounts = null; // loading - see its own note above
    tradeComposeEl.querySelector("#trade-compose-title").textContent = `PROPOSE TRADE - ${rows[i].name}`;
    renderTradeSide("give");
    renderTradeSide("want");
    tradeComposeEl.classList.add("show");
    // Fetch-on-open (2026-10-01), not a cache read - see tradeTargetSkinCounts' own note. Guarded against a
    // stale response landing after this screen was closed or reopened for a DIFFERENT target in the meantime
    // (tradeTarget would be null or point at a different uid by then).
    if (typeof Cloud !== "undefined") {
      Cloud.callFunction("getTargetInventory", { toUid: uid })
        .then((res) => {
          if (!tradeTarget || tradeTarget.uid !== uid) return;
          tradeTargetSkinCounts = (res && res.skinCounts) || null;
          renderTradeSide("want");
        })
        .catch(() => {
          /* offline, or refused for some other reason - "hasn't synced yet" is an honest enough fallback */
        });
    }
  }

  function closeTradeCompose() {
    if (tradeComposeEl) tradeComposeEl.classList.remove("show");
    tradeTarget = null;
    tradeTargetSkinCounts = null;
  }

  function skinLabel(kind, id) {
    const item = (Collection.skinItems(kind) || []).find((x) => x.id === id);
    return item ? item.name : id;
  }

  // `s.qty` is always 1 from THIS client's own compose state (no stacking - see tradeGive/tradeWant's own note),
  // but a real trade doc read back from the server (tradeRowHtml above) could in principle carry a higher qty, so
  // this stays qty-aware rather than assuming 1.
  function tradeSummaryLine(state) {
    const parts = [];
    if (state.coins > 0) parts.push(`${state.coins} coins`);
    parts.push(...state.skins.map((s) => (s.qty > 1 ? `${s.qty}x ` : "") + skinLabel(s.kind, s.id)));
    return parts.length ? esc(parts.join(", ")) : "nothing";
  }

  // The confirm itself reads as a real, weighty commitment (2026-09-29, the owner's ask: "look more serious") -
  // a bordered GIVE/WANT block instead of a plain sentence, the target's leaderboard rank next to their name,
  // and SEND OFFER styled `danger` (the same red every other real, consequential confirm in the game uses - SELL,
  // the account-overwrite warning) rather than a throwaway "OK". CANCEL backs out to the compose screen, still
  // open underneath, without sending anything - only SEND OFFER closes it.
  function handleTradeSend() {
    if (!tradeGive.coins && !tradeGive.skins.length && !tradeWant.coins && !tradeWant.skins.length) {
      openModal("TRADE OFFER", `<div class="modal-text">Offer at least a coin or a skin on one side first.</div>`, [{ label: "OK" }]);
      return;
    }
    openModal(
      "CONFIRM TRADE OFFER",
      `<div class="modal-text">Proposing a trade with <b>${esc(tradeTarget.name)}</b> (#${tradeTarget.rank}):</div>` +
        `<div class="trade-confirm-block">` +
        `<div class="trade-confirm-row"><span class="trade-confirm-label">YOU GIVE</span><span>${tradeSummaryLine(tradeGive)}</span></div>` +
        `<div class="trade-confirm-row"><span class="trade-confirm-label">YOU WANT</span><span>${tradeSummaryLine(tradeWant)}</span></div>` +
        `</div>`,
      [
        { label: "SEND OFFER", cls: "danger", onClick: () => sendTradeOffer() },
        { label: "CANCEL", cls: "ghost" },
      ]
    );
  }

  // The actual proposeTrade call (2026-09-30) - replaces what used to be a pure mockup (SEND just closed the
  // popup, nothing was ever created). Fires after the confirm modal above closes; a follow-up modal reports
  // success or the server's own rejection reason (not enough spendable coins, target went private since the
  // compose screen opened, an outgoing offer already exists, the rate limit, ...).
  //
  // FIX (2026-10-01, the owner's own ask - "ghost coins"): a real sender-side bug, found live-testing the
  // accept-trade fix above. The SERVER already escrows the offer the instant proposeTrade succeeds (reserved/
  // outgoingTradeId on this player's own save) - but nothing client-side ever reflected that locally, so the
  // sender's own coin counter stayed at its pre-trade number the whole time the offer was pending, then jumped
  // straight to whatever the NEXT full sync happened to pull, with nothing in between ever explaining why. The
  // owner's own fix, applied here: deduct the offer locally the INSTANT it's sent (mirroring the server's own
  // escrow, not guessing), refund it the instant the trade resolves to anything other than accepted (see
  // Cloud.onOutgoingTradeResolved's own subscription near the bottom of this file) - "all changes immediate."
  function sendTradeOffer() {
    const target = tradeTarget;
    closeTradeCompose(); // closes the compose screen underneath the confirm modal; tradeTarget captured above first
    const offer = { coins: tradeGive.coins, skins: tradeGive.skins.map((s) => ({ kind: s.kind, id: s.id, qty: 1 })) };
    const request = { coins: tradeWant.coins, skins: tradeWant.skins.map((s) => ({ kind: s.kind, id: s.id, qty: 1 })) };
    Cloud.callFunction("proposeTrade", { toUid: target.uid, offer, request })
      .then((res) => {
        if (offer.coins) Economy.addCoins(-offer.coins);
        offer.skins.forEach((s) => Economy.removeSkin(s.kind, s.id, s.qty));
        Cloud.setWatchedOutgoingTrade(res.tradeId, offer, request);
        openModal("TRADE OFFER SENT", `<div class="modal-text">Your offer is on its way to <b>${esc(target.name)}</b> - check the INBOX to see when it's answered.</div>`, [{ label: "OK" }]);
        Cloud.refreshTrades(() => refresh());
      })
      .catch((err) => {
        openModal("TRADE OFFER FAILED", `<div class="modal-text">${esc((err && err.message) || "Something went wrong.")}</div>`, [{ label: "OK" }]);
      });
  }

  function onTradeComposeClick(e) {
    const cell = e.target.closest(".box-inspect-cell[data-id]");
    if (cell) {
      const side = cell.closest(".trade-skins-grid").dataset.side;
      const state = side === "give" ? tradeGive : tradeWant;
      const idx = state.skins.findIndex((s) => s.kind === cell.dataset.kind && s.id === cell.dataset.id);
      if (idx >= 0) state.skins.splice(idx, 1);
      else state.skins.push({ kind: cell.dataset.kind, id: cell.dataset.id });
      if (typeof playUiClick === "function") playUiClick();
      // Toggle just this one tile's own class instead of re-rendering the whole grid (renderTradeSide rebuilds
      // every tile's innerHTML, which restarts a legendary tile's rainbow animation from scratch - even one NOT
      // being tapped - reading as the whole background "jumping" on every selection, 2026-09-29 bugfix).
      cell.classList.toggle("selected", idx < 0);
      return;
    }
    if (e.target.id === "trade-cancel-btn" || e.target === tradeComposeEl) {
      if (typeof playUiClick === "function") playUiClick();
      closeTradeCompose();
      return;
    }
    if (e.target.id === "trade-send-btn") {
      if (typeof playUiClick === "function") playUiClick();
      handleTradeSend();
    }
  }

  function onTradeComposeInput(e) {
    const input = e.target.closest(".trade-coins-input");
    if (!input) return;
    const side = input.dataset.side;
    let v = Math.max(0, Math.floor(Number(input.value) || 0));
    if (side === "give") v = Math.min(v, Economy.getCoins()); // can't offer more than you actually have
    // Can't REQUEST more than the target actually has either (2026-10-01, the owner's ask) - the server already
    // rejects this at accept time (acceptTrade's spendableCoins check), but there's no reason to let a doomed
    // request even be typed. A still-null balance (not yet synced) leaves this uncapped client-side; the server
    // check is the real backstop either way, this is purely a UX nicety.
    if (side === "want") {
      const coins = targetCoins();
      if (coins !== null) v = Math.min(v, coins);
    }
    input.value = v;
    (side === "give" ? tradeGive : tradeWant).coins = v;
  }

  function wireLeaderboardClick(root) {
    inspectEl = document.getElementById("board-inspect");
    if (!inspectEl || inspectEl.dataset.wired) return;
    inspectEl.dataset.wired = "1";
    inspectEl.addEventListener("click", onInspectClick);
    root.addEventListener("click", (e) => {
      const card = e.target.closest(".board-card[data-uid]");
      if (card) {
        openInspect(card.dataset.uid);
        return;
      }
      const tradeBtn = e.target.closest("[data-trade-act]");
      if (tradeBtn) onInboxAction(tradeBtn.dataset.tradeAct, tradeBtn.dataset.tradeId);
    });
    tradeComposeEl = document.getElementById("trade-compose");
    if (tradeComposeEl) {
      tradeComposeEl.addEventListener("click", onTradeComposeClick);
      tradeComposeEl.addEventListener("input", onTradeComposeInput);
    }
    const inboxBtn = document.getElementById("inbox-btn");
    if (inboxBtn) inboxBtn.addEventListener("click", toggleInbox);
  }

  // Version gate (2026-09-30, Cloud.onOutdated below - see src/cloud.js checkClientVersion/callFunction and
  // functions/lib/version.js). No-ops if already shown - Cloud's own `outdated` flag is sticky too, but this is
  // the cheap, local half of that same guard. Deliberately never closed by anything but the REFRESH button - see
  // the stopPropagation wiring right below, which matches #cleansing's own "nothing underneath can be tapped"
  // technique rather than openModal's tap-outside-to-cancel behavior (wrong here: the whole point is this cannot
  // be dismissed without actually reloading).
  function showOutdatedOverlay() {
    const el = document.getElementById("outdated-overlay");
    if (!el || el.classList.contains("show")) return;
    el.classList.add("show");
  }

  const outdatedEl = document.getElementById("outdated-overlay");
  if (outdatedEl) {
    const refreshBtn = outdatedEl.querySelector("#outdated-refresh-btn");
    if (refreshBtn) refreshBtn.addEventListener("click", () => location.reload());
    ["touchstart", "touchend", "mousedown", "mouseup", "pointerdown", "pointerup", "click"].forEach((ev) =>
      outdatedEl.addEventListener(ev, (e) => e.stopPropagation())
    );
  }

  // The one place an outgoing trade's local optimistic deduction (sendTradeOffer) ever gets reversed or
  // finalized (2026-10-01) - fed by Cloud from two different triggers that both funnel through the SAME
  // de-duplicated signal (cloud.js reportOutgoingTradeResolved/onOutgoingTradeResolved), so there's exactly one
  // place this reaction can ever fire, never two: the live listener noticing the OTHER player accepted/declined
  // it, or this player's own CANCEL succeeding (see runTradeAction above), or - surviving a reload across the
  // gap - a one-time check on load against whatever trade was still being watched when the page last closed.
  function onOutgoingTradeResolved(info) {
    if (info.status === "accepted") {
      // The offer side was already deducted the instant it was sent - only the REQUEST side (whatever this
      // player gets back, if anything) is new here.
      if (info.request.coins) Economy.addCoins(info.request.coins);
      info.request.skins.forEach((s) => Economy.addSkin(s.kind, s.id, s.qty));
      // Same auto-refresh as the accepter's own side (runTradeAction above) - this player didn't click ACCEPT,
      // but their own coins/skins just moved too, on a trade the other side completed.
      Cloud.refreshLeaderboard(() => refresh());
    } else {
      // declined or cancelled - give back exactly what was pre-deducted at send time.
      if (info.offer.coins) Economy.addCoins(info.offer.coins);
      info.offer.skins.forEach((s) => Economy.addSkin(s.kind, s.id, s.qty));
    }
  }

  if (typeof Cloud !== "undefined") {
    Cloud.onAuthChange(() => refresh());
    Cloud.setConfirmOverwrite(confirmCloudOverwrite);
    Cloud.onOutdated(showOutdatedOverlay);
    // Live trades (2026-10-01): fires on every push from either onSnapshot listener (cloud.js) - a trade
    // landing, being accepted/declined elsewhere, etc. - not just whenever something else happens to redraw.
    Cloud.onTradesChange(() => refresh());
    Cloud.onOutgoingTradeResolved(onOutgoingTradeResolved);
  }

  return { renderOptions, renderLeaderboard, wireLeaderboardClick, closeInspect, onClick, refresh, openModal, closeModal };
})();
