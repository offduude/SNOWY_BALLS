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

- **Mechanic**: buying empties the slot ("SOLD OUT" + countdown) for `shop.restockSeconds` (economy.json; **60 for testing - set to 3600 for the real hour**). The card style is unchanged; the sold-out card just gets a `.shop-timer` line under the text (`m:ss`, or `h:mm:ss` once it's over an hour).
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
