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
// 184. The roofline (IMG_GROUND_Y - IMG_ROOF_Y = 643) is the maximum. The strength curve below is built on
// these bounds (vy0 = sqrt(2 * GRAVITY * height)).
const MIN_STICK_HEIGHT = IMG_GROUND_Y - 486 + 10; // 184
// Apex of a full-strength throw of the reference projectile (weight 100, the snowball) with no buffs:
// the middle of the window row above the goal windows (image y 173-216 -> height 660 - 194.5).
// Buffs/lighter projectiles can still push a throw higher - past the roof edge it falls back behind
// the building, past the top of the texture it escapes (see updateFlight).
const MAX_APEX_HEIGHT = IMG_GROUND_Y - (173 + 216) / 2; // 465.5
// The snowball's weight - the reference all other weights are measured against (economy.json "weight", never
// shown to the player as a number). See the "weight" section below for what a weight does.
const REFERENCE_WEIGHT = 100;
// Where the wall ends and the sky starts: background.png rows 0-14 are sky, row 15 is the dark roof
// edge. Nothing can stick above this line - a ball whose apex is higher falls back down and sinks
// behind the roofline instead (see updateFlight), and marks are clipped at it (see addMark).
const ROOF_EDGE_HEIGHT = IMG_GROUND_Y - 15; // 645

// Marker speed (full back-and-forth sweeps per second) - the numbers live in economy.json under "aim".
// ONE fixed speed for both sliders - nothing (streak, buffs, projectiles) changes it.
const AIM_DEFAULTS = { markerHz: 1.275, offsetZoneAtWeight100: 0.5 };

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
// Offset (angle) swing, as a share of the full -1..1 range, that is GUARANTEED to land inside W20's width for
// any throw whose apex is inside W20's height band. The ball drifts sideways for the whole flight, so the
// sideways offset is swing x MAX_SWING_SPEED x apexTime, and the longest flight that still hits W20 is the
// one that peaks at its top edge (apexTime = sqrt(2 x height / gravity)). The aim bar marks +-this with
// two lines (see drawAimBar). It depends on the window and the physics only, not on the projectile.
const W20_SWING_GUARANTEE =
  Math.min(ORIGIN_X - W20.xFrom, W20.xTo - ORIGIN_X) / (MAX_SWING_SPEED * Math.sqrt((2 * W20.heightTo) / GRAVITY));
const AIM_COLOR_ANGLE = 0x6fb1ff; // the offset marker - and the "OFFSET" label above the bar
const AIM_COLOR_POWER = 0xff6f6f; // the strength marker - and the "STRENGTH" label
const AIM_COLOR_ANGLE_CSS = "#6fb1ff";
const AIM_COLOR_POWER_CSS = "#ff6f6f";
const EVENT_COLOR_FACE = 0xffd52e; // the face-window event's dot on the aim bars
const EVENT_DOT_RADIUS = 6; // px, drawn on the aim bars (smaller than the hit range, so a marker on the dot always hits)

// ---------------------------------------------------------------------------------------------------------
// WEIGHT. One number per projectile (economy.json "projectiles.<id>.weight"; snowball = 100 is the reference).
//
// STRENGTH slider: `power` is where the marker is (0 = start .. 1 = tip). The apex the throw reaches is
// apexForEffectivePower(power + weightShift(weight)), and the curve passes through the apex bounds
// (0 -> MIN_STICK_HEIGHT, 1 -> MAX_APEX_HEIGHT) and through W20's MIDDLE at 0.5. The shift moves where the
// middle of W20 sits on the slider: 0.5 for weight 100, the tip (1.0) for weight 200, the very start (0) for
// weight 0 - i.e. the perfect W20 throw is at power = weight / 200. Heavier = a higher power is needed.
//
// OFFSET slider: the sideways drift is swing x MAX_SWING_SPEED x flight time, and a swing of +-W20_SWING_GUARANTEE
// is the most that is still guaranteed to land inside W20's width. The offset bar spans +-offsetRange swing, so
// the share of the bar that hits W20 is W20_SWING_GUARANTEE / offsetRange = the "zone": 0 for weight 0 (only the exact
// middle), 1 for weight 200 (anywhere on the slider), and `offsetZoneAtWeight100` (economy.json aim, default 0.5)
// for the snowball, straight lines in between.
const APEX_MID = (W20.heightFrom + W20.heightTo) / 2; // the middle of W20 (365.5)
const CURVE_C = 2 * (MAX_APEX_HEIGHT - MIN_STICK_HEIGHT) - 4 * (APEX_MID - MIN_STICK_HEIGHT);
const CURVE_B = MAX_APEX_HEIGHT - MIN_STICK_HEIGHT - CURVE_C;
const CURVE_SLOPE_TOP = CURVE_B + 2 * CURVE_C; // beyond effective power 1 the curve continues in a straight line

function weightShift(weight) {
  return (REFERENCE_WEIGHT - weight) / (2 * REFERENCE_WEIGHT); // (100 - w) / 200
}

