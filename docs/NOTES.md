# SNOWY BALLS - dev notes

Reference doc for values decided by trial-and-error, so we don't have to rediscover them later.

## Audio (2026-09-19)

Four files dropped at the project root (`theme.mp3`, `throw_whoosh.mp3`, `snowball_impact.mp3`,
`coin_sound.mp3`) moved into `assets/audio/`. Loaded in `preload()`, wired to the obvious game
events since only the theme's looping was explicitly requested but leaving the rest silent after
being told to "check them out" seemed like an oversight:

- `theme`: starts in `create()` via `this.sound.play("theme", { loop: true, volume: 0.5 })`.
  `loop: true` is the actual fix for "don't run out of it" - it's a real multi-minute track,
  not something that was ever going to fill a play session on its own.
- `throw_whoosh`: plays in `launchBall()`, i.e. the moment a throw is released.
- `snowball_impact`: plays in `finishThrow()` for every throw, hit or miss - matches the
  "always sticks somewhere" physics, so there's always exactly one impact per throw.

**`window_clink.mp3` added later the same day, briefly wired up to replace `snowball_impact`
specifically on window hits, then reverted the same day** ("bring back the old sound for both
window hits and regular wall hits") - `snowball_impact` plays for every stick again regardless
of outcome. The file is still loaded in `preload()` but currently unused; a natural fit if a
window-specific sound gets asked for again later.

**`coin_sound.mp3` removed entirely** (2026-09-19, later the same day, by request) - both the
`preload()` call and the asset file itself are gone, not just the `finishThrow()` play call.
Unlike `window_clink` above, this wasn't "revert to a prior state," it was a direct "remove the
coin sound" - so nothing was kept around for a hypothetical later reuse.

**`theme.mp3` swapped for a different track** (2026-09-19, later the same day) -
`new_theme_music.mp3` dropped at the project root replaced `assets/audio/theme.mp3` outright
(same filename/key, so no code changes needed beyond a `?v=2` cache-buster on the load path,
since http.server sends no cache headers and the old bytes could otherwise stick around in a
browser cache). New track is ~2:13 (133.4s) vs. the original's ~3:33. Still loops.

Verified via `scene.sound.get('theme')` (`loop: true`, `isPlaying: true`, new duration) and by
monkey-patching `scene.sound.play` during a scripted throw to confirm the call order:
`throw_whoosh` -> `snowball_impact` for a stick, with nothing else added.

## Shop screen shell (2026-09-19)

`#shop-btn` (bottom-right, brown `#8b5a2b`, white Press Start 2P) toggles `.shop-open` on
`#game-container`, which fades `#shop-board` (`assets/ui/shop_board.png`, 160x90, stretched over
the whole game display) in over 0.25s. Board is z 3, SHOP/BACK button z 4, mute button z 5, so
mute stays usable in the shop. One button whose label swaps SHOP <-> BACK, so BACK is in the
identical position/size by construction (verified: identical bounding rect in both states).
While open the board has `pointer-events:auto`, so taps can't reach the canvas (verified game
state unchanged). Click sound (`assets/audio/click.mp3`) goes through Phaser (`sound.play("click")`)
so mute and master volume apply. Shop board is empty - items to buy come later.

## Banana window streak bonus (2026-09-19, built, only partly verified)

Streak of exactly 3 fades `goal_window_banana.png` (draft PSD export, scaled onto W20) over W20
for 20s; hitting the face box during that (+10 coins on top of normal reward) swaps to the hit
texture (tint-flash placeholder - `goal_window_banana_hit.png` didn't exist when built; new
`goal_window_face*.png` files have since appeared at the project root, not yet wired in), then
fades back after 1s together with the mark that hit it. Existing marks on W20's left pane fade
out quickly when the banana texture loads. Streak-3 trigger confirmed live (overlay activates);
the face-hit path and 20s expiry haven't been driven end-to-end yet.

## Mute button (2026-09-19)

Top-right, HTML (`#volume-btn` in `index.html`), not Phaser - it's persistent UI chrome rather
than gameplay content, same reasoning as moving text out to HTML earlier. Icon
(`assets/ui/volume_icon.png`) came from a huge (2291x1343) source file that turned out to be
almost entirely transparent padding around one real 947x1183 speaker-silhouette shape - had to
flood-fill on **alpha**, not just near-white RGB, to find the real content (an earlier RGB-only
pass falsely treated a huge fully-transparent region as "content" because PIL flattens
transparent pixels to black when you `.convert('RGB')` without dropping alpha first). Cropped
tight to that shape and downscaled to 48x59 with NEAREST resampling to preserve the blocky
pixel-art look rather than blurring it.

