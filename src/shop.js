// Shop: a plain list of every projectile/buff, greyed out when not currently in the roll (2026-09-27 redesign -
// it used to be a 3x2 grid of 6 rolled slots pinned to the cork board; see docs/NOTES.md). The stock itself is no
// longer a fixed 6-slot array either (2026-09-27, second pass, "grow a garden" style): economy.json
// shop.guaranteedIds are always in stock, and every other item independently rolls per category
// (shop.rollsPerCategory draws each) every shop.rerollSeconds - stock length is variable, could in principle be
// anywhere from just the guaranteed ids up to (with very low odds) most of the catalog at once. The list shows
// every catalog item and looks up whether it's currently in Economy.getShopState().stock, instead of rendering
// the stock array directly as cards. Timers are device-clock timestamps saved with the stock, so they keep
// running while the app is closed.
//
// Item types: "consumable" (a timed buff, the same one can be in stock more than once at a time) and "projectile"
// (a STACK of consumable projectiles: the amount is rolled at random each time it is put on sale, the slot's price
// is that amount x the item's fixed unitPrice - see rollOffer's own note, 2026-09-27). Skins (character/scenery/weather) used to be a third,
// one-time-unlock type sold here too, but were pulled from the shop's pool entirely (2026-09-27, owner's call)
// - they're bought from the new BOXES feature instead, as stackable items (see Economy.addSkin).
// When the shop restocks while it's closed, the SHOP button gets a dot and a sound plays.
//
// Effects (coinMultiplier, aimSpeedMultiplier, ...) are NOT applied yet - buying currently just
// spends coins and records the purchase.
// Every UI button click (SHOP/BACK, buying, equipping, list buttons) goes through here.
const UI_CLICK_VOLUME = 0.4; // half of the old 0.8
function playUiClick() {
  const game = window.snowyBallsGame;
  if (game) game.sound.play("click", { volume: UI_CLICK_VOLUME });
}

