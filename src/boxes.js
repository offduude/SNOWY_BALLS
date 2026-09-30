// BOXES: three always-available mystery boxes (character / scenery / weather), bought with coins from the
// corkboard grid the SHOP tab used to own (see shop.js's own note on #boxes-board/#boxes-items, 2026-09-27).
// A box's prize pool is that kind's own master list in economy.json (characters / sceneries / weathers) - the
// same list the SKINS menu equips from, and (2026-09-27) EVERY non-default skin that exists today is in one of
// these three pools already, just by virtue of poolFor() excluding only the default (see below) - there's
// nothing else to add. A draw is weighted by the shared rarity chances (economy.json "rarities"), the same idea
// as a shop slot's own rarity roll (see shop.js pickWeighted) but scoped to one kind's pool instead of the whole
// shop catalog. There's no "already owned" case to special-case: skins are stackable now (Economy.addSkin), so
// every draw - new or a duplicate - is a real, useful outcome.
//
// Redesigned 2026-09-27: bright colour buttons instead of the shop's old pinned-leaflet look (no category label
// any more, box.png as the closed-box art, price centered), plus a HOLD-to-inspect popup (same convention as the
// old shop's hold-to-inspect) showing every possible item in a box - just its picture and a "chance%" caption,
// styled like the game's own "TAP to AIM" message - tapping one of THOSE opens its own full item card on top.
//
// The bottom row (seasonal boxes) is a static "Coming Soon..." placeholder for now - no logic, no data.
const Boxes = (() => {
  let eco = null;
  let root = null; // #boxes-items
  let inspectEl = null; // #boxes-inspect (the odds grid)
  let inspectGridEl = null;
  let itemEl = null; // #boxes-inspect-item (one item's own card, on top of the odds grid)
  let itemCardEl = null;
  let openEl = null; // #box-open (the case-opening popup)
  let windowEl = null; // #box-open-window (the reel's fixed viewport)
  let reelEl = null; // #box-open-reel (the scrolling strip)
  let resultEl = null; // #box-open-result (rarity + name, shown once landed)
  let rarityEl = null;
  let nameEl = null;
  let captionEl = null; // #box-open-caption ("TAP to CONTINUE")

  const KINDS = ["character", "scenery", "weather"];
  const KIND_LIST = { character: "characters", scenery: "sceneries", weather: "weathers" };
  // Bright, distinct colour per kind - the owner's ask ("bright colour buttons" instead of the old
  // advertisement-leaflet look); no category label drawn on the card any more, the colour itself tells them apart.
  const KIND_COLOR = {
    character: "linear-gradient(160deg, #ff6b6b, #f06595)",
    scenery: "linear-gradient(160deg, #51cf66, #20c997)",
    weather: "linear-gradient(160deg, #339af0, #5c7cfa)",
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function boxDef(kind) {
    return (eco.boxes || []).find((b) => b.kind === kind) || null;
  }

  // The inspect popup's icon background, reflecting the item's own rarity colour (same convention as
  // buffs.js's own tintAttrs for BUFF cards: a flat ~22% tint of the rarity's colour, or the shared animated
  // rainbow background for legendary - concatenated straight into the class/style attributes, same trick).
  function tintAttrs(item) {
    const r = Rarity.info(item.rarity);
    if (!r) return "";
    if (r.color === "rainbow") return " rainbow";
    const m = /^#([0-9a-f]{6})$/i.exec(r.color || "");
    if (!m) return "";
    const n = parseInt(m[1], 16);
    return ` tinted" style="--tint: rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.22)`;
  }

  // Every real (non-default) skin of a kind: the default one is always already owned for free, never a prize.
  function poolFor(kind) {
    return (eco[KIND_LIST[kind]] || []).filter((it) => it.rarity !== "default");
  }

  // A box's own rarity odds (economy.json boxOdds, 2026-09-27) - deliberately separate from the shop's own
  // rarities[].chance, so boxes can feel different from the shop without touching shop/event odds.
  function boxChance(rarityId) {
    return (eco.boxOdds || {})[rarityId] || 0;
  }

  // Weighted by boxOdds - roll a rarity, then pick uniformly among this kind's items at that rarity (an item
  // with no rarity counts as the most common one, same convention as shop.js).
  function draw(kind) {
    const pool = poolFor(kind);
    if (!pool.length) return null;
    const rarities = (eco.rarities || []).filter((r) => boxChance(r.id) > 0);
    if (!rarities.length) return pool[Math.floor(Math.random() * pool.length)];
    const rid = (it) => (rarities.some((r) => r.id === it.rarity) ? it.rarity : rarities[0].id);
    const present = rarities.filter((r) => pool.some((it) => rid(it) === r.id));
    const total = present.reduce((sum, r) => sum + boxChance(r.id), 0);
    let roll = Math.random() * total;
    let chosen = present[present.length - 1];
    for (const r of present) {
      roll -= boxChance(r.id);
      if (roll < 0) {
        chosen = r;
        break;
      }
    }
    const atRarity = pool.filter((it) => rid(it) === chosen.id);
    return atRarity[Math.floor(Math.random() * atRarity.length)];
  }

  // The exact same math as draw() above, but as a percentage per item instead of one random pick - for the
  // inspect popup ("chance% below each item's picture"). Sorted by rarity ASCENDING, common first (left),
  // legendary last (right) - the owner's ask, 2026-09-27 (was: biggest chance first).
  function oddsFor(kind) {
    const pool = poolFor(kind);
    const rarities = (eco.rarities || []).filter((r) => boxChance(r.id) > 0);
    if (!rarities.length) {
      const each = pool.length ? 100 / pool.length : 0;
      return pool.map((it) => ({ item: it, chance: each }));
    }
    const rid = (it) => (rarities.some((r) => r.id === it.rarity) ? it.rarity : rarities[0].id);
    const present = rarities.filter((r) => pool.some((it) => rid(it) === r.id));
    const total = present.reduce((sum, r) => sum + boxChance(r.id), 0);
    return pool
      .map((it) => {
        const r = present.find((x) => x.id === rid(it));
        const sameRarityCount = pool.filter((x) => rid(x) === rid(it)).length;
        const chance = r && total > 0 ? (boxChance(r.id) / total / sameRarityCount) * 100 : 0;
        return { item: it, chance: Math.round(chance * 10) / 10 };
      })
      .sort((a, b) => Rarity.rank(a.item.rarity) - Rarity.rank(b.item.rarity));
  }

  // Per-kind animation state: "shaking" is just the quick can't-afford (or, since 2026-09-30, server-refused)
  // nudge. A real purchase instead opens the full-screen case-opening popup below (currentKind) - the box
  // button itself goes straight back to its normal look, since the popup covers the whole screen anyway.
  // Neither is saved - a reload mid-popup just shows the box normally, nothing is lost (the coins were already
  // spent and the skin already added the moment the draw is decided, not when the popup finishes).
  let shaking = {};
  let pending = {}; // { kind: true } while a real openBox Cloud Function call is in flight - blocks a second tap

  function boxCardHtml(kind) {
    const def = boxDef(kind);
    if (!def) return `<div class="box-btn box-soon"><span class="box-name">(TBD)</span></div>`;
    const afford = Economy.getCoins() >= def.price;
    return (
      `<button class="box-btn${afford ? "" : " cant"}${shaking[kind] ? " shake" : ""}" data-kind="${esc(kind)}" type="button" style="background:${KIND_COLOR[kind]}">` +
      `<span class="box-pic"><img src="assets/ui/box.png" alt="" draggable="false" /></span>` +
      `<span class="box-name">${esc(def.name)}</span>` +
      `<span class="box-price"><i class="coin"></i>${def.price}</span>` +
      `</button>`
    );
  }

  function render() {
    if (!root) return;
    const soon = `<div class="box-btn box-soon"><span class="box-name">Coming Soon...</span></div>`;
    root.innerHTML = `<div class="shop-grid">${KINDS.map(boxCardHtml).join("")}${soon}${soon}${soon}</div>`;
  }

  function shakeBox(kind) {
    shaking[kind] = true;
    render();
    setTimeout(() => {
      shaking[kind] = false;
      render();
    }, 300);
  }

  // The original, fully-local purchase - unchanged, and still exactly what runs while signed out (matching
  // every other Cloud Function call this migration has made: signed-out play keeps working exactly as it
  // always has, see serverOpenBox's own note below on why "online" isn't forced just by being signed in yet).
  function localOpenBox(kind, def) {
    if (!Economy.spendCoins(def.price)) {
      shakeBox(kind);
      return;
    }
    const item = draw(kind);
    if (!item) {
      Economy.addCoins(def.price); // refund: this kind's pool is empty (shouldn't happen with real content)
      return;
    }
    Economy.addSkin(kind, item.id, 1); // granted the instant the draw is decided, not when the popup finishes
    currentKind = kind;
    runReel(kind, item);
  }

  // Server-authoritative (2026-09-30): the openBox Cloud Function itself was built and emulator-tested weeks
  // ago (see the blaze-migration memory) - this is the first time any client actually calls it. Its own header
  // comment already says the intent plainly: "Returns the drawn item so the client can play its reel animation
  // against the REAL result instead of deciding one itself" - so unlike useBuff/claimThrow (Option B: the local
  // action already happened, the server call only reconciles afterward), this WAITS for the real draw before
  // granting or animating anything, same shape trading already established (SEND OFFER doesn't grant anything
  // optimistically either). Real coins are spent and a real prize is decided server-side, closing exactly the
  // gap economy.json's own _boxOddsSecurityNote flags: devtools can no longer edit box odds, because nothing
  // client-side decides them any more on this path.
  //
  // Gated on being signed in, same as every other Cloud Function call this migration has made - a signed-OUT
  // player still gets the exact original localOpenBox above, unchanged. The "always-online required" end state
  // the migration's own memory already accepts as a future trade-off isn't forced today just by being signed
  // in - only once this is genuinely live (rules+Functions published, the coordinated cutover) does that
  // become real; until then this whole branch stays unpushed, same discipline as everything else built this
  // session.
  function serverOpenBox(kind, def) {
    pending[kind] = true;
    Cloud.callFunction("openBox", { kind })
      .then((res) => {
        pending[kind] = false;
        const item = (eco[KIND_LIST[kind]] || []).find((it) => it.id === res.itemId);
        if (!item) {
          console.warn("openBox: server drew an item this client's economy.json doesn't recognize:", res.itemId);
          render();
          return;
        }
        // The server already validated and spent real coins - applied here as the ACTUAL delta
        // (res.coins - the local balance right now), never a blind -def.price (a real bug caught in live
        // testing, 2026-09-30: openBox skips the cost entirely for the admin uid - see functions/economy.js
        // isAdmin(uid) - so a flat -def.price wrongly docked a free admin pull the full box price locally, even
        // though the server never charged it). Same "trust the server's own math, don't re-derive it" delta
        // reconciliation claimThrow already established, not Economy.spendCoins (which would re-run an
        // affordability check against a LOCAL balance the server has already moved past).
        const delta = res.coins - Economy.getCoins();
        if (delta !== 0) Economy.addCoins(delta);
        Economy.addSkin(kind, item.id, 1);
        currentKind = kind;
        runReel(kind, item);
      })
      .catch((err) => {
        pending[kind] = false;
        console.warn("openBox (server) rejected:", err && err.message);
        shakeBox(kind);
      });
  }

  function openBox(kind) {
    if (shaking[kind] || currentKind || pending[kind]) return; // already mid-animation, or a real call is already in flight: ignore a second tap
    const def = boxDef(kind);
    if (!def) return;
    const online = typeof Cloud !== "undefined" && Cloud.getUser && Cloud.getUser() && !(typeof Economy !== "undefined" && Economy.isGod && Economy.isGod());
    if (online) serverOpenBox(kind, def);
    else localOpenBox(kind, def);
  }

  // ---------- CASE-OPENING POPUP (2026-09-27, CS:GO-style reel) ----------
  // The prize was already decided in openBox above - this is pure presentation. A long horizontal strip is built
  // out of random filler items (drawn the exact same weighted way as the real prize, just never granted - draw()
  // has no side effects, so calling it purely for looks is free) with the one real prize placed near the end,
  // then the strip is scrolled left under a fixed centre marker with a decelerating ease (easeOutQuint) so it
  // settles on the prize. Ticks fire exactly when a cell's centre crosses the marker - computed from the strip's
  // own actual on-screen position each frame, not a guessed timer, so they always match what's drawn even if a
  // slow device drops frames. A small random offset inside the winning cell (bounded well short of a neighbour)
  // keeps every reveal from framing dead-centre, the same trick real case-opening animations use.
  const REEL_FILLER_COUNT = 34;
  const REEL_WIN_INDEX = 28; // ~6 more cells after the prize, so the strip doesn't just stop dead at the end
  const REEL_DURATION_MS = 4200;
  let currentKind = null; // the kind whose popup is open, or null
  let landed = false; // true once the reel has actually stopped - a tap only closes the popup once this is true

  function easeOutQuint(x) {
    return 1 - Math.pow(1 - x, 5);
  }

  function reelCellHtml(item, isWin) {
    return (
      `<div class="box-open-cell${isWin ? " win-cell" : ""}">` +
      `<span class="box-open-icon${tintAttrs(item)}">` +
      `<img src="${esc(item.image || "")}" alt="" draggable="false" />` +
      `</span></div>`
    );
  }

  function runReel(kind, item) {
    const cellsHtml = [];
    for (let i = 0; i < REEL_FILLER_COUNT; i++) {
      cellsHtml.push(reelCellHtml(i === REEL_WIN_INDEX ? item : draw(kind) || item, i === REEL_WIN_INDEX));
    }
    reelEl.innerHTML = cellsHtml.join("");
    reelEl.style.transition = "none";
    reelEl.style.transform = "translateX(0)";
    landed = false;
    resultEl.classList.remove("show");
    captionEl.classList.remove("show");
    openEl.classList.add("show");

    // Measure only after the popup is actually visible (.show is what gives #box-open-window its real size).
    requestAnimationFrame(() => {
      const winCellEl = reelEl.querySelector(".win-cell");
      const winIcon = winCellEl.querySelector(".box-open-icon");
      const windowW = windowEl.clientWidth;
      const cellW = winCellEl.offsetWidth;
      const jitter = (Math.random() - 0.5) * cellW * 0.5; // stays well inside the winning cell, never near a neighbour
      const targetCenter = winCellEl.offsetLeft + cellW / 2 + jitter;
      const distance = targetCenter - windowW / 2;
      const crossPoints = Array.from(reelEl.querySelectorAll(".box-open-cell"))
        .map((c) => c.offsetLeft + c.offsetWidth / 2 - windowW / 2)
        .filter((p) => p > 0 && p <= distance);
      let tickPtr = 0;
      const start = performance.now();
      function frame(now) {
        const x = Math.min(1, (now - start) / REEL_DURATION_MS);
        const travelled = distance * easeOutQuint(x);
        reelEl.style.transform = `translateX(${-travelled}px)`;
        while (tickPtr < crossPoints.length && crossPoints[tickPtr] <= travelled) {
          tickSound();
          tickPtr++;
        }
        if (x < 1) {
          requestAnimationFrame(frame);
          return;
        }
        landed = true;
        winIcon.classList.add("landed");
        rarityEl.innerHTML = Rarity.labelHtml(item.rarity, "", true);
        nameEl.textContent = item.name;
        resultEl.classList.add("show");
        captionEl.classList.add("show");
        revealSound(item.rarity);
      }
      requestAnimationFrame(frame);
    });
  }

  function tickSound() {
    const game = window.snowyBallsGame;
    if (game) game.sound.play("click", { volume: 0.16 });
  }

  function revealSound(rarityId) {
    const game = window.snowyBallsGame;
    if (!game) return;
    // Legendary gets its own dedicated fanfare (legendary_pull.mp3, 2026-09-27); every other rarity - epic
    // included - just gets the plain confirmation click, so legendary is the only pull with a distinct sound.
    if (rarityId === "legendary") game.sound.play("legendary_pull", { volume: 0.85 });
    else game.sound.play("click", { volume: 0.5 });
  }

  function closeReel() {
    if (!landed || !currentKind) return; // still mid-spin: a tap doesn't skip it
    openEl.classList.remove("show");
    currentKind = null;
    render();
  }

  // ---------- HOLD to INSPECT (same convention as the old shop's hold-to-inspect) ----------
  const HOLD_MS = 450;
  const HOLD_SLOP = 10; // px the finger may move and still be a hold
  let holdTimer = null;
  let holdFrom = null;
  let holdFired = false;

  function cancelHold() {
    clearTimeout(holdTimer);
    holdTimer = null;
  }

  function closeItem() {
    if (itemEl) itemEl.classList.remove("show");
  }

  function closeInspect() {
    closeItem();
    if (inspectEl) inspectEl.classList.remove("show");
  }

  // The odds rectangle (index.html #boxes-inspect-grid: a real cream/brown panel now, 2026-09-27 - "give the box
  // inspect popup a background"): just each possible item's picture and its chance%, styled like "TAP to AIM"
  // (white, black-outlined text) - no other text at all, all in a single row inside that panel (2026-09-27, the
  // owner's ask - superseded the earlier ceil(sqrt(n)) grid attempt). Tapping a picture opens that item's own
  // card on top.
  function openInspect(kind) {
    const def = boxDef(kind);
    if (!def || !inspectGridEl) return;
    inspectGridEl.dataset.kind = kind;
    inspectGridEl.innerHTML = oddsFor(kind)
      .map(
        ({ item, chance }) =>
          `<div class="box-inspect-cell" data-id="${esc(item.id)}">` +
          `<span class="box-inspect-icon${tintAttrs(item)}">` +
          `<img src="${esc(item.image || "")}" alt="" draggable="false" />` +
          `</span>` +
          `<div class="box-inspect-chance">${chance}%</div>` +
          `</div>`
      )
      .join("");
    inspectEl.classList.add("show");
  }

  function openItem(kind, id) {
    const item = poolFor(kind).find((it) => it.id === id);
    if (!item || !itemCardEl) return;
    // No EQUIP button (this is a preview, not owned yet a lot of the time) and no owned-count line either
    // (2026-09-27, the owner's ask: "the inspected item in the box shouldn't have its quantity displayed").
    itemCardEl.innerHTML = Collection.skinRowHtml(kind, item, "<span></span>", "", false, true);
    itemEl.classList.add("show");
  }

  function onInspectClick(e) {
    if (e.target.closest("#boxes-inspect-item")) return; // clicks inside the nested item card are its own business
    const cell = e.target.closest(".box-inspect-cell");
    if (cell) {
      openItem(inspectGridEl.dataset.kind, cell.dataset.id);
      return;
    }
    closeInspect(); // anywhere else in the odds grid/backdrop: close
  }

  function onItemClick(e) {
    if (!e.target.closest(".pick-row")) closeItem(); // outside the card: back to the odds grid
  }

  function onClick(e) {
    if (holdFired) {
      holdFired = false; // the click that ends a hold (the inspect popup opened): not a purchase
      return;
    }
    const btn = e.target.closest(".box-btn[data-kind]");
    if (!btn || btn.classList.contains("box-soon")) return;
    playUiClick();
    openBox(btn.dataset.kind);
  }

  return {
    isReady: () => !!eco,
    init(economyJson) {
      eco = economyJson;
      root = document.getElementById("boxes-items");
      root.addEventListener("click", onClick);
      root.addEventListener("contextmenu", (e) => e.preventDefault()); // no image-save menu on a held box card
      // hold to inspect
      root.addEventListener("pointerdown", (e) => {
        holdFired = false;
        const card = e.target.closest(".box-btn[data-kind]");
        cancelHold();
        if (!card || card.classList.contains("box-soon")) return;
        holdFrom = { x: e.clientX, y: e.clientY };
        holdTimer = setTimeout(() => {
          holdTimer = null;
          holdFired = true;
          openInspect(card.dataset.kind);
        }, HOLD_MS);
      });
      root.addEventListener("pointermove", (e) => {
        if (holdTimer && holdFrom && Math.hypot(e.clientX - holdFrom.x, e.clientY - holdFrom.y) > HOLD_SLOP) cancelHold();
      });
      ["pointerup", "pointercancel", "pointerleave"].forEach((t) => root.addEventListener(t, cancelHold));
      inspectEl = document.getElementById("boxes-inspect");
      inspectGridEl = document.getElementById("boxes-inspect-grid");
      itemEl = document.getElementById("boxes-inspect-item");
      itemCardEl = document.getElementById("boxes-inspect-item-card");
      inspectEl.addEventListener("click", onInspectClick);
      itemEl.addEventListener("click", onItemClick);
      openEl = document.getElementById("box-open");
      windowEl = document.getElementById("box-open-window");
      reelEl = document.getElementById("box-open-reel");
      resultEl = document.getElementById("box-open-result");
      rarityEl = document.getElementById("box-open-rarity");
      nameEl = document.getElementById("box-open-name");
      captionEl = document.getElementById("box-open-caption");
      openEl.addEventListener("click", closeReel);
      [root, inspectEl, openEl].forEach((el) => el.addEventListener("contextmenu", (e) => e.preventDefault()));
    },
    // Called every time the BOXES screen opens.
    onOpen() {
      if (!eco) return;
      shaking = {};
      currentKind = null;
      landed = false;
      if (openEl) openEl.classList.remove("show");
      closeInspect();
      render();
    },
  };
})();