// Effective power (0..1 = the snowball's slider) -> apex height. Never below the lowest allowed stick height.
function apexForEffectivePower(pe) {
  if (pe <= 0) return MIN_STICK_HEIGHT;
  if (pe <= 1) return MIN_STICK_HEIGHT + CURVE_B * pe + CURVE_C * pe * pe;
  return MAX_APEX_HEIGHT + CURVE_SLOPE_TOP * (pe - 1);
}

// The inverse (can return values below 0 for apexes under the minimum; those are unreachable).
function effectivePowerForApex(apex) {
  if (apex >= MAX_APEX_HEIGHT) return 1 + (apex - MAX_APEX_HEIGHT) / CURVE_SLOPE_TOP;
  const d = apex - MIN_STICK_HEIGHT;
  return (-CURVE_B + Math.sqrt(CURVE_B * CURVE_B + 4 * CURVE_C * d)) / (2 * CURVE_C);
}

// The share of the offset bar that is a guaranteed W20 hit (sideways) for a projectile of this weight.
function offsetZone(weight, zoneAt100) {
  const w = Math.min(Math.max(weight, 0), 2 * REFERENCE_WEIGHT);
  return w <= REFERENCE_WEIGHT
    ? (zoneAt100 * w) / REFERENCE_WEIGHT
    : zoneAt100 + ((1 - zoneAt100) * (w - REFERENCE_WEIGHT)) / REFERENCE_WEIGHT;
}

// How far (in swing) the offset marker can drift from the middle - i.e. the bar spans +-this.
function offsetRangeForWeight(weight, zoneAt100) {
  return Math.min(10, W20_SWING_GUARANTEE / Math.max(0.015, offsetZone(weight, zoneAt100)));
}

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

