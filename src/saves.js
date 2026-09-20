// Save slots, and exporting / importing a save as a code you can copy and paste.
//
// Two slots. The one being played is the live save (Economy's own localStorage entry); the other slot keeps its data next to it
// (`snowyBallsSlotData<i>`), and `snowyBallsSlots` remembers the slot names, the last time each was loaded and which one is
// active. Loading another slot swaps the two saves over and reloads the page. Deleting a save (either slot) opens one dialog:
// the save is replaced by a new one the player names and starts as a new game or imports - it is never simply removed.
//
// A save code looks like  SB1.<compressed save>.<check>  (about 450-650 characters): the save JSON, deflated, as URL-safe
// base64, with a checksum that catches a code that was copied only in part. (SB0 is the same without compression, for a
// browser that cannot compress.) A code from before the current grand reset (Economy SAVE_EPOCH) is refused.
const Saves = (() => {
  const META_KEY = "snowyBallsSlots";
  const DATA_PREFIX = "snowyBallsSlotData";
  const SLOT_COUNT = 2;
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  let meta = null;
  let listEl = null; // the OPTIONS list's scroll area (set by renderOptions)

  // ---------- storage ----------
  function readJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch (e) {
      return null;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* storage unavailable: nothing to do */
    }
  }

  function defaultName(i) {
    return "Save " + (i + 1);
  }

  function saveMeta() {
    write(META_KEY, JSON.stringify(meta));
  }

  function init() {
    meta = readJson(META_KEY);
    const valid = meta && Number.isInteger(meta.active) && meta.active >= 0 && meta.active < SLOT_COUNT && Array.isArray(meta.slots);
    if (!valid) meta = { active: 0, slots: [{ name: defaultName(0), lastLoaded: null }, null] };
    meta.slots = Array.from({ length: SLOT_COUNT }, (_, i) => {
      const s = meta.slots[i];
      return s && typeof s.name === "string" ? { name: s.name, lastLoaded: typeof s.lastLoaded === "number" ? s.lastLoaded : null } : null;
    });
    if (!meta.slots[meta.active]) meta.slots[meta.active] = { name: defaultName(meta.active), lastLoaded: null };
    if (!meta.slots[0]) meta.slots[0] = { name: defaultName(0), lastLoaded: null };
    // The slots that are not being played must still hold a usable save (one made under the current grand reset).
    for (let i = 0; i < SLOT_COUNT; i++) {
      if (i === meta.active || !meta.slots[i]) continue;
      if (!Economy.sanitize(readJson(DATA_PREFIX + i))) {
        if (i === 0) {
          write(DATA_PREFIX + i, Economy.freshJson()); // slot 1 is never empty: a brand-new game
          meta.slots[0] = { name: defaultName(0), lastLoaded: null };
        } else {
          meta.slots[i] = null;
          try {
            localStorage.removeItem(DATA_PREFIX + i);
          } catch (e) {
            /* ignore */
          }
        }
      }
    }
    meta.slots[meta.active].lastLoaded = Date.now(); // this page load IS the last time the active slot was loaded
    saveMeta();
  }

  function getSlots() {
    return meta.slots.map((s, i) => ({ index: i, name: s ? s.name : "", lastLoaded: s ? s.lastLoaded : null, empty: !s, active: meta.active === i }));
  }

  function formatDate(ms) {
    if (ms == null) return "never";
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function cleanName(name, i) {
    const n = String(name || "").replace(/\s+/g, " ").trim().slice(0, 16);
    return n || defaultName(i);
  }

  // ---------- the code ----------
  function crc32(str) {
    let c = ~0;
    for (let i = 0; i < str.length; i++) {
      c ^= str.charCodeAt(i);
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ((~c) >>> 0).toString(16).padStart(8, "0");
  }

  function toB64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x2000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x2000));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromB64(str) {
    const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }

  async function pipe(bytes, stream) {
    const w = stream.writable.getWriter();
    w.write(bytes);
    w.close();
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
  }

  async function encode(json) {
    const raw = new TextEncoder().encode(json);
    let tag = "SB0";
    let bytes = raw;
    if (typeof CompressionStream !== "undefined") {
      tag = "SB1";
      bytes = await pipe(raw, new CompressionStream("deflate-raw"));
    }
    const payload = toB64(bytes);
    return `${tag}.${payload}.${crc32(payload)}`;
  }

  // The secret import code "god mode": instead of a save it builds one with a huge wallet and a pile of every projectile and
  // buff, flagged `god` so that Economy never uses anything up or charges for anything (for testing / playing around).
  async function godSave() {
    let eco = null;
    try {
      eco = await (await fetch("economy.json?t=" + Date.now())).json();
    } catch (e) {
      throw new Error("Could not load the game data. Try again.");
    }
    const s = JSON.parse(Economy.freshJson());
    s.god = true;
    s.coins = 999999999;
    s.lifetimeCoins = 999999999;
    for (const [id, p] of Object.entries(eco.projectiles || {})) if (id !== "snowball" && !p.infinite && !p.regen) s.projectiles[id] = 999;
    for (const it of (eco.shop && eco.shop.items) || []) if (it.category === "consumable") s.buffItems[it.id] = 999;
    return Economy.sanitize(s);
  }

  // Returns the (cleaned) save, or throws an Error whose message is meant for the player.
  async function decode(code) {
    if (String(code || "").trim().toLowerCase().replace(/\s+/g, " ") === "god mode") return godSave();
    const text = String(code || "").replace(/\s+/g, "");
    const parts = text.split(".");
    if (parts.length !== 3 || (parts[0] !== "SB0" && parts[0] !== "SB1")) throw new Error("That is not a save code.");
    if (crc32(parts[1]) !== parts[2]) throw new Error("The code is damaged or cut short. Copy it again.");
    let json;
    try {
      let bytes = fromB64(parts[1]);
      if (parts[0] === "SB1") {
        if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot read this code.");
        bytes = await pipe(bytes, new DecompressionStream("deflate-raw"));
      }
      json = new TextDecoder().decode(bytes);
    } catch (e) {
      throw new Error(e && e.message === "This browser cannot read this code." ? e.message : "The code is damaged. Copy it again.");
    }
    let obj = null;
    try {
      obj = JSON.parse(json);
    } catch (e) {
      throw new Error("The code is damaged. Copy it again.");
    }
    const clean = Economy.sanitize(obj);
    if (!clean) {
      const old = obj && typeof obj === "object" && !(typeof obj.epoch === "number" && obj.epoch >= Economy.getEpoch());
      throw new Error(old ? "This save is from before the grand cleansing and can no longer be used." : "This is not a valid save.");
    }
    return clean;
  }

  async function exportCode(i) {
    const json = meta.active === i ? Economy.snapshot() : localStorage.getItem(DATA_PREFIX + i);
    return encode(json);
  }

  // ---------- changing slots ----------
  function createNew(i, name) {
    write(DATA_PREFIX + i, Economy.freshJson());
    meta.slots[i] = { name: cleanName(name, i), lastLoaded: null };
    saveMeta();
    refresh();
  }

  // "Deleting" slot 1: it can never be empty, so the player names the save that takes its place and chooses how it starts
  // (a new game, or an imported code). Nothing is erased until they do. The game being played is swapped, hence the reload.
  function replaceSlot(i, name, cleanState) {
    const data = cleanState ? JSON.stringify(cleanState) : Economy.freshJson();
    if (meta.active === i) {
      Economy.lockSaves();
      write(Economy.storageKey, data);
      meta.slots[i] = { name: cleanName(name, i), lastLoaded: Date.now() };
      saveMeta();
      location.reload();
      return;
    }
    write(DATA_PREFIX + i, data);
    meta.slots[i] = { name: cleanName(name, i), lastLoaded: null };
    saveMeta();
    refresh();
  }

  function importInto(i, name, cleanState) {
    write(DATA_PREFIX + i, JSON.stringify(cleanState));
    meta.slots[i] = { name: cleanName(name, i), lastLoaded: null };
    saveMeta();
    refresh();
  }

  // Swaps the saves over and reloads. Economy is locked first so nothing can write its old state over the swap.
  function switchTo(i, then) {
    Economy.lockSaves();
    const cur = meta.active;
    write(DATA_PREFIX + cur, Economy.snapshot()); // the game being left keeps its progress in its slot
    write(Economy.storageKey, localStorage.getItem(DATA_PREFIX + i));
    try {
      localStorage.removeItem(DATA_PREFIX + i);
    } catch (e) {
      /* ignore */
    }
    meta.active = i;
    meta.slots[i].lastLoaded = Date.now();
    if (then) then();
    saveMeta();
    location.reload();
  }

  function loadSlot(i) {
    if (meta.active === i || !meta.slots[i]) return;
    switchTo(i);
  }

  // ---------- popups ----------
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

  function showExport(i) {
    const slot = meta.slots[i];
    const panel = openModal("EXPORT: " + slot.name.toUpperCase(), `<div class="modal-text">Copy this code and keep it. Paste it into IMPORT (on this or any other device) to get this save back.</div><textarea class="modal-code" readonly spellcheck="false">making the code...</textarea>`, [
      {
        label: "COPY",
        onClick: (el) => {
          const ta = el.querySelector("textarea");
          ta.select();
          const done = () => {
            const b = el.querySelector('.modal-btn[data-k="0"]');
            if (b) b.textContent = "COPIED";
          };
          try {
            navigator.clipboard.writeText(ta.value).then(done, () => {
              document.execCommand("copy");
              done();
            });
          } catch (e) {
            document.execCommand("copy");
            done();
          }
          return false;
        },
      },
      { label: "CLOSE", cls: "ghost" },
    ]);
    exportCode(i).then((code) => {
      const ta = panel.querySelector("textarea");
      if (ta) ta.value = code;
    });
  }

  // Slot 1 cannot be left empty: instead of a plain delete, name its replacement and choose new game / import.
  function showReplace(i, name) {
    const s = meta.slots[i];
    openModal(
      "DELETE SAVE?",
      `<div class="modal-text">"${esc(s.name)}" will be erased and replaced by a new save. This cannot be undone. Name the new save, then start a new game or import a code.</div><input class="modal-input" maxlength="16" value="${esc(name || defaultName(i))}" spellcheck="false" />`,
      [
        { label: "NEW GAME", cls: "danger", onClick: (el) => replaceSlot(i, el.querySelector("input").value, null) },
        { label: "IMPORT", cls: "danger", onClick: (el) => (showImport(i, el.querySelector("input").value, true), false) },
        { label: "CANCEL", cls: "ghost" },
      ]
    );
  }

  // Deleting any save opens the same dialog: name the save that replaces it, then start a new game or import a code.
  function showDelete(i) {
    showReplace(i);
  }

  function showLoad(i) {
    const cur = meta.slots[meta.active];
    openModal("LOAD " + meta.slots[i].name.toUpperCase() + "?", `<div class="modal-text">The game restarts with this save. "${esc(cur.name)}" keeps its progress and can be loaded again any time.</div>`, [
      { label: "LOAD", onClick: () => loadSlot(i) },
      { label: "CANCEL", cls: "ghost" },
    ]);
  }

  function showCreate(i, name) {
    openModal(
      "CREATE SAVE",
      `<div class="modal-text">Name the new save, then start a new game or import a code.</div><input class="modal-input" maxlength="16" value="${esc(name || defaultName(i))}" spellcheck="false" />`,
      [
        { label: "NEW GAME", onClick: (el) => createNew(i, el.querySelector("input").value) },
        { label: "IMPORT", onClick: (el) => (showImport(i, el.querySelector("input").value), false) },
        { label: "CANCEL", cls: "ghost" },
      ]
    );
  }

  function showImport(i, name, replace) {
    let parsed = null;
    let seq = 0;
    const panel = openModal(
      "IMPORT",
      `<div class="modal-text">Paste a save code.${replace ? " It replaces the save you are deleting." : ""}</div><textarea class="modal-code" spellcheck="false" placeholder="SB1...."></textarea><div class="modal-status"></div>`,
      [
        {
          label: "IMPORT",
          onClick: () => {
            if (!parsed) return false;
            if (replace) replaceSlot(i, name, parsed);
            else importInto(i, name, parsed);
          },
        },
        { label: "BACK", cls: "ghost", onClick: () => ((replace ? showReplace(i, name) : showCreate(i, name)), false) },
      ]
    );
    const ta = panel.querySelector("textarea");
    const status = panel.querySelector(".modal-status");
    const importBtn = panel.querySelector('.modal-btn[data-k="0"]');
    importBtn.classList.add("off");
    ta.addEventListener("input", async () => {
      const mine = ++seq;
      parsed = null;
      importBtn.classList.add("off");
      if (!ta.value.trim()) {
        status.textContent = "";
        return;
      }
      try {
        const clean = await decode(ta.value);
        if (mine !== seq) return;
        parsed = clean;
        importBtn.classList.remove("off");
        status.className = "modal-status ok";
        status.textContent = clean.god ? "GOD MODE" : `${clean.coins} coins`;
      } catch (e) {
        if (mine !== seq) return;
        status.className = "modal-status bad";
        status.textContent = e.message;
      }
    });
  }

  // ---------- the OPTIONS list ----------
  const ICON_DOWNLOAD =
    '<svg viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true"><path fill="#fff" d="M5 1h2v5H5zM3 6h6v1H3zM4 7h4v1H4zM5 8h2v1H5zM2 10h8v1H2z"/></svg>';
  const ICON_TRASH =
    '<svg viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true"><path fill="#fff" d="M4 1h4v1H4zM2 2h8v1H2zM3 3h6v8H3z"/><path fill="#8b5a2b" d="M5 4h1v6H5zM7 4h1v6H7z"/></svg>';

  function slotHtml(s) {
    if (s.empty) {
      return `<div class="save-row"><button type="button" class="save-slot empty" data-act="create" data-i="${s.index}">+ CREATE</button></div>`;
    }
    return (
      `<div class="save-row">` +
      `<button type="button" class="save-slot${s.active ? " active" : ""}" data-act="load" data-i="${s.index}">` +
      `<span class="save-name">${esc(s.name)}</span>` +
      `<span class="save-date">Last loaded: ${esc(formatDate(s.lastLoaded))}</span>` +
      (s.active ? `<span class="save-tag">PLAYING</span>` : "") +
      `</button>` +
      `<div class="save-btns">` +
      `<button type="button" class="save-icon" data-act="export" data-i="${s.index}" aria-label="Export">${ICON_DOWNLOAD}</button>` +
      `<button type="button" class="save-icon" data-act="delete" data-i="${s.index}" aria-label="Delete">${ICON_TRASH}</button>` +
      `</div></div>`
    );
  }

  function renderOptions(el) {
    listEl = el;
    // Every section of the list is a rectangle of its own (SAVES now, others may follow).
    el.innerHTML = `<div class="opt-section"><div class="opt-head">SAVES</div>${getSlots().map(slotHtml).join("")}</div>`;
  }

  function refresh() {
    if (listEl && listEl.dataset.kind === "options") renderOptions(listEl);
  }

  function onClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b || !meta) return;
    const i = Number(b.dataset.i);
    if (typeof playUiClick === "function") playUiClick();
    if (b.dataset.act === "create") showCreate(i);
    else if (b.dataset.act === "export") showExport(i);
    else if (b.dataset.act === "delete") showDelete(i);
    else if (b.dataset.act === "load" && meta.active !== i) showLoad(i);
  }

  init();

  return { renderOptions, onClick, getSlots, formatDate };
})();
