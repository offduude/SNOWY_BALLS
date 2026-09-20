# Economy reference

Everything tunable lives in [`economy.json`](../economy.json). Edit, save, reload the game.
Run `py tools/economy_report.py` after editing - it prints a balance table (how many hits/throws
each item costs) and catches mistakes (missing fields, duplicate ids, unknown categories).

**What the game reads today:** `rewards`, `events` and `shop` (the shop screen is built - 6 items
pinned on the cork board, tap to buy). **Not applied yet:** item `effect`s - buying spends coins and
records the purchase, but nothing changes in gameplay yet. All shop items are placeholder test data.

**Placeholder pricing:** `shop.priceOverride` is `1`, so every item costs 1 coin while we test
buying. Set it to `null` and each item's own `price` is used again.

**What's saved (localStorage `snowyBallsSave`):** coins, lifetime coins earned, best streak, the
shop's *current stock* (so leaving and re-entering can't reroll it), owned permanent items, and
consumable counts. Item `id`s are stored in saves, so never rename one once players own it.

If `economy.json` has a JSON syntax error (a missing comma is the usual one) the game stops at
start with "economy.json failed to load or has a JSON syntax error".

## rewards (live)

| field | meaning |
|---|---|
| `missCoins` | coins for a miss (or a ball that flies out the top). `0` normally |

### How a hit is paid

`coins = floor( base x faceMultiplier x buffs.coinMultiplier )`

- `base` = the equipped projectile's **hit value** - ONE number for both goal windows (W21 pays the same as W20), from its rarity (`rarities[].projectileHitValue`: snowball/default 4, common 16, rare 128, epic 960, legendary 4800) unless the projectile has a `hitValue` of its own (the heavy hitters: Stone 40, Egg 320, Grenade 2400)
- `faceMultiplier` = `events.faceWindow.faceMultiplier` (2.5; it was 40) when the banana face is hit during the face event, otherwise 1 - so a snowball face hit pays 4 x 2.5 = 10, a common projectile's 16 x 2.5 = 40, a Grenade's 2400 x 2.5 = 6000 (fractions of a coin are carried over to the next payout)
- then the buffs' multiplier (read when the player tapped to aim), rounded down once at the end

**The streak adds nothing.** It is only a counter (STREAK: n under the top-right buttons, saved across reloads, reset by a miss);
it no longer adds coins or speeds the markers up.

## events (live)

`faceWindow` is the random event where W20 turns into the face window: hit the face for the multiplier.

**Only one event can run at a time.** A new event never starts while another is running (enforced in one place, `startEvent` in `main.js`, which every event goes through), so future events can't overlap.

| field | meaning |
|---|---|
| `chancePerThrow` | chance (0-1) that the event starts after each throw, hit or miss - `0.001` = 0.1% (1 in 1000 throws; it was 1%). It never starts while an event is already running. (It used to start at a streak of 3; the streak no longer matters.) |
| `durationMs` | how long the face texture stays (20000 = 20s) |
| `hitRevertMs` | how long the "hit" texture shows before fading back |
| `faceMultiplier` | hitting the face multiplies the coins of that throw by this (`2.5`) |

## aim (live)

The speed of the two aim markers: **fixed, the same for both sliders**, and nothing changes it (not the streak, not buffs,
not the projectile - those only change how wide the sliders are).

| field | meaning |
|---|---|
| `markerHz` | back-and-forth sweeps per second (`1.275` = one sweep in about 0.8s; it was 0.85) |
| (the offset hit zone) | is not set here any more: it comes from the projectile's tier, `weightTiers[].offsetZone` (see "weight" below) |

## rarities (live)

Projectiles and buffs **share** the rarities in `rarities` (from the most common to the rarest): each has an `id`, the `label` shown,
a `color` (CSS colour, or `rainbow` = animated waves plus a pulsing shine) and a `chance` in percent.

| rarity | colour | chance |
|---|---|---|
| default | light grey | 0% (never in the shop - the snowball's) |
| common | light blue | 60% |
| rare | light orange | 30% |
| epic | purple | 9% |
| legendary | rainbow | 1% |

**Shop slot pick:** a slot first rolls a **rarity** by these chances, then picks one of that rarity's items at random (so the items of one
rarity are equally likely). Only rarities that have an item to sell take part - their chances are rescaled to 100% (with a
common chestnut and epic grenade and skyr on sale: chestnut 87%, grenade 6.5%, skyr 6.5%). `py tools/economy_report.py` prints each item's chance.

