// SNOWY BALLS - core game scene (vertical slice)
// Two-phase aim: freeze the angle pointer, then freeze the power pointer, then the
// snowball launches with those two frozen values driving its trajectory.

// background.png is 704x1000. Pixel-analysis pass (docs/background_annotated.png) found the
// ground/sidewalk line at image-y=660 and the roofline at image-y=17, and gave exact boxes for
// every window - see docs/NOTES.md for the full table. World space below uses "height climbed"
// (0 = ground, growing upward) derived from that image-y via IMG_GROUND_Y - imageY.
const IMG_GROUND_Y = 660;
const IMG_ROOF_Y = 17;
const WORLD_WIDTH = 704; // background.png's own width, used for placing/bounding the image

// Canvas resolution stays sized to roughly the frame the user originally asked for (the
// entrance-doors-and-ground crop). (We tried camera.zoom instead of a smaller canvas - Phaser
// 3.80's WebGL renderer clips world content at the viewport edge when zoom != 1, cutting off a
// strip of the image for no reason tied to scroll/bounds. Shrinking the actual canvas avoids
// that renderer bug entirely.)
const GAME_WIDTH = 432; // exactly 16:9 (432/243)
const GAME_HEIGHT = 243;

const GRAVITY = 900; // px/s^2
const MAX_SWING_SPEED = 180; // px/s horizontal drift at full left/right - needs to reach W21

const ORIGIN_X = (385 + 436) / 2; // 410.5 - centered on W20 (its xFrom/xTo; WINDOWS is defined below)
const ORIGIN_Y = 40; // world height where the character throws from (0 = ground)
const CHARACTER_Y_OFFSET = 20 - 5; // 15 - nudged down 20px, then up 5px, across separate requests (positive = down)
// The top edge of background.png (image y = 0) is world height IMG_GROUND_Y. The camera never
// scrolls past it, and a ball that reaches it has left the building (see updateFlight).
const TOP_BOUNDARY_HEIGHT = IMG_GROUND_Y;

// Resting camera framing: horizontally centered on the character. Vertically, true-centering
// on the character wasted half the frame on plain sidewalk below - instead the ground sits
// near the bottom (small margin for the sidewalk underfoot), leaving most of the frame to show
// the building above, same idea as looking up at it from where you're standing.
// Must be a whole number: a half-pixel camera x (it was 194.5) makes every pixel-snapping
// decision a coin flip, and while the camera climbs, float noise flips it left/right each frame -
// a side-to-side shake of everything the main camera draws (phone-visible, the whole-pixel
// top-left camera was unaffected).
const INITIAL_SCROLL_X = Math.round(ORIGIN_X - GAME_WIDTH / 2);
const INITIAL_SCROLL_Y = -(GAME_HEIGHT - 20);

// The snowball must always stick somewhere between just above the restricted ground/doors zone
// and the roofline - never in the sky, never in the red-marked restricted area (+10px buffer
// above it) from the user's reference image. Restricted zone's top edge was image-y=486;
// converted via IMG_GROUND_Y - imageY, plus the 10px buffer, that's a minimum stick height of
// 184. The roofline (IMG_GROUND_Y - IMG_ROOF_Y = 643) is the maximum. MIN/MAX_POWER_SPEED are
// calibrated so a 0%/100% power throw's apex lands exactly on those two bounds -
// vy0 = sqrt(2 * GRAVITY * height).
const MIN_STICK_HEIGHT = IMG_GROUND_Y - 486 + 10; // 184
// Apex of a full-strength throw of the reference projectile (weight 100, the snowball) with no buffs:
// the middle of the window row above the goal windows (image y 173-216 -> height 660 - 194.5).
// Buffs/lighter projectiles can still push a throw higher - past the roof edge it falls back behind
// the building, past the top of the texture it escapes (see updateFlight).
const MAX_APEX_HEIGHT = IMG_GROUND_Y - (173 + 216) / 2; // 465.5
// A projectile of this weight flies exactly as the constants above say; heavier flies lower, lighter higher
// (see launchBall). The number is per projectile in economy.json ("weight") and never shown to the player.
const REFERENCE_WEIGHT = 100;
// Where the wall ends and the sky starts: background.png rows 0-14 are sky, row 15 is the dark roof
// edge. Nothing can stick above this line - a ball whose apex is higher falls back down and sinks
// behind the roofline instead (see updateFlight), and marks are clipped at it (see addMark).
const ROOF_EDGE_HEIGHT = IMG_GROUND_Y - 15; // 645
const MIN_POWER_SPEED = Math.sqrt(2 * GRAVITY * MIN_STICK_HEIGHT); // ~575.6
const MAX_POWER_SPEED = Math.sqrt(2 * GRAVITY * MAX_APEX_HEIGHT); // ~1200

const ANGLE_HZ = 0.85; // full sweep cycles per second (placeholder feel, tune later)
const POWER_HZ = 0.65;

const MARK_LIFETIME_MS = 10000; // marks start fading this long after they're placed
const MARK_FADE_MS = 1500; // fade-out duration, then the mark is destroyed

