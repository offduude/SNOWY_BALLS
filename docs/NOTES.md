# SNOWY BALLS - dev notes

Reference doc for values decided by trial-and-error, so we don't have to rediscover them later.

## Current placeholder layout (src/main.js)

- Base canvas: 480x270 (medium pixel scale, chosen as a sensible default - not locked in,
  change `GAME_WIDTH`/`GAME_HEIGHT` once real building art exists).
- `BUILDING.topHeight = 1400` world px tall (climbable height above ground).
- `WINDOW_TARGET`: centered `offsetX = 30` right of the throw origin, `height = 900` px up
  the building, hitbox `46x40`.
- Head bonus hitbox sits directly above the window, `HEAD_CHANCE = 0.3` per throw.

## Physics constants (tune here first before touching game logic)

- `GRAVITY = 900`
- `MAX_SWING_SPEED = 110` (horizontal drift range from full-left to full-right aim)
- `MIN_POWER_SPEED = 260` / `MAX_POWER_SPEED = 620` (vertical launch speed range)
- `ANGLE_HZ = 0.85`, `POWER_HZ = 0.65` (aim pointer sweep speed, cycles/sec)

## Known TODO / not-yet-real

- All visuals are placeholder `Graphics` rectangles/circles - no textures loaded yet.
- `manifest.json` has no icons yet - needs `assets/ui/icon-192.png`, `icon-512.png`,
  and an `apple-touch-icon.png` + `<link rel="apple-touch-icon">` in `index.html` once
  real art exists, for "Add to Home Screen" to look right.
- Only one fixed window/head position - no per-level layout system yet.
- No shop/unlock system yet - `Economy` (src/economy.js) only tracks coins + best streak.
- No sound.

## Decisions made

- Two-phase aim: freeze angle first (press/tap/space), then freeze power (press/tap/space
  again), then it launches. Both phases use the same freeze input.
- Aim pointer is a ping-pong (triangle wave) sweep, not a sine wave - keeps sweep speed
  constant across the bar so difficulty doesn't cluster at the edges.
- Camera scrollY only (no horizontal follow) - building stays horizontally fixed as a
  reference, camera just climbs with the ball's altitude.
- Streak bonus: +15% of the base hit coins per streak level beyond the first, stacking
  with (not replacing) the flat head-hit bonus.
