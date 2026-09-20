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

## Bug: camera "jump" at the apex of a fall-behind throw (2026-09-19)

- **Cause**: the camera follow lerps `scrollY` toward the clamp at the top of the texture (-660), so it creeps -659.96, -659.98, -659.99 ... then hits exactly -660. The renderer draws a fractional scroll one pixel off from an integer one, so at that last step the whole picture snapped down 1 canvas px (measured by reading the canvas each frame: roof-edge row 14 -> 15 at flightTime 1.368, ~0.16s after the 1.204s apex). ~3 screen px on a phone. It only became visible with fall-behind because before that the camera stopped following at the apex, one frame before it ever got there. Same family as the half-pixel scrollX shake.
- **Fix** (`updateFlight`): `scrollY` is now always a whole number (`Math.round` of the lerp), with a minimum 1px step so rounding can't stall the camera short of its target.
- **Verified** by reading the rendered canvas every frame: apex 652 -> `scrollY` integer on every frame and the roof row is a constant 15 from the moment the camera arrives to the end; apex 500 (camera not clamped) -> integers, no stall, same shape as before. `main.js?v=48`.

## CHARACTERS button removed (2026-09-19)

- Removed the CHARACTERS button from `index.html`; PROJECTILES is now the only button in `#side-buttons` and sits vertically centered on the left edge (its center Y equals the display's center Y, checked). The character list data and its equip/save code are still in `src/collection.js` (button lookups are optional-chained), so bringing the button back is one line of HTML.

## Shop redesign: timed SOLD OUT slots (2026-09-19)

- **Mechanic**: buying empties the slot ("SOLD OUT" + countdown) for `shop.restockSeconds` (economy.json; 1800 = 30 minutes (was 60 while testing, 3600 for a while on 2026-09-19)). The card style is unchanged; the sold-out card just gets a `.shop-timer` line under the text (`m:ss`, or `h:mm:ss` once it's over an hour).
- **Device clock**: the deadline is a `Date.now()` timestamp saved per slot in `shop.restock[i] = { at, prev }` (localStorage), so it keeps running while the app is closed. `ensureStock()` runs on load and on every shop open and restocks every slot whose `at` has passed. While the shop is open a 1s `tick()` counts the timers down and restocks a slot the moment it expires; it also runs when the tab/app returns to the foreground (`visibilitychange`).
- **Restock** picks a different item from the sold one (`prev`) and never duplicates one currently on sale. If nothing is eligible the slot stays SOLD OUT without a timer and is retried at the next open.
- **Clock cheating**: forward = restocks early (can't be prevented without a server). Back = clamped, a deadline further than one full timer away is reset to one timer.
- **Replaced** the old SOLD OUT logic (slots emptied when the pool ran dry + `shop.catalog`). Old saves load fine: the unused `catalog` is ignored, and an empty slot without a timer simply refills.
- Verified in the browser: buy -> SOLD OUT with `1:00` counting down (0:58 two seconds later), coins -1; reload during the timer keeps the slot sold out with the remaining time; a save with the deadline already in the past restocks on load with a different item; a live expiry with the shop open restocks by itself; a far-future deadline is clamped to 60s; no duplicates.
- Ideas not built (say if you want them): a small dot on the SHOP button when a slot has restocked; a local notification (needs a service worker + permission on iOS).

## Two item types, duplicate consumables, restock dot + sound (2026-09-19)

- **Centered** the SOLD OUT text and timer on the sold-out card.
- **Item types** are now `consumable` (common) and `projectile` (rare). Accessories are gone, and so is the `kind` field (a projectile is permanent, a consumable is used up). The 6 placeholder accessories were removed from `economy.json` (they're in git history); it now has 7 consumables and 5 projectiles. `refill.categoryWeights` picks the TYPE first (consumable 9 : projectile 1), then a random item of that type. Measured over 3600 slots: 10.8% projectiles. `economy.json` version 2. `tools/economy_report.py` updated (categories, no `kind`).
- **Duplicates**: consumables may be on sale in two or more slots at once (a shop screenshot showed Hot Cocoa x2 and Lucky Penny x2); projectiles are never duplicated (0 in 600 random stocks) and an owned projectile never returns. I also dropped the rule that a restocked slot can't get the item just sold there - with a timer in between it isn't needed and it shrank the pool. Say if you want it back. Consumable tiers can come later as a `tier` field + a weight.
- **Restock dot + sound**: `#shop-dot` (red, white border, pops in with an overshoot then pulses) on the SHOP button's top-right corner. `tick()` now runs every second even with the shop closed; when a slot restocks and the shop is closed it sets `shop.unseen` (saved), shows the dot and plays `shop_restock`. Opening the shop clears it. A live restock (timer runs out while playing, or the app returns to the foreground) plays the sound; a restock that happened while the app was closed shows the dot only (a sound on load would fire on the first tap).
- **Sound**: `assets/audio/shop_restock.mp3` is a PLACEHOLDER (copy of window_clink.mp3). To use the real one: overwrite that file and bump the `?v=` on its load line in `main.js` (`preload`).
- Verified in the browser: buy -> timer -> restock with shop closed gives dot + exactly 1 restock sound, `unseen` saved; opening the shop clears both; reload with an expired timer shows the dot with no sound; no dot while buying inside the shop.
- Not done yet: bought projectiles are recorded in `shop.owned` but do not appear in the PROJECTILES list yet.

## Dot moved, one sound per unseen batch (2026-09-19)

- `#shop-dot` moved to the SHOP button's **top-left** corner (`right: 86px` = 10px margin + 84px button width - half the 16px dot).
- **One sound per batch**: `announceRestock` only plays `shop_restock` on the transition from "no dot" to "dot" (`alreadyAnnounced = shop closed && shop.unseen`). Further restocks while the dot is still showing - in the same second or an hour later - are silent. Opening the shop resets it, so the next restock plays the sound again. If the shop is open the sound still plays for each restock (the player is looking at it). Because `unseen` is saved, this also holds across reloads.
- Verified: 3 slots restocking at +1.5s / +4.5s / +7.5s with the shop closed -> 1 sound total, dot up the whole time; after opening the shop and buying again, the next restock -> a 2nd sound (2 total).

## Chestnut projectile + equip rules (2026-09-19)

- **New files** picked up from the repo root / assets: `chestnut.png`, `character1_idle_chestnut.png`, `character1_aiming_chestnut.png` (no chestnut *throwing* sprite exists, so that pose uses the normal `character1_throwing.png` - `PROJECTILE_VISUALS`), and two sounds moved from the repo root into `assets/audio/`: **`chestnut_impact.mp3`** (new) and the real **`shop_restock.mp3`** (replaced my placeholder copy of window_clink; load version bumped to `?v=2`). Unused so far: `snowball_shop.png`.
- **Equipped projectile drives gameplay.** `MainScene.applyProjectile(id)` sets `this.proj` (numbers from `economy.json` -> `projectiles`) and `this.projVisuals` (textures/sounds, `PROJECTILE_VISUALS` in `main.js`); unknown or not-owned ids fall back to the snowball. Equipped id is saved and re-applied on load.
- **Equip while aiming** (angle or power phase) -> aim is discarded, state goes back to IDLE with "TAP to aim". **Equip mid-flight** -> stored as `pendingProjectile`; the throw finishes (impact, coins, bounce, message) with the old projectile and the new one applies in `resetForNextThrow`. The ball texture is set at launch, not on equip, so a bounce in progress never changes texture. Equip in IDLE/RESULT applies immediately.
- **Chestnut**: no mark; at the apex (where a snowball would stick) it plays `chestnut_impact` (volume 0.5 - a guess, tune it) and bounces: kicked back the way it came with a small pop up, falls, hops on the ground (restitution 0.35) and rests until the next throw. Purely visual; hit/miss/coins were decided at impact (`startBounce`/`updateBounce`). It spins in flight (`SPIN_RATE` 14 rad/s), also while bouncing. Face-window hit code no longer needs a mark (`triggerBananaHit` handles `null`).
- **Easier aim**: `angleRange 0.8` (marker runs 0.1-0.9 of the bar, measured min 0.101 / max 0.895) and `angleSpeed 0.8` = the marker moves at 80% of the snowball's speed along the bar (measured ratio 0.80). The sweep rate is divided by the range so that "20% slower" is the marker's real speed, not double-counted with the shorter travel. **`coinMultiplier 0.8`, rounded down, on the whole payout**: 6 -> 4, verified (+4 coins).
- **Fall-behind clipping switched from `setCrop` to a GeometryMask** (`roofMask`, everything above the roof edge) because a crop is wrong once the sprite rotates. Verified with a spinning chestnut sinking behind the roof.
- **Shop**: `chestnut` is a 10-coin projectile item with `ignorePriceOverride: true` (the global 1-coin test price would otherwise make it 1). Buying it makes it appear in the PROJECTILES list (the list now shows only what you own: `free` entries + purchased ones). I **removed the 5 other placeholder projectiles** from `economy.json` (Icy Snowball, Big Snowball, Ice Ball, Golden Snowball, Rocket Snowball - in git history): they had no art or behavior, so buying one did nothing and, at 1 chestnut among 6 projectiles, the chestnut would have shown up in under 2% of slots. With only the chestnut, a projectile is ~10% of slots (raise `categoryWeights.projectile` while testing). Once owned it never returns and the shop is all consumables.
- `tools/economy_report.py`: drops the "items >= 2x slots" rule (duplicate consumables make a small pool fine), requires at least one consumable, and checks every projectile has a `projectiles` entry.
- Verified in the browser: chestnut bought for exactly 10 (other items 1); list shows Snowball + Chestnut; equip mid-aim -> idle + "TAP to aim" + chestnut sprites; equip mid-flight -> throw stays chestnut, snowball after reset; aim range/speed as above; chestnut throw: spin, HIT +4, sound `chestnut_impact@0.5`, 0 marks, bounce trajectory; snowball regression: +6, 1 mark, `snowball_impact@0.3`.

## Batch of 12 tweaks (2026-09-19)

1. **Snowball equipped by default.** New saves already default to it. What could go wrong was a save whose equipped id pointed at an unowned projectile: the game used the snowball but the list still marked the chestnut (nothing looked equipped). `applyProjectile` now writes the fallback back to the save.
2. **Button click volume 0.8 -> 0.4** everywhere, through one `playUiClick()` / `UI_CLICK_VOLUME` in `shop.js` (SHOP/BACK, buying, equipping, list buttons).
3. Shop cards show an item's picture from its `image` field (`.shop-pic img`); chestnut -> `chestnut.png`.
4. The snowball uses `snowball_shop.png` in the PROJECTILES list (chestnut keeps `chestnut.png`).
5. Chestnut bounces the way it was thrown (right stays right, left stays left; a dead-straight throw picks a side). Verified: vx +126 -> x 535 -> 567, vx -126 -> 286 -> 254.
6. **All placeholder items removed** (the 7 consumables). `economy.json` has only the chestnut; a slot with nothing to sell shows `(TBD)` (a slot with a timer still shows SOLD OUT + countdown). Old saves with removed items are cleaned automatically. The balance checker no longer requires consumables and now requires a `weight` per projectile.
7. `character1_idle_chestnut.png` updated: load version `?v=2` so phones/GitHub Pages fetch the new one.
8. EQUIP / EQUIPPED buttons are the same fixed width (measured 119.9px both, description column unchanged).
9. Shop item names centered.
10. **Shorter slider instead of an early turn-back**: the offset bar is drawn `angleRange` as long, centered, and the marker runs edge to edge of it (same math underneath). Marker speed still `angleSpeed` x normal.
11. **`MAX_APEX_HEIGHT` = 465.5** (was 800): the middle of the window row above the goal windows (image y 173-216 found by scanning the texture; the row above that is y 73-116). Full-strength snowball apex verified at exactly 465.5. Side effects: W20 (apex 344-387) now sits at roughly 70% power for the snowball, and a no-buff throw can no longer reach the roof/escape - that code stays for later buffs and lighter projectiles.
12. **Weight** (invisible): `projectiles.<id>.weight` in `economy.json`, snowball 100 (reference), chestnut 80. Apex = normal apex x `100 / weight` (so the chestnut flies 25% higher: full-strength 581.9, min 230; a weight-125 projectile would fly 20% lower). The launch speed is clamped to the minimum so a heavy projectile can't land in the restricted ground zone. I chose the linear 100/weight rule (same energy); if you want same-impulse physics (apex x (100/weight)^2, chestnut 1.56x) it's one line in `launchBall`.

## Face window is now a random event (2026-09-19)

- The banana/face window no longer starts at a streak of 3. After **every** throw (hit, miss or escaped) `maybeStartRandomEvent()` rolls `events.faceWindow.chancePerThrow` (economy.json, `0.01` = 1%; `streakTrigger` is gone) and starts it unless an event is already running (`isEventActive()`, which is just `bananaActive` for now - new events must be added there so they never overlap). The event itself (20s, face hit +10, hit texture, fades) is unchanged; a face hit during an event ends it, and the roll is skipped while it is still running.
- Verified: measured 0.98% over 100,000 rolls; 0 starts in 100,000 rolls while an event runs; 3 real hits in a row with the chance at 0 -> no event (streak x3 shows in the message); with the chance at 1, a real *miss* started it (face texture appeared on W20) and the next throw did not restart it (1 start total). `main.js?v=52`.
- Not implemented (only one event exists): choosing between several events when the roll succeeds.

## Economy step 1, slider graduations (2026-09-19)

- **Rewards**: W20 6 -> **5**, W21 stays 3 (`economy.json`). Chestnut pays `floor(5 x 0.8)` = 4 on a plain W20 hit.
- **Slider back to full width** for every projectile. The marker now runs edge to edge of the full-width bar (`markerPos = 0.5 + (angleValue - 0.5) / angleRange`), so the chestnut's smaller `angleRange` (0.8) still means it can only drift 80% as far.
- **Graduation lines** on the offset bar: fixed swing values every 10% of the snowball's full range (0.1, 0.2, ...), counted from the center outwards, mirrored left/right, drawn thin and dark (`AIM_TICK_STEP`). Snowball (range 1): 0.2-0.9 = 8 per side; chestnut (0.8): 0.2-0.7 = 6 per side, and they sit 1/0.8 = 25% further apart on the bar - the "magnified ruler" effect. The bar's own edge is not ticked.
- **Two green guarantee lines** at +-`W20_SWING_GUARANTEE` = **0.1528** of the swing, drawn taller and 2px wide, with nothing between them (the 0.1 tick and the center are not drawn). Derivation: the ball drifts `swing x MAX_SWING_SPEED x apexTime` sideways; the longest flight that still hits W20 peaks at its top edge (apexTime = sqrt(2 x 387 / 900) = 0.929s), so the offset stays inside W20's half-width (25.5px) whenever `|swing| <= 25.5 / (180 x 0.929)`. It depends only on the window and the physics, not on weight (apex time depends on the apex height, not the launch weight) - checked for both projectiles.
- **Verified** with the real launch code: at swing 0.1523 every combination of 6 apex heights across W20's vertical band x both directions x both projectiles lands inside W20's x range (12/12 each); at 0.1728 none do (0/12). Screenshots of both bars.
- Note: the guarantee is about the sideways offset only; the player still has to get the power right for the height.

## Same graduations on the power bar (2026-09-19)

- The power (strength) bar now has a dark graduation line every 10% (0.1 ... 0.9) and two green lines around the **power range that puts the apex inside W20's height band** (344-387), with no other line between them (ticks inside the band are skipped). `powerForApex(apex)` inverts the launch speed formula from `launchBall` (incl. the weight scale): `power = (sqrt(2g x apex / (100/weight)) - MIN_POWER_SPEED) / (MAX_POWER_SPEED - MIN_POWER_SPEED)`.
- The band moves with the projectile: snowball 0.622-0.762 (tick 0.7 removed), chestnut (weight 80, flies higher) 0.378-0.503 (ticks 0.4 and 0.5 removed). A line is only drawn if it lies inside the bar.
- Verified with the real `launchBall`: 5 powers spread across each band all give an apex inside 344-387; 0.01 below/above gives 341/390.2 (snowball) and 340.7/390.5 (chestnut). Screenshot of the snowball bar. `main.js?v=55`.
- With this the two bars together cover W20: stay between the green lines on both and the throw hits W20 (sideways guarantee assumes the apex is inside the band - see the offset-bar note above).

## Event dots on the aim bars (2026-09-19)

- While the face-window event is running (and its face not yet hit), both aim bars show a **yellow dot** (`EVENT_COLOR_FACE`, `0xffd52e`) where the marker must be released to hit the face. `activeEventTarget()` returns the running event's color and target ranges - **new events add their own color and ranges there**, and `drawEventDot` draws them.
- **Power bar**: the dot sits at the middle of the power range that puts the apex inside the face box's height band (343-360): snowball 0.619-0.675 (dot 0.647), chestnut 0.375-0.425 (dot 0.400; lighter flies higher). **Offset bar**: the sideways drift is `swing x MAX_SWING_SPEED x apexTime` and apexTime shifts slightly across the band, so the dot is the middle of the swing range that keeps x inside the face's width (385-402) for EVERY apex in the band: -0.158 to -0.054 (dot -0.106, i.e. left of center). The dot is drawn at the range's middle with a 6px radius, smaller than the range, so any marker overlapping the dot is a hit.
- The dot disappears when the event ends or the face is hit (`bananaActive && !bananaHitTriggered`).
- Verified: for both projectiles, all 9 combinations of marker offsets (-6px, 0, +6px on each bar) around the dot centers land inside the face box (9/9 each); a real throw released on the dots gave "HIT +15 coins" (5 + the 10 face bonus) and the dots vanished. Screenshots of both bars with the event running. `main.js?v=56`.
- The green W20 guarantee lines are still drawn during the event; the face sits inside W20, so the yellow dot is within the green range on the power bar and next to it on the offset bar.

## Buffs, buff HUD, BUFFS list, slider zoom (2026-09-19)

- **Event dot has no outline** (`drawEventDot` is just the yellow fill).
- **Buffs** (`src/buffs.js`): a `consumable` shop item is a timed buff. Buying it activates it immediately for `duration.seconds` (economy.json), saved as a device-clock `endsAt` in the save (`buffs: [{id, endsAt}]`) so it keeps running while the app is closed; re-buying restarts the timer (no stacking of the same buff). `Buffs.modifiers()` multiplies the effects of everything active: `precision`, `strengthControl`, `coinMultiplier`. The old per-item `consumables` counter and the `{throws}` duration are no longer used.
- **Read only on "TAP to aim"**: `takeAimSnapshot()` (called from the IDLE -> AIM_ANGLE tap, and once at start) stores `this.aim = {angleRange, angleSpeed, powerRange, coinMultiplier}`. The bars, graduations, event dots, marker movement and the payout all read `this.aim`, never the live buffs. Verified: tapped with the buff, expired it mid-aim -> sliders and payout stayed buffed for that throw (+7 = floor(5 x 1.5)); the next tap read no buff (+5).
- **Slider zoom**: precision divides the offset range (`angleRange = projectile.angleRange / precision`); strength control makes the power bar cover `powerRange = 1 / strengthControl` of the power span, centered (`power = 0.5 + (pingPong(...) - 0.5) x range`). Graduations are fixed values (every 0.1) so they spread out; green guarantee lines and the yellow event dots are mapped through the same zoom and hidden if they fall outside what the bar covers. The marker keeps the normal speed along the bar. Chestnut + precision 1.5 -> angle range 0.533; coins 5 x 0.8 x 1.5 = 6 (verified).
- **Buff cards (HUD)**: `#buff-hud`, top of the screen right of the live display (its frame is 4..133 x 4..67 canvas px - CSS numbers must follow `createTargetCamera` if that changes). Each card: item image + timer in the pixel font, translucent dark background, white outline, 4u tall (u = 1% of display width). Cards stack down until the column is as tall as the live display, then wrap into a new column (verified: 3 per column, the 4th starts column 2). Taps pass through (`pointer-events: none`); the shop board covers them while the shop is open.
- **BUFFS button** left of the mute button, brown like the others, hidden in the shop. Its list reuses the projectiles panel (`#list-panel.small`: 40% x 60%, centered; projectiles is 52% x 76%): image, name, description and a live timer where the EQUIP button would be; opening it closes the projectiles list and vice versa. Empty: "NO BUFFS YET - BUY ONE IN THE SHOP FIRST" (I wrote that instead of "equip a buff first", since buffs are activated by buying, not equipped - easy to reword).
- **Test buff**: `focus_potion`, "Focus Potion", 1 coin, 120s, precision x1.5 + strengthControl x1.5 + coinMultiplier x1.5. Its icon `assets/items/focus_potion.png` is a PLACEHOLDER I drew (32x32) - replace the file. Right now it's the only consumable, so all 6 shop slots roll it (consumables can repeat).
- `tools/economy_report.py` accepts `effect` or `effects`.

## Buff card cancel, shop resets the aim, marker speed fix (2026-09-19)

- **Tap a buff card in the game -> cancels that buff** (`Buffs.cancel`, click sound, saved). The cards are the only part of `#buff-hud` that takes taps (`pointer-events: auto`); `buff-hud` is in the list of UI elements whose touches never reach Phaser, so the tap does not start an aim (verified with a real click: buff gone, HUD empty, game still `idle`). A cancel mid-aim does not change the throw in progress (buffs are only read on "TAP to aim").
- **Opening the shop while aiming** (angle or power phase) drops the aim: `MainScene.onShopOpened()` -> IDLE + "TAP to aim" (called from the SHOP button handler). A ball already **in flight is left to finish** (its coins count) and resets by itself after the usual 1.4s; say if you want flights cancelled too. Verified for both aim phases and for flight.
- **Bug fixed - the marker got faster when a slider was stretched.** When the bar went back to full width, the sweep rate was still divided by the range (`pingPong(t x HZ / range)`), which made the marker's speed ALONG THE BAR `1 / range` times too fast (chestnut: 0.8 speed x 1.25 = exactly the normal speed, precision 1.5 buff: 1.5x faster, strength control the same). Now the marker's position on the bar is `pingPong(t x HZ x speed)` and the aimed value is derived from it (`0.5 + (pos - 0.5) x range`), so the marker speed on screen is independent of the range: `angleSpeed` is a real marker-speed multiplier again (chestnut 0.8). Measured on screen (bar lengths per second, same measurement for each): snowball 1.18, snowball + buff 1.19, chestnut 0.95 and chestnut + buff 0.95 (ratio 0.80); power bar 0.65 with and without the strength buff. `main.js?v=58`, `buffs.js?v=2`.

## Marker speed is fixed for everything (2026-09-19)

- Nothing changes the marker's speed any more: the `angleSpeed` field is **removed** (code, `economy.json` projectiles, docs), so the chestnut's marker moves exactly like the snowball's. The offset marker always runs at `ANGLE_HZ` and the strength marker at `POWER_HZ`; projectiles and buffs only change the slider's **spread** (`angleRange` / `powerRange`), and the graduations, green lines and event dots follow that spread.
- Verified (average marker speed on screen, bar lengths per second): snowball 0.84, chestnut 0.85, chestnut + buff 0.85, snowball + buff 0.85 on the offset bar; 0.65 on the strength bar in every case. The aim snapshot no longer carries a speed at all. `main.js?v=59`.
- Consequence: the chestnut is now the same speed as the snowball but with a 20% narrower spread (was "20% slower" for a few commits). If the chestnut should be handicapped differently later, the economy.json fields to change are `angleRange` and `coinMultiplier`.

## Strength slider follows the chosen aim offset (2026-09-19)

- Once the offset is frozen (strength phase), the green lines on the strength bar show the powers that hit W20 **from that exact offset** (`powerBandFor(swing, box)`). The ball drifts `swing x MAX_SWING_SPEED x apexTime` sideways and the apex time grows with the apex height, so keeping x inside the window limits the flight time to an interval; that interval is converted back into apex heights and power values (`powerForApex`). Well aimed (|swing| <= 0.1528) -> the usual band (snowball 0.622-0.762). A little off (0.1528..0.162) -> the top line drops toward the bottom one (swing 0.158: 0.622-0.681), and the graduation ticks that fall outside the band come back. Completely off (> ~0.162 for W20) -> **no green lines** and all ticks drawn.
- The **yellow face dot** on the strength bar uses the same rule (`activeEventTarget(swing)` -> `powerFrom/powerTo` are null when no strength hits from that offset, and then no dot is drawn).
- Verified against the real launch code: for 11 offsets (snowball), 4 (chestnut) and 6 (face box) I swept power in steps of 0.002 and a throw hit exactly when its power was inside the computed band (0 mismatches; 71 hit powers at a well-aimed offset, 53 at 0.155, 30 at -0.158, 8 at 0.161, none at 0.17 or beyond). Screenshots: a slightly off aim (shorter band) and a totally off aim (no green lines). `main.js?v=60`.
- Note the window is narrow relative to the drift: the whole "slightly off" zone is only ~0.009 of the swing wide, so in play the lines mostly either show the full band or vanish; the shrinking is the thin transition between.

## Event dots follow the offset, and never overhang what hits (2026-09-19)

- The yellow dot on the **strength** bar already used the chosen offset (`activeEventTarget(swing)`, previous entry). New here: the dot is **sized to the range that really hits** (`drawEventDot(..., hitWidthPx)`): radius = min(6px, half of that range on the bar), and no dot at all when the range is under 2px. Before, a fixed 6px dot could stick out of the hit range for offsets near the edge, so touching its rim wasn't a guaranteed hit. The offset-bar dot uses the same rule with its own swing range.
- Works together with the zoom (precision / strength control / chestnut range): widths are measured on the bar, so a stretched slider gives a bigger, easier dot.
- Verified with real launches: over 109 offsets (including the thin zones at both ends of the face's range, 0.0005 apart), releasing at the middle and at both rims of the dot -> 327/327 hits. Earlier 4-way sweep (snowball, chestnut, each with and without the precision/strength buff): 81/81 hits each on the strength dot and 3/3 on the offset dot, for 27 offsets that show a dot and 10 that don't. Screenshot of the shrunken dot between narrow green lines at swing -0.161. `main.js?v=62`.

## STREAK / HIGHEST boxes, equip closes the list (2026-09-19)

- **Equipping a projectile closes the PROJECTILES list** (`Collection.onEquip` calls `close()` after telling the game).
- **Streak display moved**: the "streak xN" line is gone from the HIT message ("HIT / +N coins") and the MISS message is just "MISS". Two always-visible boxes sit under the top-right buttons: `STREAK: n` (top 44px) and `HIGHEST: n` (top 70px). Each is 96px wide = the BUFFS button (46-106px from the right edge) + the mute button (10-38px), measured equal; same brown as the coin counter; z-index 2 so the shop board covers them in the shop. `updateStreakHud()` refreshes them at start and after every throw; the font shrinks (8px -> smaller) if a number gets long ("HIGHEST: 1234" fits at 6px). Best streak comes from the save (`Economy.getBestStreak()`).
- Documented the payout formula and a streak table in `docs/ECONOMY.md` ("How a hit is paid"). `main.js?v=63`, `collection.js?v=6`.

## HIGHEST box removed (2026-09-19)

- Removed the `HIGHEST: n` box (HTML, CSS, `updateStreakHud`). Only `STREAK: n` remains under the top-right buttons (96px wide, unchanged). The best streak is still tracked in the save (`Economy.reportStreak` / `getBestStreak`), just not displayed - useful later for achievements. `main.js?v=64`.

## One marker speed, faster with the streak (2026-09-19)

- **Strength marker = offset marker speed.** The old `ANGLE_HZ = 0.85` / `POWER_HZ = 0.65` constants are gone; both sliders use `aim.markerHz` (0.85) from `economy.json` - so the strength marker is 30% faster than before by default.
- **Streak speed-up**: `takeAimSnapshot()` sets `this.aim.markerHz = markerHz x min(maxSpeedMultiplier, 1 + streakSpeedUp x streak)` (0.05 per streak level, capped at 3x - both in economy.json `aim`). The streak is read at the tap like the buffs, so the speed is fixed for the throw (verified: changing the streak mid-aim leaves the snapshot alone) and a miss resets it. Applies to both sliders equally.
- Measured on screen (bar lengths per second, angle / power): streak 0 = 0.84 / 0.84, streak 5 = 1.06 / 1.05, streak 10 = 1.27 / 1.27, streak 40 = 2.5 / 2.49, streak 100 = 2.52 / 2.47 (cap 2.55). `main.js?v=65`.
- With linear +5%/level the marker is 1.5x at streak 10 and 2x at streak 20; tune `streakSpeedUp` / `maxSpeedMultiplier` to taste. Nothing shows the player the speed yet.

## Faster speed-up, saved streak, test potion removed (2026-09-19)

- **Speed curve steeper**: `aim.streakSpeedUp` 0.05 -> **0.1** (+10% of the base speed per streak level): streak 10 = 2x, the 3x cap now comes at streak 20. Marker at streak 6 measured = 1.36 Hz (0.85 x 1.6), at streak 8 = 1.53.
- **Streak is saved** (`streak` in the save; `Economy.getStreak()/setStreak()`), written after every throw (hit -> +1, miss -> 0) and read at startup. So it survives reloads/closing the app, and the marker speed - derived from the streak at the tap - comes back with it. Changing projectile never touched the streak (verified: equip left streak and speed as they were). Verified: streak 6 in an old save -> STREAK: 6 after reload, speed 1.36; two hits -> 8 saved; reload -> 8, speed 1.53; a miss -> 0 saved, best streak (8) kept.
- **Focus Potion removed** from `economy.json`, plus its placeholder icon `assets/items/focus_potion.png` (and the empty folder). The buff system (`buffs.js`, HUD, BUFFS list) stays, currently with no buff items. An old save that still had the potion (in the shop stock and as an active buff) was cleaned automatically on load (buff dropped, slot emptied). `main.js?v=66`, `economy.js?v=8`.
- (The potion icon was drawn by me with a small Python/PIL script - a few polygons and rectangles in 32x32 - not taken from anywhere.)

## Projectile redesign: infinite snowball, consumable others (2026-09-19)

- **Snowball is infinite** (`projectiles.snowball.infinite: true`); every other projectile is a consumable with a count in the save (`projectiles: {chestnut: n}`; `Economy.getProjectileCount / addProjectiles / useProjectile`).
- **Consumed at the tap**: `consumeProjectile()` runs when the player taps "TAP to aim" (next to `takeAimSnapshot()`); the throw still uses it (`this.proj` is unchanged until the throw is over). If it was the LAST one, the snowball is saved as equipped right away and applied when the throw concludes (`pendingProjectile`, the same mechanism as an equip mid-flight), so the aim isn't disturbed. The kind then leaves the PROJECTILES list (the list shows only the snowball and kinds with count > 0; counts are shown as "x12").
- **Refund (my call, easy to remove)**: if the aim is thrown away before the ball leaves - the shop is opened, or another projectile is equipped mid-aim - the used-up projectile is given back (silently: no dot). If its use had auto-switched to the snowball, opening the shop puts it back as equipped. Verified: 3 -> tap 2 -> shop/equip -> 3; last one 1 -> tap 0 (equipped snowball) -> shop -> 1 and chestnut equipped again. Closing the app mid-aim is NOT refunded.
- **Shop stacks**: a projectile item has `amount {min,max}` and `unitPrice {min,max}` (chestnut 10-20 and 4-6). Each time it is put on sale (first fill, every restock) an offer `{amount, unitPrice}` is rolled and saved per slot (`shop.offers`, so no reroll by leaving); the slot costs amount x unitPrice and its label reads "PROJECTILE x14". Measured over 400 rolls: amounts 10-20, unit prices 4/5/6, totals 40-120. Buying adds the whole stack to the inventory (spent 60 for 10 x 6, inventory +10). Still never on sale in two slots at once; the old "owned" idea for projectiles is gone (they're rebuyable).
- **Bug found and fixed while testing**: once bought, the unique chestnut became free again and an empty (TBD) slot picked it up instantly, bypassing the sold-out timer. A unique item that another slot just sold is now reserved for that slot until its timer ends (`reserved` in `eligible/pickFor`, from `restock[j].prev`). Verified: after buying, all slots stay TBD for the whole timer, then the same slot restocks with a fresh offer.
- **Red dot on PROJECTILES** (`#projectiles-dot`, same `.notif-dot` style as the shop's, top-right corner of the button, no sound): raised only when a kind goes from 0 to more than 0 (`Economy.addProjectiles` -> `projectilesUnseen`, saved); cleared when the projectiles list is opened. Buying more of a kind you already have raises nothing; refunds are silent. Verified: first buy -> dot; open list -> gone; buy more (10 -> 23) -> no dot; run out (0) then buy again -> dot again.
- **Base coins per projectile**: `rewards.windows` is removed from economy.json; `projectiles.<id>.rewards {W20, W21}` is used: snowball 5 / 3, chestnut 8 / 5 (verified +5 and +8 on a streak-1 W20 hit). The chestnut's old `coinMultiplier` (0.8) is removed - its own numbers are the numbers. Chestnut `weight` 80 -> **75** (full-power apex 465.5 x 100/75 = 620.7, still below the roof edge 645). Balance report and the shop's "cheap item" check now read the snowball's rewards.
- `main.js?v=67`, `economy.js?v=9`, `shop.js?v=12`, `collection.js?v=7`.

## Streak is only a counter; projectile card layout (2026-09-19)

- **Removed the streak's two effects**: the coin bonus (`rewards.streakBonusPerLevel` is gone; a hit pays `floor((base + faceBonus) x buffs)`) and the marker speed-up (`aim.streakSpeedUp` / `maxSpeedMultiplier` are gone; `aim.markerHz` 0.85 is the fixed speed of both markers). Kept: the streak count, the STREAK box, saving it across reloads, resetting on a miss, and the best streak in the save. Verified: marker speed 0.85 at streaks 0/5/12/40; a snowball hit at streak 12 pays +5 and a chestnut hit at streak 14 pays +8 (before: 13 and more); the counter reads 13, 14, 15 and a miss resets it (and the save) to 0. `main.js?v=68`.
- **Projectile cards**: the text column is stretched to the card's height (`.pick-text { align-self: stretch }`), so a name always starts at the top of the card - both names measured 14px from their card's top (the snowball's used to float in the middle). The amount ("x26") is now a separate element in the card's TOP-RIGHT corner (`.pick-count`, absolutely positioned, `.pick-row` is `position: relative`), no longer next to the name. `collection.js?v=8`.

## Face hit x40, one event at a time, slider labels (2026-09-19)

- **Face hit multiplies the throw's coins by 40** (`events.faceWindow.faceMultiplier`; the old `faceBonusCoins` +10 is gone): `coins = floor(base x 40 x buffs)`. Verified with real throws on the yellow dots: snowball +200 (5 x 40), chestnut +320 (8 x 40).
- **Only one event at a time**, enforced in one place: `startEvent(name)` refuses while `this.activeEvent` is set. Random events are listed in `eventDefs()` (name, chance, start); `maybeStartRandomEvent()` rolls each in a random order and starts at most one, and never while one is running. The face event sets `activeEvent = "face"` at its start and clears it when it ends (20s expiry or after the face-hit revert). `startBananaEvent` itself also refuses if an event is running. Adding a future event = one entry in `eventDefs()` + set/clear `activeEvent`. Verified: two start requests -> 1 start; 2000 rolls at 100% chance while running -> 0 extra starts; an unknown name is refused; the event clears after a face hit.
- **Slider labels** (`#aim-label`, `updateAimLabel()`): while aiming, "OFFSET" (blue `#6fb1ff`) during the offset phase and "STRENGTH" (red `#ff6f6f`) during the strength phase - the same colours as the markers (`AIM_COLOR_*`) - above the bar's LEFT end (measured 0px from the bar's start), pixel font, no background, hidden when not aiming. It has a thin dark outline (`text-shadow` in 8 directions) always, because the light blue and red would vanish against the snow behind the bar. `main.js?v=69`.

## First buff: Skyr (2026-09-19)

- **Skyr** (`skyr`, consumable buff): 10 coins (`ignorePriceOverride`, so not the 1-coin test price), 180 s, effect `guideLines`, icon `assets/items/skyr.png` (the user's 32x32 art, moved in from the repo root). Consumables may fill several shop slots, so right now most slots show Skyr (chestnut is the other item: ~1 slot roll in 10).
- **Green lines are off by default** on both sliders and drawn only while the buff was active **at the tap** (`this.aim.guideLines`, same snapshot rule as the other buffs: a buff that runs out mid-aim keeps the lines for that throw, one that starts mid-aim waits for the next tap). Without the buff the graduation ticks are drawn everywhere (with the buff they skip the gap between the lines) - otherwise the gap would give the lines away. **The yellow event dots are not affected** - they always show. Verified by scanning the rendered canvas for the lines' exact green: no buff -> 0 green px on both bars (yellow dot px 92, unchanged); buff -> 64 green px on both bars; buff expired mid-aim -> still 64 for that throw; next tap -> 0.
- **Timer survives closing the app**: buffs are stored as device-clock `endsAt` timestamps (like the shop's sold-out timers) - verified: closed with 90 s left, reopened 7 s later -> 83 s left, lines active on the next tap; a buff whose time ran out while the app was closed is dropped on load (0 active, 0 saved, no HUD card, no lines).
- **Descriptions**: every item's description is now "no description" (chestnut in `economy.json` and in the PROJECTILES list, Skyr); the snowball's is untouched. (The unused character entry in `collection.js` also keeps its text - it isn't an item and has no button.)
- `main.js?v=70`, `buffs.js?v=3`, `collection.js?v=9`.

## Equal shop chances (2026-09-19)

- Every eligible item now has the **same chance** to be put in a slot: `pickWeighted` is a plain uniform pick when `refill.categoryWeights` is absent (the 9:1 weights were removed from `economy.json`; adding `categoryWeights` again brings the type-first weighting back). Verified over 4000 fresh stocks: first-slot share skyr 50.2% / chestnut 49.8%.
- Because the chestnut is unique (never in two slots at once) while Skyr can repeat, a full shop still averages ~1 chestnut and ~5 Skyr (98.8% of shops contain the chestnut, max 1). `shop.js?v=13`.

## Projectile cards, shop duplicates, buffs panel (2026-09-19)

- **Projectiles listed by W20 base value, highest first** (`sortedItems` in `collection.js`; ties keep catalog order): Chestnut (8) above Snowball (5).
- **Projectiles can be on sale in several slots** (and each slot rolls its own amount and price): the unique-item rule and the "reserved for its own slot" workaround from the projectile redesign are removed (`isUnique`, `reserved`) - with nothing unique the pool is never empty, so a sold slot just waits for its own timer. Verified over 3000 shops: 0-6 chestnut slots, 88.5% of shops have more than one; 4 chestnut slots -> buy one -> 3 left, the sold slot has a timer. TBD slots now only appear if the item list is empty.
- **BUFFS list is the same size as the PROJECTILES list** (the `.small` panel variant is deleted; both measured 502x413).
- **Descriptions**: chestnut "Found it in someone's backpack. How convenient!" (economy.json + the list), Skyr "Improves brain function." (I corrected the typo "funciton" from the request).
- **Stats along the bottom of a projectile card**: `weight: <word>` and `hit value: <coin><W20 base value>`. The card row wraps (`.pick-row.has-stats`) and the stats take the whole last line as a 2-column grid (`1fr 1fr`), so each stat starts at the same x on every card (measured 14px and 238px on both cards) and the left column is wide enough for the longest words: worst case "weight: very light/very heavy" ends 33px before the second column. The weight WORD comes from `economy.json` `weightLabels` (first entry with `upTo >= weight`): very light <= 59, light <= 89, moderate <= 110, heavy <= 140, very heavy above; snowball 100 = moderate, chestnut 75 = light (checked at 30, 59, 60, 89, 90, 110, 111, 140, 141, 300). The number never appears. "hit value" uses the shop's coin icon (`.pick-stat .coin`) followed by the projectile's W20 base reward. `Collection.setEconomy(eco)` is called from the scene to give the list its numbers. `main.js?v=71`, `shop.js?v=14`, `collection.js?v=10`.

## Stats moved next to the picture (2026-09-19)

- The picture was never resized (still `9u` = 87px here, CSS untouched) - it *looked* smaller/off because the full-width stats row made each card taller and pinned the picture to the top of the first line. Removed that wrap layout (`.pick-row.has-stats`, the two-column grid). The weight and hit-value lines are now the last lines of the **text column, right of the picture**: `.pick-text` is a column flex as tall as the card and `.pick-stats` has `margin-top: auto`, so they sit at the bottom of the card, left-aligned with the description (measured 0px from the text column's left edge), one line each, in the same place on every card (14px above the card's bottom on both). The picture is vertically centered on both cards again.
- Worst case checked: `weight: very heavy` + `hit value: 88` still fits inside the text column. `collection.js?v=11`.

## Weight and hit value in one row (2026-09-19)

- The two stats are now a **single row** along the bottom of the projectile card, starting right after the picture (14px from it) and running under the text and the EQUIP button (`.pick-row.has-stats` is a 3-column grid: picture spanning both rows and staying vertically centered, text + button on row 1, `.pick-stats` on row 2 across columns 2-3). Both stats did not fit side by side in the text column beside the picture alone (~23em of width vs the ~34 needed), hence running under the button too. The row is a 2-column grid: the left column is `19.5u` (the longest weight word "weight: very heavy" is 18 characters, one em each), so `hit value:` starts at the same x on every card (302px measured on every case) and font size is 1u. Worst cases checked: `very heavy` + 88 leaves a 14px gap between the two texts and ends 31px inside the card; `very light` + 888 ends 21px inside. Picture unchanged (87px). `collection.js?v=12`.

## Coin/number alignment and lighter stats (2026-09-19)

- **Alignment**: measured the font (canvas `measureText`): Press Start 2P has ascent 1em / descent 0 and its digits' ink spans 0.13em..1em above the baseline, so the ink centre is 0.565em above the baseline. The 1.1em coin used `vertical-align: -0.1em`, which put its centre at 0.45em - about 0.115em (~1px) lower than the digit, which is why the "8" looked high. `vertical-align: baseline` puts the coin's centre at 0.55em: measured coin centre vs digit ink centre now differ by 0.15px on both cards.
- **Lighter font**: the weight / hit value stats use `#8a6a44`, the same lighter brown as the amount ("x12"), instead of the darker `#6b4a2a` (verified identical computed colours). `collection.js?v=13`.

## Grenade (2026-09-19)

- **Files** (moved from the repo root into `assets/`): `grenade.png` (icon: shop card, list), `grenade_flying.png` (the ball in the air), `grenade_impact.png` (a 64x64 scorch mark) -> `assets/snowball/`; `grenade_launch.mp3` (throw sound) and `grenade_impact.mp3` -> `assets/audio/`; the idle/aiming character sprites were already in `assets/character/`. There is no grenade *throwing* sprite, so that pose falls back to the plain throwing one (same as the chestnut).
- **Projectile numbers** (`economy.json`): `grenade`: `weight 120` (= 1.2 x the snowball's 100 - a plain number, not linked, so change it too if the snowball's changes; shows as "heavy"), rewards **W20 199 and W21 199** ("value per hit 199" - I applied it to both windows, see below), `angleRange 1`, leaves a mark, no spin, consumable.
- **Shop item**: 1-3 per stack (`amount`), 114-198 coins per piece (`unitPrice`), so a slot costs 114-594; `ignorePriceOverride`; description "no description". Verified over 3000 fresh shops: amounts 1/2/3, unit prices 114-198, totals 114-594.
- **Look and sound** (`PROJECTILE_VISUALS`): new optional fields `mark {texture, size}` (grenade: `grenade_impact`, 40px - the snowball's mark is 20px) and `launchSound`/`launchVolume` (grenade: `grenade_launch` at 0.6; the others keep the whoosh); impact sound `grenade_impact` at 0.5. Volumes are guesses.
- **Bug found while testing**: the "guaranteeCheapItem" safety net swapped an expensive pick (min price 114 > 48) for a cheap item whenever nothing cheap was on sale yet, so the grenade could never be the first slot - against the equal-chance rule. It is now `enabled: false` in `economy.json` (still there as a setting). Equal chances confirmed: first slot skyr 33.2% / grenade 33.5% / chestnut 33.3%, ~2 slots of each per shop.
- **Physics consequence of the weight**: apex scales by 100/120, so a full-strength grenade peaks at ~388 - just above the top of W20 (387). W20 needs power 0.843-0.997 (hit at ~365 with power 0.92); the window row above the goal windows is out of reach for it.
- **Verified** (one atomic run, clean save): equip -> idle sprite `char_idle_grenade`; tap -> count -1 and `char_aiming_grenade`; in flight `grenade_flying` (no rotation) with the plain throwing sprite; W20 hit +199 and W21 hit +199 (real launches at the computed powers/offsets); sounds `grenade_launch@0.6` then `grenade_impact@0.5` (no whoosh); mark `grenade_impact` 40x40 (screenshot: scorch on W20 and in the rear-view window); the last grenade still pays 199 as a grenade, then the snowball is equipped and Grenade leaves the list. List order by W20 value: Grenade (199), Chestnut (8), Snowball (5), with "weight: heavy / hit value: 199". `main.js?v=72`, `collection.js?v=14`.

## New weight mechanics, grenade weight 130, no refunds (2026-09-19)

- **Grenade weight 130** (heavy).
- **Weight redefined.** Snowball is always 100 (the reference). The strength slider's position of a perfect W20 throw (apex = the middle of W20, 365.5) is **weight / 200**: 100 = centre, 200 = the very tip, 0 = the very beginning. Implementation: the marker position `power` plus `weightShift = (100 - weight) / 200` is an "effective power" on the snowball's curve, `apexForEffectivePower` - a parabola through (0 -> 184, the lowest allowed apex), (0.5 -> 365.5, W20's middle) and (1 -> 465.5, the old full-strength apex), continued in a straight line above 1 for light projectiles and clamped at 184 below 0. This replaces the old launch-speed scaling by sqrt(100/weight) (`MIN/MAX_POWER_SPEED` are gone) - and it moves the snowball's own W20 sweet spot from ~0.62-0.76 to 0.43-0.58 of the slider. `powerForApex` (green lines, event dots) is the exact inverse (`effectivePowerForApex` - weightShift). Verified with real launches: at power = w/200 the apex is 365.5 for w = 0, 50, 75, 100, 130, 150, 200; snowball p0/p0.5/p1 = 184/365.5/465.5; real hits: snowball at 0.5 +5, chestnut at 0.375 +8, grenade at 0.65 +199, a weak snowball throw misses.
- **Offset spread from weight**: the share of the offset slider that lands in W20 sideways (the "zone") is a straight line through (0 -> 0, 100 -> `aim.offsetZoneAtWeight100`, 200 -> 1); the bar spans `W20_SWING_GUARANTEE / zone` swing (floor 1.5% zone, cap 10). **I chose `offsetZoneAtWeight100 = 0.5` (the literal linear reading of "0 exact middle, 200 anywhere")**, which makes the snowball's offset slider span only +-0.3055 swing. Measured over real launches (share of the bar that hits W20 at all heights of its band): w0 1.5%, w50 25.1%, w75 37.5%, w100 50%, w130 65%, w150 75%, w200 100%. **Consequence: W21 needs about +-0.37 swing, so the snowball, chestnut and grenade can no longer reach W21** (only weight <~ 68). `angleRange` is removed from the projectiles in economy.json (derived from weight now); a precision buff still divides it. Graduation lines on the offset bar are every 10% of the SNOWBALL's spread (0.03055 swing, 9 per side for the snowball, 7 for the grenade), at fixed swing values so they stretch on other weights.
- **Weight words** are `from` thresholds now: 0+ very light, 50+ light, 75+ moderate, 125+ heavy, 150+ very heavy (verified at every boundary). So the chestnut (75) reads **moderate**, the grenade (130) heavy, the snowball moderate.
- **The strength dot** now aims at the part of the hit band that is on the bar (a heavy projectile's band can end beyond the tip).
- **Glitch fixed - no more refund.** Removed `refundProjectile` and `aimConsumed`: a consumable is spent at the first tap of "TAP to aim" and stays spent whatever happens (opening the shop, equipping another projectile mid-aim, closing the app). Verified: 5 chestnuts -> tap -> 4 -> open shop -> still 4 (aim reset to "TAP to aim"); tap, open PROJECTILES/BUFFS lists -> nothing changes (the aim keeps running behind them); equip the snowball mid-aim -> the chestnut stays consumed. If that tap was the LAST of its kind and the aim is abandoned via the shop, the snowball is now applied right away (`onShopOpened`), otherwise the next tap would have thrown a free chestnut - verified the next tap uses the snowball with 0 chestnuts. An abandoned aim still doesn't count as a miss (no streak reset, no coins) - only the projectile is lost.
- `main.js?v=73`, `collection.js?v=15`.

## Abandoning costs the streak; grenade explosion effect (2026-09-19)

- **Abandoning an aim resets the streak** (`abandonAim()` in `main.js`): opening the shop mid-aim, or equipping another projectile mid-aim, sets the streak to 0 (box, save) - on top of the projectile staying spent. Opening the PROJECTILES/BUFFS lists does NOT abandon anything (the aim keeps running behind them; verified streak stays 5). **Closing the app mid-aim counts too**: the save has an `aiming` flag, set at the tap on "TAP to aim" and cleared when the ball is thrown (`Economy.setAiming`); if the game starts with it still set, the streak is reset (`wasAiming` check at scene start) - I added this because otherwise "tap, see a bad aim, close the app" would have been the same escape. Verified: streak 5 -> tap -> shop = 0; -> equip mid-aim = 0; reload mid-aim = 0; tap + throw + reload = streak kept (5). No miss coins and no message for an abandoned aim.
- **Grenade explosion** (`projVisuals.explosion`, `playExplosion()`), visual only: on impact the grenade releases a radial flash from the exact point where it hit (measured at the grenade's impact point 411,366 = the W20 middle) - a soft glow (`explosion_glow`, a 128px radial gradient drawn into a canvas texture, additive blend) that grows from 0.5x to 4.6x its size while fading over 340 ms, plus a smaller hot core that fades in ~190 ms (white -> orange). It is a world object, so it also shows in the rear-view window. At the same moment the main camera shakes for 330 ms (`shake(330, (0.014, 0.008))`, up to 8px measured, over by 500 ms) - only the game picture: the HTML buttons and the rear-view window don't shake. Tunable per projectile: `explosion { flashMs, flashScale, shakeMs, shakeX, shakeY }` in `PROJECTILE_VISUALS`. Only when the grenade actually hits the wall (not when it flies out of the top or falls behind the roof); the chestnut and snowball have none (verified). Flash objects are destroyed after the fade (0 left at 700 ms). `main.js?v=74`, `economy.js?v=10`.

## Fixed card height, shop layout, buffs redesign (2026-09-19)

- **Grenade's EQUIP button sat higher**: not a width issue (the request was corrected to *length*) - the chestnut's 3-line description made its card taller and the button is centred in the card's first row, so it drifted relative to the shorter grenade card. Projectile cards now have one fixed minimum height (`min-height: 21.5u` = the height of a card with a 3-line description; the first grid row is `1fr`), so the button is at the same y on every card. Measured: all three cards equal height, button centre 108px from the card top, stats 14px from the bottom, picture centred. Longer descriptions than 3 lines would still grow their card.
- **Shop cards**: the amount ("x14") moved out of the label into the bottom-left corner and the price is bottom-right (`.shop-bottom`, space-between); the label just says PROJECTILE / BUFF; single items (buffs) have no amount, only the price on the right.
- **Buffs redesigned**: buying a buff adds it to an inventory (`buffItems` in the save, `Economy.getBuffCount/addBuffs/takeBuff`) and does NOT start it. The BUFFS tab lists what you have or are running (`Buffs.owned()`), in the projectile-card style without the stats line: picture, name, description, "x2" in the top-right, and a **USE** button where EQUIP/timer sits; using it (`Buffs.use`) takes one from the inventory, starts the buff and the button becomes the timer (same width, so nothing shifts; the count drops). Refused while that buff is running. When it expires USE returns if any are left; with none left the card disappears (empty text: "NO BUFFS YET / BUY ONE IN THE SHOP FIRST"). The in-game buff cards (HUD) still show only running buffs and tapping one still cancels it. Verified: buy -> inventory 1, no buff, no HUD card; second buy -> 2; USE -> timer 3:00, x1, HUD card; second use refused; expiry -> USE back; last one used and expired -> list empty; reload with 2 in the inventory and one running -> inventory 2 and timer 172 s after 8 s closed. `collection.js?v=16`, `buffs.js?v=4`, `shop.js?v=15`, `economy.js?v=11`.
- Not done (say if wanted): a red dot on the BUFFS button when a new kind of buff arrives (like the projectiles one).

## Card height fix, shop swap, rarity sort, counters, buffs dot (2026-09-19)

- **Projectile cards were too tall** (the big gap under the description): my `min-height: 21.5u` was a content-box value, so padding and border were added on top (the card came out 24.3u). Measured the natural height of the tallest card (chestnut, 3-line description) = 12.97u including padding/border; `.pick-row.has-stats` is now `box-sizing: border-box; min-height: 13.05u`. All cards are 13.05u, the EQUIP button is at the same y (53px from the top) on every card, and the chestnut's gap between description and stats is 0.98u (was 12). A description longer than 3 lines still grows its own card.
- **Shop card bottom row swapped**: the price is at the LEFT, the amount ("x14") at the RIGHT (buffs: price only, on the left).
- **Rarity sorting**: new `rarity` numbers (bigger = rarer), on `projectiles.<id>` and on the buff items in `economy.json`; the PROJECTILES tab and the BUFFS tab (`Buffs.owned`) list the rarest first. Ties: projectiles by W20 value, buffs by file order. The values are **placeholders** in the current order (snowball 1, chestnut 2, grenade 3, Skyr 1). Verified: making the snowball 9 puts it on top; all equal falls back to W20 order.
- **Tapping the streak counter no longer starts a throw** - and neither does the coin counter (same bug: `pointer-events: none` let the tap through to the game). Both are now tappable-but-inert (`pointer-events: auto`) and in the list of UI elements whose touches never reach Phaser. Verified with real clicks: streak counter -> still idle, coin counter -> still idle, a click on the game -> aim starts. (Side effect: a tap on those two small boxes while aiming does not freeze the marker either.)
- **Red dot on the BUFFS button**, top-left corner (`#buffs-dot`, same `.notif-dot` as the others, no sound): `Economy.addBuffs` raises `buffsUnseen` only when the buff was in neither the inventory nor running; opening the BUFFS tab clears it; it is saved. Verified: first Skyr -> dot (centre exactly on the button's top-left corner); open the tab -> gone; buy another (2 in the inventory) -> no dot; use one and buy while it runs -> no dot; when none are left or running, buying again -> dot; no sound played. `economy.js?v=12`, `buffs.js?v=5`, `shop.js?v=16`, `collection.js?v=17`.

## Rarities (2026-09-19) - TEST assignments in place, waiting for the user to confirm the look

- **System** (`src/rarity.js`, `economy.json` `rarities`): common (light blue `#62c0ff`, 60%), rare (light orange `#ffab5c`, 30%), epic (purple `#a25cff`, 9%), legendary (`rainbow`, 1%); shared by projectiles (`projectiles.<id>.rarity`) and buffs (item `rarity`). `Rarity.ofItem(item)` resolves an item's rarity (projectile -> its projectiles entry).
- **Shop pick**: `pickWeighted` now rolls a rarity by its chance among the rarities that have an item in the pool (chances rescaled), then a random item of that rarity; the old `categoryWeights` path is gone. Verified over 8000 shops: test config (chestnut rare, grenade epic, skyr legendary; no common item is on sale) -> chestnut 76.1% / grenade 21.6% / skyr 2.3% (expected 75 / 22.5 / 2.5); the planned final config (chestnut common, grenade epic, skyr epic, checked in memory only) -> 87.2 / 6.5 / 6.3 (expected 87.0 / 6.5 / 6.5); only a legendary on sale -> always it. `tools/economy_report.py` validates rarity names and prints each item's slot odds.
- **Labels**: a shop card's top row is `PROJECTILE`/`BUFF` at the left and the rarity (same font size and letter spacing, own colour, uppercase) at the right; in the PROJECTILES and BUFFS tabs a `.pick-corner` holds the label and the amount ("epic x7") on one row, label left of the amount (verified same row, label left of the number; the infinite snowball has just "common"). Plain coloured text, no background, with a thin dark 1px outline so the light colours read on cream (my addition). The tabs list the rarest first (verified: epic, rare, common; buffs by the same rank).
- **Legendary**: an animated rainbow (`.rarity-rainbow`): a clipped 8-stop gradient whose position scrolls (`rarity-wave`, 2.4 s, seamless) so the colours travel through the letters as waves, plus a pulsing shine (`rarity-shine`, 1.7 s: a white glow and brightness that swing dim -> bright -> dim; measured glow alpha 0.15..0.93 and brightness 1.00..1.34 over one cycle; the outline is drop-shadow filters because the text fill is a clipped gradient). Bg-position measured advancing 47% -> 186% over 1.8 s.
- **Test assignment now**: snowball common, chestnut rare, grenade epic, skyr legendary. To be reverted after the user confirms the look to: snowball none, chestnut common, grenade epic, skyr epic. `rarity.js?v=1`, `buffs.js?v=6`, `shop.js?v=17`, `collection.js?v=18`, `main.js?v=75`.

## "default" rarity, no-rarity items last, assignments confirmed (2026-09-19)

- The labels were confirmed, so the test assignments are replaced by the real ones: **snowball = default, chestnut = common, grenade = epic, Skyr = epic**.
- New rarity **default** (light grey `#c9c9c9`, `chance: 0`) at the bottom of the list in `rarities`. A chance of 0 means it is never rolled for the shop (`pickWeighted` only uses rarities with chance > 0); an item with no sellable rarity still counts as common when the shop picks. The balance report accepts chance 0 (only negative is an error) and leaves it out of the slot odds.
- **Items with NO rarity always sort at the very end**, after every rarity (default and common included): `Rarity.rank` is -1 for them and the tabs sort rarest-first by rank. This was already how the comparison behaved, so I verified it rather than changed it. Tested with six fake buffs: order legendary, epic (Skyr), common, common, default, none, none; and with the chestnut's rarity removed the PROJECTILES tab reads grenade (epic), snowball (default), chestnut (none).
- Shop odds with the final assignments, 8000 shops: chestnut 87.0%, grenade 6.9%, skyr 6.2% (expected 87 / 6.5 / 6.5); default never appears. Screenshot: snowball's "default" label in light grey. `rarity.js?v=2`, `shop.js?v=18`.

## Skyr price range (2026-09-19)

- Skyr's fixed price 10 became `priceRange {min 39, max 59}` (still `ignorePriceOverride`). New generic item field: a single item can have `priceRange` instead of `price`; each time it is put on sale its price is rolled in the range and saved in the slot's offer (`{ price }`, next to the stack offers `{ amount, unitPrice }`), so leaving the shop can't reroll it. `offerValid()` rerolls a missing/mismatched saved offer (an older save with Skyr in stock got prices 58 and 55 on load). The card shows only the price for it (no "x"). Verified over 3000 shops: all 21 prices from 39 to 59 appear; the card price equals the offer; buying charged exactly the shown price (40) and put one Skyr in the inventory; the price stayed the same after a reload. The balance report treats `priceRange` as its midpoint (49). `shop.js?v=19`.
- Question answered in chat: the strength hit range (W20) is 15.3% of the slider for every weight from about 15 to 184 (same curve, just slid along by the weight shift); it is shorter only when it runs past an end: weight 190 -> 12.3%, 200 -> 7.3% (band 0.927-1.08 cut at the tip), weight 10 -> 13%, 0 -> 8%. It also shrinks when the offset is outside the guaranteed zone (weight 100: 15.3% up to swing 0.1528, 6% at 0.158, 1.5% at 0.161, none at 0.17), and a strength-control buff zooms the bar so the same band fills more of it.

## Snowball stock: cap 100, +1 per 30 s (2026-09-19)

- **Why:** stop players spamming free snowballs to trigger random events. `projectiles.snowball` is no longer `infinite`; it has `regen { max: 100, everySeconds: 30 }` in economy.json. A new player starts full; each snowball thrown is given back at 1 per 30 s.
- **Timer** (`Economy.setRegenConfig / regenInfo / syncRegen`, save key `regen: { snowball: { count, next } }`): `next` is a `Date.now()` timestamp (device clock), so it keeps running while the app is closed; on load / every read the missed refills are added at once (`n = floor((now - next) / 30 s) + 1`, capped at 100, `next` moves on by n periods, `null` while full). It starts with the first snowball used and is NOT reset by later throws. A clock set back can't make the player wait longer than one period. Verified: 90 left + 95 s away -> 93 with 22 s to the next.
- **x0:** the snowball card is always listed (`isListed`: a `regen` projectile never leaves). The corner shows `x<count>` (also "default x100"), and under the EQUIP button (its own `.pick-action` box, so the button stays at the same height as on the other cards - checked) the text "+1 in 00:xx" shows while the stock is not full, "MAX" when it is; the list refreshes every 0.5 s while open.
- **At 0:** tapping the screen does not start a throw; the message in the middle reads "OUT of SNOWBALLS" with "+1 in 00:xx" under it (updated every frame) and turns back into "TAP to aim" when one arrives. Verified in the browser. Other consumables still fall back to the snowball when they run out (the snowball is not swapped when it is the empty one).
- `economy.js?v=13`, `collection.js?v=19`, `main.js?v=78` (wording: "+1 in", "MAX", "OUT of SNOWBALLS", "TAP to AIM"; `collection.js?v=20`).

## Character sprites: snowball in hand vs empty hands (2026-09-19)

- `character1_idle_snowball.png` (new) is the idle pose with a snowball in hand (`PROJECTILE_VISUALS.snowball.sprites.idle` = `char_idle_snowball`); `character1_idle.png` (updated) is now the EMPTY-handed pose, used when the equipped snowball stock is at 0 and the game is idle (`updateCharacterPose`: `state === IDLE && !hasAmmo()` -> `char_idle`). Aiming/throwing poses are unchanged, so after the last snowball is used the character is empty-handed again once the throw is over, and gets the snowball back the moment one regenerates. `main.js?v=79`; `char_idle` loads with `?v=2` to beat the browser cache.
- Shop restock timer set to 1800 s (30 minutes).

## Red dots on new cards; shop slot positions checked (2026-09-19)

- **Per-card "new" dot:** the same event that raises the PROJECTILES / BUFFS button dot (a kind the player had none of, and for buffs none running either) now also puts a red dot on the top-left corner of THAT card (`Economy.newProjectiles / newBuffs` = id lists in the save, `isNewProjectile / isNewBuff`, `.pick-new` in `collection.js`). The button's dot still goes when the list is opened; the cards' dots stay while it is open and are cleared when it is closed (or when the player switches straight to the other list) - `markSeen()`. More of a kind you already have adds no dot. `#list-scroll` got 8px of top padding (and `#list-title` 8px less at the bottom, so nothing else moves) so the dot isn't clipped above the first card. Verified: bought a new grenade + Skyr (+ chestnut that was already owned, + a second Skyr): dot only on the grenade card / the Skyr card, none after closing and reopening, dot persisted in the save until the list was closed. `economy.js?v=14`, `collection.js?v=21`.
- **Shop slot positions:** checked, no code change needed. A slot is an index in `stock/offers/restock`; buying only empties that index and a restock refills the same index. Tested 6 slots with real clicks: buy slot 2 -> SOLD OUT in place, 4 close/open cycles gave an identical layout; also slot 4; restock while the shop is open (slot 2) and while it is closed (slot 4): each came back in its own position, the other four cards (item, price, amount) unchanged across reopening. What can look like a "switch" is a restocked slot rolling a NEW item/price/amount (each restock is a fresh roll), e.g. Chestnut x10 -> Chestnut x16.

- Grenade description set: "What a great day to have one!" (`CATALOG` in `collection.js`; the shop card doesn't show descriptions). `collection.js?v=22`.

- **Equip / use removes the card's dot** (`Economy.clearNewProjectile(id)` / `clearNewBuff(id)`, called from `onEquip` in `collection.js`): equipping a new projectile drops its dot, and USE on a new buff drops its dot at once while the BUFFS list stays open. (Equipping a projectile closes the list, which still clears every card's dot as before - the list is "seen".) Verified: Skyr card dot gone right after USE (saved list empty, list still open); equipping the grenade removed its dot. `economy.js?v=15`, `collection.js?v=23`.

## Tomato Juice, buff cards fixed height, event chance 0.1% (2026-09-19)

- **Tomato Juice** (new shop item, `assets/items/tomato_juice.png`, moved in from the project root): consumable, **legendary**, `priceRange` 1200-2000, `duration` 60 s, effect `{ "type": "triggerEvent", "value": "face" }`, description "It's insides carry a scent that few people adore." (as written - "It's" kept). New buff effect type `triggerEvent`: while the buff runs the banana face is on (`MainScene.syncBuffEvent`, checked every frame, starts only in IDLE). The event lasts as long as the buff (timer = buff time left; device clock, so after closing the app the face comes back for the time that is left); a natural face event already running is taken over by the buff (its 20 s timer becomes the buff's); hitting the face concludes the event AND cancels the buff (`triggerBananaHit` -> `Buffs.cancel`), the x40 payout as usual; the buff ending (timeout, or tapping its HUD card) ends the event (`endBananaEvent`, now idempotent). `Buffs.eventBuff(name)` reports the running buff. Verified: use -> face appears, HUD card 0:59, timer ~58 s; buff run out -> face fades; hit (`triggerBananaHit`) -> buff gone, event over; card tap -> event ends; natural event + use -> taken over (timer 20 -> 59); reload with the buff running -> the face returns with the time left.
- **Buff cards** are as tall as projectile cards (`.pick-row.buff-row`, `min-height: 13.05u`, border-box), so a description of up to 3 lines doesn't change the height (Skyr and Tomato Juice cards measured identical). Note: a long name plus a wide "legendary xNN" corner can get tight (Tomato Juice + "legendary x1" has a ~9px gap at 800px wide; "x10+" would touch).
- **Natural face event chance 1% -> 0.1%** (`events.faceWindow.chancePerThrow` 0.001, 1 in 1000 throws).
- Balance report: Tomato Juice ~1600 coins on average (400 snowball hits); shop odds per slot with it: chestnut 85.7%, skyr 6.4%, grenade 6.4%, tomato juice 1.4%.
- `economy.js?v=15`, `buffs.js?v=7`, `collection.js?v=24`, `main.js?v=81`.

## Buff cap x99, long names, buff-use sound (2026-09-19)

- **Buff cap**: at most 99 of one buff (`shop.buffMax` in economy.json; `Economy.setBuffMax/getBuffMax`, `addBuffs` clamps as a safety net). Buying one you are maxed on is refused like too little money: `Shop.buy` returns `reason: "max"` BEFORE charging, the card greys (`cant`) and shakes. Verified: 98 -> buy -> 99 (charged 1500), next buy: shake, 0 charged, slot stays on sale, count 99; `addBuffs(+5)` stays 99. Projectiles have no cap.
- **Name vs corner**: `fitNames()` in `collection.js` (after each list draw and on window resize) gives a card's name a `max-width` that stops 8px short of the rarity/amount corner, so a long name wraps instead of touching it (Tomato Juice + "legendary x99" wraps to two lines and the card keeps its 13.05u height).
- **Sound on USE**: `assets/audio/buff_use.mp3` (the file the user dropped in the project root - they called it "accessory_use"; a `consumable_accessory_use.mp3` also exists in the lawnmower_frenzy project, not used) plays at volume 1 (was 0.6) when a buff is used from the BUFFS list, replacing the plain click; only when the use actually succeeds. Verified `buff_use@0.6` played. `economy.js?v=16`, `shop.js?v=20`, `collection.js?v=25`, `main.js?v=82`.

## Coin counter shortened from a million (2026-09-19)

- 10,000,000 coins ran out of the counter box (7+ digits don't fit its 84px). The counter (`formatCoins` in the inline script of `index.html`) now shows 1M, 2M ... 999M from a million up and 1B, 2B ... from a billion up, rounded down (1,999,999 -> "1M"); below a million the full number (999999 still fits). Verified for 999999, 1M, 12M, 999M, 1B, 5B: the coin icon and text stay inside the box. Only the counter is shortened; the exact amount is still what is saved and what prices are checked against. The user's local save was set to 10,000,000 (shows "10M").

## Kaiser Roll, Skyr price (2026-09-19)

- **Kaiser Roll** (new shop item, `assets/items/kaiser_roll.png`): consumable, **rare**, `priceRange` 30-50, 3 minutes (`duration.seconds` 180), effect `coinMultiplier 1.2` (the existing effect: multiplies the coins of a hit, rounded down, after the x40 face bonus, and it multiplies with other coinMultiplier buffs). Verified with the running buff: multiplier 1.2; snowball hit 5 -> 6, face hit 5 x 40 -> 240, chestnut 8 -> 9, grenade 199 -> 238. Description "Makes Making it Easier." (as written), bottom line "Coin bonus: 1.2x."
- **Bottom line on a buff card**: a new optional item field `detail` (economy.json) is drawn at the bottom of the buff's card in the BUFFS tab (`.pick-row.buff-row .pick-stats`, same lighter stats font as the projectiles' weight/hit value line). It is positioned over the card's bottom (no room of its own), so every buff card keeps its fixed 13.05u height (Tomato Juice, Skyr and Kaiser Roll all measured 126px, USE button at the same y). Only the Kaiser Roll has one so far. The USE button / timer is now wrapped in `.pick-action` like on projectile cards.
- **Skyr price** 39-59 -> **140-190**.
- Balance report (average price / shop odds per slot with all five items on sale: chestnut 60% (the only common), kaiser 30% (the only rare), skyr and grenade 4.5% each (the two epics share 9%), tomato juice 1%): Kaiser Roll 40 (10 snowball hits), Skyr 165 (41 hits). `collection.js?v=28`.

## Pinecone (2026-09-19)

- New projectile **Pinecone** (`assets/snowball/pine_cone.png`, id `pinecone`): **rare**, weight **126** ("heavy"), hit value **21** (W20 and W21 both 21 - one value was given), no mark, bounces off like the chestnut, spins in flight, and plays the chestnut's impact sound (`chestnut_impact`, 0.5). Shop: 10-20 per stack, 13-20 per piece (average price 248 = 62 snowball hits). Description "Feels kinda sticky." (also `CATALOG` in `collection.js`; `PROJECTILE_VISUALS.pinecone` in `main.js`.) There is no pinecone-in-hand character art, so the snowball idle/aiming poses stand in (add `character1_idle_pinecone.png` / `character1_aiming_pinecone.png` and point `sprites` at them when they exist).
- Verified live: list shows Pinecone between the grenade (epic) and the chestnut (common), "weight: heavy, hit value: 21", dot on the new card; equipped it and threw: 1 used, spun, bounced (0 new marks), sounds `throw_whoosh` then `chestnut_impact`.
- Shop odds per slot with all six items on sale: chestnut 60%, kaiser roll 15%, pinecone 15% (the two rares share 30%), skyr 4.5%, grenade 4.5%, tomato juice 1%.
- Weights for reference: snowball 100, chestnut 75, pinecone 126, grenade 130. `main.js?v=83`, `collection.js?v=29`.

- **Pinecone art wired (2026-09-19):** `character1_idle_pinecone.png` and `character1_aiming_pinecone.png` are now the pinecone's idle and aiming poses (`PROJECTILE_VISUALS.pinecone.sprites`; the throwing pose is still the plain one - no pinecone throwing sprite), replacing the snowball stand-ins; the updated `pine_cone.png` (shop / list / ball) loads with `?v=2`. Verified through a full throw: idle `char_idle_pinecone` -> aiming `char_aiming_pinecone` -> throwing `char_throwing` -> idle again. `main.js?v=84`, `collection.js?v=30`.

## Graduation lines removed (2026-09-19)

- The black tick marks on the OFFSET and STRENGTH sliders are gone (`drawAimBar` in `main.js`; the dead `AIM_TICK_STEP` and `aim.angleTickStep` went with them). The green guarantee lines (Skyr) are untouched: verified with Skyr running - green lines on both sliders (on the strength slider only when the locked offset can still hit W20, as before), and plain bars without it. Yellow event dots unchanged. `main.js?v=85`; docs updated (ECONOMY.md guideLines / precision rows).

## Water Bottle, "Coin bonus" wording (2026-09-19)

- Kaiser Roll's bottom line is now "Coin bonus: 1.2x." (was "Coins bonus").
- **Water Bottle** (new shop item, `assets/items/water_bottle.png`, moved from `assets/`): consumable, **common**, `priceRange` 10-20, 60 s, effect `saveProjectile 0.1` (new effect type: the chance, 0-1, that a throw does NOT use up its projectile; several sources combine as 1-(1-a)(1-b)), description "Has 10% chance to not consume projectile." The chance is read with the rest of the buff snapshot at the tap on "TAP to AIM" (`aim.saveProjectile`) and rolled in `consumeProjectile` - so it applies to every projectile including the snowball (a saved snowball doesn't lower the stock or start the +1 timer). No on-screen sign that it triggered (only the count doesn't drop). Verified: no buff, 200 taps -> 200 used; with the buff the modifier is 0.1 and 2000 taps saved 9.3% (expected 10% +-1.3); a forced lucky roll left the snowball stock at 100 with no timer, an unlucky one made it 99. Shop odds now: water bottle 30% and chestnut 30% (the two commons share the 60%), kaiser roll 15%, pinecone 15%, skyr 4.5%, grenade 4.5%, tomato juice 1%. `buffs.js?v=8`, `main.js?v=86`.

## Sliders 50% faster (2026-09-19)

- `aim.markerHz` 0.85 -> **1.275** (x1.5) in `economy.json` (and the fallback default in `main.js`); one speed for both the offset and the strength slider. Measured live: an edge-to-edge sweep takes 784 ms on the offset slider and 783 ms on the strength slider (was ~1180 ms; 1/1.275 = 784 ms). `main.js?v=87`.

## Saved-projectile indicator, best save chance only (2026-09-19)

- **Indicator:** when a projectile-saving buff (Water Bottle) saves a throw's projectile, the result message ("HIT +N coins" / "MISS") gets a row one line above it: the buff's icon and "+1" (`showMessage(msg, savedBy)` in `main.js`, `.msg-saved` in `index.html`, absolutely positioned on the top edge of `#message`, so the HIT / MISS text does not move). It is generic: whichever buff saved the throw shows its own icon, so future save-projectile items get it for free (they only need the `saveProjectile` effect). The roll is still at the tap on "TAP to AIM" (`consumeProjectile` sets `this.savedBy`), the icon appears when the result shows. Verified: forced lucky throw -> result `MISS` + row "+1" with `assets/items/water_bottle.png`; row gone after the reset to "TAP to AIM"; static preview above "HIT / +12 coins" (screenshot).
- **Several save buffs at once:** all of them keep running with their own timers, but only the HIGHEST chance counts - no combining (was 1-(1-a)(1-b); `Buffs.modifiers()` now keeps the max, and `saveProjectileBy` says which buff, whose icon is shown). Verified with temporary fake buffs (30% and 5%) next to the Water Bottle (10%): 30% by the strong one with all three running; cancel the strong one and the Water Bottle (10%) counts again, its timer never having stopped. `buffs.js?v=9`, `main.js?v=88`.

## Result text: "Saved Projectile" line, bigger + thicker outline (2026-09-19)

- The icon-and-"+1" row is gone (it looked like another Water Bottle was being added). When a buff saves the projectile, the result message gets a last line **"Saved Projectile"**: "HIT / +N coins / Saved Projectile" or "MISS / Saved Projectile" (`finishThrow` in `main.js`; works for any future save-projectile buff, no per-item icon any more).
- **HIT / MISS text bigger and easier to read:** `showMessage(msg, result)` puts the `result` class on `#message`: 16px instead of 12px and a thick black outline (8 hard 2px text-shadows + a soft one, `#message.result` in `index.html`). Only the result text - "TAP to AIM", "OUT of SNOWBALLS" etc. keep the 12px look (verified: back to 12px, no class, at idle). `main.js?v=89`.

- **Result text revised:** back to the original size (12px, line-height 1.8); `#message.result` now only adds a **thin black outline** (8 hard 1px text-shadows). The "Saved Projectile" line stays. Other messages unchanged.

- **All middle text has the thin outline:** the outline moved from `#message.result` onto `#message` itself (8 hard 1px black text-shadows, the old soft glow is gone), so "TAP to AIM", "OUT of SNOWBALLS", HIT / MISS and everything else in the middle share exactly the same size (12px, line-height 1.8) and outline. The `result` class / second `showMessage` argument were removed. `main.js?v=90`.

- **First line of the middle text is the centre:** `#message` is now shifted up by half a line only (`translate(-50%, -0.9em)`), so the first line - HIT / MISS / TAP to AIM / OUT of SNOWBALLS - sits on the exact vertical middle of the game and everything else in the message (+N coins, Saved Projectile, the "+1 in" countdown) hangs below it. Measured: the first line's centre is within 0.8px of the middle for one-, two- and three-line messages alike (single-line messages did not move).

## Buff max time under USE, Kaiser Roll 2 min, Triangles (2026-09-19)

- **Max time under USE:** in the BUFFS tab every card that is NOT running shows how long the buff lasts once used ("03:00", "01:00", "02:00") under its USE button, in the same style as the "MAX" under a snowball's EQUIP button (`.pick-regen` inside `.pick-action`; `Buffs.durationMs(item)`). It is the buff's full duration, not the running countdown: while a buff is active its own timer replaces the USE button and nothing is shown under it. The USE button did not move (same y on every card).
- **Kaiser Roll** duration 180 -> **120 s**.
- **Triangles** (new, `assets/items/triangles.png`, moved in from the project root): consumable, **rare**, `priceRange` 120-200, 120 s, "Tasty shapes to make your hand steadier.", effect `{ "type": "sliderSpeed", "value": 0.8 }` = both sliders at 80% of their speed (read with the rest of the buff snapshot at the tap: `aim.markerHz = markerHz x sliderSpeed`, 1.275 -> 1.02). Several sliderSpeed buffs can run together (each keeps its timer) but only the best counts - the slowest, no multiplying (`Buffs.modifiers`: min). Verified: none 1, Triangles 0.8, plus a temporary 0.9 buff still 0.8, plus a temporary 0.6 buff 0.6 (not 0.48), back to 0.8 when those were cancelled; measured an edge-to-edge sweep of 979 ms with Triangles (expected 980). Shop odds with seven items: common 60% (chestnut 30, water bottle 30), rare 30% (kaiser roll, pinecone, triangles 10 each), epic 9% (skyr, grenade 4.5 each), legendary 1%. `buffs.js?v=10`, `collection.js?v=31`, `main.js?v=91`.

## Stone (2026-09-19)

- New projectile **Stone** (`assets/snowball/stone.png`, id `stone`, name "Stone" - written "stone" in the request, capitalised like the others): description "Vile snowball", weight **145** ("heavy"), hit value **15** (W20 and W21), shop stacks of **2-5** at **12-14** per piece (average 46 coins per slot = 11 snowball hits). Character art `character1_idle_stone.png` / `character1_aiming_stone.png` wired (throwing pose = the plain one). Files moved in: `stone.png`, `hard_impact.mp3` -> `assets/audio/`.
- **Sound:** a throw that hits a window (W20 / W21) plays **`hard_impact`** (volume 0.6, a guess); a throw that hits no window plays the plain wall thud `snowball_impact` (0.3) - the request only covered window hits. New optional `hitSound` / `hitVolume` in `PROJECTILE_VISUALS` (`finishThrow`), any projectile can have one.
- **Not specified, so assumed (all in economy.json, one edit each):** no rarity (so it is treated as common when the shop picks - the three commons now share the 60%, 20% each - and it is listed LAST in the PROJECTILES tab, after "default"), `leavesMark: false` + `spins: true` (a stone bounces off like the chestnut / pinecone instead of sticking). The balance report accepts an item with no rarity now (it counts it as common like the shop).
- Verified live: equipped -> stone idle sprite, aiming sprite, ball `stone`; a centred good throw = HIT +15 coins with `hard_impact@0.6`, no mark; a weak throw = MISS with `snowball_impact@0.3`. List card: last, no rarity label, "x97", "weight: heavy", "hit value: 15". `collection.js?v=32`, `main.js?v=92`.

- **Stone revised:** rarity **common** (now set; it lists between the pinecone and the chestnut - same rarity, higher W20 value first - and the three commons still share the 60% at 20% each), a throw that hits **no window** plays the **chestnut's sound** (`chestnut_impact` 0.5; a window hit is still `hard_impact` 0.6), description **"Vile snowball."** (with the full stop). Verified: a weak throw = MISS with `chestnut_impact@0.5`; a centred throw = HIT +15 with `hard_impact@0.6`; list order grenade, pinecone, stone, chestnut, snowball. `collection.js?v=33`, `main.js?v=93`.

- **Stone: `hard_impact` on ANY window** (2026-09-19): the sound now plays when the stone lands on any of the building's 40 windows, not just the goal windows. New `WALL_WINDOWS` in `main.js` (all 40 window boxes in image pixels) + `hitsAnyWindow(x, heightClimbed)`; `PROJECTILE_VISUALS.<id>.hitSound` plays when `hit || hitsAnyWindow(...)`. The boxes come from the red rectangles of `docs/background_annotated.png` via the new `tools/find_windows.py` (prints the array to paste; W20 comes out as 385-436 x 273-316, exactly the game's). The door windows W39 / W40 (y 513-549) count too. Scoring is unchanged - only W20 / W21 pay. Verified with real throws: a decorative window (W28) = MISS with `hard_impact@0.6`, plain wall between windows = MISS with `chestnut_impact@0.5`, W20 = HIT +15 with `hard_impact@0.6`. `main.js?v=94`.

- **Max time stays under a running buff** (2026-09-19): the "03:00"-style max time under the USE button is now shown for a running buff too, under its live countdown. The running timer got the USE button's exact height (padding 1u + 2px transparent border + a 1.2u line), so the max time is at the same y whether the buff runs or not (measured: timer box 35px = button 35px, max text at the same y on every card). `collection.js?v=34`.

- **Buff timers in sync** (2026-09-19): the list's countdown changed up to half a second before the one on the cards at the top because each ran its own 500 ms `setInterval` (`buffs.js` for the cards, `collection.js` for the list), started at different moments and so out of phase; each showed the time as of its own last refresh. Now `Buffs` has ONE clock (every 250 ms) that refreshes the cards and then calls the list's refresh (`Buffs.onTick`), so both read the same instant. Verified over 8 s: every change of the two timers happened at the same millisecond (difference 0 on all 8), steps 1000 +-4 ms apart. `buffs.js?v=11`, `collection.js?v=35`.

## Rowan Berry (2026-09-19)

- New projectile **Rowan Berry** (`assets/snowball/rowan_berry.png`, id `rowan_berry`): description "Annoyingly imprecise. Not yummy.", weight **60** ("light"), rarity **common**, hit value **7** (W20 and W21 both 7 - one value was given), shop stacks of **6-15** at **3-6** per piece (average 47 coins per slot), and it behaves and sounds like the chestnut (no mark, bounces, spins, `chestnut_impact` 0.5). Character art `character1_idle_rowan_berry.png` / `character1_aiming_rowan_berry.png` wired (throwing = the plain pose). The updated `character1_aiming.png` (snowball aiming) loads with `?v=2`.
- **Why weight 60 reaches W21:** lighter = a wider offset slider: `offsetRangeForWeight(60)` = 0.509 swing each way (snowball 0.306, chestnut 0.407, pinecone 0.242), and W21 needs about 0.37-0.52. Verified with a real throw at swing 0.45: HIT +7 coins on W21, `chestnut_impact@0.5`, no mark.
- The four commons now share the 60%: chestnut, stone, water bottle, rowan berry 15% each. `collection.js?v=36`, `main.js?v=95`.

- **Rowan Berry ball art** (2026-09-19): the projectile in the air now uses `assets/snowball/rowan_berry_projectile.png` (moved in from the project root); the card / shop icon stays `rowan_berry.png`. Note the new file is a 32x32 image with only **4 opaque pixels** (a 2x2 dot at x 15-16, y 13-14), and every projectile is drawn at 16x16 (half scale), so the berry in flight is about 1 px on the 432-wide canvas - almost invisible (the chestnut fills ~25x18 of its 32x32). Left as delivered. `main.js?v=96`.

- **Rowan Berry ball art updated** (2026-09-19): the new `rowan_berry_projectile.png` has 16 opaque pixels (a 4x4 dot at x 14-17, y 13-16), so the berry in flight is about 2 px on the canvas (was 1 px). Loads with `?v=2` (verified the game loads the new file: 16 opaque pixels). `main.js?v=97`.

## Egg (2026-09-19)

- New projectile **Egg** (`assets/snowball/egg.png`, id `egg`): rarity **rare**, weight **137** ("heavy"), hit value **41** (W20 and W21 both), shop stacks of **3-9** at **30-40** per piece (average 210 coins per slot = 52 snowball hits), description "No chickens inside. Enough for a 'basic' omelette.". It sticks like a snowball and leaves its own splat: `egg_impact.png` (64x64, shown at 40px like the grenade's scorch mark, same 0.625 scale as the snowball's) and plays `egg_impact.mp3` (volume 0.5, a guess) on every throw; no spin. Files moved in: `egg.png`, `egg_impact.png` -> `assets/snowball/`, `egg_impact.mp3` -> `assets/audio/`.
- **Character sprites NOT found:** the request said they would be in the game files, but there is no egg character art anywhere (`assets/character/` has none, nothing untracked). The snowball poses stand in for now (`PROJECTILE_VISUALS.egg.sprites`); when `character1_idle_egg.png` / `character1_aiming_egg.png` are added, point `sprites` at them (as done for the pinecone).
- Verified live: equipped Egg, centred throw = HIT +41 coins, `egg_impact@0.5`, one new mark with the `egg_impact` texture at 40px (visible on W20 and in the rear-view window). Shop odds with eleven items: the four commons 15% each, the four rares 7.5% each (kaiser roll, triangles, pinecone, egg), skyr and grenade 4.5%, tomato juice 1%. `collection.js?v=37`, `main.js?v=98`.

- **Egg character art wired** (2026-09-19): `character1_idle_egg.png` / `character1_aiming_egg.png` are now the egg's idle and aiming poses (throwing = the plain pose), replacing the snowball stand-ins. Verified: idle `char_idle_egg` -> aiming `char_aiming_egg` (egg visible in the raised hand) -> idle again. `main.js?v=99`.

## Fast-throw visuals reverted; the ball shrinks toward the apex (2026-09-19)

- **Reverted** (commits `120b22b` and `64bc89d`, the sprite file `character1_aiming.png` that `64bc89d` also carried was kept): the fast straight flight, the weight-dependent speed (1600 -> 600 px/s), the tiny impact jolt and the velocity-based bounce are all gone; throws again follow the parabola to the apex (about 0.8-0.9 s for a typical throw) and bouncers kick off as before (fixed 90 px/s sideways + 0.3 x the throw's drift, 130 px/s up). Verified: no `flightVis` / `FLIGHT_*`, a snowball throw lasts 928 ms, a chestnut 989 ms.
- **New, visual only - perspective:** the projectile in the air gets smaller as it approaches its apex: full size (`BALL_SIZE` 16 px) when thrown, `BALL_APEX_SCALE` **0.5** (8 px) at the apex, shrinking steadily with the flight's progress (measured 15.9 -> 11.9 -> 8.2 px, never growing on the way); a ball that goes on over the roof stays small while it falls behind it. A projectile that bounces off (no mark) comes back towards the player and grows back to full size over `BALL_REGROW_MS` 450 ms (9.6 -> 13.7 -> 16 px measured). Marks, hit detection and everything else are untouched. Constants sit next to `BOUNCE_OFF_SPEED` in `main.js`. `main.js?v=102`.

- **Shrink / regrow are now curved** (2026-09-19): instead of linear, both use one logarithmic curve `logCurve(x) = ln(1 + K x) / ln(1 + K)`, K = `BALL_CURVE_K` 9 (steep near 0, flat near 1). Growing after a bounce follows it forwards in time (fastest right after the bounce, slower and slower the further it gets); shrinking towards the apex follows it BACKWARDS, so the closer it is to the apex the faster it shrinks - the ball leaves the wall exactly the way it arrived, in reverse. Same end sizes (16 -> 8 px at the apex, back to 16 over 450 ms). Measured on a chestnut throw: drop per quarter of the flight 0.86, 1.26, 1.80, 3.48 px (accelerating); gain per quarter of the regrow 2.41, 1.63, 1.26, 0.92 px (decelerating). `main.js?v=103`.

- **Smaller impacts, spinning egg** (2026-09-19): the snowball's wall mark 20 px -> **10 px** (the default in `addMark`), the egg's splat 40 px -> **20 px** (`PROJECTILE_VISUALS.egg.mark`; the grenade's scorch mark is unchanged), and the egg now **spins in flight** (`egg.spins: true` in economy.json, same `SPIN_RATE` as the chestnut; it stops turning at the wall as the others do). Verified: snowball mark 10 px, egg mark 20 px, the egg's rotation moved during the flight and the snowball's did not. `main.js?v=104`.

## Banana face event music (2026-09-19)

- **`event_banana_face.mp3`** (moved into `assets/audio/`; 7.4 MB, bigger than the 4.3 MB theme) plays for as long as the banana face event is on, crossfaded with the theme: `setEventMusic(on)` in `main.js`. When the event starts (`startBananaEvent`, natural or Tomato Juice) the theme fades down to silence (it keeps looping underneath) while the event track (looping, started silent at its beginning) fades up to 0.5 over **1.5 s** (`MUSIC_FADE_MS`, sine ease in and out); when the event ends - the face is hit (`triggerBananaHit`, the moment it is hit, while the face fades away), the timer runs out or the buff is cancelled (`endBananaEvent`) - it fades back the other way and the event track stops (it starts from the beginning next time). `THEME_VOLUME` / `EVENT_MUSIC_VOLUME` 0.5 each. A fade that is still running when the event ends (or starts again) is stopped and the next one begins from the volumes the tracks have at that moment, so nothing ever jumps.
- Verified: fade in theme 0.50 -> 0 and event 0 -> 0.50 in step (sampled smooth S-curves, sums stay near 0.5), fade out the reverse, event track stopped and theme back at 0.5 afterwards; reversing a fade at 700 ms: volumes 0.29 / 0.21 -> 0.28 / 0.22 (no jump). The event track's gain reads 1 for a few ms on the very first play (Phaser applies the volume on the next audio tick); the sound starts and the gain change land in the same render quantum, so it is silent. `main.js?v=106`.

## Face window textures replaced with the raw exports (2026-09-19)

- `goal_window_face.png` / `goal_window_face_hit.png` were replaced with the raw **58x50** exports (2px grey padding + the 54x46 picture). Once the padding is removed they are pixel-identical to the previous cropped textures (compared: 0 differing pixels), so the face box and divider constants did not change. Instead of cropping the PNGs, the overlay now crops the padding away at draw time (`FACE_TEX_PAD` 2, `FACE_TEX_W/H` 54x46 in `main.js`: the sprite sits at (FACE_IMG_X - 2, top - 2) with `setCrop(2, 2, 54, 46)`), so future raw exports can be dropped in as they are. Both load with `?v=2` to beat the browser cache.
- Verified by reading the rendered canvas back (`renderer.snapshotArea`) with the event on: the 54x46 area over W20 equals the normal texture with **0 of 2484 pixels** off (worst channel difference 0), and after the face is hit the same area equals the hit texture (0 off) - the crop survives the texture swap; the wall around it is untouched (the grey ring seen next to it is the building art's own window frame); after the hit the overlay fades out and is hidden. `main.js?v=108`.

- **Face window textures, corrected (2026-09-19):** the 58x50 textures are exactly W20's whole window in the building art - 52x44 glass plus a 3px frame (1px white, 2px light grey) - so they are now drawn **1:1 over it, no crop** (`FACE_FRAME` 3: top-left 3px up/left of the glass; the earlier crop / pre-cropped-texture attempts are gone). The face box (385-402 x 343-360 world) and the divider are unchanged: `FACE_RAW` / `FACE_RAW_LEFT_DIVIDER_X` are now in the texture's own pixels (3-20, 30-47, 22).
- **Why the top-left display rendered weird:** the rear-view camera is 125x59 (odd sizes) and a Phaser camera with an odd width / height gets a half-pixel offset (its matrix translates by -0.5); with `roundPixels` the vertices of a sprite then round unevenly, so the face picture came out 1px stretched and shifted there (1px wider, 1px shorter, ~600 of its 2900 pixels off), while the main view was exact. Fix: `createTargetCamera` scrolls by the same half pixel when the size is odd (`scrollX/Y - 0.5`). Verified by reading the rendered pixels back: main view and rear-view window both show the normal texture and the hit texture with **0 of 2900 pixels** off. `main.js?v=111`.

## Prices re-set by tier, hit values from prices (2026-09-19)

- **Average price per stack** is now set per tier (`tools/reprice.py`, kept for reference; run once): projectiles common 50 / rare 250 / epic 1250, consumables common 25 / rare 125 / epic 625 / legendary 3125. Stack sizes (`amount`) are untouched; each item keeps its own min-max spread around the new average, and every per-piece price is **rounded down** (so the real averages come out 1-2 coins under the targets: 45-49 / 246-248 / 1249 and 24 / 124 / 624 / 3124). For a projectile the per-piece average is target / average stack size.
- **Hit values:** each sold projectile's hit value (W20 and W21) is now its **highest per-piece price + 1**: chestnut 5 (W21 3, it keeps its old W21 : W20 ratio), rowan berry 7, stone 16, pinecone 21, egg 48, grenade 794. The snowball is not sold, so it keeps 5 / 3.
- Slots already on sale in a save keep the price they were rolled with until they restock.

- **Coin counter in the shop** (2026-09-20): while the shop is open the counter moves from above the SHOP/BACK button to the **top centre** of the screen, in the middle of the shop board's top frame (`#game-container.shop-open #coin-counter`: `left: 50%`, `top: 2.8u - 11px`, `translateX(-50%)`). Outside the shop it stays where it was. Verified: centre exactly 50.0% across in the shop, 94.6% (bottom-right, unchanged) in the game view, still shows the live amount ("10M").

## Skipped result screen no longer cuts off a falling projectile; snowball cap 50 (2026-09-20)

- **Falling projectile survives the skip:** the HIT / MISS screen can be skipped by a tap (or ends by itself) while a bounced-off projectile is still in the air. `resetForNextThrow` used to hide it on the spot. Now `releaseBounce()` hands it over to a sprite of its own (`this.fallingBalls`; the main ball is needed for the next throw) that keeps falling with the same velocity, size regrow and spin, and `updateFallingBalls` removes it only once it has dropped below the **bottom edge of the default (idle) camera view** (world y `INITIAL_SCROLL_Y + GAME_HEIGHT` = 20, i.e. 20 px below the ground line). It has no ground of its own - it keeps falling out of the picture (in the normal flow that ground hit happens off-screen while the camera is high). A projectile that is already resting on the ground is still hidden at the reset as before. Verified: a chestnut skipped at height 351 -> the main ball hidden, a separate sprite visible and falling through the default view, destroyed at the bottom edge, none left afterwards. `main.js?v=112`.
- **Snowball cap 100 -> 50** (`projectiles.snowball.regen.max`): a new player starts with 50, a save above 50 is clamped to 50 on load (verified: the local 100 became 50), buying / refilling can't exceed it; the +1 per 30 s refill is unchanged. `docs/ECONOMY.md` updated.

## Availability timer: items in the shop are replaced by rarity (2026-09-20)

- **New mechanic:** every item on sale has an availability timer by its rarity; when it runs out the slot **rerolls** (a new pick - by the normal rarity roll, so it can even be the same item - with a fresh amount, price and timer). `economy.json` `rarities[].availabilitySeconds`: **common 30 min, rare 1 h, epic 2 h, legendary 4 h** (default has none; an item with no rarity counts as common). Purpose: nobody is stuck looking at a price they can't reach, and there is a reason to come back.
- **Save / clock:** `shop.expires[slot]` = device-clock timestamp (like the restock and buff timers, so it keeps running while the app is closed; a clock set back never gives more than one full timer). A slot whose time ran out while the app was closed is rerolled on load. A save from before the timers gets fresh ones on the next load. Buying a slot clears its availability timer (the sold-out timer runs, as before); when the sold-out slot restocks its new item gets a fresh availability timer. A reroll counts like a restock: the SHOP dot (when the shop is closed) and the restock sound.
- **Display:** `xx:xx` in the top-left corner of the picture rectangle on every card (`.shop-avail` inside `.shop-pic`), same look as the max time in the BUFFS tab (0.85u, #8a6a44); under an hour `29:51`, from an hour `3:59:00`. It counts down live (every second the shop's tick) and a reroll while the shop is open redraws the card.
- Verified: fresh timers 30 / 60 / 120 / 240 min for a common / rare / epic / legendary item on sale; live reroll while open (Rowan Berry -> Stone with a new 30 min timer); an expired timer on load -> slot 0 rerolled (Triangles -> Stone) and the dot raised; a bought slot has no availability timer, only its 30 min sold-out timer; card offset of the timer 8,6 px from the rectangle's corner. `economy.js?v=17`, `shop.js?v=21`.

- **Shop picture vs availability timer** (2026-09-20): so the item picture no longer runs into the timer, the picture rectangle (`.shop-pic`) sits a little higher (0.15u under the category row instead of 0.5u; the difference went to its bottom margin, so it keeps its height) and the picture inside is a little smaller and lower (padding 0.9u top / 0.4u sides / 0.3u bottom: drawn 97 px instead of 109 px at an 800 px wide display, 11 px clear of the timer). The timer is inside the rectangle, so it moved up with it. Verified on all six cards.

- **Availability timers no longer restart from "now"** (2026-09-20): a slot's new item takes over the clock of the one it replaces (`rollFrom` in `shop.js`): its timer runs from when the previous item ran out (for a sold-out slot: from when its sold-out timer ended; a first stocking still starts at now). If that is already over too - the app was closed for a long time - the slot is rerolled again and again, each new item taking its own duration from the previous end, until the item that would be on sale right now is found; only that one is shown, with the time it really has left. So time away is used up, not refunded as a fresh full timer: e.g. with 30 min items, a slot that ran out 100 min ago shows the 4th replacement with 20 min left (the 4th one started 10 min ago). Verified with all rarities set to 30 min in the page: expired 100 / 45 / 5 min ago -> 20 / 15 / 25 min left; a sold-out slot that came back 70 min ago -> 20 min left. `shop.js?v=22`.

## Fractional coins carry over (2026-09-20)

- A payout with a coin multiplier is no longer rounded down each time: `Economy.takePayout(amount)` (`economy.js`) pays the whole coins and keeps the fraction (`coinCarry`, saved, 0 <= x < 1) for the next payout. 5 x 1.1 = 5.5 now pays 5, 6, 5, 6, ... (55 over ten hits exactly), 7 x 1.1 pays 7, 8, 8, 7, 8, 8, ... (77 over ten), 5 x 1.2 always 6, and with no multiplier nothing changes. The carry is global (not per projectile) and survives closing the app; the face event x40 goes through the same function. So a small multiplier such as the 1.1x that matches the 10% save chance now works on cheap projectiles too. Verified with the function on its own and with four real Chestnut throws under a temporary 1.1x buff: paid 5, 6, 5, 6. `economy.js?v=18`, `main.js?v=113`, `buffs.js` comment.

## THE GRAND RESET (2026-09-20)

- **Everybody starts again**, no exceptions, because prices changed drastically. There is no server, so progress (the `snowyBallsSave` entry in each player's browser) is reset on each device the first time it opens the new version: every save now carries `epoch`; `Economy.SAVE_EPOCH` (a constant at the top of `economy.js`, currently **1**) is what the game expects. A save with no `epoch` (every save made before this) or a lower one is thrown away on load and replaced right away by a fresh default save (0 coins, no streak / best streak, 50 snowballs, nothing else owned, only the snowball equipped, no buffs, newly rolled shop, no dots, no coin fraction) - so it can only happen once per device. **To reset everybody again, raise `SAVE_EPOCH`.** A save with an epoch >= the constant is kept as it is; a corrupt save just becomes a fresh one (no message).
- **The message:** only a device that HAD a save (`Economy.wasCleansed()`, kept in memory, never saved) sees it: a completely black screen over the whole game (`#cleansing`, z-index 100, taps blocked) with white text "The grand cleansing has struck.", which fades in (0.8 s), is held until the game is up and at least 3.2 s have passed, then the whole screen fades out into the normal game over 2.4 s and the element is removed - it is not shown at any later time. A brand-new player (no save) sees nothing. Note: a device that only ever opened the old game already had a save (the shop saves its stock on load), so it sees the message too.
- Verified in the browser: an old-style save (no epoch, 12345 coins, 40 grenades, 5 Skyr, best streak 17) -> black screen with the white sentence, save replaced by a fresh one (0 coins, 50 snowballs, nothing owned, epoch 1); the fade timeline black -> opacity 0.65 / 0.23 / 0.05 -> 0 -> removed; a second load shows nothing; a save with the epoch keeps its progress (500 coins kept, no message); no save at all -> fresh game, no message. `economy.js?v=19`, `main.js?v=114`.
- Rollout notes: GitHub Pages can serve the old page for ~10 minutes after a push; whoever loads it then runs the old version and is reset on their next visit; a tab left open on the old version that writes an old-format save is reset on the next load. The local preview save was reset by this (and set back to a fresh new game).

## OPTIONS list, save slots, export / import codes (2026-09-20)

- **OPTIONS button** under PROJECTILES (left side, `#options-btn` in `#side-buttons`); it opens the same list panel as the other lists, titled OPTIONS, with a **SAVES** section (`Saves.renderOptions`, `src/saves.js`, new; `collection.js` opens it as list kind `options`).
- **Two slots.** A slot is a rectangle with its name and, under it, "Last loaded: 20 SEP 2026 03:17" ("never" until first loaded); the slot being played has a green frame and "PLAYING". To the right of each filled slot two small buttons, one above the other: a **download arrow** (EXPORT popup: a read-only box with the code, COPY / CLOSE) and a **trash can** (DELETE popup with the wording for what will happen, DELETE / CANCEL). Tapping a filled slot that is not being played opens a LOAD popup (the game restarts with it; the game being left keeps its progress in its slot). An **empty slot** is dimmed with a dashed frame and "+ CREATE": tapping it opens a popup with a name field (default "Save 2", max 16 characters) and **NEW GAME** / **IMPORT** / CANCEL; IMPORT shows a paste box with a live check under it ("OK: 4321 coins, best streak 0" or the reason it is refused) and an IMPORT button that only works on a valid code (BACK returns, keeping the name). Popups close with their buttons or a tap on the dimmed area around them and block taps to the game.
- **Storage:** the game being played is the usual `snowyBallsSave`; the other slot's save sits in `snowyBallsSlotData<i>`; `snowyBallsSlots` holds `{ active, slots: [{ name, lastLoaded } | null] }`. Loading a slot writes the current save into its slot's data, moves the chosen data into `snowyBallsSave`, and reloads; `Economy.lockSaves()` stops the old page from writing over the swap. Every page load stamps the active slot's "last loaded". Existing players keep their game as "Save 1" (slot 1 active). **Slot 1 is never empty:** deleting it (when it is the game being played, or when it is not) starts a brand-new game in it named "Save 1"; deleting slot 2 empties it - and if slot 2 was the game being played the game goes back to slot 1 first. The grand reset also empties any other slot whose save is from before the reset.
- **The code:** `SB1.<payload>.<check>` - the save JSON deflated (`CompressionStream`), URL-safe base64, and a CRC32 check (`SB0` = uncompressed for a browser without compression). **About 300-650 characters** (a fresh game about 450; a heavily played one about 640; measured 311-500 in these tests). Line breaks and spaces in a pasted code are ignored. Refused with a clear message: not a code, cut short / one character changed (the check fails), unreadable, "not a valid save", and a save from before the grand reset ("...can no longer be used"). An accepted save is cleaned through the same function the game uses to load (`Economy.sanitize`), so nothing unexpected gets in. There is no server, so a player can still craft a code on purpose - the check only catches accidents.
- Verified in the browser: export -> import round trip (4321 coins), all refusal messages, create new (name trimmed to 16 chars), export of the slot not being played, delete inactive / cancel / tap outside, load slot 2 (coins 4321) and back (Save 1 kept its 4432), delete the slot being played (back to Save 1, slot 2 empty, no leftover data), delete slot 1 (brand-new game: 0 coins, 50 snowballs); the popups fit a phone-sized screen; no console errors. `economy.js?v=20`, `saves.js?v=1`, `collection.js?v=38`.

- **OPTIONS polish** (2026-09-20): the import check under the paste box now says just "2500 coins" (no "OK:", no best streak). The SAVES section (heading + slots) is inside a rectangle of its own (`.opt-section`: darker translucent panel, dark border, heading inside), and any future section gets its own the same way. `saves.js?v=2`.

## FIX: the cleansing path crashed the game (2026-09-20)

- **Bug:** the OPTIONS commit (`947648a`) added `let locked = false;` to `economy.js` AFTER the line `if (cleansed) save();`. For anyone whose save was from before the grand reset (the exact case the cleansing screen is for) `save()` ran while `locked` was still uninitialised and threw "Cannot access 'locked' before initialization": `Economy` never came into existence, so the whole game failed to start ("Economy is not defined") and the black cleansing screen never showed properly. Players with a current save, and new players, were not affected - and I had not re-run the cleansing test after that commit.
- **Fix:** `let locked` now sits before `let state = load()`. Verified at phone size with an old-style save: the black screen with the sentence shows, the save is replaced by a fresh one (Economy defined, 50 snowballs), and the screen fades into the working game. Also: a **tap on the black screen** now ends the wait (once the sentence has had 1.2 s; it still waits for the game to be ready, and the 14 s safety net remains) - measured: a tap at ~2.7 s made it fade about 100 ms later instead of at 3.2 s. `economy.js?v=21`.

- **Secondary popup buttons** (2026-09-20): CANCEL / CLOSE / BACK (`.modal-btn.ghost`) looked disabled (pale grey with pale text); they are now tan (`#dcc9a0`) with dark brown text and the popup's brown border - clearly pressable, quieter than the main action (brown, or red for DELETE). The disabled IMPORT button keeps its faded look.

- **Tomato Juice lasts 20 s** (2026-09-20), the same as the natural face event (`events.faceWindow.durationMs` 20000), down from 60 s (`duration.seconds` in economy.json). The max time under its USE button reads 00:20. A Tomato Juice that is already running keeps the deadline it was started with.

## Deleting Save 1 = replace it; no buff cap (2026-09-20)

- **Deleting slot 1** (which can never be empty) no longer just starts a new game: the trash can opens "DELETE SAVE?" with the new save's **name** field (default "Save 1") and **NEW GAME** / **IMPORT** / CANCEL (`showReplace` in `saves.js`). Nothing is erased until one of the first two is chosen: NEW GAME replaces the slot with a fresh game, IMPORT shows the paste box ("Paste a save code. It replaces the save you are deleting.") with the live coins check, BACK returns keeping the typed name, CANCEL leaves everything as it was. The replaced save can be the game being played (then the game reloads with it) or the one not being played. Deleting slot 2 is unchanged (plain delete, slot empty). Verified on a separate origin: cancel keeps the save; IMPORT with a name replaced slot 1 by the imported save (3277 coins, named "Imported one"); NEW GAME with a name gave a fresh game (0 coins, 50 snowballs, named "Fresh start"). `saves.js?v=3`.
- **The 99 buff cap is gone:** `shop.buffMax` is removed from economy.json (`Economy.buffMax` starts at Infinity; the key still works if it is added again), so a player can hold and buy any number of one buff (verified: 150 Skyr). `economy.js?v=22`.
- **Local dev save (preview browser only):** the first save is named **dev_testing**, with 999 of every projectile except the snowball (chestnut, egg, rowan berry, stone, pinecone, grenade) and 99 of each buff (skyr, kaiser roll, water bottle, triangles, tomato juice); the snowball stays at the normal 50 (its cap).

- **Deleting the second save uses the same dialog as the first** (2026-09-20): the trash can on either slot opens "DELETE SAVE?" with the name field (default "Save 1" / "Save 2") and NEW GAME / IMPORT / CANCEL (`showDelete` -> `showReplace`); the save is replaced by a new one the player names and starts as a new game or imports, it is never simply removed (the old plain delete popup and `deleteSlot` are gone). So slot 2, once created, can be replaced but not emptied again. Verified on a separate origin: the dialog for slot 2 (default "Save 2"), CANCEL keeps it, replacing the slot not being played ("Second" -> "Third"), replacing the slot being played (4242 coins -> a fresh game, named "Replaced live", still the active slot). `saves.js?v=4`.

- **Chestnut rebalanced** (2026-09-20): its hit value (5 / 3) had ended up the same as the snowball's after the price rework (per-piece price 2-4, hit value = highest price + 1). To raise it without changing what a stack costs on average: stack size **10-20 -> 5-10** and price per piece **2-4 -> 5-7**, so the average stack price stays **45** (7.5 x 6; range 25-70, was 20-80) while the highest per-piece price - and with it the hit value - goes to **8 / 5** (from 5 / 3; the ratio 5 : 8 as before). It now sits just above the Rowan Berry (7) and below the Stone (16). Shop odds unchanged. Slots already on sale keep their old offer until they reroll.

- **All availability timers are 30 minutes** (2026-09-20): `rarities[].availabilitySeconds` is 1800 for common, rare, epic and legendary - a better rarity no longer stays on sale longer (was 30 min / 1 h / 2 h / 4 h). The per-rarity field stays, so it can be varied again. Items already on sale with a longer timer are cut to 30 minutes on the next load / tick (the shop's "never longer than one full timer" guard).

## One hit value, weight tiers, hit values by rarity (2026-09-20)

- **W21 pays the same as W20:** a projectile has ONE hit value (`hitValue`, used for both goal windows); `rewards { W20, W21 }` is gone from economy.json, the code (`finishThrow`), the card ("hit value") and the balance report. The snowball is 5.
- **Weight is a tier, not a number** (`weightTiers` in economy.json; a projectile's `weight` is now `"very_light" | "light" | "moderate" | "heavy" | "very_heavy"`; the card shows the tier word): the tier is where on the STRENGTH slider a throw lands in W20 - very light 0-25%, light 25-50%, moderate 37.5-62.5%, heavy 50-75%, very heavy 75-100%. The apex is a straight line in strength through W20's bottom at the band's start and W20's top at its end (`apexForPower` / `powerForApexOf` in `main.js`; the old quadratic curve, `weightShift` and the weight-0-to-200 model are gone), so the green guide lines, the yellow event dots and everything that uses `powerForApex` follow the tier. Every band is 25% wide (the W20 strength band used to be ~15% for the snowball: easier now). The offset slider keeps its weight-dependent width, using the old weight number that equals the middle of the tier's band x 200 (25 / 75 / 100 / 125 / 175); `prepareProjectiles()` converts the tier to `strengthBand`, `weightLabel` and that number at load (safe to run twice).
- **Tier assignment now** (from the old words): snowball moderate, chestnut moderate (was weight 75, now the same as the snowball: offset +-0.31 instead of +-0.41, so it can no longer reach W21), rowan berry light (was 60: +-0.41 instead of +-0.51, still reaches W21), pinecone / egg / grenade / stone heavy (were 126-145; offset +-0.24). Nothing is very light / very heavy yet.
- **Hit values by rarity** (`rarities[].projectileHitValue`): default (snowball) **5**, common **12**, rare **60**, epic **300**, legendary **1500** (x5 per tier). For this to be a fair deal every shop projectile of a rarity now has the same **stack of 3-7 pieces** and the same **price per piece, 20% under the hit value** (common 8-12, rare 40-60, epic 200-300, legendary would be 1000-1500), so an average stack costs exactly 50 / 250 / 1250 (/ 6250) - the tier targets - and pays back 1.2x at a 100% hit rate (break-even accuracy 83%). Before, stack sizes varied 1-20 per item, which made a per-tier hit value impossible (Stone would have lost money). Projectiles can still override with their own `hitValue`.
- Verified in the browser: the strength band of each tier equals the specified one (light 0.25-0.5, moderate 0.375-0.625, heavy 0.5-0.75; apex at the band's edges = W20's edges for all five tiers, very light 344 at strength 0, very heavy 387 at strength 1); real throws at the middle of the band hit: chestnut +12 (strength 0.5), rowan berry W20 and W21 +12 (0.375), stone +12, pinecone +60, grenade +300 (0.625); the card shows "weight: moderate / hit value: 5" for the snowball. `economy.js` unchanged, `main.js?v=115`, `collection.js?v=39`, `shop.js?v=23`.

- **Heavy hitters** (2026-09-20): one projectile per rarity takes a bigger risk for a bigger reward - **Stone** (common), **Egg** (rare), **Grenade** (epic): a smaller stack (**1-3** instead of 3-7), a price per piece **2.5x** the standard one and a hit value **2.5x** the standard one (`projectiles.<id>.hitValue` overrides the rarity's), for the same average stack price. Stone 30 (pieces 20-30, stack 20-90, avg 50), Egg 150 (100-150, stack 100-450, avg 250), Grenade 750 (500-750, stack 500-2250, avg 1250). The standard row of each rarity stays as set (Chestnut and Rowan Berry 12, Pinecone 60, an epic standard would be 300 with 3-7 at 200-300). The ratio hit / price is the same 1.2 (break-even accuracy 83%) - what changes is the stakes per throw: at a 50% hit rate a common standard throw loses about 4 coins, a Stone throw 10; at 90% they gain +0.8 / +2.0. A future legendary heavy hitter would be 3750 (2500-3750, stack 1-3). Local saves keep the offers they already rolled until those slots reroll.

## Economy rework: tiered stacks, prices and buffs (2026-09-20)

Applies the plan in `docs/FUTURE_PRICES.md` (one stack per 2 minutes, 75% hits, hit value = 1.6 x the average price per piece, prices +-25%). Only `economy.json` (and the balance report) changed; no code, so no cache-buster bumps. Local shops keep the offers they already rolled until those slots reroll.

- **Hit values** (`rarities[].projectileHitValue`): snowball 4, common 16, rare 128, epic 960, legendary 4800 (was 5 / 12 / 60 / 300 / 1500). Heavy hitters: Stone 40, Egg 320, Grenade 2400 (were 30 / 150 / 750).
- **Shop stacks** (standard 3-7): Chestnut / Rowan Berry 8-12 a piece (avg stack 50), Pinecone 60-100 (400); heavy hitters 1-3 pieces: Stone 20-30 (50), Egg 150-250 (400), Grenade 1,125-1,875 (3,000). Every hit value is above the highest price per piece.
- **Buffs** (prices per buff, always 1): Water Bottle 2-4 and now **120 s** (was 60 s), Kaiser Roll 43-72, Triangles 29-48, **Skyr moved to rare** and 43-72, Tomato Juice 3,100-5,100. Shop odds after the move: water bottle / chestnut / stone / rowan 15% each, grenade 9%, skyr / kaiser / triangles / pinecone / egg 6% each, tomato 1%.
- **Face multiplier x40 -> x2.5** (`events.faceWindow.faceMultiplier`): a face hit pays 10 (snowball), 40 (common), 6,000 (Grenade); fractions carry over.
- `tools/economy_report.py` also flags a shop projectile whose hit value is not above its highest price per piece.
- **Not in the game yet, kept for later:** `docs/FUTURE_PRICES.md` (reasoning, tables) and `docs/future_items.json` (ready-to-paste entries: epic standard, legendary standard and heavy hitter, common 1.1x coins, rare 20% save, epic 30% save and 1.35x, legendary 50% save, 1.5x and Sure Shot, which needs a new "guaranteed hit" mechanic).

- **Skyr renamed** (2026-09-20): the buff (id `skyr`, unchanged so saves keep working) is now **Orange Skyr** with the picture `assets/items/skyr_orange.png` (economy.json only). The old `skyr.png` stays in the folder, unused.

## God mode import code (2026-09-20)

- Typing **god mode** (any case, any spacing) into an IMPORT box (a new slot, or replacing one) builds a special save instead of decoding a code: 999,999,999 coins and lifetime coins (every shop tier open), 999 of every projectile and of every buff, and the save flag `god: true` (`godSave()` in `saves.js`, which reads economy.json for the ids, so new items are included automatically). The status line reads "GOD MODE".
- With `god` set, `Economy` never uses anything up: `spendCoins` always succeeds without charging, `useProjectile` and `takeBuff` succeed without removing anything (the snowball stays at 50), and the lists show **xINF** instead of the count. Coins from hits are still added, so payouts stay visible. `Economy.isGod()`. The flag is part of the save, so it survives reloads, switching slots and export/import of that slot (an exported god save is a code that gives god mode again). It is kept in the slot only; a normal import or a new game never has it.
- The code is public (it is in the source on GitHub Pages), so it is a testing tool, not a secret. `economy.js?v=23`, `saves.js?v=5`, `collection.js?v=40`.
- Verified on a separate origin: status "GOD MODE" for "  God   Mode ", the slot loads with 999,999,999 coins (counter shows 999M), spending 5,000,000 keeps the wallet, using a Grenade / Tomato Juice / snowball removes nothing, Orange Skyr runs and stays at 999, BUFFS and PROJECTILES lists show xINF.

## New buff: Snowy Cube (2026-09-20)

- **Snowy Cube** (`snowy_cube`, `assets/items/snowy_cube.png`): common buff, **coin bonus 1.1x** for **2 minutes**, price **3-5** coins, "Stay frosty geeza." / "Coin bonus: 1.1x." (economy.json only, no code). 1.1x is fair as it is - fractions of a coin carry over (`coinCarry`), so it pays exactly +10% over time; a full common stack (avg 50, hit 16, ~5 throws at 75% hits) earns about 6 extra coins for a price of 4 (the plan's 60% of the return, see `docs/FUTURE_PRICES.md`; Water Bottle, the other common buff, earns about 5 for 3).
- Shop odds: common now has 5 items, so each is 12% (water bottle, snowy cube, chestnut, stone, rowan berry); the rest is unchanged. The picture was in the repo root and moved into `assets/items/`. The item is removed from `docs/future_items.json`. Balance report: all good.
- Verified: the card (name, text, detail, 2:00, common) in BUFFS, USE starts it (timer icon appears top-left, count kept in god mode), the 32x32 picture loads.

## New buff: Mints; god mode tops itself up (2026-09-20)

- **Mints** (`mints`, `assets/items/mints.png`, moved in from the repo root): rare buff, **20% chance not to use up the projectile** for **2 minutes**, price **36-60** (the plan's rare save buff: 60% of the 80 coins a rare stack of 400 gets back), "Hmmm.. I can't read the label." with the bottom line "Save chance: 20%." Best save chance wins (Mints beats a Water Bottle's 10%, they do not add). Rare shop odds: 6 items, so 5% each; common stays 12% each. Removed from `docs/future_items.json`. Verified: card, USE, `Buffs.modifiers()` gives saveProjectile 0.2 by "mints".
- **God mode fills in new items:** a god save is made with 999 of what existed at that moment, so items added later were missing (Mints showed 0). `Economy.fillGod(projectileIds, buffIds)` (called from `Collection.setEconomy`) now gives 999 of every projectile / buff a god save lacks, on every load. Verified by deleting entries from a god save and reloading. `economy.js?v=24`, `collection.js?v=41`.

- **Water Bottle text** (2026-09-20): description is now "Contains hydration. Hydrates." and it has the bottom line "Save chance: 10%." (like Mints and Snowy Cube; economy.json only).

- **Buff bottom lines** (2026-09-20): Triangles "Slows pointer by 20%." (its 0.8x slider speed), Orange Skyr "Shows the hit zone." (the green guide lines; "Marks the sweet spot." was dropped so it can go to a future buff that marks the middle of the green lines); every buff now has one (economy.json only).

## "Doesn't stack." on buffs (2026-09-20)

- Every buff with a **save chance** or a **coin multiplier** (Water Bottle, Mints, Snowy Cube, Kaiser Roll) shows **"Doesn't stack."** under its max time (02:00) in the BUFFS list, at the same distance below it on every card and also while the buff is running (`.pick-nostack` in index.html, `noStack` in `buffRowHtml`; it follows the effect types, so new buffs of these kinds get it automatically). Triangles (slowest slider speed wins) and Orange Skyr / Tomato Juice have none.
- **Behavior change to make the label true:** coin multipliers used to MULTIPLY when several ran together (Kaiser Roll 1.2x + Snowy Cube 1.1x = 1.32x). Now only the **highest** counts (1.2x), like save chances (`Buffs.modifiers`). Verified with Kaiser Roll, Snowy Cube, Mints and Water Bottle running at once: coinMultiplier 1.2, saveProjectile 0.2 by Mints. `buffs.js?v=12`, `collection.js?v=42`. This also means the buff prices in `docs/FUTURE_PRICES.md` (one buff use per stack) hold with several buffs on.

- **"Doesn't stack." moved** (2026-09-20): it is now on the same row as the buff's detail line, in the same style (1u font, the lighter brown) and same baseline, at the right end of the card (`.pick-row.buff-row .pick-nostack`, drawn after the detail in `buffRowHtml`), instead of under the max time. Measured: the same 14 px from the card's bottom as the detail on every card; the two never meet (detail ends at x 550, the label starts at 572). `collection.js?v=43`.

- **Orange Skyr's bottom line** (2026-09-20): "Shows the hit zone." (was "Marks the sweet spot.", kept free for a planned buff that marks the middle of the green lines; economy.json only).

- **Rowan Berry description** (2026-09-20): "Not yummy if you're not a bird." (was "Annoyingly imprecise. Not yummy."; economy.json only).

- **Rowan Berry description, really** (2026-09-20): the PROJECTILES list takes projectile names and descriptions from the hard-coded `CATALOG` in `src/collection.js`, not from economy.json (which only the shop cards use), so the first change (economy.json) did not show there. Both now say "Not yummy if you're not a bird."; changing a projectile's text means editing BOTH files. `collection.js?v=44`. Verified in the PROJECTILES list after a hard reload (the browser had kept the old index.html, and with it `collection.js?v=43`).

## Offset hit zone by tier (2026-09-20)

- **The offset slider's hit zone is now set directly by the weight tier** (`weightTiers[].offsetZone` in economy.json), as a share of the whole bar, centered on the middle and reaching out to both sides: very light **6.25%**, light **12.5%**, moderate **25%**, heavy **50%**, very heavy **100%**. Before, it came from the old weight number (25 / 75 / 100 / 125 / 175) on a line through `aim.offsetZoneAtWeight100`: 12.5% / 37.5% / 50% / 62.5% / 87.5%, so the snowball's zone is halved (50% -> 25%), light 37.5% -> 12.5%, heavy 62.5% -> 50%, very heavy 87.5% -> 100%. `aim.offsetZoneAtWeight100`, `REFERENCE_WEIGHT`, the numeric `p.weight` and `offsetRangeForWeight` are gone; `prepareProjectiles` sets `p.offsetZone`, `takeAimSnapshot` uses `offsetRangeForZone(zone x precision)` (`main.js?v=116`).
- **Zone buffs:** the existing `precision` effect type now reads as "hit zone x value" (1.2 = 20% bigger: 25% -> 30%), clamped at the whole bar (`buffs.js?v=13`, comments only). No buff uses it yet; Triangles is the slower-marker buff (`sliderSpeed`).
- The bar spans +-2.44 / 1.22 / 0.61 / 0.31 / 0.15 swing (very light .. very heavy), so **the snowball and Chestnut (moderate) can now reach W21 sideways** (it needs about +-0.37); before, only very light / light could. Heavy and very heavy still cannot.
- Current projectiles: snowball, Chestnut moderate 25%; Rowan Berry light 12.5% (hardest one in the game now); Stone, Pinecone, Egg, Grenade heavy 50%.
- Verified in the browser: the zone of every projectile matches the table, the x1.2 test gives 25% -> 30% and a very heavy projectile stays at 100%, and on the real aim bar with Orange Skyr the snowball's green lines span 181 of 726 px (25%), centered.
- Balance note: the earlier price plan assumed a 75% hit rate. With the snowball's zone halved and Rowan Berry's at 12.5% that is harder to reach with those two, easier for heavy hitters (Stone, Egg, Grenade need only half the bar).

## Test projectile: Test Boulder (2026-09-20)

- **Test Boulder** (`test_very_heavy`): an infinite projectile with the **very heavy** tier (offset hit zone 100%, strength band 75-100%), hit value 4 (the default rarity), that looks and sounds like the stone (picture `stone.png`, spins, leaves no mark). It is **god mode only**: `projectiles.test_very_heavy.godOnly` in economy.json makes `Collection.isListed` show it only when `Economy.isGod()`, and `applyProjectile` fall back to the snowball if a normal save has it equipped. It is not in the shop and normal saves never see it. To test another tier, change its `weight` (very_light .. very_heavy) in economy.json; for more test projectiles copy the pattern (an economy.json entry with `godOnly`, a `PROJECTILE_VISUALS` line in main.js, a CATALOG entry in collection.js). `main.js?v=117`, `collection.js?v=45`.
- Verified on a test origin: the card in a god save ("weight: very heavy", hit value 4), EQUIP gives tier very_heavy and a zone of 100%; with `god` switched off the list does not show it and a save with it equipped starts on the snowball.

## New buff: Blue Skyr (2026-09-20)

- **Blue Skyr** (`blue_skyr`, `assets/items/skyr_blue.png`): common buff, new effect type **`centerLine`** - ONE green line at the middle of the hit zone on each slider (the middle of the offset bar; the middle of the strength band that hits W20 from the chosen offset), while Orange Skyr's `guideLines` draw the two edges. They are independent (both can run; "Doesn't stack." is not shown because it only labels save chances and coin multipliers). "Improves brain function." / "Shows the sweet spot." (`main.js?v=118`, `buffs.js?v=14`).
- **Price 4-7, 3 minutes** (like Orange Skyr): by the plan's formula (`docs/FUTURE_PRICES.md`) a buff's return on a common stack of 50 is `hit-rate points x 1.6 x 50`; I guessed +8 points for the line (a smaller help than the two edges, which are the rare +15), 1.5 stacks in 3 minutes -> about 9.6, price 60% -> 5.5 average. Balance report: all good. Common shop odds: 6 items, 10% each (Blue Skyr 10%).
- Verified: card, the one green line in the middle of the offset bar and one on the strength bar (test origin); your local god save shows 999 of it after a reload (`fillGod`).

## Buff timers at the top tinted by rarity (2026-09-20)

- The buff cards at the top of the screen (icon + timer) now have a background tint in their buff's **rarity colour** (from economy.json `rarities`: common blue, rare orange, epic purple) at 40% over the old dark backing, set as `--tint` on the card by `tintAttrs` in `buffs.js` (`.buff-card.tinted` in index.html). A **legendary** card (Tomato Juice) gets an animated **rainbow** background instead (`.buff-card.rainbow`): the same waves as `.rarity-rainbow` (`rarity-wave`, 2.4 s) plus a shine - a white glow and brightness that pulse (`buff-card-shine`, 1.7 s). A buff with no rarity keeps the plain look. The rarity colours are read from economy.json, so a colour changed there changes the cards.
- Verified with Tomato Juice, Orange Skyr, Triangles and Water Bottle running: rainbow / orange / orange / blue cards; the rainbow's background position and glow change over time. Not looked at: an epic card (no epic buff exists yet; same code path as the others). `buffs.js?v=15`.

- **Buff card tints more transparent** (2026-09-20): the rarity tint is now 22% (was 40%, `tintAttrs` in `buffs.js`) and the legendary rainbow 32% (was 55%, `.buff-card.rainbow` in index.html); the dark backing, the pulsing glow and the wave are unchanged. `buffs.js?v=16`.

## Common Triangles; both Triangles last 3 minutes (2026-09-20)

- **Triangles (common)** (`triangles_common`, `assets/items/triangles_common.png`): the common sibling of the rare Triangles - the same name "Triangles" and description ("Tasty shapes to make your hand steadier."), but **slows the pointer by 10%** (`sliderSpeed` 0.9), detail "Slows pointer by 10%.". Price **3-5**, **3 minutes**. The rare one (`triangles`, `triangles.png`, 0.8 = 20%) keeps its price 29-48 but now also lasts **3 minutes** (was 2). The two are told apart by **id, picture, rarity and detail only** - the shown name is the same; nothing in the code looks a buff up by its name (always by id), ids and pictures are unique (checked), counts, timers and the top cards are per id. (Named "Blue Triangles" for a moment, renamed at request.)
- **Slowest wins:** both are `sliderSpeed` buffs and only the slowest counts (0.9 alone, both = 0.8, verified), so they now carry the **"Doesn't stack."** label too (`collection.js?v=46`: save chance, coin multiplier and sliderSpeed). The label is tight next to "Slows pointer by 20%." (21 characters).
- Pricing: common return per the plan's formula (`docs/FUTURE_PRICES.md`): +5 points of hit rate x 1.6 x a common stack of 50 = 4 per 2 minutes, 6 per 3, price 60% = 3.6 -> 3-5. Note the rare Triangles' 29-48 was set for 2 minutes (return 64); at 3 minutes the same formula would give about 43-72 (like Orange Skyr), so it is now a cheaper deal - left as it was until decided. Common shop odds: 7 items, 8.6% each (Triangles common 8.6%); rare Triangles 5%.

## Buff stacking (branch `buff-stacking`, 2026-09-20, NOT pushed yet)

- Buffs of the same kind now **stack** (`Buffs.modifiers`, limits in economy.json `buffCaps`): **save chances = independent rolls** (each buff has its own chance, the projectile is used up only if all fail: 10% + 20% = 28%, 10 / 20 / 50 = 64%; at most **75%**), **coin multipliers multiply** (1.1 x 1.2 = 1.32; at most **x2**), **pointer slow-downs multiply** (0.9 x 0.8 = 0.72; never below **0.6**, i.e. at most 40% slower). `saveProjectileBy` (the icon on the "saved" message) is the buff with the highest chance. The "Doesn't stack." label and its CSS are removed. `buffs.js?v=17`, `collection.js?v=47`.
- Verified: none 1 / 0 / 1; Water Bottle + Mints 28%; Snowy Cube + Kaiser Roll 1.32x; both Triangles 0.72; all six real buffs 28% / 1.32x / 0.72; fake buffs: saves 10 / 20 / 50 -> 64%, 10 / 20 / 30 / 50 -> 74.8%, coin multipliers 1.1 / 1.2 / 1.35 / 1.5 (2.67 uncapped) -> 2.0, slow-downs 0.9 / 0.8 / 0.5 -> 0.6. No label in the BUFFS list.

## Stacking, no multiplier / slow-down cap, Triangles slow only the offset slider (branch `buff-stacking`, 2026-09-20, NOT pushed yet)

- **Caps:** the coin multiplier cap (x2) and the slow-down floor (0.6) are removed: coin multipliers multiply without limit, slow-downs multiply without a floor. Only the save chance keeps its cap (75%, `buffCaps.saveProjectile`; the planned 10 / 20 / 50 give 64%, so it does not bite). With the planned ladder the coin multipliers reach 2.67x; every new multiplier item must be checked against the whole stack.
- **Triangles slow only the OFFSET slider:** the effect type `sliderSpeed` is now **`offsetSpeed`** (economy.json, `buffs.js`): `aim.angleMarkerHz` = markerHz x the product of the buffs, `aim.markerHz` (strength) is never slowed. Both Triangles use it (0.8 and 0.9, both together 0.72). Their bottom line: "Slows offset by 20%." / "Slows offset by 10%." (the description "Tasty shapes to make your hand steadier." is unchanged). `main.js?v=119`, `buffs.js?v=18`.
- Verified: modifiers none / one / both Triangles -> offset marker 1.275 / 1.02 / 0.918 Hz, strength marker always 1.275 Hz; on a real aim the offset marker followed the slowed speed and the strength marker followed the normal one; coin multipliers 1.1 / 1.2 / 1.35 / 1.5 -> 2.673 (uncapped); an extra 0.3 slow-down -> 0.216 (no floor).
- Docs: `docs/future_items.json` and `docs/FUTURE_PRICES.md` now have the epic save at **50%** (price 675-1,125) and the legendary as a one-time **free throw** (2,250-3,750, needs a new `freeThrow` mechanic) instead of a 50% save.
- Note: the Triangles prices (rare 29-48, common 3-5) were set when they slowed both sliders; slowing one is worth less, so they are on the generous side for the player (unchanged for now).