// Top-left "rear view camera" - a real second Phaser camera pointed at W20/W21, not a static
// crop, so the live ball/marks show up in it too. Kept at zoom 1 (see the zoom-clipping gotcha
// in docs/NOTES.md) - sized to exactly cover the world region instead of zooming into it.
const TARGET_CAM_X = 6;
const TARGET_CAM_Y = 6;
const TARGET_CAM_MARGIN_X = 8; // world px of breathing room left/right of the windows
const TARGET_CAM_MARGIN_Y = 8; // world px of breathing room above/below the windows
const TARGET_CAM_RADIUS = 8; // corner radius of the live feed and its border
const TARGET_CAM_BORDER_WIDTH = 2; // thickness of the solid-fill border ring around the live feed

// W20 and W21 (see docs/background_annotated.png), converted from image pixels to world
// "height climbed" (IMG_GROUND_Y - imageY). Both sit in the same window row (image y 273-316).
const WINDOWS = [
  { name: "W20", xFrom: 385, xTo: 436, heightFrom: IMG_GROUND_Y - 316, heightTo: IMG_GROUND_Y - 273 },
  { name: "W21", xFrom: 472, xTo: 494, heightFrom: IMG_GROUND_Y - 316, heightTo: IMG_GROUND_Y - 273 },
];

// "Banana window" streak bonus (2026-09-19). goal_window_face.png / goal_window_face_hit.png are
// 54x46 (cropped from the 58x50 exports - the outer 2px grey padding would otherwise paint over
// the wall). They map 1:1 onto the building with NO scaling: the glass area is 52x44 px, exactly
// W20's 52x44 pixel box, and the white frame edge sits 1px outside it, so the image's top-left
// lands 1px up/left of W20 (image-x 384, image-y 272). The face box and left-pane divider were
// found by flood-filling the texture for non-curtain pixels, in cropped-texture pixels.
const W20 = WINDOWS[0];
const FACE_IMG_X = W20.xFrom - 1; // world x of the texture's left edge
const FACE_IMG_TOP_HEIGHT = W20.heightTo + 1; // heightClimbed of the texture's top edge
const FACE_RAW = { xFrom: 1, xTo: 18, yFrom: 28, yTo: 45 }; // face+collar, cropped-texture px
const FACE_RAW_LEFT_DIVIDER_X = 20; // cropped-texture px - where the left pane ends

const BANANA_FACE_BOX = {
  xFrom: FACE_IMG_X + FACE_RAW.xFrom,
  xTo: FACE_IMG_X + FACE_RAW.xTo,
  heightFrom: FACE_IMG_TOP_HEIGHT - FACE_RAW.yTo,
  heightTo: FACE_IMG_TOP_HEIGHT - FACE_RAW.yFrom,
};
const BANANA_LEFT_SECTION_XTO = FACE_IMG_X + FACE_RAW_LEFT_DIVIDER_X;

const BANANA_FADE_MS = 350; // "quickly fade/change" - texture transitions
const MARK_QUICK_FADE_MS = 300; // faster than the normal MARK_FADE_MS, for the banana-tied clears

// What each equippable projectile LOOKS and SOUNDS like (texture / sound keys from preload). Its
// gameplay numbers (aim range/speed, coin multiplier, mark or bounce, spin) live in economy.json
// under "projectiles", keyed by the same id. Character sprites that aren't listed fall back to the
// normal ones - there is no chestnut "throwing" sprite yet, so that pose uses the plain one.
const PROJECTILE_VISUALS = {
  snowball: {
    ball: "snowball",
    sprites: { idle: "char_idle", aiming: "char_aiming", throwing: "char_throwing" },
    impactSound: "snowball_impact",
    impactVolume: 0.3, // halved from 0.6
  },
  chestnut: {
    ball: "chestnut",
    sprites: { idle: "char_idle_chestnut", aiming: "char_aiming_chestnut", throwing: "char_throwing" },
    impactSound: "chestnut_impact",
    impactVolume: 0.5,
  },
};
const SPIN_RATE = 14; // rad/s, a spinning projectile (~2.2 turns a second)
const BOUNCE_OFF_SPEED = 90; // px/s a bouncing projectile is kicked away from where it hit
const BOUNCE_POP_SPEED = 130; // px/s upward pop of that bounce
const BOUNCE_RESTITUTION = 0.35; // how much speed it keeps when it lands on the ground

const STATE = {
  IDLE: "idle",
  AIM_ANGLE: "aim_angle",
  AIM_POWER: "aim_power",
  FLIGHT: "flight",
  RESULT: "result",
};

function pingPong(t) {
  const cycle = t % 2;
  return cycle <= 1 ? cycle : 2 - cycle;
}

class MainScene extends Phaser.Scene {
  constructor() {
    super("main");
  }