No separate "muted" icon variant exists in the source art, which works out fine since the user's
spec was to grey out the button on click, not swap the icon: `.muted` CSS class drops opacity to
0.45 and applies `grayscale(100%)`. Click handler toggles Phaser's global `game.sound.mute`
(`window.snowyBallsGame`, exposed for exactly this - also still handy for driven tests) and
syncs the `.muted` class to match. Verified via computed styles
(`getComputedStyle(...).opacity`/`.filter`) that both the mute state and the visual both flip
correctly on click, in both directions.

`window.snowyBallsFreeze` (a leftover global from the FREEZE button removed earlier) was dead
code with zero remaining references anywhere - deleted while touching this same
`window.addEventListener("load", ...)` block.

## Mobile-only from here on (2026-09-19)

Keyboard control (`keydown-SPACE`) removed entirely - tap/click is the only input now. Message
text changed from "TAP or SPACE to aim" to "TAP to aim" in both places it's set (`create()` and
`resetForNextThrow()`).

## Page layout: HTML page, not a fullscreen canvas app (2026-09-19, revised twice same day)

Restructured `index.html` away from the original fixed/fullscreen/centered layout. There's no
more `overflow:hidden`/`touch-action:none` on `html,body` - the page can scroll if it needs to,
which it couldn't originally. The on-screen FREEZE button is gone entirely (removed by request)
- tapping anywhere on the canvas still freezes via the existing `pointerdown` listener on the
whole game, so mobile input isn't actually lost, just the redundant explicit button.

First pass put the game at the top of the page with text in normal flow below it; the very next
request was to make the game **fill the entire page** instead (`#game-container` width is
`min(100vw, calc(100vh * 426 / 243))`, i.e. as large as it can be without exceeding either the
viewport width or height, aspect ratio always exactly preserved - `body` centers it with flex).

**All in-game text moved out of Phaser into HTML** (`#message`, a `<div>` - `white-space:
pre-line` so `\n` in messages still breaks lines). Canvas-rendered Phaser `Text` objects at this
game's small internal resolution (426x243) render as blurry upscaled bitmaps once the browser
scales the canvas up to fill the page; an HTML element with a real web font doesn't have that
problem, it's crisp at any size. `MainScene.showMessage(msg)` just does
`document.getElementById("message").textContent = msg`; there is no `messageText` game object
anymore. The aim bar itself is still a Phaser `Graphics` object (not text), untouched.

**Page/letterbox background is solid black** (`#000000`) - was `#14192a`/`#2b3a55` (dark navy),
changed everywhere it appeared: `html,body` CSS background, the `<meta name="theme-color">`,
`manifest.json`'s `background_color`/`theme_color`, and the Phaser game config's own
`backgroundColor` fallback. The in-game sky color (`0x65bfd5`, set via
`camera.setBackgroundColor` on both cameras) is unrelated and unchanged - that's actual art, not
page chrome.

`#message` is positioned back at **screen center** (`position:absolute` inside
`#game-container`, centered via `top/left:50%` + `transform`) - its original spot as a Phaser
Text object, per a follow-up request; it had briefly lived below the canvas in normal flow in
between. `pointer-events:none` is required here - without it, this overlay (now sitting
directly on top of the interactive canvas) would swallow taps meant for the game underneath.
Added a `text-shadow` for legibility since it now sits directly over busy building art instead
of a plain background.

**Font**: Google Fonts' "Press Start 2P" (loaded via `<link>` in `<head>`), applied via
`font-family` on `html, body` plus explicitly on `#message`. This is a real pixel-styled *font*
(vector glyphs styled to look pixelated), not the same thing as the blurry-canvas-text problem
above - it stays crisp at any zoom level.

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

`targetCam.ignore([...])` excludes the screen-space HUD (`aimGfx`) and the PIP's own decorative
bezel - without this, those `scrollFactor(0)` objects would also try to render inside the PIP's
own tiny viewport (screen-space objects are camera-relative, not global, so a second camera
renders them at its own tiny scale unless told not to).

