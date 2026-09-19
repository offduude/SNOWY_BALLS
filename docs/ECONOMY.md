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
| `windows.W20`, `windows.W21` | base coins for a hit on that window |
| `streakBonusPerLevel` | each hit in a streak beyond the first adds this fraction of the base, rounded down. `0.15` = +15% per level. Set `0` to turn streak bonuses off |
| `missCoins` | coins for a miss (or a ball that flies out the top). `0` normally |

## events (live)

`faceWindow` is the streak bonus where W20 turns into the face window.

| field | meaning |
|---|---|
| `streakTrigger` | hit streak that starts it (exactly this number) |
| `durationMs` | how long the face texture stays (20000 = 20s) |
| `hitRevertMs` | how long the "hit" texture shows before fading back |
| `faceBonusCoins` | extra coins for hitting the face, on top of the normal hit reward |

## projectiles (live)

Gameplay numbers for each projectile you can equip, keyed by its id (the same id as its shop item and its
entry in the PROJECTILES list). How each one *looks and sounds* (textures, character sprites, impact sound)
is in `PROJECTILE_VISUALS` at the top of `src/main.js`.

| field | meaning |
|---|---|
| `weight` | **not shown to the player.** Heavier projectiles fly lower with the same throw strength: the apex is multiplied by `100 / weight` (snowball = 100 is the reference; chestnut 80 flies 25% higher). A very heavy projectile is clamped so it never ends up below the lowest allowed stick height |
| `angleRange` | how long the left-right offset bar is, drawn centered. `1` = the full bar; `0.8` = a bar 20% shorter (the marker runs edge to edge of it, so the throw can drift only 80% as far sideways) |
| `angleSpeed` | how fast that marker moves along the bar compared with normal. `0.8` = 20% slower |
| `coinMultiplier` | multiplies the coins of a hit (streak and face bonuses included), rounded **down**. `0.8` on a 6-coin hit = 4 |
| `leavesMark` | `false` = no snow mark; the projectile bounces off the wall instead (and plays its impact sound) |
| `spins` | the projectile rotates in flight |

A full-strength throw of the snowball (weight 100, no buffs) peaks at the middle of the window row above the goal windows (height 465.5). Chestnut right now: `weight 80`, `angleRange 0.8`, `angleSpeed 0.8`, `coinMultiplier 0.8`, no mark, spins (placeholder numbers, to be tuned).

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
| `image` | optional: picture path shown on the shop card (the chestnut has one; other items show an empty picture box) |
| `ignorePriceOverride` | optional. `true` = always costs its own `price`, even while `shop.priceOverride` makes everything else 1 coin (the chestnut is 10) |
| `duration` | consumables only: `{ "throws": N }` |
| `effect` | `{ "type": ..., "value": ... }` - see below |

### effect types (planned; nothing applies them yet)

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

- Average base reward is ~4.5 coins per hit (W20 6 / W21 3); `tools/economy_report.py` prints how many
  hits and throws each item costs. There are no tiers right now: every item can appear from the start.
- Multiplier effects stack, so keep `coinMultiplier` values modest or a few purchases make the
  prices meaningless. Effects that make the *game itself* easier (`aimSpeedMultiplier`,
  `hitPaddingPx`) compound with that - watch total hit rate, not just coin rate.
- Permanent items leave the pool once bought; consumables never do. If nothing is eligible when a
  slot restocks it just stays SOLD OUT (no timer) until something is.
