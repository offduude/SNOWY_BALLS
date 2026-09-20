# Future prices (the planned economy; the existing items are applied, the new ones are not in the game yet)

Written 2026-09-20, revised the same day. Everything marked "in the game" was applied to `economy.json` on 2026-09-20; the rows marked "future" are not in the game yet - their ready-to-paste entries are in `docs/future_items.json`.

## Assumptions behind the numbers

- A player throws about 10 times a minute and hits about **75%** of throws. A buff's use covers **one stack** in its 2 minutes (5 throws of a
  standard stack, 2 of a heavy hitter; a stack costs the same on average either way).
- Free income: the snowball (hit value **4**, cap 50, +1 every 30 s = about 360 coins an hour at 75%).
- **Hit value = 1.6 x the average price per piece** (price spread +-25%, so the hit value is always above the highest price: every
  purchase is profitable at a 100% hit rate; the average break-even is about 62% hits).
- Standard stacks are 3-7 pieces (avg 5); **heavy hitters** are 1-3 pieces (avg 2) at 2.5x the price per piece and 2.5x the hit value.
- **Buffs must be profitable with the items of their own rarity.** One use of a buff on one average stack (price P) of ITS OWN tier returns:
  a save chance `s`: **s x P** (the pieces not used up); a coin multiplier `k`: **1.2 x (k - 1) x P** (a full stack pays back 1.2 x P at 75%);
  +N points of hit rate: **N x 1.6 x P** (Triangles +10, Skyr +15: my guesses); Sure Shot on a heavy hitter: **0.2 x P** (0.5 x P with a banana
  face x2.5). The price is about **60% of that return** (so a same-tier stack earns the player about 1.7x what the buff costs; a stack of a higher
  tier earns far more), with a **+-25% range**, like projectiles. (A 50-throws-in-2-minutes basis was also worked out and dropped: it made every
  buff price about ten times higher, about 30 / 500 / 5,500 / 50,000 for save and multiplier buffs, and assumed the player owns 10 stacks.)
- Every save % / multiplier buff lasts **2 minutes**; the other special buffs keep their own durations.

## Projectiles

| rarity | avg stack price | standard: stack / price per piece / hit value | heavy hitter: stack / price per piece / hit value |
|---|---|---|---|
| default (snowball) | free | - / - / **4** | - |
| common | 50 | 3-7 / 8-12 / **16** | 1-3 / 20-30 / **40** |
| rare | 400 | 3-7 / 60-100 / **128** | 1-3 / 150-250 / **320** |
| epic *(standard: not in the game yet)* | 3,000 | 3-7 / 450-750 / **960** | 1-3 / 1,125-1,875 / **2,400** |
| legendary *(none in the game yet)* | 15,000 | 3-7 / 2,250-3,750 / **4,800** | 1-3 / 5,600-9,400 / **12,000** |

In the game today: common Chestnut + Rowan Berry (standard) and Stone (heavy hitter); rare Pinecone (standard) and Egg (heavy hitter); epic
Grenade (heavy hitter). Time to first afford a stack at 75% / 90% hit rate (simulated, always-playing player): rare 0.5 h / 0.2 h, epic 3.7 h / 2.1 h,
legendary 12.5 h / 6.6 h.

## Buffs (always 1 per slot, price is per buff)

**Skyr moves from epic to rare** (the new strength bands make the guide lines a smaller help).

| rarity | buff | effect | duration | return on one same-tier stack | price range (avg) | status |
|---|---|---|---|---|---|---|
| common | Water Bottle | 10% chance not to use up the projectile | 2 min | 5 | 2-4 (3) | in the game (2-4, 120 s; was 60 s, 16-33) |
| common | Snowy Cube | 1.1x coins | 2 min | 6 | 3-5 (4) | in the game (added 2026-09-20) |
| rare | Triangles | the OFFSET slider at 0.8x speed (was both sliders; the strength slider is not slowed any more) | 3 min (was 2) | 64 | 29-48 (38) | in the game (was 93-156, now the range above) |
| rare | Skyr | green guide lines on both sliders | 3 min (as now) | 96 | 43-72 (58) | in the game (now rare; was epic, 530-719) |
| rare | Mints | 20% chance not to use up the projectile | 2 min | 80 | 36-60 (48) | in the game (added 2026-09-20) |
| rare | Kaiser Roll | 1.2x coins | 2 min (as now) | 96 | 43-72 (58) | in the game (was 93-156, now the range above) |
| epic | *(new)* save | **50%** chance not to use up the projectile (was 30%) | 2 min | 1,500 | 675-1,125 (900) | future |
| epic | *(new)* coin bonus | 1.35x coins | 2 min | 1,260 | 570-940 (756) | future |
| legendary | *(new)* free throw | replaces the 50% save: the next throw does not use up a bought projectile (a one-time charge, no timer; needs a new mechanic) | until thrown | 3,000 (7,500 on a heavy hitter) | 2,250-3,750 (3,000) | future |
| legendary | Daniel's 3 PLN | 1.5x coins | 2 min | 9,000 | 4,050-6,750 (5,400) | in the game (added 2026-09-20) |
| legendary | Diamond Cross (was Sure Shot) | the next throw is carried to W20 (or the banana face during the event) if it misses; a charge, no timer | until thrown | 3,000 (7,500 with a face event) | 1,800-3,000 (2,400) | in the game (added 2026-09-20) |
| legendary | Tomato Juice | starts the banana face event (face multiplier x2.5) | 20 s (as now) | 6,840 on a standard stack, 17,100 on a heavy hitter | 3,100-5,100 (4,100) | in the game (3,100-5,100, face x2.5; was 2,343-3,906, face x40) |

Buff price ladder by tier: about 3 / 50 / 550 / 5,000 for the save and multiplier buffs.

### Sure Shot and the banana face

- On a legendary heavy hitter (hit value 12,000) at 75% hits, a guaranteed hit is worth 0.25 x 12,000 = **3,000** on an ordinary throw.
- With a banana face event running (payout = hit value x the face multiplier, x2.5 = 30,000) the guaranteed hit also guarantees the jackpot: 0.25 x 30,000 =
  **7,500**. Tomato Juice (about 4,100) + Sure Shot (about 2,400) = a guaranteed jackpot for about 6,500 plus the projectile.

### The face multiplier

The face multiplier is set so Tomato Juice is profitable with the standard projectile of its own rarity: x2.5 with legendary items (x40 today would be
far too much). With a lower-tier projectile the same x2.5 pays little, so it is a buff for the best projectile the player has. If the multiplier should
depend on the projectile, use: 2.5 x the buff's price / the hit value, kept between x2 and x20.

## Effect of moving Skyr to rare on the shop odds

Rare items: Kaiser Roll, Triangles, Skyr, Pinecone, Egg = 6% each (was 7.5% with four); epic then holds only the Grenade at 9% (was 4.5% each).

## Stacking (2026-09-20)

Buffs of the same kind stack: save chances as independent rolls (10 / 20 / 50 = 64% together, never above 90%), coin multipliers multiply (no cap: 1.1 x 1.2 x 1.35 x 1.5 = 2.67x with the planned ladder), the Triangles slow-downs multiply on the offset slider only (no floor). The prices above were set for one buff at a time; with stacking each extra buff of a kind returns a little less than its own price implies.