const Shop = (() => {
  let eco = null;
  let root = null;
  let dotEl = null;

  // ---------- rules ----------

  function randInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  // Items that come in stacks have an `amount` range and a single fixed `unitPrice`; each time one is put on
  // sale a concrete offer is rolled: { amount }. Saved with the stock so leaving the shop can't reroll it.
  // (2026-09-27, the owner's call: every price used to be a rolled range - priceRange for a single item, unitPrice
  // for one of a stack - collapsed to one fixed number each, at the old range's highest point. Only a stack's
  // `amount` is still randomized - "still affected by quantity of course", the owner's own words.)
  function rollOffer(item) {
    if (!item || !item.amount) return null;
    return { amount: randInt(item.amount.min, item.amount.max) };
  }

  // What ONE costs - a stack item is bought one unit at a time now (2026-09-27, the owner's ask: "clicking it
  // once buys only a single projectile"), so its price is just its fixed unitPrice, no multiplication. `amount`
  // (see rollOffer) is no longer "how many you get", it's "how many are left in this slot before it empties".
  function price(item) {
    if (item.amount) return item.unitPrice;
    if (item.ignorePriceOverride) return item.price;
    const o = eco.shop.priceOverride; // placeholder pricing switch, see economy.json
    return o !== null && o !== undefined ? o : item.price;
  }

  function itemById(id) {
    return eco.shop.items.find((it) => it.id === id) || null;
  }

  // Items that may be rolled for the given category (2026-09-27: rolls are per-category now, not one shared pool).
  // Excludes: a "godOnly" test buff (a god mode save just has it, see Economy.fillGod) and anything in
  // shop.guaranteedIds - those are always in stock and never take a roll at all (see rerollAll).
  function eligible(cat) {
    const guaranteed = new Set(eco.shop.guaranteedIds || []);
    return eco.shop.items.filter((it) => !it.godOnly && it.category === cat && !guaranteed.has(it.id));
  }

  function averageHitCoins() {
    return eco.projectiles.snowball.hitValue; // what a normal hit pays
  }

  function isCheap(item, cfg) {
    return price(item) <= cfg.maxPriceInAverageHits * averageHitCoins();
  }

  // Every item in a rarity pool is drawn with equal weight now that skins (which used to be thinned to half
  // weight here, see git history) aren't in the pool at all any more.
  function itemWeight(item) {
    return 1;
  }

  function pickWeightedFrom(list) {
    const total = list.reduce((sum, it) => sum + itemWeight(it), 0);
    let roll = Math.random() * total;
    for (const it of list) {
      roll -= itemWeight(it);
      if (roll < 0) return it;
    }
    return list[list.length - 1];
  }

  // The pick for a slot is by RARITY: first a rarity is rolled by its chance (economy.json "rarities"; only rarities that
  // have an item in the pool take part, their chances are rescaled to 100%), then one of that rarity's items is picked
  // (weighted - see pickWeightedFrom/itemWeight above). An item with no rarity counts as the most common one.
  function pickWeighted(pool) {
    // Only rarities with a chance above 0 can be rolled (the "default" one has 0: it is the snowball's, not for sale).
    const rarities = (eco.rarities || []).filter((r) => r.chance > 0);
    if (!rarities.length) return pickWeightedFrom(pool);
    const rid = (it) => (rarities.some((r) => r.id === Rarity.ofItem(it)) ? Rarity.ofItem(it) : rarities[0].id);
    const present = rarities.filter((r) => pool.some((it) => rid(it) === r.id));
    const total = present.reduce((sum, r) => sum + r.chance, 0);
    let roll = Math.random() * total;
    let chosen = present[present.length - 1];
    for (const r of present) {
      roll -= r.chance;
      if (roll < 0) {
        chosen = r;
        break;
      }
    }
    return pickWeightedFrom(pool.filter((it) => rid(it) === chosen.id));
  }

  // Roll `count` independent picks for one category (2026-09-27: replaces the old one-pick-per-shared-slot model -
  // each category now runs its own draws from its own non-guaranteed pool; duplicates are expected and fine, they
  // just dedup away when rerollAll() folds everything into a Set).
  function pickForCategory(cat, count) {
    const pool = eligible(cat);
    if (!pool.length) return [];
    const picks = [];
    for (let i = 0; i < count; i++) picks.push(pickWeighted(pool));

    // Safety net: never let a category end up with nothing the player could reasonably afford (currently disabled,
    // see economy.json shop.refill.guaranteeCheapItem.enabled - the guaranteed staples already cover this today).
    const g = eco.shop.refill && eco.shop.refill.guaranteeCheapItem;
    if (g && g.enabled && !picks.some((it) => isCheap(it, g))) {
      const cheap = pool.filter((it) => isCheap(it, g));
      if (cheap.length) picks[0] = pickWeightedFrom(cheap);
    }
    return picks.map((it) => it.id);
  }

  // ---------- global reroll ----------
  // ALL slots reroll together every economy.json shop.rerollSeconds, whether or not they were bought and regardless
  // of how long an item's been on sale (2026-09-27, owner's call - replaced the old per-item availability timer +
  // per-slot sold-out timer, where each slot rerolled on its own schedule). The timer is on the SHOP'S CLOCK
  // (Economy.shopNow(): the device's clock, sped up by any equipped skin's shopSpeed effect - nothing has one
  // today) saved with the stock, so it keeps running while the app is closed. What the player is shown is real
  // time: shop time / Economy.shopRate().
  const shopNow = () => Economy.shopNow();
  const realMs = (shopMs) => shopMs / Economy.shopRate();

  function rerollMs() {
    return (eco.shop.rerollSeconds > 0 ? eco.shop.rerollSeconds : 1800) * 1000;
  }

  // A buff can't be held in more than Economy.getBuffMax() (99) copies.
  function isMaxed(item) {
    return item.category === "consumable" && Economy.getBuffCount(item.id) >= Economy.getBuffMax();
  }

  // The list (see render() below) shows every catalog item, not a slot - so buying is keyed by item id: it resolves
  // to whichever slot currently has it in stock (the first one, if it somehow rolled into more than one at once).
  function buy(itemId) {
    const st = Economy.getShopState();
    const slot = st.stock ? st.stock.indexOf(itemId) : -1;
    if (slot === -1) return { ok: false, reason: "unavailable" }; // not currently in the roll: greyed out, can't be bought
    const item = itemById(itemId);
    if (!item) return { ok: false, reason: "empty" };
    if (isMaxed(item)) return { ok: false, reason: "max" }; // already holding the most of this buff: nothing is charged
    if (!Economy.spendCoins(price(item))) return { ok: false, reason: "funds" };

    if (item.category === "projectile") {
      // One at a time now (2026-09-27, the owner's ask) - click again for more, while the slot's remaining stock
      // (offer.amount) lasts. If this is a kind the player had none of, the PROJECTILES list expands and its red
      // dot comes on (Economy raises it; more of a kind they already have doesn't).
      Economy.addProjectiles(item.id, 1);
      const offer = st.offers[slot];
      if (offer) offer.amount -= 1;
      if (!offer || offer.amount <= 0) {
        st.stock[slot] = null;
        st.offers[slot] = null;
        if (st.unseenIds) st.unseenIds = st.unseenIds.filter((id) => id !== itemId);
      }
    } else {
      Economy.addBuffs(item.id, 1); // a buff goes into the inventory; it is USED from the BUFFS tab (see buffs.js)
      // A buff's slot has no "amount" to run down - one purchase always empties it, same as before.
      st.stock[slot] = null;
      st.offers[slot] = null;
      if (st.unseenIds) st.unseenIds = st.unseenIds.filter((id) => id !== itemId);
    }
    // Either way the slot just stays empty (not sold to anyone else) until the next global reroll - no per-slot
    // timer any more.
    Economy.saveShop();
    return { ok: true, item };
  }

  // ---------- UI ----------
  // The SHOP tab is a plain list of every projectile/buff (2026-09-27) - one row per catalog item, not one card per
  // rolled slot. Sorted by rarity ASCENDING (common at the top, legendary at the bottom - the owner's ask). Every
  // row always has a real BUY button with its real (fixed, since the price-range collapse) price - available AND
  // affordable shows it live; either available-but-too-expensive or plain not-in-stock right now greys the SAME
  // button out the SAME way (2026-09-27: no more red price text, no more a separate "NOT IN STOCK" label - just
  // one consistent "can't buy this right now" look, whatever the reason).

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  let openCat = "projectile"; // the shop always opens on this (the owner's ask), then follows the category buttons

  function categoryItems(cat) {
    return eco.shop.items
      .filter((it) => it.category === cat)
      .slice()
      .sort((a, b) => Rarity.rank(Rarity.ofItem(a)) - Rarity.rank(Rarity.ofItem(b)));
  }

  // One row. `available` = the item currently has a matching slot in the roll (its first one, if the rarity roll
  // happened to put the same item in two slots at once - purely cosmetic, buying just resolves to whichever slot
  // is found first).
  function rowHtml(item) {
    const st = Economy.getShopState();
    const slot = st.stock ? st.stock.indexOf(item.id) : -1;
    const available = slot !== -1;
    const offer = available ? (st.offers || [])[slot] || null : null;
    const p = price(item); // fixed now (2026-09-27) - the same number whether or not it's currently in stock
    const buyable = available && Economy.getCoins() >= p && !isMaxed(item); // a maxed-out buff looks unbuyable, like a too-expensive one
    // Unavailable (not in the current roll): a plain red "NO STOCK" label instead of a button at all (2026-09-27,
    // the owner's ask - replacing the earlier "greyed-out button + greyed row" look). Unaffordable (in stock,
    // too expensive right now) keeps its own look exactly as it already was - a real, greyed BUY button.
    const action = available
      ? `<button class="pick-equip shop-buy${buyable ? "" : " cant"}" type="button" data-id="${esc(item.id)}">` +
        `<i class="coin"></i><span>${p}</span></button>`
      : `<span class="shop-no-stock">NO STOCK</span>`;
    // Replaces the old per-item availability countdown (removed 2026-09-27, see the global-reroll note above) in
    // that same spot under the button: how many are LEFT in this slot for a stack item (2026-09-27: an
    // unavailable stack explicitly reads "x0" rather than showing nothing, the owner's ask - it's still an
    // "amount", just zero), nothing at all for a buff (always exactly one per purchase, never had an amount).
    const amountText = item.amount ? (available && offer ? `x${offer.amount}` : "x0") : null;
    const dot = available && (st.unseenIds || []).includes(item.id);
    return Collection.shopRowHtml(item, { offer, action, extraClass: available ? "" : " unavailable", amountText, dot });
  }

  function render() {
    if (!root) return;
    root.innerHTML = categoryItems(openCat).map(rowHtml).join("");
    checkDisplayed();
  }

  // A row whose item is "new to the roll" (see rerollAll's unseenIds note) loses its dot once it's been scrolled
  // into view - same idea as the SKINS menu's checkDisplayed, but clearing the dot by removing its DOM node
  // directly rather than a full re-render (a full render() would restart every OTHER row's CSS animation too -
  // see tick()'s own note on why that's avoided now).
  function checkDisplayed() {
    const st = Economy.getShopState();
    if (!root || !st.unseenIds || !st.unseenIds.length) return;
    const view = root.getBoundingClientRect();
    let changed = false;
    root.querySelectorAll(".pick-row[data-id]").forEach((row) => {
      const id = row.dataset.id;
      if (!st.unseenIds.includes(id)) return;
      const r = row.getBoundingClientRect();
      const visible = Math.min(r.bottom, view.bottom) - Math.max(r.top, view.top);
      if (visible < r.height / 2) return;
      st.unseenIds = st.unseenIds.filter((x) => x !== id);
      changed = true;
      const dot = row.querySelector(".pick-new");
      if (dot) dot.remove();
    });
    if (changed) Economy.saveShop();
  }

  // Top-right of the header (see index.html #shop-timer): counts down to the next global reroll.
  function updateTimerText() {
    const el = document.getElementById("shop-timer");
    if (!el) return;
    const at = Economy.getShopState().nextRerollAt;
    el.textContent = typeof at === "number" ? countdownText(realMs(at - shopNow())) : "";
  }

  // 1799000 ms -> "29:59", 3 h 59 min -> "3:59:00" (the same look as the max time in the BUFFS tab, hours when there are any)
  function countdownText(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000 - 0.001)); // (the small allowance: 1500000.0000000002 ms must read 25:00, not 25:01)
    const h = Math.floor(total / 3600);
    const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const ss = String(total % 60).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function updateCatButtons() {
    const p = document.getElementById("shop-cat-projectile");
    const b = document.getElementById("shop-cat-buff");
    if (p) p.classList.toggle("active", openCat === "projectile");
    if (b) b.classList.toggle("active", openCat === "consumable");
  }

  function setCat(cat) {
    if (openCat === cat) return;
    openCat = cat;
    updateCatButtons();
    render();
    if (root) root.scrollTop = 0; // every category opens at the top of its list, never wherever the last one left off
  }

  function isShopOpen() {
    return document.getElementById("game-container").classList.contains("shop-open");
  }

  // Is the shop's stock due for its next global reroll (or does it not have a proper one yet at all - a brand-new
  // save, or one migrating from the old per-item-timer model, which never had `nextRerollAt`)?
  function isDue(st, now) {
    return (
      !Array.isArray(st.stock) ||
      typeof st.nextRerollAt !== "number" ||
      now >= st.nextRerollAt ||
      st.nextRerollAt - now > rerollMs() + 1000 // the device clock was set back (or an old save's cadence was longer): never wait longer than one full cycle
    );
  }

  // A full, unconditional reset of the shop - the guaranteed staples (economy.json shop.guaranteedIds) go back in
  // stock unconditionally, and each category (projectile, consumable) independently rolls shop.rollsPerCategory
  // fresh picks from its own non-guaranteed items (2026-09-27: replaces the old "exactly 6 shared slots" model -
  // stock is now a variable-length, deduped list, not a fixed array of card slots). The next reroll is scheduled a
  // fresh rerollMs() from this moment. Used by the Toy Tank event (main.js fireTank) too - "the entire shop should
  // reroll the exact time the tank fires", and its own cadence just restarts from that moment.
  //
  // If this happens while the shop is closed, every freshly-stocked id (guaranteed ones included, in case they
  // weren't in stock before - e.g. right after this feature first ships) is marked "unseen" (a red dot, same idea
  // as a new projectile/buff's) until its row is scrolled into view (checkDisplayed). A reroll while the shop is
  // OPEN needs none of that - the player is looking straight at it happening.
  function rerollAll() {
    const st = Economy.getShopState();
    const picked = new Set(eco.shop.guaranteedIds || []);
    const rolls = eco.shop.rollsPerCategory || 1;
    for (const cat of ["projectile", "consumable"]) {
      for (const id of pickForCategory(cat, rolls)) picked.add(id);
    }
    const stock = [...picked];
    st.stock = stock;
    st.offers = stock.map((id) => rollOffer(itemById(id)));
    st.nextRerollAt = shopNow() + rerollMs();
    if (!isShopOpen()) st.unseenIds = [...new Set([...(st.unseenIds || []), ...stock])];
    Economy.saveShop();
    if (isShopOpen()) {
      render();
      updateTimerText();
    }
  }

  function setDot(on) {
    if (dotEl) dotEl.classList.toggle("show", !!on);
  }

  // `live` = the player is in the app right now (the cadence rolled over while playing / the app came back to the
  // foreground), as opposed to the game only just loading after the cadence rolled over while it was closed - a
  // sound there would blast out on the first tap. If the shop isn't open the SHOP button gets a dot, which stays
  // (it is saved) until the shop is opened. The sound plays whenever it's live, open or not.
  function announceReroll(live) {
    const st = Economy.getShopState();
    const open = isShopOpen();
    // The dot is already up and nobody has opened the shop yet: this reroll is just more of the same
    // news, so no second sound (however much later it happens).
    const alreadyAnnounced = !open && st.unseen;
    if (!open) {
      st.unseen = true;
      Economy.saveShop();
      setDot(true);
    }
    const game = window.snowyBallsGame;
    if (live && game && !alreadyAnnounced) game.sound.play("shop_restock", { volume: 0.9 });
  }

  // Once a second (and when the app returns to the foreground): reroll the whole shop if the cadence is up, and
  // while it's on screen keep the header's countdown live. No more per-row re-rendering just to tick a timer down
  // (that used to fully rebuild the list's DOM every second, which restarted a legendary row's CSS shine/wave
  // animation from frame 0 each time - the "flashing in a weird way" the owner reported, 2026-09-27. The list itself
  // now only re-renders when something actually changes: opening the shop, switching PROJECTILES/BUFFS, buying, or
  // an actual reroll.)
  function tick() {
    if (!eco) return;
    if (isDue(Economy.getShopState(), shopNow())) {
      rerollAll();
      announceReroll(true);
    }
    if (isShopOpen()) updateTimerText();
  }

  function onClick(e) {
    const btn = e.target.closest(".shop-buy[data-id]");
    if (!btn) return;
    const result = buy(btn.dataset.id);
    if (result.ok) {
      playUiClick();
      if (typeof Cloud !== "undefined") Cloud.notePurchase();
      render();
    } else if (result.reason === "funds" || result.reason === "max") {
      btn.classList.remove("shake");
      void btn.offsetWidth; // restart the animation if they tap repeatedly
      btn.classList.add("shake");
    }
  }

  return {
    isReady: () => !!eco,
    init(economyJson) {
      eco = economyJson;
      if (eco.shop && eco.shop.buffMax) Economy.setBuffMax(eco.shop.buffMax);
      // The shop's clock runs at the product of the equipped skins' `shopSpeed` effects (nothing has one today - Frosty Night's 1.2x was removed
      // 2026-09-23, but a future skin could still use it): set now (a save may have been loaded with one equipped) and again every time something is equipped.
      const syncRate = () => Economy.setShopRate(Economy.skinEffects(eco).filter((e) => e.type === "shopSpeed").reduce((a, e) => a * e.value, 1));
      Economy.setEquippedHook(syncRate);
      syncRate();
      root = document.getElementById("shop-scroll");
      root.addEventListener("click", onClick);
      root.addEventListener("scroll", checkDisplayed); // clears a row's "new to the roll" dot as it scrolls into view
      document.getElementById("shop-cat-projectile").addEventListener("click", () => setCat("projectile"));
      document.getElementById("shop-cat-buff").addEventListener("click", () => setCat("consumable")); // economy.json's own category id for a buff
      document.getElementById("shop-backdrop").addEventListener("click", () => document.getElementById("shop-btn").click());
      dotEl = document.getElementById("shop-dot");
      // generate the saved stock right away if it's missing/due, before the shop is ever opened - quiet, no sound,
      // same reasoning tick() has for a cadence that rolled over while the app was closed.
      if (isDue(Economy.getShopState(), shopNow())) rerollAll();
      setDot(Economy.getShopState().unseen);
      setInterval(tick, 1000);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) tick();
      });
    },
    // Called every time the shop screen opens. Always opens on PROJECTILES (the owner's ask) - the BUFFS tab, if it
    // was open last time, is not remembered across visits.
    onOpen() {
      if (!eco) return;
      if (isDue(Economy.getShopState(), shopNow())) rerollAll(); // quiet - just get it fresh, not "while playing"
      openCat = "projectile";
      updateCatButtons();
      // The player is looking at the shop now, so whatever the dot was about is seen.
      Economy.getShopState().unseen = false;
      Economy.saveShop();
      setDot(false);
      render();
      root.scrollTop = 0; // always opens at the top of the list (the owner's ask), never the last scroll position
      updateTimerText();
    },
    rerollAll, // exposed for the Toy Tank event (main.js fireTank) - see rerollAll's own comment
  };
})();
