# SNOWY BALLS - dev notes

Reference doc for values decided by trial-and-error, so we don't have to rediscover them later.

## background.png layout (real art, in use since 2026-09-18)

704x1000 PNG. Found via a pixel-analysis pass (flood-fill on the window-glass blue, see
`docs/background_annotated.png` for the labeled reference image with a 50px grid):

- **Ground line**: image y=660 (top of the flat sidewalk plane). Maps to world height 0.
- **Roofline**: image y=17 (sky starts). Maps to world height 643.
- **40 windows detected**, W1-W40, full coordinate table was printed to chat when this was
  first analyzed - regenerate with the mask/flood-fill approach in that session if needed again.
- **W20** (x=385-436, y=273-316) and **W21** (x=472-494, y=273-316) are the two real scoring
  targets - user's choice, confirmed 2026-09-18. Everything else is decoration. W20 = 6 coins,
  W21 = 3 coins (half of W20, despite being the smaller/harder target - user's explicit call).
  Both in the same row, so they share one `heightFrom`/`heightTo` band in `WINDOWS` (src/main.js).
- Building height is final - user confirmed no more floors will be added above; the only slack
  is unused sidewalk at the bottom of the PNG that "doesn't matter."
- World-space conversion: `heightClimbed = IMG_GROUND_Y - imageY` (see `IMG_GROUND_Y` in
  src/main.js). The background image itself is placed at Phaser `(0, -IMG_GROUND_Y)` with a
  top-left origin so image row 660 lands exactly on world height 0.

## Canvas / camera

- `WORLD_WIDTH = 704` - background.png's own width; the image and all world-space x
  coordinates (windows, ORIGIN_X) are relative to this, independent of canvas size.
- `GAME_WIDTH = 426` / `GAME_HEIGHT = 243` - canvas resolution IS the resting camera framing,
  sized to match a reference crop the user marked directly on the art (right entrance door +
  ground). See the camera-bounds/zoom gotcha below for why this is done via canvas size
  instead of `camera.zoom`.
- `ORIGIN_X = 440` (WORLD_WIDTH/2 + 58 + 30) - nudged right of dead-center twice per user
  request (+58, then +30 later the same day); moves the character and the ball's launch point
  together. W20 now needs a slight *left* swing to hit (character stands slightly right of it).

## Physics: snowball sticks at apex (redesigned 2026-09-18)

The snowball no longer falls back down or gets checked frame-by-frame along its whole arc -
it flies up along the usual parabola and **sticks to the wall exactly at the top of its arc**
(apex), full stop. A throw only counts as a hit if that one point (apex height + horizontal
drift at that instant) lands inside W20, W21, or the bonus head zone; everything else is a
miss, no matter how close the ball's path came to a window on the way up. `launchBall()`
computes `apexTime = ballVY0 / GRAVITY` up front; `updateFlight()` clamps `t` to `apexTime`
once reached, and resolves the hit/miss check only at that point (see `updateFlight` in
src/main.js). This also retired the old "possible tunneling through a thin target" caveat
that applied to continuous per-frame collision checking - there's no continuous check anymore,
just one point-in-box test at apex.

## Physics constants (tune here first before touching game logic)

- `GRAVITY = 900`
- `MAX_SWING_SPEED = 180` - had to raise this from an earlier placeholder (110) because W21
  sits far enough right of center that a weaker max drift couldn't physically reach it by the
  time the ball reaches apex height.
- `MIN_POWER_SPEED = 300` / `MAX_POWER_SPEED = 1150` - max apex is ~735 world px, just above
  the roofline (643), so a full-power throw sticks near the roof (an intentional miss/edge
  case) rather than overshooting into undefined space.
- `ANGLE_HZ = 0.85`, `POWER_HZ = 0.65` (aim pointer sweep speed, cycles/sec)
- W20/W21's required power (to make their apex land in the window band) is `vy0` in roughly
  [786, 835] out of the full [300, 1150] range - a real but learnable precision window, not a
  hair's-width one.

## Real snowball + mark sprites (2026-09-18)

`assets/snowball/snowball.png` and `snowball_mark.png` (exported from the user's
`snowball.psd`/`snowball_mark.psd` in the "snowy-balls photoshop assets" folder, both native
32x32) replace the placeholder white circle. Ball renders at 16x16 display size, marks at
20x20 (slightly bigger than the ball, like a real impact splat). Marks render at depth 5
(above the building, below the live ball at depth 10).

Every throw leaves a mark exactly where the snowball sticks (see the apex-physics section
above) - hit or miss, since the ball always sticks somewhere now. Marks are a FIFO queue
(`this.marks` in `MainScene`) capped at `MAX_MARKS = 5`: adding a 6th destroys and removes the
oldest, so the wall never gets fully covered. `addMark()` is called from `finishThrow()`, which
now also receives the exact stick coordinates from `updateFlight()`.

## Known TODO / not-yet-real

- Character, snowball, and any UI chrome are still placeholder `Graphics` shapes - only the
  building is real art so far.
- `manifest.json` has no icons yet - needs `assets/ui/icon-192.png`, `icon-512.png`,
  and an `apple-touch-icon.png` + `<link rel="apple-touch-icon">` in `index.html` once
  real art exists, for "Add to Home Screen" to look right.
- No per-level layout system yet - W20/W21 positions are hardcoded from this one background.
- No shop/unlock system yet - `Economy` (src/economy.js) only tracks coins + best streak.
- No sound.
- Streak bonus (+15% of base coins per streak level) rounds down and is currently invisible
  at low streak counts with W20/W21's small coin values (e.g. streak 2 on a 6-coin hit only
  adds +1). Worth revisiting once real coin economy/shop pricing exists to know what scale
  actually matters.

