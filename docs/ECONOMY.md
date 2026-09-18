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

## shop

The shop always shows `slots` items. Buying one replaces it with another one from the pool.

**`refill`** - how a replacement is chosen:
- `mode: random_from_eligible` - random pick among items the player is allowed to see
- `excludeOwned` - permanent items already bought never come back
- (always on, not a setting) the same item is never on sale in two slots at once
- when no eligible item is left for a slot it shows SOLD OUT, and it **stays** SOLD OUT when the
  shop is closed and reopened. Empty slots only refill when the list of items in `economy.json`
  changes (the game saves which list the stock came from as `catalog`)
- `guaranteeCheapItem` - after choosing, if nothing shown costs `maxPriceInAverageHits` average
  hits or less, swap one slot for a cheaper item. This is the safety net against the shop
  filling up with things the player can't afford.

**items** - one entry each:

| field | meaning |
|---|---|
| `id` | unique, never change it once players own it (saves refer to it) |
| `name`, `description` | shown in the shop |
| `category` | `accessory`, `buff` or `projectile` |
| `price` | coins |
| `kind` | `permanent` (bought once, kept) or `consumable` (used up) |
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
- Permanent items leave the pool once bought; consumables never do. If the pool can't fill every
  slot, the extra slots show SOLD OUT.