// What each equippable projectile LOOKS and SOUNDS like (texture / sound keys from preload; `mark` = the texture and
// on-screen size of the mark it leaves on the wall, `launchSound` = the sound when it is thrown - both optional, the
// defaults are the snowball's mark and the throw whoosh). Its
// gameplay numbers (aim range/speed, coin multiplier, mark or bounce, spin) live in economy.json
// under "projectiles", keyed by the same id. Character sprites that aren't listed fall back to the
// normal ones - there is no chestnut "throwing" sprite yet, so that pose uses the plain one.
const PROJECTILE_VISUALS = {
  snowball: {
    ball: "snowball",
    sprites: { idle: "char_idle_snowball", aiming: "char_aiming", throwing: "char_throwing" }, // (the bare "char_idle" is the empty-handed pose, see updateCharacterPose)
    impactSound: "snowball_impact",
    impactVolume: 0.3, // halved from 0.6
  },
  chestnut: {
    ball: "chestnut",
    sprites: { idle: "char_idle_chestnut", aiming: "char_aiming_chestnut", throwing: "char_throwing" },
    impactSound: "chestnut_impact",
    impactVolume: 0.5,
  },
  pinecone: {
    ball: "pinecone",
    sprites: { idle: "char_idle_pinecone", aiming: "char_aiming_pinecone", throwing: "char_throwing" },
    impactSound: "chestnut_impact", // same sound as the chestnut
    impactVolume: 0.5,
  },
  grenade: {
    ball: "grenade_flying",
    sprites: { idle: "char_idle_grenade", aiming: "char_aiming_grenade", throwing: "char_throwing" },
    launchSound: "grenade_launch",
    launchVolume: 0.6,
    impactSound: "grenade_impact",
    impactVolume: 0.5,
    mark: { texture: "grenade_impact", size: 40 }, // a big scorch mark (the snowball's is 20px)
    // On impact: a radial flash growing out of the grenade (ms, and how big it gets as a multiple of its 128px
    // texture) and a short shake of the game picture (share of the screen size, x/y; the UI does not shake).
    explosion: { flashMs: 340, flashScale: 4.6, shakeMs: 330, shakeX: 0.014, shakeY: 0.008 },
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

// 83000 ms -> "01:23"
function formatClock(ms) {
  const total = Math.ceil(ms / 1000);
  return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
}

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
    this.load.image("char_idle", "assets/character/character1_idle.png?v=2"); // empty-handed: no snowballs left
    this.load.image("char_idle_snowball", "assets/character/character1_idle_snowball.png"); // a snowball in hand
    this.load.image("char_aiming", "assets/character/character1_aiming.png");
    this.load.image("char_throwing", "assets/character/character1_throwing.png");
    this.load.image("chestnut", "assets/snowball/chestnut.png");
    this.load.image("pinecone", "assets/snowball/pine_cone.png?v=2");
    this.load.image("char_idle_pinecone", "assets/character/character1_idle_pinecone.png");
    this.load.image("char_aiming_pinecone", "assets/character/character1_aiming_pinecone.png");
    this.load.image("grenade_flying", "assets/snowball/grenade_flying.png"); // the ball while it is in the air
    this.load.image("grenade_impact", "assets/snowball/grenade_impact.png"); // the scorch mark it leaves on the wall
    this.load.image("char_idle_grenade", "assets/character/character1_idle_grenade.png");
    this.load.image("char_aiming_grenade", "assets/character/character1_aiming_grenade.png");
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
    this.load.audio("grenade_launch", "assets/audio/grenade_launch.mp3");
    this.load.audio("grenade_impact", "assets/audio/grenade_impact.mp3");
    this.load.audio("buff_use", "assets/audio/buff_use.mp3");
  }

  create() {
    // Rewards/prices live in economy.json (edit that, not the code). A typo there would otherwise
    // fail silently later, so say so loudly right away.
    this.eco = this.cache.json.get("economy");
    if (!this.eco) throw new Error("economy.json failed to load or has a JSON syntax error - check it.");
    Rarity.init(this.eco);
    // Refilling projectile stocks (the snowball): tell the save their cap and pace before anything reads a count.
    const regen = {};
    for (const [id, p] of Object.entries(this.eco.projectiles || {})) {
      if (p.regen) regen[id] = { max: p.regen.max, everyMs: p.regen.everySeconds * 1000 };
    }
    Economy.setRegenConfig(regen);
    Shop.init(this.eco);
    Buffs.init(this.eco);
    Collection.setEconomy(this.eco);

    this.state = STATE.IDLE;
    if (Economy.wasAiming()) {
      // The app was closed in the middle of an aim: that is an abandoned aim, so the streak is lost.
      Economy.setStreak(0);
      Economy.setAiming(false);
    }
    this.streak = Economy.getStreak(); // hits in a row - saved, so it survives closing the app
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
    this.buffEventId = null; // id of the buff (Tomato Juice) that is running the current face event, or null - see syncBuffEvent
    this.activeEvent = null; // name of the running random event, or null - at most ONE runs at a time (see startEvent)

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
    this.takeAimSnapshot();
    this.updateStreakHud();

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

    this.showMessage("TAP to AIM");
    this.setupFpsReadout();
  }

  // Makes `id` the projectile in use: the ball texture, the character sprites and every gameplay
  // number (aim range/speed, coin multiplier, mark vs bounce, spin) follow from it. Anything unknown
  // or not owned falls back to the snowball.
  applyProjectile(id) {
    const known = PROJECTILE_VISUALS[id] && this.eco.projectiles && this.eco.projectiles[id];
    // A projectile is usable if it never runs out, refills (the snowball is always equippable, even at 0), or the player has some.
    const available = known && (this.eco.projectiles[id].infinite || this.eco.projectiles[id].regen || Economy.getProjectileCount(id) > 0);
    if (!known || !available) {
      id = "snowball"; // the default
      if (Economy.getEquipped("projectile") !== id) Economy.setEquipped("projectile", id); // keep the save honest
    }
    this.projectileId = id;
    this.proj = this.eco.projectiles[id];
    this.projVisuals = PROJECTILE_VISUALS[id];
  }

  // Freezes everything about the coming throw that a buff (or the projectile) can change - slider ranges,
  // speeds and the coin multiplier. It is called when the player taps "TAP to aim" and NOT again until the
  // next tap, so a buff that runs out or is bought mid-aim, mid-flight or on the result screen can never
  // change the sliders (or the payout) of the throw in progress. The bars, their green lines and the event
  // dots are all drawn from this snapshot.
  //  angleRange: how far (in swing) the offset marker can drift, edge to edge of the bar - from the weight (see
  //    "WEIGHT" above), narrowed by a precision buff; smaller = more precise.
  //  powerRange: how much of the power span the strength slider covers (1 = all of it; strength-control buff).
  takeAimSnapshot() {
    const b = Buffs.modifiers();
    const cfg = { ...AIM_DEFAULTS, ...(this.eco.aim || {}) };
    // The offset spread comes from the projectile's WEIGHT (heavier = a wider share of the bar is a hit), then a
    // precision buff narrows it further.
    const weight = this.proj.weight === undefined ? REFERENCE_WEIGHT : this.proj.weight;
    this.aim = {
      markerHz: cfg.markerHz, // fixed: the streak no longer speeds it up
      angleRange: offsetRangeForWeight(weight, cfg.offsetZoneAtWeight100) / b.precision,
      powerRange: 1 / b.strengthControl,
      coinMultiplier: b.coinMultiplier,
      guideLines: b.guideLines > 0, // the green guarantee lines are only drawn while a buff (Skyr) gives them
      saveProjectile: b.saveProjectile, // chance (0-1) that this throw does not use up its projectile (Water Bottle) - the best running buff's
      saveProjectileBy: b.saveProjectileBy, // ... and which buff that is (its icon is shown when it saves one)
    };
  }

  // The shop was opened. An aim in progress (angle or power phase) is dropped and the game goes back to
  // "TAP to aim" - the player is no longer looking at it, and the buffs are re-read on the next tap. A ball
  // already in flight is left to finish (its coins count) and resets by itself like any other throw.
  // Purely visual: a bright radial flash that grows out of the grenade where it hit and fades, and a short shake of
  // the main camera (the game picture only - the HTML buttons and the rear-view window stay still).
  playExplosion(x, y, fx) {
    if (!this.textures.exists("explosion_glow")) this.makeExplosionGlowTexture();
    const glow = this.add.image(x, y, "explosion_glow").setDepth(15).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5).setAlpha(1);
    this.tweens.add({
      targets: glow,
      scale: fx.flashScale,
      alpha: 0,
      duration: fx.flashMs,
      ease: "Quad.easeOut",
      onComplete: () => glow.destroy(),
    });
    // A small hot core that flashes faster than the glow, so the first frames are almost white.
    const core = this.add.image(x, y, "explosion_glow").setDepth(16).setBlendMode(Phaser.BlendModes.ADD).setScale(0.3).setAlpha(1);
    this.tweens.add({
      targets: core,
      scale: fx.flashScale * 0.45,
      alpha: 0,
      duration: fx.flashMs * 0.55,
      ease: "Cubic.easeOut",
      onComplete: () => core.destroy(),
    });
    this.cameras.main.shake(fx.shakeMs, new Phaser.Math.Vector2(fx.shakeX, fx.shakeY), true);
  }

  // A soft white-yellow-orange radial gradient, drawn once into a canvas texture (smooth, not pixelated).
  makeExplosionGlowTexture() {
    const tex = this.textures.createCanvas("explosion_glow", 128, 128);
    const ctx = tex.getContext();
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.25, "rgba(255,244,190,0.95)");
    grad.addColorStop(0.55, "rgba(255,160,50,0.55)");
    grad.addColorStop(1, "rgba(255,90,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    tex.refresh();
    tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  // Throwing away an aim in progress (opening the shop, equipping something else, closing the app) counts as a
  // failed throw: the projectile the tap used up is NOT given back, and the streak is lost - otherwise a bad aim
  // could be escaped for free. (No miss coins, no message: nothing was thrown.)
  abandonAim() {
    Economy.setAiming(false);
    this.streak = 0;
    Economy.setStreak(0);
    this.updateStreakHud();
  }

  onShopOpened() {
    if (this.state === STATE.AIM_ANGLE || this.state === STATE.AIM_POWER) {
      this.abandonAim();
      this.state = STATE.IDLE;
      this.showMessage("TAP to AIM");
      if (this.pendingProjectile) {
        // That tap was the last of its kind: the snowball takes over now, since no throw will follow to apply it.
        this.applyProjectile(this.pendingProjectile);
        this.pendingProjectile = null;
      }
    }
  }

  // Consumable projectiles: one is used up the moment the player taps "TAP to aim". The throw still uses it
  // (this.proj is unchanged until the throw is over); if it was the LAST one, the snowball is equipped again -
  // saved right now, applied when the throw concludes (pendingProjectile), so the aim isn't disturbed.
  consumeProjectile() {
    this.savedBy = null; // the buff that saved THIS throw's projectile, shown on the result message
    if (this.proj.infinite) return;
    if (Math.random() < this.aim.saveProjectile) {
      this.savedBy = this.aim.saveProjectileBy; // lucky: the projectile is not used up (Water Bottle)
      return;
    }
    const id = this.projectileId;
    if (!Economy.useProjectile(id)) return;
    if (id !== "snowball" && Economy.getProjectileCount(id) === 0) {
      Economy.setEquipped("projectile", "snowball");
      this.pendingProjectile = "snowball";
    }
  }

  // Can the equipped projectile be thrown? Only a refilling one can be out (the others fall back to the snowball).
  hasAmmo() {
    return !this.proj.regen || Economy.getProjectileCount(this.projectileId) > 0;
  }

  // While the equipped refilling projectile is out, the message in the middle says so and counts down to the next one;
  // as soon as one arrives it goes back to "TAP to aim".
  updateStockMessage() {
    if (this.state !== STATE.IDLE) {
      this.stockMessageShown = false;
      return;
    }
    if (!this.hasAmmo()) {
      const info = Economy.regenInfo(this.projectileId);
      const text = "OUT of " + this.projectileId.toUpperCase() + "S\n+1 in " + formatClock(info && info.msToNext !== null ? info.msToNext : 0);
      if (document.getElementById("message").textContent !== text) this.showMessage(text);
      this.stockMessageShown = true;
    } else if (this.stockMessageShown) {
      this.showMessage("TAP to AIM");
      this.stockMessageShown = false;
    }
  }

  // The always-visible STREAK: x box under the top-right buttons. The text shrinks a little if it would be
  // wider than the box (a streak in the hundreds). (The best streak is still saved, just not shown.)
  updateStreakHud() {
    const fit = (id, text) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = text;
      el.style.fontSize = Math.min(8, Math.floor(88 / text.length)) + "px"; // 88px = the box minus its border and padding
    };
    fit("streak-text", "STREAK: " + this.streak);
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
    const wasAiming = this.state === STATE.AIM_ANGLE || this.state === STATE.AIM_POWER;
    if (wasAiming) this.abandonAim();
    this.applyProjectile(id);
    if (wasAiming) {
      this.state = STATE.IDLE;
      this.showMessage("TAP to AIM");
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
    if (this.state === STATE.IDLE && !this.hasAmmo()) key = "char_idle"; // out of snowballs: empty hands
    if (this.state === STATE.AIM_ANGLE || this.state === STATE.AIM_POWER) key = sprites.aiming;
    else if (this.state === STATE.FLIGHT && this.flightTime < 0.35) key = sprites.throwing;
    if (this.character.texture.key !== key) this.character.setTexture(key);
  }

  handleFreezeInput() {
    // Belt and braces: never advance the throw while the shop or a list covers the game.
    const cls = document.getElementById("game-container").classList;
    if (cls.contains("shop-open") || cls.contains("list-open")) return;
    if (this.state === STATE.IDLE) {
      if (!this.hasAmmo()) return; // out of snowballs: nothing to throw (updateStockMessage tells the player when the next one comes)
      this.takeAimSnapshot(); // the one moment the player's buffs are read for this throw
      this.consumeProjectile(); // ... and the moment a consumable projectile is used up
      Economy.setAiming(true); // an aim is open until the ball is thrown (see abandonAim)
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
    Economy.setAiming(false); // thrown: the aim is no longer open

    const swing = (this.angleValue - 0.5) * 2; // -1..1
    this.ballVX = swing * MAX_SWING_SPEED;
    // The strength marker's position (0..1) plus the weight shift is the effective power on the snowball's curve
    // (see "WEIGHT" above); the apex is never below the lowest allowed stick height.
    const weight = this.proj.weight === undefined ? REFERENCE_WEIGHT : this.proj.weight;
    const apex = apexForEffectivePower(this.powerValue + weightShift(weight));
    this.ballVY0 = Math.sqrt(2 * GRAVITY * apex);
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
    this.sound.play(this.projVisuals.launchSound || "throw_whoosh", { volume: this.projVisuals.launchVolume || 0.6 });
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
    const look = this.projVisuals.mark || { texture: "snowball_mark", size: 20 };
    const mark = this.add.image(x, this.worldY(heightClimbed), look.texture);
    mark.setDisplaySize(look.size, look.size);
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
    // An exploding projectile lights up the wall where it hit (not when it flew out of the top / fell behind the roof).
    if (!escaped && this.projVisuals.explosion) this.playExplosion(stickX, this.worldY(stickHeight), this.projVisuals.explosion);

    if (hit) {
      this.streak += 1;
      let coins = this.proj.rewards[win.name]; // the base coins for this window come from the projectile in use
      // (The streak is only counted and shown - it no longer adds coins.)

      if (faceHit) {
        this.bananaHitTriggered = true;
        coins *= this.eco.events.faceWindow.faceMultiplier; // hitting the face multiplies this throw's coins (x40)
        this.triggerBananaHit(mark);
      }

      // The coin multiplier of the buffs that were active when the player tapped to aim, rounded down (+1e-9 so a
      // product like 8 x 1.5 doesn't fall short through floating point).
      coins = Math.floor(coins * this.aim.coinMultiplier + 1e-9);

      // (The streak itself is shown all the time in the top-right STREAK box now.)
      Economy.addCoins(coins);
      Economy.reportStreak(this.streak);
      Economy.setStreak(this.streak);
      this.updateStreakHud();
      // (a buff that saved the projectile - Water Bottle - adds a "Saved Projectile" line at the bottom)
      this.showMessage("HIT\n+" + coins + " coins" + (this.savedBy ? "\nSaved Projectile" : ""), true);
    } else {
      this.streak = 0;
      Economy.setStreak(0);
      if (this.eco.rewards.missCoins) Economy.addCoins(this.eco.rewards.missCoins);
      this.updateStreakHud();
      this.showMessage("MISS" + (this.savedBy ? "\nSaved Projectile" : ""), true);
    }

    this.maybeStartRandomEvent();

    this.time.delayedCall(1400, () => {
      if (this.state === STATE.RESULT) this.resetForNextThrow();
    });
  }

  // True while any timed event is running. Only the face window exists so far - add every new event
  // here, so two events never overlap.
  isEventActive() {
    return this.activeEvent !== null;
  }

  // Every random event is listed here: its name, its chance after a throw, and how it starts. To add an event, add
  // it here and make it set `this.activeEvent = name` when it starts and `null` when it ends - the rule that only
  // one event can run at a time is enforced in startEvent(), so a new event can't overlap the others.
  eventDefs() {
    return [{ name: "face", chance: this.eco.events.faceWindow.chancePerThrow, start: () => this.startBananaEvent() }];
  }

  // Tomato Juice (buff effect triggerEvent "face"): while it runs the banana face is on. Checked every frame:
  //  - the buff runs and no event does -> start the face event for what is left of the buff (only between throws);
  //  - a natural face event is running -> the buff takes it over (it now lasts as long as the buff);
  //  - the buff ended (timer ran out, or its card was tapped away) -> the event ends with it.
  // The end by hitting the face is in triggerBananaHit. The buff is on the device clock, so if the app was closed
  // meanwhile the event comes back for the time that is left.
  syncBuffEvent() {
    const b = Buffs.eventBuff("face");
    if (this.buffEventId) {
      if (!b || b.id !== this.buffEventId) {
        this.buffEventId = null;
        if (this.bananaActive && !this.bananaHitTriggered) this.endBananaEvent();
      }
      return;
    }
    if (!b || this.state !== STATE.IDLE) return;
    if (this.bananaActive && !this.bananaHitTriggered) {
      this.buffEventId = b.id;
      if (this.bananaEndTimer) this.bananaEndTimer.remove();
      this.bananaEndTimer = this.time.delayedCall(b.msLeft, () => this.endBananaEvent());
      return;
    }
    if (this.isEventActive()) return; // the previous face is still fading out: start after it
    this.startBananaEvent(b.msLeft, b.id);
  }

  // The single way to start an event by name. Refuses (returns false) while another event is running.
  startEvent(name) {
    if (this.isEventActive()) return false;
    const def = this.eventDefs().find((d) => d.name === name);
    if (!def) return false;
    def.start();
    return this.activeEvent === name;
  }

  // After every throw (hit, miss or escape) roll for a random event - but never while one is running.
  // Chance per event is in economy.json (events.faceWindow.chancePerThrow, 0.01 = 1%).
  maybeStartRandomEvent() {
    if (this.isEventActive()) return;
    // One roll per event, in a random order so no event is favoured; the first success starts and the rest are skipped.
    const defs = this.eventDefs().sort(() => Math.random() - 0.5);
    for (const def of defs) {
      if (Math.random() < def.chance) {
        this.startEvent(def.name);
        return;
      }
    }
  }

  // Random face-window event (1% chance after each throw): swaps W20's texture to the banana art for events.faceWindow.durationMs, then fades
  // back on its own. Any existing marks on W20's left section fade out quickly first, so they
  // don't look like they're stuck to a texture that's about to change out from under them.
  // `durationMs` / `buffId`: given when a buff (Tomato Juice) starts it - then it lasts as long as the buff (see syncBuffEvent).
  startBananaEvent(durationMs, buffId) {
    if (this.isEventActive()) return; // only one event at a time
    this.buffEventId = buffId || null;
    this.activeEvent = "face";
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

    this.bananaEndTimer = this.time.delayedCall(durationMs || this.eco.events.faceWindow.durationMs, () => this.endBananaEvent());
  }

  // Normal 20s expiry - fades the banana texture back to nothing (the real W20 art underneath
  // was never actually touched, this overlay just sits on top of it).
  endBananaEvent() {
    if (!this.bananaActive) return;
    if (this.bananaEndTimer) this.bananaEndTimer.remove();
    this.buffEventId = null;
    this.bananaActive = false;
    this.activeEvent = null;
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
    if (this.buffEventId) {
      // The event was made by a buff (Tomato Juice): hitting the face concludes the event AND ends the buff.
      const id = this.buffEventId;
      this.buffEventId = null;
      Buffs.cancel(id);
    }
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
          this.activeEvent = null;
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
    this.showMessage("TAP to AIM");
  }

  // `result`: the HIT / MISS text - drawn bigger with a thick outline (see #message.result).
  showMessage(msg, result) {
    // Text lives in HTML now (see index.html #message), not as a Phaser Text object - canvas
    // text at this resolution renders as blurry upscaled pixels, an HTML element with a real
    // web font doesn't.
    const el = document.getElementById("message");
    el.textContent = msg;
    el.classList.toggle("result", !!result);
  }

  // The power-bar range that lands the throw's apex inside `box` ({xFrom, xTo, heightFrom, heightTo}) GIVEN the
  // offset (swing, -1..1) that was already chosen - or null if no strength can hit it from there.
  // The ball drifts swing x MAX_SWING_SPEED x apexTime sideways, and the apex time grows with the apex height,
  // so an offset that is a little off can still hit the box - but only with a lower (shorter) throw. That
  // limits the flight time to an interval, which is then turned back into apex heights and power values.
  powerBandFor(swing, box) {
    const v = MAX_SWING_SPEED * swing; // sideways speed
    let tLo = Math.sqrt((2 * box.heightFrom) / GRAVITY);
    let tHi = Math.sqrt((2 * box.heightTo) / GRAVITY);
    if (Math.abs(v) < 1e-9) {
      if (ORIGIN_X < box.xFrom || ORIGIN_X > box.xTo) return null; // thrown straight and the box isn't straight ahead
    } else {
      const t1 = (box.xFrom - ORIGIN_X) / v;
      const t2 = (box.xTo - ORIGIN_X) / v;
      tLo = Math.max(tLo, Math.min(t1, t2));
      tHi = Math.min(tHi, Math.max(t1, t2));
    }
    if (tLo > tHi) return null;
    return { from: this.powerForApex((GRAVITY * tLo * tLo) / 2), to: this.powerForApex((GRAVITY * tHi * tHi) / 2) };
  }

  // Where the sliders must be released to hit the running event's target, or null if no event has one.
  // Each event has its own color; the aim bars show a dot of that color at the middle of the range.
  // Currently only the face window (yellow): its face box needs the apex inside the face's height band and
  // the sideways position inside its width. The sideways drift is swing x MAX_SWING_SPEED x apexTime and
  // apexTime changes a little across the band, so the swing range returned is the one that works for EVERY
  // apex in the band; the power range is the band itself. Anywhere the marker overlaps the dot is a hit.
  //  `swing` (optional): the offset already chosen. With it, powerFrom/powerTo are the strengths that hit FROM
  //  THAT OFFSET (null if none does); without it they are just the height band.
  activeEventTarget(swing) {
    if (!(this.bananaActive && !this.bananaHitTriggered)) return null;
    const b = BANANA_FACE_BOX;
    const band = swing === undefined ? { from: this.powerForApex(b.heightFrom), to: this.powerForApex(b.heightTo) } : this.powerBandFor(swing, b);
    const tMin = Math.sqrt((2 * b.heightFrom) / GRAVITY);
    const tMax = Math.sqrt((2 * b.heightTo) / GRAVITY);
    const dxFrom = b.xFrom - ORIGIN_X;
    const dxTo = b.xTo - ORIGIN_X;
    return {
      color: EVENT_COLOR_FACE,
      swingFrom: Math.max(dxFrom / (MAX_SWING_SPEED * tMin), dxFrom / (MAX_SWING_SPEED * tMax)),
      swingTo: Math.min(dxTo / (MAX_SWING_SPEED * tMin), dxTo / (MAX_SWING_SPEED * tMax)),
      powerFrom: band ? band.from : null,
      powerTo: band ? band.to : null,
    };
  }

  // The strength-bar value whose throw peaks at `apex` (a world height) with the equipped projectile - the inverse
  // of launchBall(). May fall outside 0..1 (then that apex can't be reached with the bar).
  powerForApex(apex) {
    const weight = this.proj.weight === undefined ? REFERENCE_WEIGHT : this.proj.weight;
    return effectivePowerForApex(apex) - weightShift(weight);
  }

  // `hitWidthPx` = how wide (on the bar) the range that really hits is. The dot never sticks out of it - it is
  // shrunk to fit when that range gets narrow (e.g. an offset near the edge of what can still hit) - so a
  // marker overlapping the dot is always a hit.
  drawEventDot(g, x, y, color, hitWidthPx) {
    if (hitWidthPx < 2) return; // a sliver too thin to aim at: no dot rather than a dot that overhangs it
    const radius = Math.min(EVENT_DOT_RADIUS, hitWidthPx / 2);
    g.fillStyle(color, 1);
    g.fillCircle(Math.round(x), y, radius);
  }

  // The text above the left end of the aim bar: OFFSET during the offset phase, STRENGTH during the strength phase,
  // in the marker's colour (HTML #aim-label, pixel font, no background, a thin dark outline so it reads on snow).
  // Only shown while aiming.
  updateAimLabel() {
    const el = document.getElementById("aim-label");
    if (!el) return;
    const aiming = this.state === STATE.AIM_ANGLE || this.state === STATE.AIM_POWER;
    const text = this.state === STATE.AIM_POWER ? "STRENGTH" : "OFFSET";
    if (el.dataset.text !== text) {
      el.dataset.text = text;
      el.textContent = text;
      el.style.color = this.state === STATE.AIM_POWER ? AIM_COLOR_POWER_CSS : AIM_COLOR_ANGLE_CSS;
    }
    el.classList.toggle("show", aiming);
  }

  drawAimBar() {
    const g = this.aimGfx;
    g.clear();
    this.updateAimLabel();
    if (this.state !== STATE.AIM_ANGLE && this.state !== STATE.AIM_POWER) return;

    const barX = 20;
    const barY = GAME_HEIGHT - 20;
    const barW = GAME_WIDTH - 40;
    const barH = 8;

    g.fillStyle(0x000000, 0.4);
    g.fillRect(barX, barY, barW, barH);

    const isAngle = this.state === STATE.AIM_ANGLE;
    let markerPos; // 0..1 along the bar
    if (isAngle) {
      // The bar always spans the equipped projectile's whole angle range, so the marker runs edge to edge.
      const range = this.aim.angleRange;
      markerPos = 0.5 + (this.angleValue - 0.5) / range;

      const lineAt = (swing, color, alpha, width, extra) => {
        for (const sign of [-1, 1]) {
          const x = Math.round(barX + (0.5 + (sign * swing) / 2 / range) * barW);
          g.lineStyle(width, color, alpha);
          g.lineBetween(x, barY - extra, x, barY + barH + extra);
        }
      };
      // (There are no graduation lines any more - the bar is plain, apart from the green lines below.)
      const guide = this.aim.guideLines;
      // The two lines that guarantee a hit on W20 (sideways) - nothing else is drawn between them. Buff only.
      if (guide) lineAt(W20_SWING_GUARANTEE, 0x5cff5c, 1, 2, 5);

      const target = this.activeEventTarget();
      if (target) {
        const swing = (target.swingFrom + target.swingTo) / 2;
        if (Math.abs(swing) < range) {
          const x = barX + (0.5 + swing / 2 / range) * barW;
          this.drawEventDot(g, x, barY + barH / 2, target.color, ((target.swingTo - target.swingFrom) / 2 / range) * barW);
        }
      }
    } else {
      // The bar covers powerRange of the power span, centered: power p sits at (p - pLo) / range along it.
      const pRange = this.aim.powerRange;
      const pLo = 0.5 - pRange / 2;
      const barPos = (power) => (power - pLo) / pRange;
      markerPos = barPos(this.powerValue);

      // Same idea for power: two green lines around the power
      // range that puts the apex inside W20's height band (a guaranteed vertical hit). That range depends
      // on the projectile's weight (a lighter one flies higher, so it needs less power); nothing else is
      // drawn between the two lines.
      // The offset is already frozen, so the lines show what actually hits W20 FROM THAT OFFSET: the same band as
      // before when it is well aimed, a shorter one when it is a little off, and no lines (nothing to aim for)
      // when no strength can hit.
      const swingNow = (this.angleValue - 0.5) * 2;
      const band = this.powerBandFor(swingNow, W20);
      const lo = band ? band.from : NaN;
      const hi = band ? band.to : NaN;
      const lineAtPower = (power, color, alpha, width, extra) => {
        if (power <= pLo || power >= pLo + pRange) return; // outside what this bar covers
        const x = Math.round(barX + barPos(power) * barW);
        g.lineStyle(width, color, alpha);
        g.lineBetween(x, barY - extra, x, barY + barH + extra);
      };
      if (band && this.aim.guideLines) {
        lineAtPower(lo, 0x5cff5c, 1, 2, 5);
        lineAtPower(hi, 0x5cff5c, 1, 2, 5);
      }

      const target = this.activeEventTarget(swingNow);
      if (target && target.powerFrom !== null) {
        // The hit band can stick out past the ends of the bar (a heavy projectile's band ends beyond the tip):
        // aim the dot at the part that is on the bar.
        const from = Math.max(target.powerFrom, pLo);
        const to = Math.min(target.powerTo, pLo + pRange);
        if (from < to) {
          const hitWidthPx = ((to - from) / pRange) * barW;
          this.drawEventDot(g, barX + barPos((from + to) / 2) * barW, barY + barH / 2, target.color, hitWidthPx);
        }
      }
    }

    g.fillStyle(isAngle ? AIM_COLOR_ANGLE : AIM_COLOR_POWER, 1);
    const markerX = barX + markerPos * barW;
    g.fillRect(markerX - 2, barY - 4, 4, barH + 8);

    g.lineStyle(1, 0xffffff, 0.6);
    g.strokeRect(barX, barY, barW, barH);
  }

  update(time, delta) {
    // Cap the step so one long frame (audio start, GC, a busy phone GPU) can't make the ball
    // and the camera chasing it jump - time just runs slightly slow for that frame instead.
    const dt = Math.min(delta / 1000, 1 / 30);

    if (this.state === STATE.AIM_ANGLE) {
      const elapsed = (time - this.aimStartTime) / 1000;
      // The marker sweeps the BAR at one fixed speed for the whole throw (aim.markerHz) - nothing but the streak
      // (read at the tap) changes it, and it is the same for both sliders: `pos` is where it
      // is along the bar (0..1), and angleValue is what that position means - the bar shows angleRange of the
      // full swing edge to edge, so a smaller range (chestnut, precision buff) is finer aim but the marker
      // itself never moves faster on screen.
      const a = this.aim;
      const pos = pingPong(elapsed * a.markerHz);
      this.angleValue = 0.5 + (pos - 0.5) * a.angleRange;
    } else if (this.state === STATE.AIM_POWER) {
      const elapsed = (time - this.aimStartTime) / 1000;
      // Same for strength: fixed marker speed along the bar, the bar covers `powerRange` of the power span (centered).
      const r = this.aim.powerRange;
      this.powerValue = 0.5 + (pingPong(elapsed * this.aim.markerHz) - 0.5) * r;
    } else if (this.state === STATE.FLIGHT) {
      this.updateFlight(dt);
    }
    this.updateBounce(dt);

    this.updateStockMessage();
    this.syncBuffEvent();
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
