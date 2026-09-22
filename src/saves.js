// OPTIONS list: VOLUME, ACCOUNT (sign in with Google - src/cloud.js) and LEADERBOARD.
//
// There used to be a SAVES section here (multiple named slots, export/import as a copy-paste code, a "god mode" import
// code) - removed 2026-09-22 (see docs/NOTES.md "The leaderboard"): there is only ever ONE save now (Economy's own
// localStorage entry), and it cannot be reset, deleted or renamed from the UI. Signing in with Google does not replace it
// or download anything into it either - it only ever pushes this device's current numbers outward, to the leaderboard (see
// cloud.js); nothing is ever pulled down. What used to be the "god mode" import code is now a console-only dev tool,
// window.godMode() on localhost (see main.js) - the SAVES section was its only in-game door, so it needed a replacement.
const Saves = (() => {
  // ---------- popups (shared with Cloud's "this account already has a save" confirm - see wireCloudConfirm below) ----------
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

  // ---------- the OPTIONS list ----------
  let listEl = null; // the OPTIONS list's scroll area (set by renderOptions)

  function renderOptions(el) {
    listEl = el;
    // Every section of the list is a rectangle of its own.
    el.innerHTML =
      `<div class="opt-section"><div class="opt-head">VOLUME</div><div class="vol-row" data-vol="master"><input class="vol-slider" type="range" min="0" max="100" step="1" aria-label="Volume" /><span class="vol-value"></span></div>` +
      `<div class="vol-name">Weather</div><div class="vol-row" data-vol="weather"><input class="vol-slider" type="range" min="0" max="100" step="1" aria-label="Weather" /><span class="vol-value"></span></div></div>` +
      accountSectionHtml() +
      leaderboardSectionHtml();
    wireVolume(el);
  }

  // ---- ACCOUNT: sign in with Google (Cloud, src/cloud.js) - only what's needed to join the leaderboard. ----
  function accountSectionHtml() {
    if (typeof Cloud === "undefined" || !Cloud.isConfigured()) return ""; // no Firebase project set up yet: no dead button
    const user = Cloud.getUser();
    const body = user
      ? `<div class="account-row"><span class="account-name">${esc(user.name)}</span><button type="button" class="save-icon-btn" data-act="signout">SIGN OUT</button></div>`
      : `<div class="account-row"><span class="account-hint">Sign in to join the leaderboard.</span><button type="button" class="save-icon-btn" data-act="signin">SIGN IN</button></div>`;
    // The last sign-in failure (Cloud.signIn), if any - so what went wrong is readable in the game itself, no devtools needed.
    const error = Cloud.getAuthError();
    const errorLine = !user && error ? `<div class="account-error">Sign-in failed: ${esc(error)}</div>` : "";
    return `<div class="opt-section"><div class="opt-head">ACCOUNT</div>${body}${errorLine}</div>`;
  }

  // ---- LEADERBOARD: everyone's CURRENT coins, ranked - a public reading of Cloud's cache (see cloud.js and
  // collection.js's open("options"), which is what actually triggers a fresh read - this only ever draws what is cached). ----
  // Same shortening as the live coin counter (index.html): 1,234,000 -> "1M", so a leaderboard total never gets unreadable.
  function formatBoardCoins(n) {
    if (n >= 1e9) return Math.floor(n / 1e9) + "B";
    if (n >= 1e6) return Math.floor(n / 1e6) + "M";
    return String(n);
  }

  function leaderboardRowHtml(row, rank) {
    return (
      `<div class="board-row"><span class="board-rank">${rank}</span><span class="board-name">${esc(row.name)}</span>` +
      `<span class="board-coins"><i class="coin"></i>${formatBoardCoins(row.coins)}</span></div>`
    );
  }

  function leaderboardSectionHtml() {
    if (typeof Cloud === "undefined" || !Cloud.isConfigured()) return "";
    const rows = Cloud.getLeaderboardCache();
    const body = !rows
      ? `<div class="board-empty">Loading...</div>`
      : rows.length
        ? rows.map((row, i) => leaderboardRowHtml(row, i + 1)).join("")
        : `<div class="board-empty">No scores yet.</div>`;
    return `<div class="opt-section"><div class="opt-head">LEADERBOARD</div>${body}</div>`;
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
  }

  function onClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "signin" || b.dataset.act === "signout") {
      if (typeof playUiClick === "function") playUiClick();
      if (typeof Cloud !== "undefined") Cloud[b.dataset.act === "signin" ? "signIn" : "signOut"]();
    }
  }

  // Cloud (cloud.js) has no DOM/modal code of its own - it asks THIS module to confirm something with the player via this
  // hook, and gets a Promise<boolean> back (true = go ahead). Used for exactly one thing right now: "this Google account
  // already has a save on the leaderboard - signing in here will start overwriting it with this device's numbers instead
  // (nothing is ever downloaded), continue?" - shown once, right after a fresh interactive sign-in (never on a page reload
  // that merely restores an existing session - see cloud.js signIn()).
  function confirmCloudOverwrite(existing) {
    return new Promise((resolve) => {
      openModal(
        "ALREADY HAS A SAVE",
        `<div class="modal-text">This Google account already has a save on the leaderboard: <b>${esc(existing.name)}</b>, ${formatBoardCoins(existing.coins)} coins.` +
          ` Signing in here does not download it - it will start being replaced by THIS device's numbers instead. Continue?</div>`,
        [
          { label: "SIGN IN ANYWAY", cls: "danger", onClick: () => resolve(true) },
          { label: "CANCEL", cls: "ghost", onClick: () => resolve(false) },
        ]
      );
    });
  }

  if (typeof Cloud !== "undefined") {
    Cloud.onAuthChange(() => refresh());
    Cloud.setConfirmOverwrite(confirmCloudOverwrite);
  }

  return { renderOptions, onClick, refresh };
})();
