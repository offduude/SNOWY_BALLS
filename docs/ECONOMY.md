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
| `streakBonusPerLevel` | each hit in a streak beyond the first adds this fraction of the base, rounded down. `0.15` = +15% per level. Set `0` to turn streak bonuses off |
| `missCoins` | coins for a miss (or a ball that flies out the top). `0` normally |

### How a hit is paid (the streak bonus)

`coins = floor( (base + streakBonus + faceBonus) x buffs.coinMultiplier )`

- `base` = the equipped projectile's `rewards.W20` / `rewards.W21` (see "projectiles": snowball 5 / 3, chestnut 8 / 5)
- `streakBonus = floor( base x streakBonusPerLevel x (streak - 1) )` - with `streakBonusPerLevel` 0.15, every hit beyond
  the first in a streak adds 15% of the base per level, **rounded down**. The streak is the number of hits in a row (a miss resets it to 0)
- `faceBonus` = `events.faceWindow.faceBonusCoins` (10) when the banana face is hit
- then the buffs' multiplier (read when the player tapped to aim), rounded down once at the end (projectiles no longer have a coin multiplier - their own `rewards` are the numbers)

| streak | W20 (base 5) | W21 (base 3) |
|---|---|---|
| 1 | 5 | 3 |
| 2 | 5 (bonus 0.75 -> 0) | 3 (0.45 -> 0) |
| 3 | 6 (1.5 -> 1) | 3 (0.9 -> 0) |
| 4 | 7 (2.25 -> 2) | 4 (1.35 -> 1) |
| 5 | 8 (3.0 -> 3) | 4 (1.8 -> 1) |
| 10 | 11 (6.75 -> 6) | 6 (4.05 -> 4) |

Because the bonus rounds down, the first level of a streak pays nothing at these small bases.

## events (live)

`faceWindow` is the random event where W20 turns into the face window: hit the face for the bonus.

| field | meaning |
|---|---|
| `chancePerThrow` | chance (0-1) that the event starts after each throw, hit or miss - `0.01` = 1%. It never starts while an event is already running. (It used to start at a streak of 3; the streak no longer matters.) |
| `durationMs` | how long the face texture stays (20000 = 20s) |
| `hitRevertMs` | how long the "hit" texture shows before fading back |
| `faceBonusCoins` | extra coins for hitting the face, on top of the normal hit reward |

## aim (live)

The speed of the two aim markers. **Both sliders always run at the same speed**, and nothing but the streak changes it
(projectiles and buffs only change how wide the sliders are).

| field | meaning |
|---|---|
| `markerHz` | back-and-forth sweeps per second at streak 0 (`0.85` = one sweep in about 1.2s) |
| `streakSpeedUp` | each hit of the current streak adds this fraction of the base speed: `0.1` = +10% per level, so streak 10 = 2x, streak 20 = 3x |
| `maxSpeedMultiplier` | the speed never goes above this multiple of the base (`3` = reached at streak 20 with the current 0.1) |

`speed = markerHz x min(maxSpeedMultiplier, 1 + streakSpeedUp x streak)`. The streak is saved (it survives closing the app and changing projectile) and is read when the player taps "TAP to aim", so
the speed is fixed for that whole throw; a miss resets the streak and the speed with it.

## projectiles (live)

Gameplay numbers for each projectile you can equip, keyed by its id (the same id as its shop item and its
entry in the PROJECTILES list). How each one *looks and sounds* (textures, character sprites, impact sound)
is in `PROJECTILE_VISUALS` at the top of `src/main.js`.

| field | meaning |
|---|---|
| `infinite` | `true` = never runs out (the snowball). Every other projectile is a **consumable**: one is used up the moment the player taps "TAP to aim"; when the last one is gone the snowball is equipped again and the kind leaves the PROJECTILES list |
| `rewards` | the base coins for a hit on `W20` / `W21` with this projectile (the streak and face bonuses are added on top) |
| `weight` | **not shown to the player.** Heavier projectiles fly lower with the same throw strength: the apex is multiplied by `100 / weight` (snowball = 100 is the reference; chestnut 80 flies 25% higher). A very heavy projectile is clamped so it never ends up below the lowest allowed stick height |
| `angleRange` | how far the throw can drift sideways. `1` = the full swing; `0.8` = only 80% as far. The marker's speed is fixed for everything (projectiles and buffs only change the *spread*). The offset bar always keeps its full width and shows the projectile's range edge to edge, so its graduation lines (every 10% of the full swing) look stretched on a smaller range. Two green lines mark where a W20 hit is guaranteed sideways |
| `leavesMark` | `false` = no snow mark; the projectile bounces off the wall instead (and plays its impact sound) |
| `spins` | the projectile rotates in flight |