  preload() {
    this.load.image("background", "assets/building/background.png?v=2");
    this.load.image("snowball", "assets/snowball/snowball.png");
    this.load.image("snowball_mark", "assets/snowball/snowball_mark.png");
    this.load.image("goal_window_face", "assets/building/goal_window_face.png");
    this.load.image("goal_window_face_hit", "assets/building/goal_window_face_hit.png");
    this.load.image("char_idle", "assets/character/character1_idle.png");
    this.load.image("char_aiming", "assets/character/character1_aiming.png");
    this.load.image("char_throwing", "assets/character/character1_throwing.png");
    this.load.image("chestnut", "assets/snowball/chestnut.png");
    this.load.image("char_idle_chestnut", "assets/character/character1_idle_chestnut.png?v=2");
    this.load.image("char_aiming_chestnut", "assets/character/character1_aiming_chestnut.png");
    // Timestamp so an edited economy.json is never served from a stale browser/CDN cache.
    this.load.json("economy", "economy.json?t=" + Date.now());
    this.load.audio("theme", "assets/audio/theme.mp3?v=2");
    this.load.audio("throw_whoosh", "assets/audio/throw_whoosh.mp3");
    this.load.audio("snowball_impact", "assets/audio/snowball_impact.mp3");
    this.load.audio("window_clink", "assets/audio/window_clink.mp3");
    this.load.audio("click", "assets/audio/click.mp3");
    this.load.audio("shop_restock", "assets/audio/shop_restock.mp3?v=2");
    this.load.audio("chestnut_impact", "assets/audio/chestnut_impact.mp3");
  }

  create() {
    // Rewards/prices live in economy.json (edit that, not the code). A typo there would otherwise
    // fail silently later, so say so loudly right away.
    this.eco = this.cache.json.get("economy");
    if (!this.eco) throw new Error("economy.json failed to load or has a JSON syntax error - check it.");
    Shop.init(this.eco);

    this.state = STATE.IDLE;
    this.streak = 0;
    this.angleValue = 0.5;
    this.powerValue = 0.5;
    this.flightTime = 0;

    // Generous bounds so a fixed scrollX/scrollY never gets clamped/reinterpreted -
    // we don't horizontally follow the ball, so there's nothing that actually needs
    // constraining on the X axis.
    this.cameras.main.setBounds(
      -WORLD_WIDTH,
      -TOP_BOUNDARY_HEIGHT,
      WORLD_WIDTH * 3,
      TOP_BOUNDARY_HEIGHT + GAME_HEIGHT
    );
    this.cameras.main.setBackgroundColor("#65bfd5");
    this.cameras.main.scrollX = INITIAL_SCROLL_X;
    this.cameras.main.scrollY = INITIAL_SCROLL_Y;

    // background.png's own row IMG_GROUND_Y lines up with world height 0 (the ground):
    // image pixel row r sits at Phaser y = -IMG_GROUND_Y + r, so placing the top-left origin
    // at y = -IMG_GROUND_Y puts row IMG_GROUND_Y exactly at y = 0.
    this.bgImage = this.add.image(0, -IMG_GROUND_Y, "background").setOrigin(0, 0);

    this.drawCharacter();

    this.marks = []; // stuck-snowball sprites; each one schedules its own fade-out in addMark()

    // Sits over W20, invisible until the banana event triggers - see startBananaEvent().
    this.bananaOverlay = this.add
      .image(FACE_IMG_X, this.worldY(FACE_IMG_TOP_HEIGHT), "goal_window_face")
      .setOrigin(0, 0); // native size, 1:1 with the wall - no scaling
    this.bananaOverlay.setDepth(1); // above the building, below marks/ball
    this.bananaOverlay.setAlpha(0);
    this.bananaOverlay.setVisible(false);
    this.bananaActive = false;
    this.bananaHitTriggered = false;

    this.ball = this.add.image(ORIGIN_X, this.worldY(ORIGIN_Y), "snowball");
    this.ball.setDisplaySize(16, 16);
    this.ball.setDepth(10);
    this.ball.setVisible(false); // only shown mid-flight - see launchBall/finishThrow

    // Everything above the roof edge: a ball falling back behind the building is masked to this shape,
    // so it sinks behind the roofline at any rotation (see updateFlight).
    const roofShape = this.make.graphics({ x: 0, y: 0, add: false });
    roofShape.fillStyle(0xffffff);
    roofShape.fillRect(-4000, -4000, 8000, 4000 + this.worldY(ROOF_EDGE_HEIGHT));
    this.roofMask = new Phaser.Display.Masks.GeometryMask(this, roofShape);

    this.bounce = null; // a projectile bouncing off the wall after impact (see startBounce)
    this.pendingProjectile = null; // equipped mid-flight, applied when the throw concludes
    this.applyProjectile(Economy.getEquipped("projectile"));

    // Aim HUD (screen-space, ignores camera scroll).
    this.aimGfx = this.add.graphics().setScrollFactor(0).setDepth(20);

    this.createTargetCamera();

    // Master volume default - a single place to change the overall level later (e.g. once a
    // volume slider exists), rather than every individual sound.play() call.
    this.sound.volume = 0.5;

    // Loops forever so the theme doesn't just play once and go silent - it's a few minutes
    // long, not actually infinite on its own.
    this.startThemeMusic();

    // Mobile-only from here on - no keyboard control, tap is the only input.
    this.input.on("pointerdown", () => this.handleFreezeInput());

    this.showMessage("TAP to aim");
    this.setupFpsReadout();
  }

