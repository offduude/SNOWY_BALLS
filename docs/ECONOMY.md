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

- `base` = the equipped projectile's `rewards.W20` / `rewards.W21` (see "projectiles": snowball 5 / 3, chestnut 8 / 5)
- `faceMultiplier` = `events.faceWindow.faceMultiplier` (40) when the banana face is hit during the face event, otherwise 1 - so a snowball face hit pays 5 x 40 = 200, a chestnut one 8 x 40 = 320
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
| `faceMultiplier` | hitting the face multiplies the coins of that throw by this (`40`) |

## aim (live)

The speed of the two aim markers: **fixed, the same for both sliders**, and nothing changes it (not the streak, not buffs,
not the projectile - those only change how wide the sliders are).

| field | meaning |
|---|---|
| `markerHz` | back-and-forth sweeps per second (`1.275` = one sweep in about 0.8s; it was 0.85) |
| `offsetZoneAtWeight100` | the share of the OFFSET slider that is a guaranteed W20 hit for a weight-100 projectile (the snowball). `0.5` = half the slider. See "weight" below |

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
Snowball = default, chestnut = common, grenade = epic, Skyr = epic. A rarity with `chance` 0 (default) is never rolled for the shop.
An item with **no rarity** is treated as common when the shop picks, and in the tabs it always goes at the very end - after every
rarity, default and common included, however many of those there are (the tabs list: legendary, epic, rare, common, default, then no rarity).

**Labels:** plain coloured text, no background: top right of a shop card (same text style as PROJECTILE / BUFF), and in the
PROJECTILES / BUFFS tabs on the amount's row, left of the amount. The tabs list the rarest first. The light colours have a thin
dark outline so they read on the cream cards.

## weightLabels (live)

Projectile weights are never shown as numbers. `weightLabels` maps a weight to the word on the projectile card (`weight: light`):
the **last** entry whose `from` is at most the weight is used. Now: 0+ very light, 50+ light, 75+ moderate, 125+ heavy,
150+ very heavy (snowball 100 = moderate, chestnut 75 = moderate, grenade 130 = heavy). Edit the thresholds or words freely.

## weight (live)

The **snowball is always weight 100** - the reference every other weight is measured against. A projectile's `weight` (0 to 200,
shown to the player only as a word) sets two things:

**Strength slider.** The perfect throw - the apex in the exact middle of W20 - is at strength position `weight / 200`:
weight 100 = the centre of the slider, weight 200 = the very tip, weight 0 = the very beginning (50 -> 25%, 130 -> 65%, ...).
Heavier projectiles need more strength. Below/above the perfect position the apex falls/rises along the snowball's curve
(start of the slider = the lowest allowed height 184, centre = W20's middle 365.5, tip = the middle of the window row above, 465.5;
beyond the tip, for light projectiles, the curve continues upward in a straight line).

**Offset slider.** The share of the slider that lands inside W20 sideways is `weight / 200` on a straight line: weight 0 = only the exact
middle (a floor of 1.5% is used so the slider still works), weight 200 = anywhere on the slider, and the snowball (100) is
`aim.offsetZoneAtWeight100` (0.5 = half). Heavier projectiles are therefore easier to throw in a straight line.
Precision buffs narrow the spread further. **Note:** with 0.5 the snowball's offset slider only spans +-0.31 swing, which is too short to
reach W21 (it needs about +-0.37) - only projectiles lighter than ~68 can reach it. Lower `offsetZoneAtWeight100` to widen the snowball's spread.

## projectiles (live)

Gameplay numbers for each projectile you can equip, keyed by its id (the same id as its shop item and its
entry in the PROJECTILES list). How each one *looks and sounds* (textures, character sprites, impact sound)
is in `PROJECTILE_VISUALS` at the top of `src/main.js`.

| field | meaning |
|---|---|
| `regen` `{ max, everySeconds }` | a **refilling stock** (the snowball: `max` 50, `everySeconds` 30): the player starts with `max`; every one thrown comes back at one per `everySeconds` from the first throw, counted by the device clock so it also runs while the app is closed. The card never leaves the PROJECTILES list, not even at x0; with 0 left you can't start a throw (the middle of the screen shows "OUT of SNOWBALLS" with "+1 in 00:xx" under it). Buying can't push it over `max` |
| `infinite` | `true` = never runs out (nothing uses it right now). Every other projectile is a **consumable**: one is used up the moment the player taps "TAP to aim" (and is NOT given back if the aim is abandoned - opening the shop, equipping something else, closing the app; an abandoned aim also loses the streak); when the last one is gone the snowball is equipped again and the kind leaves the PROJECTILES list |
| `rewards` | the base coins for a hit on `W20` / `W21` with this projectile (the face bonus is added on top) |
| `weight` | 0-200, **not shown as a number** (see "weight" above; the snowball is always 100): the strength position of the perfect W20 throw is `weight / 200`, and the share of the offset slider that hits W20 also grows with it |
| `leavesMark` | `false` = no snow mark; the projectile bounces off the wall instead (and plays its impact sound) |
| `spins` | the projectile rotates in flight |