## Decisions made

- Two-phase aim: freeze angle first (press/tap/space/on-screen button), then freeze power
  (same triggers again), then it launches.
- Aim pointer is a ping-pong (triangle wave) sweep, not a sine wave - keeps sweep speed
  constant across the bar so difficulty doesn't cluster at the edges.
- Camera scrollY only (no horizontal follow) - building stays horizontally fixed as a
  reference, camera just climbs with the ball's altitude.
- Streak bonus: +15% of the base hit coins per streak level beyond the first, stacking
  with (not replacing) the flat head-hit bonus.
- Head bonus hitbox sits directly above W20 only (not W21), `HEAD_CHANCE = 0.3` per throw,
  `HEAD_BONUS_COINS = 8` added on top of W20's base coins.
- background.png's ground-detail update (textured sidewalk, 2026-09-18) was reverted the same
  day at the user's request - back to the flat-gray sidewalk version. Windows/doors/ground-roof
  lines were identical between the two versions either way (confirmed via pixel diff), so this
  is a pure art choice with no gameplay-constant impact if it comes back later.

## Phaser camera-bounds gotcha (2026-09-18)

`camera.setBounds(x, y, width, height)` combined with `camera.setZoom(z)` will silently
force-center `scrollX`/`scrollY` (ignoring any explicit value you set) once the bounds width/
height gets close to the zoomed viewport size - happened here when bounds width was exactly
`GAME_WIDTH` (704) at zoom 1.72 (zoomed viewport ~409px). Explicit `scrollX = 223` would read
back as 223 immediately after the assignment, then silently snap to `(bounds.width -
viewportWidth)/2` on the very next read/frame. Fix: keep bounds padded well beyond what you
actually need to constrain (we don't horizontally follow the ball anyway, so the X bounds here
are just `-GAME_WIDTH` to `GAME_WIDTH*3` - effectively unconstrained).

## Browser-pane testing gotcha (2026-09-18)

Phaser's `requestAnimationFrame` loop can stall in the Claude Code Browser pane if the tab
isn't genuinely OS-focused (observed after a `navigate` + `javascript_exec` sequence with no
real click in between - `flightTime` froze mid-throw and wouldn't advance even after `wait`).
`tabs_select` alone didn't unstick it. Workaround for driven tests: call `scene.updateFlight(dt)`
directly in a loop from `javascript_exec` to step the simulation manually instead of relying on
real elapsed time. A real click-driven sequence (click to freeze angle, click to freeze power,
then `wait`) played through fine in real time, so this only affects scripted/automated testing,
not actual play.