  // Makes `id` the projectile in use: the ball texture, the character sprites and every gameplay
  // number (aim range/speed, coin multiplier, mark vs bounce, spin) follow from it. Anything unknown
  // or not owned falls back to the snowball.
  applyProjectile(id) {
    const known = PROJECTILE_VISUALS[id] && this.eco.projectiles && this.eco.projectiles[id];
    const owned = id === "snowball" || Economy.getShopState().owned.includes(id);
    if (!known || !owned) {
      id = "snowball"; // the default
      if (Economy.getEquipped("projectile") !== id) Economy.setEquipped("projectile", id); // keep the save honest
    }
    this.projectileId = id;
    this.proj = this.eco.projectiles[id];
    this.projVisuals = PROJECTILE_VISUALS[id];
  }

  // Called by the PROJECTILES list when the player equips something.
  //  - aiming: the aim is thrown away (different aim range/speed) and we go back to "TAP to aim"
  //  - mid-flight: the current throw (its result, bounce and message) finishes with the old projectile;
  //    the new one applies when the game goes back to "TAP to aim" (see resetForNextThrow)
  //  - otherwise: applies immediately
  onProjectileEquipped(id) {
    if (this.state === STATE.FLIGHT) {
      this.pendingProjectile = id;
      return;
    }
    this.pendingProjectile = null;
    this.applyProjectile(id);
    if (this.state === STATE.AIM_ANGLE || this.state === STATE.AIM_POWER) {
      this.state = STATE.IDLE;
      this.showMessage("TAP to aim");
    }
  }

  // Diagnostic only: open the game with ?fps on the URL to show live frame stats (helps track
  // down phone-only jitter). Shows fps, the slowest frame in the last second, and the slowest
  // frame seen during the most recent throw's flight.
  setupFpsReadout() {
    this.fpsEl = null;
    if (window.location.search.indexOf("fps") === -1) return;
    const el = document.createElement("div");
    el.style.cssText =
      "position:absolute;left:4px;bottom:4px;z-index:9;color:#0f0;background:rgba(0,0,0,.6);" +
      "font:10px monospace;padding:2px 4px;pointer-events:none;white-space:pre";
    document.getElementById("game-container").appendChild(el);
    this.fpsEl = el;
    this.fpsWorst = 0;
    this.flightWorst = 0;
    this.fpsWindowStart = 0;
  }

  updateFpsReadout(time, delta) {
    if (!this.fpsEl) return;
    this.fpsWorst = Math.max(this.fpsWorst, delta);
    if (this.state === STATE.FLIGHT) this.flightWorst = Math.max(this.flightWorst, delta);
    if (time - this.fpsWindowStart > 1000) {
      this.fpsEl.textContent =
        "fps " + this.game.loop.actualFps.toFixed(0) +
        "\nworst frame " + this.fpsWorst.toFixed(0) + "ms" +
        "\nworst in last flight " + this.flightWorst.toFixed(0) + "ms";
      this.fpsWorst = 0;
      this.fpsWindowStart = time;
    }
  }

  // Top-left "rear view camera": a real second Phaser camera aimed at the W20/W21 patch of the
  // building, rendering the same live world (background, ball, marks) as the main camera - not
  // a static crop, so a snowball flying past or a mark landing there actually shows up in it.
  createTargetCamera() {
    const [w20, w21] = WINDOWS;
    const worldXFrom = w20.xFrom - TARGET_CAM_MARGIN_X;
    const worldXTo = w21.xTo + TARGET_CAM_MARGIN_X;
    const heightFrom = w20.heightFrom - TARGET_CAM_MARGIN_Y;
    const heightTo = w20.heightTo + TARGET_CAM_MARGIN_Y;
    const viewW = worldXTo - worldXFrom;
    const viewH = heightTo - heightFrom;

    // Border: a single solid white rounded rect, TARGET_CAM_BORDER_WIDTH bigger than the camera
    // on every side. The camera (opaque, rendered on top, inset by that same width) covers
    // everything except that ring, which reads as a clean solid border - no stroke involved.
    // (A stroked rounded rect at this small a radius renders as a broken/dotted line in this
    // Phaser version's WebGL renderer - two solid fills sidestep that entirely.)
    const bezel = this.add.graphics().setScrollFactor(0).setDepth(19);
    bezel.fillStyle(0xffffff, 1);
    bezel.fillRoundedRect(
      TARGET_CAM_X - TARGET_CAM_BORDER_WIDTH,
      TARGET_CAM_Y - TARGET_CAM_BORDER_WIDTH,
      viewW + TARGET_CAM_BORDER_WIDTH * 2,
      viewH + TARGET_CAM_BORDER_WIDTH * 2,
      TARGET_CAM_RADIUS
    );

    this.targetCam = this.cameras.add(TARGET_CAM_X, TARGET_CAM_Y, viewW, viewH);
    this.targetCam.setBackgroundColor(0x65bfd5);
    this.targetCam.scrollX = worldXFrom;
    this.targetCam.scrollY = this.worldY(heightTo);
    this.targetCam.roundPixels = true;

    // Real rounded corners on the live feed itself via a geometry mask - the mask graphics is
    // never added to the display list (addToScene = false), it exists purely to supply the clip
    // shape, redrawn from its command buffer each frame, so a reference has to be kept alive on
    // `this` or it'd be garbage collected.
    this.targetCamMaskShape = this.make.graphics({ x: 0, y: 0 }, false);
    this.targetCamMaskShape.fillStyle(0xffffff);
    this.targetCamMaskShape.fillRoundedRect(TARGET_CAM_X, TARGET_CAM_Y, viewW, viewH, TARGET_CAM_RADIUS);
    this.targetCam.setMask(this.targetCamMaskShape.createGeometryMask());

    // The PIP should only show world content - it'd otherwise also try to render the
    // screen-space HUD (which is scrollFactor(0), so it'd appear squeezed into this tiny
    // viewport too) and its own bezel (drawn by the main camera, one layer behind it).
    this.targetCam.ignore([this.aimGfx, bezel]);
  }

