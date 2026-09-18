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
- `GAME_WIDTH = 426` / `GAME_HEIGHT = 243` - canvas resolution, originally sized to match a
  reference crop the user marked on the art (right entrance door + ground). See the camera-
  bounds/zoom gotcha below for why this is done via canvas size instead of `camera.zoom`.
- `ORIGIN_X = 450` (WORLD_WIDTH/2 + 58 + 30 + 10) - nudged right of dead-center three times
  across separate requests (+58, +30, +10); moves the character and the ball's launch point
  together. W20 now needs a slight *left* swing to hit (character stands right of it).
- **Resting camera is centered on the character** (2026-09-18 request), not a fixed crop:
  `INITIAL_SCROLL_X = ORIGIN_X - GAME_WIDTH/2`, `INITIAL_SCROLL_Y = -GAME_HEIGHT/2` (centers
  world height 0, the ground, vertically). This means the resting view shows a fair amount of
  plain sidewalk below the character and doesn't show W20/W21 at rest (only during the
  camera's flight-follow) - a real tradeoff of true centering worth knowing about if the
  framing ever feels off; revisit if the user wants the old bottom-anchored framing back.

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
- `MIN_POWER_SPEED`/`MAX_POWER_SPEED` are **derived, not hand-picked** (2026-09-18 redesign):
  `MIN_STICK_HEIGHT = 184` and `MAX_STICK_HEIGHT = 643` (the roofline) come from a restricted-
  zone reference image the user marked (red zone's top edge was image-y=486, plus a 10px
  buffer they asked for, converted via `IMG_GROUND_Y - imageY`), and `MIN/MAX_POWER_SPEED` are
  back-computed from those via `vy0 = sqrt(2 * GRAVITY * height)` so a 0%/100% power throw's
  apex lands exactly on those two bounds. This guarantees the snowball can never stick in the
  sky or in the restricted ground/doors area, by construction - no extra runtime clamping
  needed. If `MIN_STICK_HEIGHT`/`MAX_STICK_HEIGHT` change, the power range updates itself.
- `ANGLE_HZ = 0.85`, `POWER_HZ = 0.65` (aim pointer sweep speed, cycles/sec)
- W20/W21's required power (to make their apex land in the window band) is `vy0` in roughly
  [786, 835] out of the current [576, 1076] range - a real but learnable precision window, not
  a hair's-width one.

## Real snowball + mark sprites (2026-09-18)

`assets/snowball/snowball.png` and `snowball_mark.png` (exported from the user's
`snowball.psd`/`snowball_mark.psd` in the "snowy-balls photoshop assets" folder, both native
32x32) replace the placeholder white circle. Ball renders at 16x16 display size, marks at
20x20 (slightly bigger than the ball, like a real impact splat). Marks render at depth 5
(above the building, below the live ball at depth 10).

Every throw leaves a mark exactly where the snowball sticks (see the apex-physics section
above) - hit or miss, since the ball always sticks somewhere now. `addMark()` is called from
`finishThrow()`, which receives the exact stick coordinates from `updateFlight()`.

**Marks fade out on a per-mark timer, not a count cap (2026-09-19, superseding the
"culling deferred until camera returns" approach from the same day)**: the count-based
FIFO/`MAX_MARKS`/`pruneMarks()` system was replaced entirely. Each mark now gets its own
`this.time.delayedCall(MARK_LIFETIME_MS, ...)` when placed - `MARK_LIFETIME_MS = 10000`, so it
starts fading exactly 10s after it stuck, independent of throw count or camera position - then
tweens `alpha` to 0 over `MARK_FADE_MS = 1500` and destroys itself, splicing out of
`this.marks`. A smooth fade doesn't have the "vanished while I was looking" problem an instant
cull did, so there was no need to keep gating it on the camera being back on the player.
Verified end-to-end in real browser time (not scripted stepping - Phaser's timers/tweens need
actual elapsed wall time, and the Browser-pane rAF-stall gotcha below means scripted
`time.update()`/`tweens.update()` calls to fast-forward them are unreliable, so this needs a
real `wait` with the tab actually rendering frames to trust the result).

## Target panel replaces the coins/streak/best text (2026-09-19, superseded same day - see below)

The old `hudText`/`updateHud()` (COINS/STREAK/BEST readout) is gone - the underlying `Economy`
tracking is untouched, just not displayed right now; bring the readout back (or redesign it)
whenever there's a reason to show it again.

The first replacement was a static panel showing W20/W21 as cropped texture snippets with coin
values underneath. The user didn't want a static crop or the coin numbers - see the PIP camera
section below for what actually shipped.

## Top-left "rear view camera" - a real second Phaser camera, not a static crop (2026-09-19)

`createTargetCamera()` adds a genuine second `Camera` (`this.targetCam`, via `this.cameras.add`)
with its own small viewport at `(TARGET_CAM_X, TARGET_CAM_Y)`, `scrollX`/`scrollY` centered on
the W20/W21 patch of the world (`TARGET_CAM_MARGIN_X`/`_Y` add a little breathing room around
both windows). It renders the *same live scene* as the main camera - background, ball, marks -
so a snowball flying past or a mark landing there shows up in the PIP in real time, exactly like
a car's backup camera. Confirmed live: stepped a throw to just-before-apex and screenshotted -
the ball was visibly mid-air in the PIP, in front of W20, while the main (resting) camera didn't
show that area at all.

Deliberately **zoom 1** - the PIP's viewport size is set to exactly match the world region's
pixel size instead of zooming a smaller region up to fill a bigger viewport. This sidesteps the
same Phaser 3.80 WebGL zoom-clipping bug documented below (content getting cut off at the
viewport edge when `camera.zoom != 1`) rather than re-fighting it for a second camera.

`targetCam.ignore([...])` excludes the screen-space HUD (`aimGfx`, `messageText`) and the PIP's
own decorative bezel - without this, those `scrollFactor(0)` objects would also try to render
inside the PIP's own tiny viewport (screen-space objects are camera-relative, not global, so a
second camera renders them at its own tiny scale unless told not to).

Camera viewports are inherently rectangular in Phaser - there's no cheap way to give the live
feed itself rounded corners without a geometry mask (skipped for now, extra complexity/risk on
top of an already-quirky camera system in this Phaser version). Instead there's a **bezel**: a
separate rounded-rect `Graphics` object, drawn by the main camera, slightly larger
(`TARGET_CAM_BEZEL_PAD`) than the camera's rectangular viewport and positioned directly behind
it - like a rounded phone body around a rectangular screen. Reads as a smooth-edged panel even
though the live content inside is a plain rectangle.

The live ball sprite itself is hidden except during actual flight (`setVisible(false)` in
`create()`/`finishThrow()`, `setVisible(true)` in `launchBall()`) - it used to sit visibly
above the character's head at rest, which the user asked to remove; the mark left behind at
the stick point is the only lasting visual now.

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
- Streak bonus: +15% of the base hit coins per streak level beyond the first.
- **Headshot mechanic removed (2026-09-19)**: there used to be a 30% chance per throw of an
  invisible bonus zone spawning just above W20, worth W20's coins + 8 extra if the apex landed
  there. It shipped with zero visual indicator - there was no head sprite anywhere - so from
  the player's side it just looked like hitting near the top of the window randomly triggered
  a "HEADSHOT" message. Removed entirely rather than left disabled; re-add properly (with an
  actual visible head sprite that appears before the throw, so it's something to aim for, not
  a coin flip) once real NPC/head art exists.
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