A full-strength throw of the snowball (weight 100, no buffs) peaks at the middle of the window row above the goal windows (height 465.5). Chestnut right now: rewards 8 / 5, `weight 75`, `angleRange 0.8`, no mark, spins, consumable (placeholder numbers, to be tuned).

## shop

The shop always shows `slots` slots. **A slot with no item to sell shows `(TBD)`** - the shop currently has only the chestnut, the placeholder items were removed. Buying an item empties its slot: it shows SOLD OUT with a countdown,
and when the timer ends the slot restocks with an item picked by the rules below (it can be the same one again).
If that happens while the shop is closed, the SHOP button gets a pulsing red dot and `assets/audio/shop_restock.mp3` plays
(the dot is saved and stays until the shop is opened; a restock that happened while the app was closed shows the dot but
plays no sound, since browsers only allow sound after a tap). Only the first restock after you last looked at the shop makes a sound: if more slots restock later while the dot is still showing, they stay silent.

**`restockSeconds`** - how long a bought slot stays SOLD OUT. `60` while testing, `3600` for the real
one hour. The deadline is stored as a timestamp from the **device clock** in the save, so it keeps
counting while the app is closed: on the next open every slot whose time has passed is restocked.
Setting the phone clock forward will restock early - there is no server to check against - but
setting it back can not make a timer longer than one full `restockSeconds`.

**`refill`** - how a replacement is chosen:
- `mode: random_from_eligible` - random pick among items the player is allowed to see
- `excludeOwned` - permanent items already bought never come back
- `categoryWeights` - odds of each TYPE when a slot is filled (`consumable` 9 vs `projectile` 1 = a projectile about 1 time in 10; measured 10.8%). An item of the chosen type is then picked at random
- (always on) a **projectile** is never on sale in two slots at once; **consumables can be** (the same one can show in two or more slots)
- `guaranteeCheapItem` - after choosing, if nothing shown costs `maxPriceInAverageHits` average
  hits or less, swap one slot for a cheaper item. This is the safety net against the shop
  filling up with things the player can't afford.

**items** - one entry each:

| field | meaning |
|---|---|
| `id` | unique, never change it once players own it (saves refer to it) |
| `name`, `description` | shown in the shop |
| `category` | `consumable` (common: buy it as often as you like, used up over `duration`; can be on sale in two slots at once) or `projectile` (rare: bought once and kept, never on sale twice) |
| `price` | coins |
| `amount`, `unitPrice` | **stack items (projectiles)**: `{min, max}` ranges. Each time the item is put on sale (first fill and every restock) an `amount` and the price of ONE are rolled inside the ranges (chestnut: 10-20 pieces at 4-6 coins each); the slot costs `amount x unitPrice` and shows "x14" on its card. Saved with the stock, so leaving the shop can't reroll it. Buying adds the whole stack to the inventory. A stack item is never on sale in two slots at once, and a slot that just sold one keeps it reserved until its timer ends |
| `image` | optional: picture path shown on the shop card (the chestnut has one; other items show an empty picture box) |
| `ignorePriceOverride` | optional. `true` = always costs its own `price`, even while `shop.priceOverride` makes everything else 1 coin (the chestnut is 10) |
| `duration` | buffs only: `{ "seconds": N }` |
| `effect` / `effects` | `effect` = `{ "type": ..., "value": ... }`; buffs use an `effects` list of those - see below |

### buffs (live)

A `consumable` item is a timed **buff**: buying it starts it right away for `duration.seconds` (device clock,
so the timer keeps running while the app is closed and is saved). Buying an active buff again restarts its timer -
effects do not stack from the same buff; different buffs multiply. Its `effects` list is what it does:

| type | value means |
|---|---|
| `precision` | offset (angle) slider: its range shrinks to 1/value (1.5 = 33% narrower, same marker speed), so the graduation lines spread out |
| `strengthControl` | strength (power) slider: same, its range shrinks to 1/value around the middle of the bar |
| `coinMultiplier` | multiplies the coins of a hit (rounded down) |

**When buffs are read:** only at the moment the player taps "TAP to aim". That snapshot is used for the whole throw
(sliders, graduations, event dots and payout), so a buff expiring or being bought mid-aim never changes anything under the
player's finger. The buff cards and list always show the live state.

### other effect types (planned; nothing applies them yet)

| type | value means |
|---|---|
| `coinMultiplier` | multiplies coins from hits (multiple sources multiply together) |
| `aimSpeedMultiplier` | multiplies the aim pointers' sweep speed (below 1 = slower = easier) |
| `streakBonusPerLevelAdd` | added to `rewards.streakBonusPerLevel` |
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