  // Theme music. `loop: true` handles the normal loop; on phones the audio context can get
  // suspended (backgrounding, Safari) and leave the theme silent, so also resume it and replay
  // if needed whenever the player returns to the tab or taps - event-driven, no polling.
  startThemeMusic() {
    this.theme = this.sound.add("theme", { loop: true, volume: 0.5 });
    this.theme.play();

    const ensurePlaying = () => {
      const ctx = this.sound.context;
      if (ctx && (ctx.state === "suspended" || ctx.state === "interrupted")) ctx.resume().catch(() => {});
      if (!document.hidden && !this.sound.locked && !this.theme.isPlaying && !this.theme.isPaused) {
        this.theme.play();
      }
    };
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) ensurePlaying();
    });
    this.input.on("pointerdown", ensurePlaying);
  }

  worldY(heightFromGround) {
    // Phaser y grows downward; our "height climbed" grows upward.
    return -heightFromGround;
  }

  // Character sprite (64x64 frames, feet at the bottom edge). Pose follows game state - see
  // updateCharacterPose().
  drawCharacter() {
    const baseY = this.worldY(0) + CHARACTER_Y_OFFSET;
    this.character = this.add.image(Math.round(ORIGIN_X), baseY + 1, "char_idle").setOrigin(0.5, 1);
    this.character.setDepth(2);
  }

  updateCharacterPose() {
    const sprites = this.projVisuals.sprites; // the equipped projectile's set (chestnut in hand, etc.)
    let key = sprites.idle;
    if (this.state === STATE.AIM_ANGLE || this.state === STATE.AIM_POWER) key = sprites.aiming;
    else if (this.state === STATE.FLIGHT && this.flightTime < 0.35) key = sprites.throwing;
    if (this.character.texture.key !== key) this.character.setTexture(key);
  }

  handleFreezeInput() {
    // Belt and braces: never advance the throw while the shop or a list covers the game.
    const cls = document.getElementById("game-container").classList;
    if (cls.contains("shop-open") || cls.contains("list-open")) return;
    if (this.state === STATE.IDLE) {
      this.state = STATE.AIM_ANGLE;
      this.aimStartTime = this.time.now;
      this.showMessage("");
    } else if (this.state === STATE.AIM_ANGLE) {
      this.state = STATE.AIM_POWER;
      this.aimStartTime = this.time.now;
    } else if (this.state === STATE.AIM_POWER) {
      this.launchBall();
    } else if (this.state === STATE.RESULT) {
      this.resetForNextThrow();
    }
  }

  launchBall() {
    this.state = STATE.FLIGHT;
    this.flightTime = 0;

    const swing = (this.angleValue - 0.5) * 2; // -1..1
    this.ballVX = swing * MAX_SWING_SPEED;
    // Same throw strength, different weight: the apex scales with REFERENCE_WEIGHT / weight (weight 80 flies
    // 25% higher than the snowball, weight 125 would fly 20% lower). Never below the lowest allowed stick
    // height, so a heavy projectile can't end up in the restricted ground zone.
    const apexScale = REFERENCE_WEIGHT / (this.proj.weight || REFERENCE_WEIGHT);
    this.ballVY0 = Math.max(
      MIN_POWER_SPEED,
      (MIN_POWER_SPEED + this.powerValue * (MAX_POWER_SPEED - MIN_POWER_SPEED)) * Math.sqrt(apexScale)
    );
    this.ballStartX = ORIGIN_X;
    this.apexTime = this.ballVY0 / GRAVITY; // the snowball sticks to the wall here - see updateFlight
    // An apex above the roof edge would be a stick in the sky: that ball doesn't stick, it falls back.
    this.fallsBehind = (this.ballVY0 * this.ballVY0) / (2 * GRAVITY) > ROOF_EDGE_HEIGHT;
    this.cameraFollowing = true;
    this.bounce = null;
    this.ball.setTexture(this.projVisuals.ball);
    this.ball.setDisplaySize(16, 16);
    this.ball.clearMask(); // in front of the wall until (and unless) it falls back behind the roof
    this.ball.setRotation(0);
    this.ball.setAlpha(1);
    this.ball.setVisible(true);
    this.flightWorst = 0;
    this.sound.play("throw_whoosh", { volume: 0.6 });
  }

  updateFlight(dt) {
    this.flightTime += dt;
    const reachedApex = this.flightTime >= this.apexTime;
    // Normally the flight freezes at the apex (the ball sticks there); a ball that fell behind the
    // roof keeps following its arc back down.
    const t = reachedApex && !this.fallsBehind ? this.apexTime : this.flightTime;

    const x = this.ballStartX + this.ballVX * t;
    const heightClimbed = this.ballVY0 * t - 0.5 * GRAVITY * t * t;
    const y = this.worldY(heightClimbed);
    this.ball.setPosition(x, y);
    if (this.proj.spins) this.ball.setRotation(t * SPIN_RATE); // stops turning at the apex, where it hits the wall

    if (this.cameraFollowing) {
      const targetScrollY = y - GAME_HEIGHT * 0.6;
      // Frame-rate independent smoothing: a fixed per-frame fraction (the old 0.12) moves the
      // camera by different amounts on uneven frames, which reads as the whole screen shaking.
      const follow = 1 - Math.exp(-14 * dt);
      // Never show anything above the top of the texture.
      const clampedTarget = Math.max(targetScrollY, -TOP_BOUNDARY_HEIGHT);
      // Whole pixels only, like scrollX: a fractional scrollY that creeps toward the top limit
      // (-659.99 ... -660) made the whole picture snap down 1px at the very end, which read as the
      // camera jumping (worst right after the apex of a ball that falls back behind the roof).
      // The min 1px step keeps the rounding from stalling the camera a couple of pixels short.
      const cam = this.cameras.main;
      const cur = Math.round(cam.scrollY);
      const goal = Math.round(clampedTarget);
      let next = Math.round(Phaser.Math.Linear(cur, clampedTarget, follow));
      if (next === cur && cur !== goal) next = cur + Math.sign(goal - cur);
      cam.scrollY = next;
    }

    // Flew out through the top of the building: no wall to stick to, so end the throw right
    // here as if it had landed (camera goes back to the character via the normal result flow).
    if (heightClimbed >= TOP_BOUNDARY_HEIGHT) {
      this.finishThrow(false, null, x, heightClimbed, false, true);
      return;
    }

    if (!reachedApex) return;

    if (this.fallsBehind) {
      // Coming down past the roof: everything below the roof edge is behind the building, so mask the
      // ball to the part above it (works at any rotation). Once it's fully hidden the throw is over -
      // a miss with no mark or impact.
      if (!this.ball.mask) this.ball.setMask(this.roofMask);
      if (y - this.ball.displayHeight / 2 >= this.worldY(ROOF_EDGE_HEIGHT)) {
        this.finishThrow(false, null, x, heightClimbed, false, true);
      }
      return;
    }

    // The snowball always sticks to the wall at the top of its arc - a hit only counts if
    // that exact point lands inside W20 or W21.
    for (const win of WINDOWS) {
      if (x >= win.xFrom && x <= win.xTo && heightClimbed >= win.heightFrom && heightClimbed <= win.heightTo) {
        const faceHit =
          this.bananaActive &&
          !this.bananaHitTriggered &&
          win === W20 &&
          x >= BANANA_FACE_BOX.xFrom &&
          x <= BANANA_FACE_BOX.xTo &&
          heightClimbed >= BANANA_FACE_BOX.heightFrom &&
          heightClimbed <= BANANA_FACE_BOX.heightTo;
        this.finishThrow(true, win, x, heightClimbed, faceHit);
        return;
      }
    }

    this.finishThrow(false, null, x, heightClimbed, false);
  }

  // A projectile that leaves no mark hits the wall at its apex, glances off further the way it was
  // thrown (right stays right, left stays left) with a little pop upward, then falls, hops on the ground and settles - all while the result shows. It is
  // purely visual: the hit/miss and the coins were already decided at the moment of impact.
  startBounce(x, heightClimbed) {
    const dir = this.ballVX > 1 ? 1 : this.ballVX < -1 ? -1 : Math.random() < 0.5 ? -1 : 1; // thrown straight: either way
    this.bounce = {
      x,
      h: heightClimbed,
      vx: dir * (BOUNCE_OFF_SPEED + 0.3 * Math.abs(this.ballVX)),
      vh: BOUNCE_POP_SPEED,
      spin: dir,
      resting: false,
    };
  }

  updateBounce(dt) {
    const b = this.bounce;
    if (!b || b.resting) return;
    b.vh -= GRAVITY * dt;
    b.h += b.vh * dt;
    b.x += b.vx * dt;
    const GROUND_CONTACT = 8; // ball radius: it rests on the ground, not in it
    if (b.h <= GROUND_CONTACT && b.vh < 0) {
      b.h = GROUND_CONTACT;
      b.vh = -b.vh * BOUNCE_RESTITUTION;
      b.vx *= 0.6;
      if (b.vh < 40) b.resting = true;
    }
    this.ball.setPosition(b.x, this.worldY(b.h));
    if (this.proj.spins && !b.resting) this.ball.setRotation(this.ball.rotation + b.spin * SPIN_RATE * dt);
  }

  addMark(x, heightClimbed) {
    const mark = this.add.image(x, this.worldY(heightClimbed), "snowball_mark");
    mark.setDisplaySize(20, 20);
    mark.setDepth(5); // above the building, below the live ball (depth 10)
    // A mark stuck right under the roof must not overhang into the sky: clip off the part above the roof edge.
    const overhang = this.worldY(ROOF_EDGE_HEIGHT) - (mark.y - mark.displayHeight / 2);
    if (overhang > 0) {
      const cut = Math.min(mark.frame.height, (overhang / mark.displayHeight) * mark.frame.height);
      mark.setCrop(0, cut, mark.frame.width, mark.frame.height - cut);
    }
    this.marks.push(mark);

    // Starts fading MARK_LIFETIME_MS after it's placed, regardless of what the camera's doing -
    // a smooth fade doesn't have the "vanished while I was looking" problem a hard cull did.
    // Kept on the mark itself (not just a local var) so an early trigger (banana event start,
    // a face hit) can cancel this normal-lifetime timer before it fires.
    mark.fadeTimer = this.time.delayedCall(MARK_LIFETIME_MS, () => this.fadeAndRemoveMark(mark, MARK_FADE_MS));
    return mark;
  }

  // Tweens a mark's alpha to 0 over `duration`, then destroys it and drops it from this.marks.
  // Shared by the normal 10s lifetime fade and the two "quickly fade out" banana-event cases.
  fadeAndRemoveMark(mark, duration) {
    if (!mark.active) return; // already mid-fade or destroyed
    this.tweens.add({
      targets: mark,
      alpha: 0,
      duration,
      onComplete: () => {
        mark.destroy();
        const idx = this.marks.indexOf(mark);
        if (idx !== -1) this.marks.splice(idx, 1);
      },
    });
  }

  finishThrow(hit, win, stickX, stickHeight, faceHit, escaped) {
    this.state = STATE.RESULT;
    this.cameraFollowing = false;
    // An escaped ball never touched the wall: no mark, no bounce, no impact sound.
    // Otherwise the projectile either leaves a mark (the ball disappears into it) or, if it leaves
    // none (chestnut), stays visible and bounces off the wall.
    let mark = null;
    if (!escaped && this.proj.leavesMark) {
      mark = this.addMark(stickX, stickHeight);
      this.ball.setVisible(false); // the mark now represents where it stuck
    } else if (!escaped) {
      this.startBounce(stickX, stickHeight);
    } else {
      this.ball.setVisible(false);
    }
    if (!escaped) this.sound.play(this.projVisuals.impactSound, { volume: this.projVisuals.impactVolume });

    if (hit) {
      this.streak += 1;
      let coins = this.eco.rewards.windows[win.name];
      const streakBonus = Math.floor(coins * this.eco.rewards.streakBonusPerLevel * (this.streak - 1));
      coins += streakBonus;

      if (faceHit) {
        this.bananaHitTriggered = true;
        coins += this.eco.events.faceWindow.faceBonusCoins;
        this.triggerBananaHit(mark);
      }

      // Projectile handicap/bonus (economy.json "projectiles"), rounded down, on the whole payout.
      coins = Math.floor(coins * this.proj.coinMultiplier);

      const message = "HIT\n+" + coins + " coins" + (this.streak > 1 ? "\nstreak x" + this.streak : "");
      Economy.addCoins(coins);
      Economy.reportStreak(this.streak);
      this.showMessage(message);
    } else {
      this.streak = 0;
      if (this.eco.rewards.missCoins) Economy.addCoins(this.eco.rewards.missCoins);
      this.showMessage("MISS\nstreak reset");
    }

    this.maybeStartRandomEvent();

    this.time.delayedCall(1400, () => {
      if (this.state === STATE.RESULT) this.resetForNextThrow();
    });
  }

  // True while any timed event is running. Only the face window exists so far - add every new event
  // here, so two events never overlap.
  isEventActive() {
    return this.bananaActive;
  }

  // After every throw (hit, miss or escape) roll for a random event - but never while one is running.
  // Chance per event is in economy.json (events.faceWindow.chancePerThrow, 0.01 = 1%).
  maybeStartRandomEvent() {
    if (this.isEventActive()) return;
    if (Math.random() < this.eco.events.faceWindow.chancePerThrow) this.startBananaEvent();
  }

  // Random face-window event (1% chance after each throw): swaps W20's texture to the banana art for events.faceWindow.durationMs, then fades
  // back on its own. Any existing marks on W20's left section fade out quickly first, so they
  // don't look like they're stuck to a texture that's about to change out from under them.
  startBananaEvent() {
    this.bananaActive = true;
    this.bananaHitTriggered = false;

    for (const mark of this.marks.slice()) {
      const heightClimbed = -mark.y;
      if (
        mark.x >= W20.xFrom &&
        mark.x <= BANANA_LEFT_SECTION_XTO &&
        heightClimbed >= W20.heightFrom &&
        heightClimbed <= W20.heightTo
      ) {
        if (mark.fadeTimer) mark.fadeTimer.remove();
        this.fadeAndRemoveMark(mark, MARK_QUICK_FADE_MS);
      }
    }

    this.bananaOverlay.setTexture("goal_window_face");
    this.bananaOverlay.setVisible(true);
    this.tweens.add({ targets: this.bananaOverlay, alpha: 1, duration: BANANA_FADE_MS });

    this.bananaEndTimer = this.time.delayedCall(this.eco.events.faceWindow.durationMs, () => this.endBananaEvent());
  }

  // Normal 20s expiry - fades the banana texture back to nothing (the real W20 art underneath
  // was never actually touched, this overlay just sits on top of it).
  endBananaEvent() {
    this.bananaActive = false;
    this.tweens.add({
      targets: this.bananaOverlay,
      alpha: 0,
      duration: BANANA_FADE_MS,
      onComplete: () => this.bananaOverlay.setVisible(false),
    });
  }

  // Hitting the face: cancels the pending 20s revert, quickly swaps to goal_window_face_hit,
  // then after events.faceWindow.hitRevertMs fades both the texture and the mark that triggered it back
  // to nothing together.
  triggerBananaHit(mark) {
    if (this.bananaEndTimer) this.bananaEndTimer.remove();
    if (mark && mark.fadeTimer) mark.fadeTimer.remove();

    this.bananaOverlay.setTexture("goal_window_face_hit");
    this.bananaOverlay.setAlpha(1);

    this.time.delayedCall(this.eco.events.faceWindow.hitRevertMs, () => {
      this.tweens.add({
        targets: mark ? [this.bananaOverlay, mark] : [this.bananaOverlay],
        alpha: 0,
        duration: BANANA_FADE_MS,
        onComplete: () => {
          this.bananaOverlay.setVisible(false);
          this.bananaActive = false;
          if (mark && mark.active) {
            mark.destroy();
            const idx = this.marks.indexOf(mark);
            if (idx !== -1) this.marks.splice(idx, 1);
          }
        },
      });
    });
  }

  resetForNextThrow() {
    this.state = STATE.IDLE;
    this.bounce = null;
    this.ball.setVisible(false); // a bouncing projectile is done by now
    this.ball.setPosition(ORIGIN_X, this.worldY(ORIGIN_Y));
    if (this.pendingProjectile) {
      // equipped mid-flight: the throw is over, switch now
      this.applyProjectile(this.pendingProjectile);
      this.pendingProjectile = null;
    }
    this.tweens.add({
      targets: this.cameras.main,
      scrollY: INITIAL_SCROLL_Y,
      duration: 500,
      ease: "Sine.easeInOut",
    });
    this.showMessage("TAP to aim");
  }

  showMessage(msg) {
    // Text lives in HTML now (see index.html #message), not as a Phaser Text object - canvas
    // text at this resolution renders as blurry upscaled pixels, an HTML element with a real
    // web font doesn't.
    document.getElementById("message").textContent = msg;
  }

  drawAimBar() {
    const g = this.aimGfx;
    g.clear();
    if (this.state !== STATE.AIM_ANGLE && this.state !== STATE.AIM_POWER) return;

    const barX = 20;
    const barY = GAME_HEIGHT - 20;
    const barW = GAME_WIDTH - 40;
    const barH = 8;

    // The offset (angle) bar is drawn as long as the projectile's angleRange says, centered - the chestnut
    // gets a bar 20% shorter, and its marker runs edge to edge of it. The power bar is always full length.
    const angleBar = this.state === STATE.AIM_ANGLE;
    const trackW = angleBar ? barW * this.proj.angleRange : barW;
    const trackX = barX + (barW - trackW) / 2;

    g.fillStyle(0x000000, 0.4);
    g.fillRect(trackX, barY, trackW, barH);

    const value = this.state === STATE.AIM_ANGLE ? this.angleValue : this.powerValue;
    const color = this.state === STATE.AIM_ANGLE ? 0x6fb1ff : 0xff6f6f;
    g.fillStyle(color, 1);
    const markerX = barX + value * barW;
    g.fillRect(markerX - 2, barY - 4, 4, barH + 8);

    g.lineStyle(1, 0xffffff, 0.6);
    g.strokeRect(trackX, barY, trackW, barH);
  }

  update(time, delta) {
    // Cap the step so one long frame (audio start, GC, a busy phone GPU) can't make the ball
    // and the camera chasing it jump - time just runs slightly slow for that frame instead.
    const dt = Math.min(delta / 1000, 1 / 30);

    if (this.state === STATE.AIM_ANGLE) {
      const elapsed = (time - this.aimStartTime) / 1000;
      // angleRange squeezes the marker's travel toward the middle of the bar (its edge positions),
      // angleSpeed scales how fast the marker moves. The sweep rate is divided by the range so the
      // marker's speed along the bar is exactly angleSpeed x normal.
      const p = this.proj;
      this.angleValue = 0.5 + (pingPong((elapsed * ANGLE_HZ * p.angleSpeed) / p.angleRange) - 0.5) * p.angleRange;
    } else if (this.state === STATE.AIM_POWER) {
      const elapsed = (time - this.aimStartTime) / 1000;
      this.powerValue = pingPong(elapsed * POWER_HZ);
    } else if (this.state === STATE.FLIGHT) {
      this.updateFlight(dt);
    }
    this.updateBounce(dt);

    this.updateCharacterPose();
    this.updateFpsReadout(time, delta);
    this.drawAimBar();
  }
}

const config = {
  type: Phaser.AUTO,
  parent: "game-container",
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  pixelArt: true,
  roundPixels: true,
  backgroundColor: "#000000",
  // Canvas size is done in CSS: #game-container is an exact 16:9 box and the canvas fills it.
  // Phaser's FIT measured the container once at launch, and in an iPhone home-screen app that
  // measurement can be wrong (canvas came out ~2.3x too big, cropping the picture) - CSS can't be.
  scale: { mode: Phaser.Scale.NONE },
  scene: [MainScene],
};

window.addEventListener("load", () => {
  const game = new Phaser.Game(config);
  window.snowyBallsGame = game; // used by the HTML mute button (index.html) and driven tests
});