**Where a rarity is set:** a projectile's in `projectiles.<id>.rarity` (also used by its shop item), a buff's on the shop item (`rarity`).
Snowball = default, chestnut / rowan berry / stone = common, pinecone / egg = rare, grenade = epic; buffs: Water Bottle = common, Kaiser Roll / Triangles / **Skyr** = rare, Tomato Juice = legendary. A rarity with `chance` 0 (default) is never rolled for the shop.
An item with **no rarity** is treated as common when the shop picks, and in the tabs it always goes at the very end - after every
rarity, default and common included, however many of those there are (the tabs list: legendary, epic, rare, common, default, then no rarity).

**Labels:** plain coloured text, no background: top right of a shop card (same text style as PROJECTILE / BUFF), and in the
PROJECTILES / BUFFS tabs on the amount's row, left of the amount. The tabs list the rarest first. The light colours have a thin
dark outline so they read on the cream cards.

## weightTiers (live)

Projectile **weight is a tier, not a number**: very light, light, moderate, heavy, very heavy (`weightTiers`, and each projectile names
its tier in `projectiles.<id>.weight`). The word is shown on the projectile card. A tier is where on the **strength slider** a throw
lands in W20 (`from` / `to` are shares of the slider: 0 = its start, 1 = its tip):

| tier | strength slider | band |
|---|---|---|
| very light | 0% - 25% | 25% wide |
| light | 25% - 50% | 25% wide |
| moderate | 37.5% - 62.5% | 25% wide (the snowball) |
| heavy | 50% - 75% | 25% wide |
| very heavy | 75% - 100% | 25% wide |

Inside the band the apex is inside W20's height (344-387: the bottom of W20 at the band's start, the top at its end, a straight line
through them that goes on both sides); below the band the throw peaks under W20, above it over W20. Every band is 25% wide, so the
strength part is equally easy for every tier - only where it is differs (lighter = less strength, heavier = more).

**Offset slider.** The hit zone is the share of the WHOLE bar that lands inside W20 sideways. It is a band centered on the middle of the bar
that reaches out to both sides, and every tier has its own size (`weightTiers[].offsetZone`; each tier is half of the next):

| tier | offset hit zone (of the whole bar) | the bar spans (swing) |
|---|---|---|
| very light | 6.25% | +-2.44 |
| light | 12.5% | +-1.22 |
| moderate | 25% (the snowball) | +-0.61 |
| heavy | 50% | +-0.31 |
| very heavy | 100% (the whole bar hits) | +-0.15 |

The bar is scaled so the zone fills exactly that share (a smaller zone = a longer, less precise swing); the green guide lines of Orange Skyr
mark the zone's edges. A buff with the effect `precision` (value x) makes the zone x times bigger: `zone = offsetZone x product of the buffs`,
e.g. x1.2 turns 25% into 30% (never more than 100%). The Triangles buff (slower marker) helps every tier, most where the zone is small.
**Note:** W21 needs about +-0.37 swing, so very light, light and moderate projectiles can reach it and heavy and very heavy ones cannot.

## projectiles (live)

Gameplay numbers for each projectile you can equip, keyed by its id (the same id as its shop item and its
entry in the PROJECTILES list). How each one *looks and sounds* (textures, character sprites, impact sound)
is in `PROJECTILE_VISUALS` at the top of `src/main.js`.

| field | meaning |
|---|---|
| `regen` `{ max, everySeconds }` | a **refilling stock** (the snowball: `max` 50, `everySeconds` 30): the player starts with `max`; every one thrown comes back at one per `everySeconds` from the first throw, counted by the device clock so it also runs while the app is closed. The card never leaves the PROJECTILES list, not even at x0; with 0 left you can't start a throw (the middle of the screen shows "OUT of SNOWBALLS" with "+1 in 00:xx" under it). Buying can't push it over `max` |
| `infinite` | `true` = never runs out (nothing uses it right now). Every other projectile is a **consumable**: one is used up the moment the player taps "TAP to aim" (and is NOT given back if the aim is abandoned - opening the shop, equipping something else, closing the app; an abandoned aim also loses the streak); when the last one is gone the snowball is equipped again and the kind leaves the PROJECTILES list |
| `rarity` | its tier; it decides the hit value (`rarities[].projectileHitValue`: default 4, common 16, rare 128, epic 960, legendary 4800 - the same for W20 and W21 and for every projectile of the rarity). A projectile may set a `hitValue` of its own (the **heavy hitters**) |
| `weight` | the weight TIER id: `very_light`, `light`, `moderate`, `heavy`, `very_heavy` (see "weightTiers") |
| `leavesMark` | `false` = no snow mark; the projectile bounces off the wall instead (and plays its impact sound) |
| `spins` | the projectile rotates in flight |