**Real rounded corners via a geometry mask (2026-09-19, tried after first shipping the fake-
bezel-only version above)**: `camera.setMask()` does exist in this Phaser version and works
cleanly here - `this.targetCamMaskShape = this.make.graphics({x:0,y:0}, false)` creates a
Graphics object that's never added to the display list (`addToScene: false`, so no camera
renders it directly), draws a rounded rect matching the camera's exact viewport rect/radius,
and `targetCam.setMask(maskShape.createGeometryMask())` clips the camera's actual rendered
content to that shape. The mask shape reference has to be kept alive on `this` since Phaser
redraws the clip from its command buffer every frame - letting it get garbage collected would
break the mask. Verified via a renderer snapshot (`game.renderer.snapshot()`, decoded and
upscaled with PIL - the cheap way to actually inspect this canvas's real pixels instead of
guessing from a screenshot) that the corners are genuinely rounded, not just visually implied.

**Border went through three iterations the same day**, each verified with a fresh renderer
snapshot before moving on:
1. A `strokeRoundedRect` border on a bezel sized `TARGET_CAM_BEZEL_PAD` (3px) larger than the
   camera rect. Left a visible 3px dark ring between the live feed and the border ("fill the
   image to the brim" complaint).
2. Set the pad to 0 to kill the ring - but a 1px `lineStyle` stroke on a rounded rect this small
   renders as a **broken/dotted line** in this Phaser version's WebGL renderer, worst right at
   the corners. Bumping the stroke to 2px didn't fix it either - still gapped at the tight
   corner arcs. This looks like a fundamental issue with how this renderer tessellates thin
   strokes on small-radius curves, not a width problem.
3. **What actually shipped**: no stroke at all. `TARGET_CAM_BORDER_WIDTH = 2` sizes the white
   bezel fill (a single `fillRoundedRect`, no inner cutout needed) that many px larger than the
   camera rect on every side; the opaque camera (rendered after, on top, at its normal smaller
   rect) covers everything except that ring, which reads as a clean solid border purely from two
   solid fills overlapping - no path/stroke tessellation involved anywhere, so no gaps possible.

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

## 2026-09-19 (late) - face window, character sprites, 16:9, misc

- **Face window textures**: `goal_window_face.png` / `goal_window_face_hit.png` (the user's real exports, replacing the banana draft + tint placeholder) are cropped to 54x46 (outer 2px grey padding removed - it painted over the wall). Glass area is 52x44 = W20's exact pixel box, so they place **1:1, no scaling**, image top-left at (W20.xFrom-1, height W20.heightTo+1). Face box `(385..402, 343..360)` and left divider (x=404) are in cropped-texture pixels. Hit swap uses the real hit art, no tint; the "BANANA BONUS" message is gone (normal "W20 HIT! +N coins", N includes the +10).
- **Character**: `assets/character/character1_{idle,aiming,throwing}.png` (64x64) replace the placeholder shapes. Pose: aiming during AIM_ANGLE/AIM_POWER, throwing for the first 0.35s of flight, idle otherwise (`updateCharacterPose`). Feet at the ground line + CHARACTER_Y_OFFSET.
- **Display is exactly 16:9**: canvas 432x243 (was 426x243), container `aspect-ratio: 16/9`, width `min(100vw, 100dvh*16/9)` (dvh so mobile browser bars don't push it off-screen). `#game-container` and `html,body` are `overflow:hidden`, so the volume/shop buttons can never sit outside the display. Verified on a 375x812 phone viewport.
- Snowball impact volume halved (0.6 -> 0.3).
- `background.png` tweaked by the user (no coordinate changes).

- Character/throw origin `ORIGIN_X` is now W20's center (410.5), replacing the earlier hand-nudged 420. Hit message is "HIT" then "+N coins" on its own line, then the streak line (no window name).

- `manifest.json` orientation is now `landscape` (was a leftover `portrait` placeholder from the very first scaffold).
- **Theme "not looping" report**: `loop:true` verified working on desktop (seeked to the last 1.5s, it wrapped), so the failure is environment-specific (likely phone audio-context suspend/interrupt). Fix is `startThemeMusic()`: one persistent `sound.add` object plus a 1s watchdog that resumes a suspended/interrupted context and replays the theme whenever it isn't playing (skips hidden tab / locked audio / Phaser-paused-on-blur). Verified by stopping the theme and by suspending the context: both recover within ~2s. Not verified on a real phone.

- **Watchdog trimmed**: the 1s `setInterval` theme watchdog was overkill for a bug I couldn't reproduce. Replaced with event-driven recovery in `startThemeMusic()`: resume the audio context and replay the theme on `visibilitychange` (returning to the tab) and on any tap. No polling. Verified: theme stopped + context suspended, one tap restored both.
- **Mute button "wiggle" on SHOP press**: layout rect never changes during the fade (measured), so it's a paint-time subpixel shift - the icon sits at a fractional y (container is vertically centered, y=259.313) and the shop board only became its own compositor layer when the fade started. Fixed by giving `#shop-board` (`will-change: opacity`) and `#volume-btn` (`will-change: transform; translateZ(0)`) their own layers from the start. Not visually confirmable in the automation pane; needs a real-device look.

- Tried and **dropped**: CSS-rotating the game on portrait phones (iOS ignores the manifest `orientation`, so the home-screen app opens in whatever orientation the phone is held). It broke Phaser FIT sizing and the user preferred just rotating the phone physically. Reverted; the `landscape` manifest entry stays (helps Android only).

- **Phone-only screen shake on throw** (PC fine): camera follow used a fixed 0.12 lerp *per frame* and physics used raw frame delta, so uneven phone frame times (or one long frame when the whoosh starts) made the camera/ball lurch. Now `follow = 1 - exp(-14*dt)` (frame-rate independent) and `dt` is capped at 1/30s in `update()`. Verified the camera path is now pace-independent (steady vs jittery frame times end at -521.3 vs -521.1); not verified on a real phone - if it still shakes, next suspects are the geometry-masked PIP camera cost on mobile GPUs and camera roundPixels stepping.

- **Diagnostic `?fps`**: opening the game with `?fps` in the URL (e.g. `.../SNOWY_BALLS/?fps`) shows a small green readout bottom-left: fps, worst frame in the last second, and worst frame during the most recent throw flight. Added to chase the phone-only mid-flight shake. Ruled out: shader precision (Phaser auto-uses its highp MobilePipeline on phones). Open questions: is the shake dropped/uneven frames (readout will show) or something in how the scrolling pixel-art is drawn?

- **Shake diagnosis so far**: phone reported 60fps / 17ms worst frame / 18ms worst in flight, so it is NOT dropped frames. No shake code exists (grep + git history clean). Leading suspect: `roundPixels` snapping makes the fast climb move in uneven whole-pixel steps that look like vibration once upscaled ~2-3x on a phone. `?smooth` (combine as `?fps&smooth`) turns off roundPixels on the main camera for an A/B on-device. If it helps, make it the default (and consider whether the PIP camera needs it too).

- **Phone shake, probable root cause found**: user reported side-to-side shake of everything except the UI buttons and the top-left PIP camera, during any camera movement (flight and scroll-back). Main camera scrollX was `ORIGIN_X - GAME_WIDTH/2 = 194.5` (half a pixel); with `roundPixels`, a .5 offset is a rounding tie, and float noise from the changing scrollY flips it left/right frame to frame. The PIP camera (scrollX 377, integer) was steady, which fits. Fix: `INITIAL_SCROLL_X = Math.round(...)` (=195) and the character sprite drawn at `Math.round(ORIGIN_X)` so its edges are whole pixels. Verified camera x is a constant integer across a whole flight; not yet confirmed on the phone. The `?smooth` experiment was removed (it did not help, same tie problem). Lesson: keep any static camera/sprite positions on whole pixels in this pixel-art setup. `?fps` diagnostic stays.

## Top boundary / escaping the building (2026-09-19)

- `TOP_BOUNDARY_HEIGHT = IMG_GROUND_Y` (660) = the top edge of `background.png`. The camera follow target is clamped to it (`Math.max(target, -TOP_BOUNDARY_HEIGHT)`) and the camera bounds top is the same value, so the view never shows anything above the texture (was -743, i.e. 83px of empty sky headroom).
- The throw is now allowed to leave the building: in `updateFlight`, the moment `heightClimbed >= TOP_BOUNDARY_HEIGHT` the throw ends via `finishThrow(..., escaped=true)` "as if landed" - miss + streak reset, **no mark and no impact sound** (it never touched the wall), and the normal result flow returns the camera to the character after the usual 1.4s. Checked before apex, so a ball that would have kept climbing can't run off forever.
- `MAX_POWER_SPEED` now comes from `MAX_APEX_HEIGHT = 800` (was the roofline, 643, via `MAX_STICK_HEIGHT`, now removed) so full power actually escapes. Side effect: the same power bar now spans a bigger range, so the W20/W21 sweet spot is a slightly narrower slice of it (W20 needs ~37.6% power, was ~44%). `MIN_POWER_SPEED` unchanged (never sticks in the restricted ground zone).
- Open choice made without asking: an escaped ball counts as a *miss* (resets the streak). Easy to change if accessories should make it neutral.

- **iPhone home-screen app showed the canvas ~2.3x too big** (HTML buttons fine, background/PIP/aim bar cropped; Safari tab fine): Phaser FIT measures the container once at launch and in standalone mode that read is wrong at that instant. Fixed by `scale.mode = NONE` + CSS `#game-container canvas { width/height: 100
- **iPhone home-screen app showed the canvas ~2.3x too big** (HTML buttons fine, background/PIP/aim bar cropped; Safari tab fine): Phaser FIT measures the container once at launch and in standalone mode that read is wrong at that instant. Fixed with `scale.mode = NONE` plus CSS `#game-container canvas { width/height: 100% !important }` - the exact-16:9 container sizes the canvas, no measurement involved. Input is tap-anywhere so Phaser's pointer-scale math is irrelevant. Verified canvas == container on desktop; not yet on the iPhone.

## Economy file (2026-09-19)

`economy.json` (repo root) now holds rewards, the face-window event numbers, and the shop design; field reference in `docs/ECONOMY.md`, balance table + validator in `tools/economy_report.py`. The game **reads `rewards` and `events` today** (window coins, streak bonus %, missCoins, face-window trigger/duration/revert/bonus) via `this.load.json("economy")` -> `this.eco`; the `WINDOWS` array in `main.js` is geometry only now. A missing/invalid file throws a clear error at start. The file is fetched with a `?t=Date.now()` cache-buster so edits show up immediately even through GitHub Pages' CDN cache. Verified by editing W20 to 99 and seeing +99 in game, then restoring 6.

**Shop design captured in the file, not built yet**: 6 slots, buying replaces the item from a pool (`refill`), items gated by `tierUnlocks` = lifetime coins *earned* (not balance, so spending can't re-lock a tier), tier-weighted random pick, and a `guaranteeCheapItem` safety net so the shop never fills with unaffordable items. 16 placeholder items (accessory / buff / projectile, 3 tiers). Effect types are listed in `docs/ECONOMY.md`; nothing applies them yet. Characters are excluded (unlocked via achievements later).

**Balance finding baked into the checker**: day one only tier 1 is unlocked and bought permanent items leave the pool, so the starter pool must exceed the slot count. With 6 slots and only 4 tier-1 items the shop would have shown gaps after two purchases - the checker now requires `slots + 2` starter items (there are 8).

## Shop screen (2026-09-19)

- `src/shop.js` (logic + UI) draws 6 cream "notes" pinned on `shop_board.png`'s cork (HTML overlay `#shop-items`, sized in `--u` = 1% of display width so it scales on any screen; verified on desktop and an 812x375 phone landscape). Edited `shop_board.png` is still 160x90, no layout change needed.
- **Persistence (the reroll exploit)**: the stock is saved (`Economy.getShopState().stock`) and only changes on a purchase. Verified: fresh player -> 6 unique tier-1 items -> page reload -> identical stock. `ensureStock()` also repairs a saved stock (removed/renamed items, owned items) on load. `Economy` now also tracks `lifetimeCoins` (earned only; spending doesn't lower it) which gates tiers.
- **Buying**: `Economy.spendCoins` (refuses if short -> the card shakes), permanent items go to `owned` and never return, consumables just count up. The bought card's slot is refilled by a *different* item (tier-weighted random, no duplicates on screen, cheap-item guarantee). Verified: 2 purchases replaced 2 slots with different items, coins 3->1 while lifetime stayed 3, no owned item on sale, triple-tapping one card bought exactly once.
- **Bugs found while testing**: `window.Shop` doesn't exist for a top-level `const` (used `typeof Shop`); double-tap during the 220ms fade could buy the swapped-in replacement (fixed: ignore `.bought` cards).
- **Design finding**: with 1-coin placeholder prices you can drain the tier-1 pool within minutes and get SOLD OUT slots. Same thing would happen with real prices before tier 2 (250 earned coins) if the starter tier were small, so `tools/economy_report.py` now simulates it; fixed by adding tier-1 consumables (10 starter items).
- Unexplained: an earlier test run showed 9 purchases / 9 lifetime coins that my scripted actions don't account for. A clean re-run with spies on `spendCoins`/`addCoins` showed exactly the expected numbers, so I'm treating it as a test-harness artifact - but if the shop ever seems to spend coins by itself on a real device, that's the thing to look for.
- Effects still not applied; characters excluded (achievement unlocks later).

## Shop fixes: no duplicates, SOLD OUT stays sold out (2026-09-19)

- **Unexplained purchases**: the user confirmed they were clicking in the shared preview pane while I tested, so that's the explanation - no bug.
- **Duplicates**: `pickFor` now always excludes every item shown in the other slots (was a config flag `excludeCurrentlyShown`; removed the flag, it is an invariant). `ensureStock` also nulls and refills any duplicate found in a saved stock.
- **Reopen bug**: a slot left empty (pool ran dry) was refilled on every `onOpen`, and since consumables never leave the pool the item you had just bought came straight back. Now `ensureStock` remembers which slots were empty and leaves them SOLD OUT; they refill only when a new tier unlocks. The last unlocked tier is saved as `shop.tierLevel` (`economy.js`).
- **Verified** with a randomized soak in the browser (random coin grants, random slot taps, close/reopen after every step): 140 steps, 0 duplicates, 0 owned permanents on sale, stock unchanged on every reopen except the one where lifetime coins crossed 250 (tier 2 unlocking, which is correct). `economy_report.py` still "all good".

## Tiers removed, coin counter, card picture space (2026-09-19)

- The user will design the economy themselves, so **tiers are gone**: no `tier` on items, no `tierUnlocks`, no `tierWeights` (refill is a uniform random pick). Every item can appear from the start. `economy.json` numbers were otherwise left alone.
- SOLD OUT slots used to refill on tier unlock; now they refill when the item list in `economy.json` changes (`shop.catalog` in the save = the sorted item ids the stock came from). Old saves with `tierLevel` load fine (the stale field is ignored and the stock is kept/repaired).
- `tools/economy_report.py`: dropped the tier column, tier table and the starter-pool simulation. Still validates fields/duplicates/categories and prints the hits-to-afford table.
- **Coin counter** `#coin-counter` (index.html): brown box with a coin icon, right above the SHOP/BACK button (same 84px width, 6px gap), z-index 4 so it stays visible over the shop board. It replaces the "COINS n" line that used to sit inside the shop. It is fed by `Economy.onCoinsChange(fn)` (called on add/spend and once on registration), so it updates live in the game and while buying.
- **Shop cards**: new `.shop-pic` block between the category and the name (takes the leftover height, faint tint so the space is visible); the name and price now sit at the bottom. Nothing is drawn in it yet - waiting for the item textures.
- Verified in the browser: counter shows the saved balance in game and in the shop, drops by exactly 1 per purchase (spied `spendCoins`: 1 call, 1 slot changed), no duplicates.

## Bug: can't throw after spamming shop cards on a phone (2026-09-19)

- **Cause**: Phaser registers `touchstart`/`touchend` listeners on `window` for touches that start outside the canvas (TouchManager `onTouchStartWindow`/`onTouchEndWindow`). So every tap on the HTML UI (shop cards, SHOP/BACK, mute) was also fed to the game as a pointer. When a card was re-rendered mid-touch (buy -> `render()` after 220ms while the next tap was in flight) the card was detached from the DOM, so its `touchend` never bubbled to `window`. Phaser kept its only touch pointer "active", and every later canvas tap was ignored - "tap to aim" on screen, nothing happens.
- **Reproduced** in the browser pane (mobile viewport preset - touch input is off on desktop): touchstart on a card, remove the card, touchend on the detached node -> pointer stays active, next canvas tap leaves the state at `idle`.
- **Fix**: `index.html` stops `touchstart/touchend/touchcancel/mousedown/mouseup` from bubbling out of `#shop-board`, `#shop-items`, `#shop-btn`, `#volume-btn`, so Phaser never sees UI touches. Plus a guard in `handleFreezeInput()` that ignores input while `#game-container` has `shop-open`. `main.js?v=45`.
- **Verified** (mobile preset, synthetic touches): the lost-touchend case leaves no active pointer; 70 spam taps across all cards leave the game `idle`; a canvas tap afterwards goes to `aim_angle`.
- Side effect worth knowing: before this, tapping the mute button or SHOP on a phone could also advance the throw underneath; that no longer happens.

## PROJECTILES / CHARACTERS lists (2026-09-19)

- Two brown buttons (same look as SHOP, 108x32, 8px font because "PROJECTILES" doesn't fit in 84px) stacked in the middle of the left edge (`#side-buttons`). They fade out and stop being tappable while the shop is open; opening the shop also closes any open list.
- `src/collection.js` (`Collection`): one shared panel `#list-panel` (24% left, 12% top, 52% x 76%, so both lists are identical in size, centered, clear of the edges). Pressing the other button swaps lists; pressing the open list's own button, or tapping the dimmed area outside, closes it. Each row: picture, name, description, EQUIP button (becomes a greyed EQUIPPED for the current one).
- The list scrolls with the finger (`overflow-y:auto; touch-action:pan-y; overscroll-behavior:contain`), scrollbar hidden - no slider.
- **Entries live in the `CATALOG` object at the top of `src/collection.js`** (not economy.json - they aren't priced). Two so far: projectile `snowball` and character `default` (shown as "Character 1"; `default` is the id already used by `unlockedCharacters` in saves). Descriptions are placeholders I wrote.
- Equipped choice is saved (`Economy.getEquipped/setEquipped`, save field `equipped`). **It is not applied to gameplay yet** - with one entry per list there's nothing to swap. Wiring it means picking the texture keys from the equipped id in `main.js`.
- While a list is open the game ignores input (`handleFreezeInput` checks `list-open` as well as `shop-open`), and the panel/buttons are on the list of elements whose touches never reach Phaser (see the shop-spam bug above).
- Verified in an 812x375 landscape viewport: both lists have identical rects, switching/toggling/backdrop-close work, the game stays `idle` while a list is open, buttons hidden and untappable in the shop and back after, 9 dummy rows overflow and are scrollable. Real finger-scrolling not tested on a phone.

## Bug: marks in the sky -> ball falls back behind the roof (2026-09-19)

- **Cause**: `background.png` rows 0-14 are opaque sky, row 15-16 is the dark roof edge, brick starts at row 17. The old max stick height was the brick line (643), but apexes between the roof edge and the top boundary (660) still ended in a normal stick, so a mark could sit in the sky.
- **Rule now** (`ROOF_EDGE_HEIGHT = IMG_GROUND_Y - 15 = 645` in `main.js`): a throw whose apex is above the roof edge (`fallsBehind`, computed in `launchBall`) does **not** stick. The flight keeps following its arc past the apex (`updateFlight` no longer freezes `t`), and on the way down the ball is cropped at the roof edge (`ball.setCrop`) so it sinks behind the building. When it is fully hidden the throw ends as a miss with no mark and no impact sound (same path as an escape: `finishThrow(..., escaped=true)`).
- Marks are also cropped at the roof edge (`addMark`), so one that sticks just under the roofline doesn't overhang into the sky.
- **Unchanged**: an apex at or above 660 (top of the texture) still ends the throw the moment it crosses 660 (the camera-back-to-character rule from earlier), so those balls do NOT do the fall-behind animation - the camera can't go higher than the texture anyway. Say the word if you want them to fall back too.
- Verified by forcing exact apexes: 640 -> mark, clipped 5px at the roof edge; 652 and 656 -> falls behind, cropped while sinking, MISS, no mark; 700 -> ends at 660 as before; 420 -> normal stick. Screenshots at the apex (ball in the sky, fully visible) and mid-sink (bottom clipped at the roof edge). `main.js?v=47`.
- Small known snap: the crop starts at the apex, so the part of the ball below the roof edge disappears at that moment (at most a few px, ball is nearly stationary there).