A full-strength throw of the snowball (weight 100, no buffs) peaks at the middle of the window row above the goal windows (height 465.5); its centred throw hits the middle of W20. Chestnut right now: rewards 8 / 5, `weight 75`, `angleRange 0.8`, no mark, spins, consumable (placeholder numbers, to be tuned).

## shop

The shop always shows `slots` slots. **A slot with no item to sell shows `(TBD)`** - the shop currently has only the chestnut, the placeholder items were removed. Buying an item empties its slot: it shows SOLD OUT with a countdown,
and when the timer ends the slot restocks with an item picked by the rules below (it can be the same one again).
If that happens while the shop is closed, the SHOP button gets a pulsing red dot and `assets/audio/shop_restock.mp3` plays
(the dot is saved and stays until the shop is opened; a restock that happened while the app was closed shows the dot but
plays no sound, since browsers only allow sound after a tap). Only the first restock after you last looked at the shop makes a sound: if more slots restock later while the dot is still showing, they stay silent.

**`buffMax`** - the most copies of one buff a player can hold (99). A purchase that would exceed it is refused like too little money (the card shakes, nothing is charged).

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
| `priceRange` | optional, instead of `price`: `{ "min": 39, "max": 59 }` - the price is rolled in that range each time the item is put on sale (saved with the stock, so no reroll by leaving) |
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
when none are left. Effects do not stack from the same buff; different buffs multiply. Its `effects` list is what it does:

| type | value means |
|---|---|
| `guideLines` | `1` = the green guarantee lines are drawn on both sliders while the buff is active (they are hidden otherwise). Does NOT affect the yellow event dots, which always show |
| `precision` | offset (angle) slider: its range shrinks to 1/value (1.5 = 33% narrower, same marker speed) |
| `strengthControl` | strength (power) slider: same, its range shrinks to 1/value around the middle of the bar |
| `coinMultiplier` | multiplies the coins of a hit. Only whole coins are paid; the fraction is carried over to the next payout (5 x 1.1 = 5.5 pays 5 now and 6 next time), so a small multiplier is never rounded away |
| `sliderSpeed` | both sliders move at this fraction of their speed (`0.8` = 20% slower); several such buffs can run at once but only the best counts - the slowest - they do not multiply |
| `saveProjectile` | chance (0-1, e.g. `0.1` = 10%) that a throw does not use up its projectile (any projectile, the snowball included); several such buffs can run at once (each keeps its timer) but only the highest chance counts. When one saves a projectile the result text gets a "Saved Projectile" line |
| `triggerEvent` | the name of an event (`"face"` = the banana face) that is ON for as long as the buff runs (Tomato Juice: 20 s, the same as the natural event). It starts between throws (if the natural face event is already up, the buff takes it over and it now lasts as long as the buff). Hitting the face concludes the event AND ends the buff; the buff running out or being cancelled (tap its card) ends the event. The face hit pays the usual x40 |

**When buffs are read:** only at the moment the player taps "TAP to aim". That snapshot is used for the whole throw
(sliders, green lines, event dots and payout), so a buff expiring or being bought mid-aim never changes anything under the
player's finger. The buff cards and list always show the live state.

### other effect types (planned; nothing applies them yet)

| type | value means |
|---|---|
| `coinMultiplier` | multiplies coins from hits (multiple sources multiply together) |
| `aimSpeedMultiplier` | multiplies the aim pointers' sweep speed (below 1 = slower = easier) |
| `streakShield` | number of misses that won't reset the streak |
| `hitPaddingPx` | window hitboxes grow by this many pixels on every side |
| `markLifetimeMultiplier` | multiplies how long marks stay on the wall |
| `launchSpeedMultiplier` | multiplies throw launch speed (can send the ball out the top) |
| `faceWindowDurationAddMs` | added to `events.faceWindow.durationMs` |

## Balancing notes

- Average base reward is ~4 coins per hit (W20 5 / W21 3); `tools/economy_report.py` prints how many
  hits and throws each item costs. There are no tiers right now: every item can appear from the start.
- Multiplier effects stack, so keep `coinMultiplier` values modest or a few purchases make the
  prices meaningless. Effects that make the *game itself* easier (`aimSpeedMultiplier`,
  `hitPaddingPx`) compound with that - watch total hit rate, not just coin rate.
- Permanent items leave the pool once bought; consumables never do. If nothing is eligible when a
  slot restocks it just stays SOLD OUT (no timer) until something is.