**The numbers.** A *standard* projectile has a stack of 3-7 pieces and a price per piece of 8-12 / 60-100 / 450-750 / 2250-3750 (common / rare / epic / legendary; average stack 50 / 400 / 3000 / 15000) and pays 16 / 128 / 960 / 4800 a hit - always more than its highest price per piece, so every purchase is profitable at a 100% hit rate (`tools/economy_report.py` checks this). A **heavy hitter** (Stone, Egg, Grenade) takes more risk for more reward: a stack of 1-3, a price per piece 2.5x higher and a hit value 2.5x higher (Stone 40, Egg 320, Grenade 2400; each one's `hitValue`), for the same average stack price. What tells projectiles of one rarity apart is their weight tier, look, sound and whether they leave a mark. The planned items that are not in the game yet (epic standard, legendary projectiles, new buffs) are in `docs/FUTURE_PRICES.md` and `docs/future_items.json`.

## shop

The shop always shows `slots` slots. **A slot with no item to sell shows `(TBD)`** - the shop currently has only the chestnut, the placeholder items were removed. Buying an item empties its slot: it shows SOLD OUT with a countdown,
and when the timer ends the slot restocks with an item picked by the rules below (it can be the same one again).
If that happens while the shop is closed, the SHOP button gets a pulsing red dot and `assets/audio/shop_restock.mp3` plays
(the dot is saved and stays until the shop is opened; a restock that happened while the app was closed shows the dot but
plays no sound, since browsers only allow sound after a tap). Only the first restock after you last looked at the shop makes a sound: if more slots restock later while the dot is still showing, they stay silent.

**`buffMax`** - OPTIONAL: the most copies of one buff a player can hold. Not set now (there is no limit; it was 99). If set, a purchase that would exceed it is refused like too little money (the card shakes, nothing is charged).

**`restockSeconds`** - how long a bought slot stays SOLD OUT. `1800` = 30 minutes
(now set; it was 3600 = one hour for a day); use `60` to test. The deadline is stored as a timestamp from the **device clock** in the save, so it keeps
counting while the app is closed: on the next open every slot whose time has passed is restocked.
Setting the phone clock forward will restock early - there is no server to check against - but
setting it back can not make a timer longer than one full `restockSeconds`.

**`refill`** - how a replacement is chosen:
- `mode: random_from_eligible` - random pick among items the player is allowed to see
- `excludeOwned` - permanent items already bought never come back
- **the pick is by rarity** (see "rarities"): a rarity by its chance, then one of its items at random
- (always on) **any item can be on sale in several slots at once**, projectiles included; every slot rolls its own amount and price
- `guaranteeCheapItem` - (currently `enabled: false`, so it does not skew the equal chances) after choosing, if nothing shown costs `maxPriceInAverageHits` average
  hits or less, swap one slot for a cheaper item. This is the safety net against the shop
  filling up with things the player can't afford.

**items** - one entry each:

| field | meaning |
|---|---|
| `id` | unique, never change it once players own it (saves refer to it) |
| `name`, `description` | shown in the shop |
| `category` | `consumable` (a timed buff: used up over `duration`) or `projectile` (a stack of consumable projectiles). Either can be on sale in several slots at once |
| `price` | coins |
| `detail` | optional (buffs): a bottom line on the item's card in the BUFFS tab, e.g. `"Coin bonus: 1.2x."` |
| `priceRange` | optional, instead of `price`: `{ "min": 43, "max": 72 }` - the price is rolled in that range each time the item is put on sale (saved with the stock, so no reroll by leaving) |
| `amount`, `unitPrice` | **stack items (projectiles)**: `{min, max}` ranges. Each time the item is put on sale (first fill and every restock) an `amount` and the price of ONE are rolled inside the ranges (chestnut: 10-20 pieces at 4-6 coins each); the slot costs `amount x unitPrice` and shows "x14" on its card. Saved with the stock, so leaving the shop can't reroll it. Buying adds the whole stack to the inventory. |
| `image` | optional: picture path shown on the shop card (the chestnut has one; other items show an empty picture box) |
| `ignorePriceOverride` | optional. `true` = always costs its own `price`, even while `shop.priceOverride` makes everything else 1 coin (the chestnut is 10) |
| `duration` | buffs only: `{ "seconds": N }` |
| `effect` / `effects` | `effect` = `{ "type": ..., "value": ... }`; buffs use an `effects` list of those - see below |

### buffs (live)

A `consumable` item is a timed **buff**. Buying one only puts it in the **inventory** (saved, shown as "x3" on its card in the BUFFS tab).
It is **used from the BUFFS tab**: the USE button takes one out of the inventory and starts it for `duration.seconds`, and the button
turns into the running timer (device clock, so it keeps running while the app is closed and is saved). While a buff is running it
can't be used again (its button is a timer); when it ends the USE button comes back if there are more, and the card leaves the list
when none are left. Effects do not stack from the same buff. Different buffs of the same kind STACK (`Buffs.modifiers`, limits in `buffCaps`): save chances as independent rolls (10% + 20% = 28%, at most 75%), coin multipliers multiply (1.1 x 1.2 = 1.32, at most x2), pointer slow-downs multiply (0.9 x 0.8 = 0.72, never below 0.6). Its `effects` list is what it does:

| type | value means |
|---|---|
| `guideLines` | `1` = the green guarantee lines are drawn on both sliders while the buff is active (they are hidden otherwise). Does NOT affect the yellow event dots, which always show |
| `centerLine` | `1` = ONE green line at the middle of the hit zone on each slider: the middle of the offset bar, and the middle of the strength band that hits W20 from the chosen offset (Blue Skyr). Independent of `guideLines` (both can be on) |
| `precision` | offset (angle) slider: its hit zone gets `value` times bigger (1.2 = 20% bigger, 25% -> 30%; at most the whole bar), so its range shrinks to 1/value (same marker speed) |
| `strengthControl` | strength (power) slider: same, its range shrinks to 1/value around the middle of the bar |
| `coinMultiplier` | multiplies the coins of a hit. Only whole coins are paid; the fraction is carried over to the next payout (5 x 1.1 = 5.5 pays 5 now and 6 next time), so a small multiplier is never rounded away |
| `sliderSpeed` | both sliders move at this fraction of their speed (`0.8` = 20% slower); several such buffs multiply (0.9 x 0.8 = 0.72) but the speed never goes below `buffCaps.sliderSpeedMin` (0.6) |
| `saveProjectile` | chance (0-1, e.g. `0.1` = 10%) that a throw does not use up its projectile (any projectile, the snowball included); several such buffs stack as independent rolls (10% + 20% = 28%, at most `buffCaps.saveProjectile`, 75%). When one saves a projectile the result text gets a "Saved Projectile" line |
| `triggerEvent` | the name of an event (`"face"` = the banana face) that is ON for as long as the buff runs (Tomato Juice: 20 s, the same as the natural event; its hit pays the face multiplier x2.5). It starts between throws (if the natural face event is already up, the buff takes it over and it now lasts as long as the buff). Hitting the face concludes the event AND ends the buff; the buff running out or being cancelled (tap its card) ends the event. The face hit pays the usual face multiplier (x2.5) |

**When buffs are read:** only at the moment the player taps "TAP to aim". That snapshot is used for the whole throw
(sliders, green lines, event dots and payout), so a buff expiring or being bought mid-aim never changes anything under the
player's finger. The buff cards and list always show the live state.

### other effect types (planned; nothing applies them yet)

| type | value means |
|---|---|
| `coinMultiplier` | multiplies coins from hits (several running buffs multiply each other, up to `buffCaps.coinMultiplier`, x2) |
| `aimSpeedMultiplier` | multiplies the aim pointers' sweep speed (below 1 = slower = easier) |
| `streakShield` | number of misses that won't reset the streak |
| `hitPaddingPx` | window hitboxes grow by this many pixels on every side |
| `markLifetimeMultiplier` | multiplies how long marks stay on the wall |
| `launchSpeedMultiplier` | multiplies throw launch speed (can send the ball out the top) |
| `faceWindowDurationAddMs` | added to `events.faceWindow.durationMs` |

## Balancing notes

- The snowball pays 5 a hit (free, so it is the baseline); `tools/economy_report.py` prints how many
  hits and throws each item costs. There are no tiers right now: every item can appear from the start.
- Coin multipliers stack (multiplied, capped at x2 by `buffCaps`), so the caps are what keep a pile of buffs from breaking the prices.
  Effects that make the *game itself* easier (`aimSpeedMultiplier`,
  `hitPaddingPx`) compound with that - watch total hit rate, not just coin rate.
- Permanent items leave the pool once bought; consumables never do. If nothing is eligible when a
  slot restocks it just stays SOLD OUT (no timer) until something is.
