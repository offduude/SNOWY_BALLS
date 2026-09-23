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
// Where the wall ends and the sky starts: background.png rows 0-14 are sky, row 15 is the dark roof
// edge. Nothing can stick above this line - a ball whose apex is higher falls back down and sinks
// behind the roofline instead (see updateFlight), and marks are clipped at it (see addMark).
const ROOF_EDGE_HEIGHT = IMG_GROUND_Y - 15; // 645

// Marker speed (full back-and-forth sweeps per second) - the numbers live in economy.json under "aim".
// ONE fixed speed for both sliders - nothing (streak, buffs, projectiles) changes it.
const AIM_DEFAULTS = { markerHz: 1.275 };
const DEFAULT_OFFSET_ZONE = 0.25; // the moderate tier's (used if a projectile has none)

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

// EVERY window of the building (the two goal windows above are among them), in IMAGE pixels [x from, x to, y from, y to]
// (inclusive) - read from the red boxes of docs/background_annotated.png by tools/find_windows.py. Only W20 / W21 score;
// this list is for effects that react to ANY window (the stone's hard_impact sound).
const WALL_WINDOWS = [
  [0, 26, 73, 116], [209, 231, 73, 116], [267, 318, 73, 116], [385, 436, 73, 116],
  [472, 494, 73, 116], [677, 703, 73, 116], [96, 139, 138, 157], [564, 607, 138, 157],
  [0, 26, 173, 216], [209, 231, 173, 216], [267, 318, 173, 216], [385, 436, 173, 216],
  [472, 494, 173, 216], [677, 703, 173, 216], [96, 139, 231, 250], [564, 607, 231, 250],
  [0, 27, 273, 316], [210, 232, 273, 316], [268, 319, 273, 316], [385, 436, 273, 316],
  [472, 494, 273, 316], [676, 703, 273, 316], [96, 139, 324, 343], [564, 607, 324, 343],
  [0, 27, 373, 416], [209, 231, 373, 416], [267, 318, 373, 416], [385, 436, 373, 416],
  [472, 494, 373, 416], [676, 703, 373, 416], [96, 139, 417, 436], [564, 607, 417, 436],
  [0, 26, 473, 516], [209, 231, 473, 516], [267, 318, 473, 516], [385, 436, 473, 516],
  [472, 494, 473, 516], [677, 703, 473, 516], [102, 153, 513, 549], [572, 623, 513, 549],
];

// Is the point where a projectile stuck (world x, height climbed) inside any window of the building?
function hitsAnyWindow(x, heightClimbed) {
  const imageY = IMG_GROUND_Y - heightClimbed;
  return WALL_WINDOWS.some(([x0, x1, y0, y1]) => x >= x0 && x <= x1 && imageY >= y0 && imageY <= y1);
}

// "Banana window" streak bonus (2026-09-19). goal_window_face.png / goal_window_face_hit.png are 58x50: exactly W20's whole
// window in the building art - the 52x44 glass plus its 3px frame - so they are drawn 1:1 over it, top-left 3px up/left of the
// glass (see FACE_FRAME). The face box and left-pane divider were found by flood-filling the texture for non-curtain pixels.
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
const EVENT_COLOR_FACE = 0xffd52e; // the face-window event's hitzone on the aim bars
const EVENT_COLOR_DISCO = 0xb04dff; // the disco event's face: a purple hitzone on the aim bars
const EVENT_COLOR_GUITAR = 0xff8a3d; // the guitar event's face: an orange hitzone on the aim bars

// ---------------------------------------------------------------------------------------------------------
// WEIGHT is a TIER (very light ... very heavy, economy.json weightTiers), not a number.
//
// STRENGTH slider: `power` is where the marker is (0 = start .. 1 = tip). A tier is the part of the slider where the throw
// lands in W20: very light 0-25%, light 25-50%, moderate 37.5-62.5%, heavy 50-75%, very heavy 75-100% (projectile.strengthBand).
// The apex is a straight line in `power` through those two points - the bottom of W20 at the band's start, the top of W20 at
// its end - and goes on in the same line on both sides (never below the lowest allowed stick height).
//
// OFFSET slider: the sideways drift is swing x MAX_SWING_SPEED x flight time, and a swing of +-W20_SWING_GUARANTEE
// is the most that is still guaranteed to land inside W20's width. The offset bar spans +-offsetRange swing, so
// the share of the bar that hits W20 is W20_SWING_GUARANTEE / offsetRange = the "zone" - a band centered on the middle of the
// bar that reaches out to both sides. Each tier has its own zone (economy.json weightTiers.offsetZone: very light 6.25%,
// light 12.5%, moderate 25%, heavy 50%, very heavy 100% of the whole bar); a smaller zone = a longer, less precise swing.
// A `precision` buff (x) multiplies the zone (x1.2 = 20% bigger), up to the whole bar.
const DEFAULT_STRENGTH_BAND = { from: 0.375, to: 0.625 }; // moderate

// Strength position -> apex height for a projectile (a straight line through W20's bottom at the band's start and top at its end).
function apexForPower(proj, power) {
  const b = proj.strengthBand || DEFAULT_STRENGTH_BAND;
  const apex = W20.heightFrom + ((W20.heightTo - W20.heightFrom) * (power - b.from)) / (b.to - b.from);
  return Math.max(MIN_STICK_HEIGHT, apex);
}

// The inverse (can fall outside 0..1: then that apex can't be reached with the bar).
function powerForApexOf(proj, apex) {
  const b = proj.strengthBand || DEFAULT_STRENGTH_BAND;
  return b.from + ((apex - W20.heightFrom) / (W20.heightTo - W20.heightFrom)) * (b.to - b.from);
}

// How far (in swing) the offset marker can drift from the middle - i.e. the bar spans +-this - when `zone` (0..1) of the bar is the
// guaranteed W20 hit. A zone of 1 = the whole bar hits (a bigger one would only waste the bar's ends), so it stops there.
function offsetRangeForZone(zone) {
  return Math.min(10, W20_SWING_GUARANTEE / Math.min(1, Math.max(0.015, zone)));
}

// The face window textures are exactly the size of the building's window INCLUDING its frame: 58x50 = W20's 52x44 glass plus a
// 3px frame all round (1px white, then 2px light grey - the same frame the building art draws). They are drawn 1:1, no crop and
// no scaling, right over the building window: their top-left corner sits 3px up/left of W20's glass.
const FACE_FRAME = 3;
const FACE_IMG_X = W20.xFrom - FACE_FRAME; // world x of the texture's left edge
const FACE_IMG_TOP_HEIGHT = W20.heightTo + FACE_FRAME; // heightClimbed of the texture's top edge
const FACE_RAW = { xFrom: 3, xTo: 20, yFrom: 30, yTo: 47 }; // face+collar, in texture px (from the texture's top-left corner)
const FACE_RAW_LEFT_DIVIDER_X = 22; // texture px - where the left pane ends

const BANANA_FACE_BOX = {
  xFrom: FACE_IMG_X + FACE_RAW.xFrom,
  xTo: FACE_IMG_X + FACE_RAW.xTo,
  heightFrom: FACE_IMG_TOP_HEIGHT - FACE_RAW.yTo,
  heightTo: FACE_IMG_TOP_HEIGHT - FACE_RAW.yFrom,
};
const BANANA_LEFT_SECTION_XTO = FACE_IMG_X + FACE_RAW_LEFT_DIVIDER_X;

// DISCO event: discoface1-6 are 58x50 like the banana face's picture and are drawn over W20 in the same place. The singer (right pane) is
// the same in all six; his head (hair, face, glasses; texture px x 30-45, y 13-28) is the face a hit gives the bonus for.
const DISCO_FACE_RAW = { xFrom: 30, xTo: 45, yFrom: 13, yTo: 28 };
const DISCO_FACE_BOX = {
  xFrom: FACE_IMG_X + DISCO_FACE_RAW.xFrom,
  xTo: FACE_IMG_X + DISCO_FACE_RAW.xTo,
  heightFrom: FACE_IMG_TOP_HEIGHT - DISCO_FACE_RAW.yTo,
  heightTo: FACE_IMG_TOP_HEIGHT - DISCO_FACE_RAW.yFrom,
};
// GUITAR event: guitar1-3 are 58x50 too and are drawn over W20 in the same place. The guitarist (right pane) has the same head as the singer, 5 px
// further left (texture px x 25-40, y 13-28), and that is the face a hit gives the bonus for.
const GUITAR_FACE_RAW = { xFrom: 25, xTo: 40, yFrom: 13, yTo: 28 };
const GUITAR_FACE_BOX = {
  xFrom: FACE_IMG_X + GUITAR_FACE_RAW.xFrom,
  xTo: FACE_IMG_X + GUITAR_FACE_RAW.xTo,
  heightFrom: FACE_IMG_TOP_HEIGHT - GUITAR_FACE_RAW.yTo,
  heightTo: FACE_IMG_TOP_HEIGHT - GUITAR_FACE_RAW.yFrom,
};
// THE SONG EVENTS (the disco, the guitar): a song plays, W20 cycles through `frames` (a new one every `beatMs`), a hit on the face (`faceBox`) pays
// `faceMultiplier` x, and when the song is over the applause and the roses come. `block` = its numbers in economy.json events.<block> (over
// `defaults`; the block also names the event's rarity when it has no summon buff). To add another song event: an entry here, its pictures / song in
// preload, and eventDefs().
const SONG_EVENTS = {
  disco: {
    sound: "disco",
    volume: 0.8,
    frames: ["discoface1", "discoface2", "discoface3", "discoface4", "discoface5", "discoface6"],
    block: "discoWindow",
    faceBox: DISCO_FACE_BOX,
    color: EVENT_COLOR_DISCO,
    defaults: { faceMultiplier: 1.25, beatMs: 500 }, // 120 bpm
  },
  guitar: {
    sound: "guitar",
    volume: 0.8,
    frames: ["guitar1", "guitar2", "guitar3"],
    block: "guitarWindow",
    faceBox: GUITAR_FACE_BOX,
    color: EVENT_COLOR_GUITAR,
    defaults: { faceMultiplier: 1.25, beatMs: 470 }, // about 128 bpm (measured from the song)
  },
};
const APPLAUSE_VOLUME = 0.8;
// The roses of the applause: size (px), how many per second, and the fall speed range (px/s).
const ROSE_SIZE = 26;
const ROSE_RATE = 30;
const ROSE_SPEED_MIN = 200;
const ROSE_SPEED_MAX = 300;
const ROSE_MEAN_SPEED = (ROSE_SPEED_MIN + ROSE_SPEED_MAX) / 2;
const ROSE_ON_SCREEN = (ROSE_RATE * GAME_HEIGHT) / ROSE_MEAN_SPEED; // how many roses are in the picture at once (about 29): what the rate and the speed above give

const BANANA_FADE_MS = 350; // "quickly fade/change" - texture transitions
const MARK_QUICK_FADE_MS = 300; // faster than the normal MARK_FADE_MS, for the banana-tied clears

// What each equippable projectile LOOKS and SOUNDS like (texture / sound keys from preload; `mark` = the texture and
// on-screen size of the mark it leaves on the wall, `launchSound` = the sound when it is thrown (`launchLoop`: it repeats until the projectile lands
// and the impact sound cuts it), `ballScale` = how big the projectile in the air is compared with the others, `heldScale` = the same for the hand - all optional, the
// defaults are the snowball's mark, the throw whoosh and 1). Its
// gameplay numbers (aim range/speed, coin multiplier, mark or bounce, spin) live in economy.json
// under "projectiles", keyed by the same id. Character sprites that aren't listed fall back to the
// normal ones - there is no chestnut "throwing" sprite yet, so that pose uses the plain one.
const PROJECTILE_VISUALS = {
  snowball: {
    ball: "snowball",
    sprites: { idle: "char_idle_snowball", aiming: "char_aiming_snowball", throwing: "char_throwing" }, // (the bare "char_idle" / "char_aiming" are the empty-handed poses, see updateCharacterPose)
    impactSound: "snowball_impact",
    impactVolume: 0.3, // halved from 0.6
  },
  chestnut: {
    ball: "chestnut",
    sprites: { idle: "char_idle_chestnut", aiming: "char_aiming_chestnut", throwing: "char_throwing" },
    impactSound: "chestnut_impact",
    impactVolume: 0.5,
  },
  potato: {
    ball: "potato",
    sprites: { idle: "char_idle", aiming: "char_aiming", throwing: "char_throwing" }, // (no pictures of its own: it is drawn in the hand, see CHARACTERS)
    impactSound: "chestnut_impact", // sounds and behaves like the chestnut (no mark, it bounces off)
    impactVolume: 0.5,
  },
  onion: {
    ball: "onion",
    sprites: { idle: "char_idle", aiming: "char_aiming", throwing: "char_throwing" }, // (no pictures of its own: it is drawn in the hand, see CHARACTERS)
    impactSound: "chestnut_impact", // sounds and behaves like the chestnut (no mark, it bounces off)
    impactVolume: 0.5,
  },
  egg: {
    ball: "egg",
    sprites: { idle: "char_idle_egg", aiming: "char_aiming_egg", throwing: "char_throwing" },
    impactSound: "egg_impact",
    impactVolume: 0.5,
    mark: { texture: "egg_impact", size: 20 }, // the splat it leaves on the wall (was 40)
  },
  tomato: {
    ball: "tomato",
    sprites: { idle: "char_idle_tomato", aiming: "char_aiming_tomato", throwing: "char_throwing" },
    impactSound: "tomato_impact",
    impactVolume: 0.5,
    mark: { texture: "tomato_impact", size: 20 }, // the splat it leaves on the wall (it sticks, it does not bounce off)
  },
  rowan_berry: {
    ball: "rowan_berry",
    sprites: { idle: "char_idle_rowan_berry", aiming: "char_aiming_rowan_berry", throwing: "char_throwing" },
    impactSound: "chestnut_impact", // sounds and behaviour like the chestnut
    impactVolume: 0.5,
  },
  stone: {
    ball: "stone",
    sprites: { idle: "char_idle_stone", aiming: "char_aiming_stone", throwing: "char_throwing" },
    impactSound: "chestnut_impact", // a throw that hits no window: the chestnut's sound
    impactVolume: 0.5,
    hitSound: "hard_impact", // ... a throw that lands on ANY window of the building (see WALL_WINDOWS), goal window or not
    hitVolume: 0.6,
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
  drone: {
    ball: "drone", // (the same picture as its card: it is drawn 2x bigger in the air, see ballScale)
    sprites: { idle: "char_idle", aiming: "char_aiming", throwing: "char_throwing" }, // (no pictures of its own: it is drawn in the hand, see CHARACTERS)
    ballScale: 2, // the projectile in the air is twice the size of the others (the card / shop / counter picture is not affected)
    heldScale: 3, // ... and in the hand it is three times the normal hand size (its drawing is a wide, thin one: at 2x it still looked no bigger than the others)
    launchSound: "drone_fly", // the whole flight: it loops until the projectile lands, and the impact sound cuts it
    launchLoop: true,
    launchVolume: 0.6,
    impactSound: "drone_impact",
    impactVolume: 0.6,
    mark: { texture: "grenade_impact", size: 40 }, // the grenade's scorch mark
    // Like the grenade's explosion, but stronger: a longer and bigger flash and a harder, longer shake.
    explosion: { flashMs: 520, flashScale: 7, shakeMs: 520, shakeX: 0.024, shakeY: 0.014 },
  },
};
// A TEST projectile (economy.json projectiles.test_very_heavy, "godOnly": only a god mode save can list and equip it): it looks and sounds
// like the stone. To try another weight tier, change its `weight` in economy.json.
PROJECTILE_VISUALS.test_very_heavy = { ...PROJECTILE_VISUALS.stone };
// HELD PROJECTILES: a character has only EMPTY-handed idle and aiming pictures; the equipped projectile is drawn as a small sprite of its own at the
// hand's place, so a new projectile needs no character picture at all and a new character only needs the two empty poses, the throwing pose and
// its hand numbers. THE CHARACTERS: `sprites` are the texture keys of its three poses (loaded in preload); `hands.<pose>` (idle / aiming) are
// x, y: the middle of the projectile in the 64x64 picture (pixels from its top-left corner); size: its width and height in pixels; rotation:
// idle = upside down (PI), aiming = upright; behind: true = drawn under the character (the fingers are over it), false = over the character;
// rest: (aiming) the row of the fingertips - a projectile smaller than `size` sits ON them (fully visible) instead of behind the fist.
// A single projectile can adjust any pair with `hold: { <characterId>: { <pose>: { dx, dy, size, rotation, behind } } }` in PROJECTILE_VISUALS
// (dx / dy move it from the character's hand point). EVERY NEW PROJECTILE MUST BE CALIBRATED WITH EVERY CHARACTER and every new character with
// every projectile: see docs/CALIBRATION.md and calibrateHeldProjectiles() below. Turn the whole thing off with USE_HELD_PROJECTILES = false
// (every projectile then uses its own pictures again, see PROJECTILE_VISUALS.sprites).
const USE_HELD_PROJECTILES = true;
const HELD_MIN_CONTENT_PX = 2; // the drawn part of a projectile in the hand is never narrower than this (the same 2 px the rowan berry is when thrown)
const CHARACTERS = {
  character1: {
    sprites: { idle: "char_idle", aiming: "char_aiming", throwing: "char_throwing" }, // (all empty-handed)
    hands: {
      idle: { x: 43.5, y: 33.5, size: 5, rotation: Math.PI, behind: false },
      aiming: { x: 42, y: 6, size: 6, rotation: 0, behind: true, rest: 6 },
    },
  },
  // Pryk (2026-09-23): same hand position as character1 (the owner's call - drawn on the same rig) - reused
  // verbatim rather than re-measured; still calibrated against every projectile per docs/CALIBRATION.md (only
  // pryk's own rows checked, character1 x everything is unaffected and untouched).
  pryk: {
    sprites: { idle: "pryk_idle", aiming: "pryk_aiming", throwing: "pryk_throwing" },
    hands: {
      idle: { x: 43.5, y: 33.5, size: 5, rotation: Math.PI, behind: false },
      aiming: { x: 42, y: 6, size: 6, rotation: 0, behind: true, rest: 6 },
    },
  },
};
const DEFAULT_CHARACTER = "character1";
const DEFAULT_BACKGROUND = "assets/building/background.png"; // the wall picture that is loaded at the start (the key "background"); the default scenery Frosty uses it
const WEATHER_MARGIN = 6; // px the sky the weather falls in reaches beyond each side of the picture
const WEATHER_DEPTH = 9; // the weather's particles are drawn over the character (depth 2) - the same depth as the roses: over the building, over the marks (5), under the live ball (10)
const SPIN_RATE = 14; // rad/s, a spinning projectile (~2.2 turns a second)
// PERSPECTIVE (visual only): the projectile flies away from the player towards the wall, so it gets smaller as it approaches its
// apex - full size (BALL_SIZE px) when thrown, BALL_APEX_SCALE of that at the apex - and the closer it gets to the apex the
// FASTER it shrinks. A projectile that bounces off comes back towards the player and grows back to full size over
// BALL_REGROW_MS, growing fastest right after the bounce and slower and slower the further it gets from the bounce point.
// Both are the same curve, a logarithm (fast at first, then flattening): growing follows it forwards in time, shrinking
// follows it backwards, so the ball leaves the wall the way it arrived, in reverse.
// MUSIC: the theme plays all the time; while the banana face event is on, it is crossfaded with event_banana_face (the theme fades
// down to silence - it keeps running underneath - as the event music fades up, and the other way round when the event ends).
const THEME_VOLUME = 0.5;
const EVENT_MUSIC_VOLUME = 0.5;
const MUSIC_FADE_MS = 1500;
const BALL_SIZE = 16;
const BALL_APEX_SCALE = 0.5;
const BALL_REGROW_MS = 450;
// DIAMOND CROSS (the buff effect `miracle`): a throw that would miss hangs at its apex, is carried to the goal window (or the event) while the
// angels sing, hangs there again, and is released as a hit - see resolveMiracleThrow.
const MIRACLE_HANG_MS = 500; // the pause before the angels start and the pause after they have carried it
const MIRACLE_MUSIC_FADE_MS = 300; // how quickly the music fades out before the angels and back in after them
const MIRACLE_MOVE_MS = 3000; // the length of angels.mp3 (the real length is used once the sound is loaded)
const BALL_CURVE_K = 9; // how sharply the curve bends (higher = more of the change happens near the wall)
// 0..1 -> 0..1: log(1 + K x) / log(1 + K), steep near 0, flat near 1
function logCurve(x) {
  return Math.log(1 + BALL_CURVE_K * Math.min(1, Math.max(0, x))) / Math.log(1 + BALL_CURVE_K);
}
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
    // The loading screen's percentage (index.html #loading-text): real progress from Phaser's own loader, counted by files
    // done out of files queued (not bytes - a handful of the sound files are much bigger than the images, so this can jump
    // unevenly, e.g. race to 90% then sit on one big file - normal for a file-count progress bar). The screen itself is
    // already on screen before this ever runs (pure CSS, see index.html); it only fades out once create() below is done.
    this.load.on("progress", (frac) => {
      const el = document.getElementById("loading-text");
      if (el) el.textContent = "Loading - " + Math.round(frac * 100) + "%";
    });
    this.load.image("background", "assets/building/background.png?v=2");
    this.load.image("snowball", "assets/snowball/snowball.png");
    this.load.image("snowball_mark", "assets/snowball/snowball_mark.png");
    this.load.image("goal_window_face", "assets/building/goal_window_face.png?v=2");
    this.load.image("goal_window_face_hit", "assets/building/goal_window_face_hit.png?v=2");
    this.load.image("char_idle", "assets/character/character1_idle.png?v=2"); // empty-handed: no snowballs left
    this.load.image("char_idle_snowball", "assets/character/character1_idle_snowball.png"); // a snowball in hand
    this.load.image("char_aiming", "assets/character/character1_aiming.png?v=3"); // empty-handed
    this.load.image("char_aiming_snowball", "assets/character/character1_aiming_snowball.png"); // a snowball in hand (used when USE_HELD_PROJECTILES is off)
    this.load.image("char_throwing", "assets/character/character1_throwing.png");
    // Pryk (2026-09-23): the second character, empty-handed poses only (see CHARACTERS below) - the held-projectile
    // system means a character needs no per-projectile art of its own any more (docs/CALIBRATION.md "Adding a
    // character"). Its card thumbnail (pryk_face.png) is NOT loaded here - that one goes through the reactive
    // characters/sceneries/weathers preload above, from its economy.json "image" field, like every other skin's.
    this.load.image("pryk_idle", "assets/character/pryk_idle.png");
    this.load.image("pryk_aiming", "assets/character/pryk_aiming.png");
    this.load.image("pryk_throwing", "assets/character/pryk_throwing.png");
    this.load.image("chestnut", "assets/snowball/chestnut.png");
    this.load.image("onion", "assets/snowball/onion.png");
    // Keyed by its OWN PATH, not "weather_snow" - a real bug found and fixed 2026-09-22: Blizzard's particle happens to
    // be this exact same file, and applyWeather() used to key it "weather_blizzard" instead - loading the SAME URL
    // under a SECOND key while the first was already loaded reproducibly hung Phaser's loader forever (progress stuck
    // partway, "complete" never fires, the game never finishes booting - not just a cosmetic flash). Keying every
    // weather's texture by its particle path (see applyWeather) means two weathers sharing a file always share a key.
    this.load.image("assets/weather/snowflake.png", "assets/weather/snowflake.png");
    this.load.image("drone", "assets/snowball/drone.png");
    this.load.image("potato", "assets/snowball/potato.png");
    this.load.image("pinecone", "assets/snowball/pine_cone.png?v=2");
    this.load.image("stone", "assets/snowball/stone.png");
    this.load.image("egg", "assets/snowball/egg.png");
    this.load.image("char_idle_egg", "assets/character/character1_idle_egg.png");
    this.load.image("char_aiming_egg", "assets/character/character1_aiming_egg.png");
    this.load.image("egg_impact", "assets/snowball/egg_impact.png"); // the splat it leaves on the wall
    this.load.image("tomato", "assets/snowball/tomato.png");
    this.load.image("char_idle_tomato", "assets/character/character1_idle_tomato.png");
    this.load.image("char_aiming_tomato", "assets/character/character1_aiming_tomato.png");
    this.load.image("tomato_impact", "assets/snowball/tomato_impact.png"); // the splat it leaves on the wall
    this.load.image("rowan_berry", "assets/snowball/rowan_berry_projectile.png?v=2"); // the ball in the air (the card / shop icon is rowan_berry.png)
    this.load.image("char_idle_rowan_berry", "assets/character/character1_idle_rowan_berry.png");
    this.load.image("char_aiming_rowan_berry", "assets/character/character1_aiming_rowan_berry.png");
    this.load.image("char_idle_stone", "assets/character/character1_idle_stone.png");
    this.load.image("char_aiming_stone", "assets/character/character1_aiming_stone.png");
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
    // Every character/scenery/weather thumbnail, queued reactively the moment economy.json itself has arrived (still
    // mid-batch - the loader hasn't reached "complete" yet, since other files are still in flight) so they finish
    // loading under THIS same loading screen instead of popping in the first time SKINS or an account card needs one.
    // These are plain <img src> tags elsewhere (collection.js), not Phaser textures - loading them here still puts
    // them in the browser's own HTTP cache under their exact URL, so that later <img> reference is instant.
    //
    // NOTE (2026-09-22): also tried preloading the player's ACTUALLY EQUIPPED scenery/weather here (their real
    // in-game asset, to stop a brief flash of the default one before applyScenery()/applyWeather()'s own lazy load
    // catches up) - reverted. Queuing that extra file (via this exact same reactive pattern, and separately via a
    // synchronous XHR read of economy.json before the loader even starts) both reproducibly stalled Phaser's loader
    // completely - totalToLoad/totalComplete mismatched with nothing in-flight and nothing failed, stuck well short
    // of 100%, "complete" never fires, the game never boots. Root cause not pinned down with confidence; shipping it
    // would break the game for anyone with a non-default scenery/weather equipped, which is far worse than the
    // flash it was meant to fix. Left as a known limitation - see docs/NOTES.md.
    this.load.on("filecomplete-json-economy", (key, type, data) => {
      const seen = new Set();
      let n = 0;
      ["characters", "sceneries", "weathers"].forEach((listKey) => {
        (data[listKey] || []).forEach((item) => {
          if (item.image && !seen.has(item.image)) {
            seen.add(item.image);
            this.load.image("skin_preload_" + n++, item.image);
          }
        });
      });
    });
    this.load.audio("theme", "assets/audio/theme.mp3?v=2");
    this.load.audio("event_banana_face", "assets/audio/event_banana_face.mp3");
    this.load.audio("throw_whoosh", "assets/audio/throw_whoosh.mp3");
    this.load.audio("snowball_impact", "assets/audio/snowball_impact.mp3");
    this.load.audio("window_clink", "assets/audio/window_clink.mp3");
    this.load.audio("click", "assets/audio/click.mp3");
    this.load.audio("shop_restock", "assets/audio/shop_restock.mp3?v=2");
    this.load.audio("chestnut_impact", "assets/audio/chestnut_impact.mp3");
    this.load.audio("grenade_launch", "assets/audio/grenade_launch.mp3");
    this.load.audio("grenade_impact", "assets/audio/grenade_impact.mp3");
    this.load.audio("drone_fly", "assets/audio/drone_fly.mp3");
    this.load.audio("drone_impact", "assets/audio/drone_impact.mp3");
    this.load.audio("buff_use", "assets/audio/buff_use.mp3");
    this.load.audio("angels", "assets/audio/angels.mp3");
    this.load.audio("hard_impact", "assets/audio/hard_impact.mp3");
    this.load.audio("egg_impact", "assets/audio/egg_impact.mp3");
    this.load.audio("tomato_impact", "assets/audio/tomato_impact.mp3");
    for (let i = 1; i <= 6; i++) this.load.image("discoface" + i, "assets/building/discoface" + i + ".png");
    for (let i = 1; i <= 3; i++) this.load.image("guitar" + i, "assets/building/guitar" + i + ".png");
    this.load.image("rose", "assets/building/rose.png");
    this.load.audio("disco", "assets/audio/disco.mp3");
    this.load.audio("guitar", "assets/audio/guitar.mp3");
    this.load.audio("applause", "assets/audio/applause.mp3");
  }

  create() {
    // Rewards/prices live in economy.json (edit that, not the code). A typo there would otherwise
    // fail silently later, so say so loudly right away.
    this.eco = this.cache.json.get("economy");
    if (!this.eco) throw new Error("economy.json failed to load or has a JSON syntax error - check it.");
    this.prepareProjectiles();
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
    this.applyScenery(Economy.getEquipped("scenery")); // the equipped scenery's wall picture (Frosty = background.png)
    this.weather = null; // the equipped weather that is falling: see applyWeather
    this.applyWeather(Economy.getEquipped("weather"));

    this.drawCharacter();

    this.fallingBalls = []; // projectiles still falling after their bounce when the result screen ended - see releaseBounce
    this.marks = []; // stuck-snowball sprites; each one schedules its own fade-out in addMark()

    // Sits over W20, invisible until the banana event triggers - see startBananaEvent().
    this.bananaOverlay = this.add
      .image(FACE_IMG_X, this.worldY(FACE_IMG_TOP_HEIGHT), "goal_window_face")
      .setOrigin(0, 0); // native size, 1:1 with the wall - no scaling, no crop
    this.bananaOverlay.setDepth(1); // above the building, below marks/ball
    this.bananaOverlay.setAlpha(0);
    this.bananaOverlay.setVisible(false);
    this.bananaActive = false;
    this.bananaHitTriggered = false;
    this.buffEventId = null; // id of the buff (Tomato Juice) that is running the current face event, or null - see syncBuffEvent
    this.activeEvent = null; // name of the running random event, or null - at most ONE runs at a time (see startEvent)
    this.songPhase = null; // null, "song" or "applause" while the disco event runs
    this.roses = []; // the roses falling during the applause
    this.songEvent = null; // { name, startedAt } of the running disco (also saved: Economy.getEvent)
    this.heldEventStep = null; // a change of an event (its end, a new phase) that waits for the throw being aimed / in the air to be over
    Buffs.setEventLength((name) => (SONG_EVENTS[name] && this.songSounds ? this.songTimes(name).songMs : 0)); // (a summon buff shows how long its event lasts)
    Buffs.setEventGate(() => this.eventBlocksStart()); // no event buff can be used while an event runs (the disco's applause can be cut)

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

    // Master volume: the value of the slider in OPTIONS (Volume, remembered on the device; 0.5 until the player moves it), rather than
    // every individual sound.play() call.
    this.sound.volume = Volume.get();

    // Loops forever so the theme doesn't just play once and go silent - it's a few minutes
    // long, not actually infinite on its own.
    this.startThemeMusic();
    this.songSounds = {}; // the song of each song event, by event name
    for (const [name, def] of Object.entries(SONG_EVENTS)) this.songSounds[name] = this.sound.add(def.sound, { volume: def.volume });
    this.applauseSound = this.sound.add("applause", { volume: APPLAUSE_VOLUME });
    this.resumeSavedEvent(); // a song event (disco, guitar) that was running when the game was closed goes on where the clock says it is
    if (/^(localhost|127\.)/.test(location.hostname)) {
      window.calibrateHeld = () => this.calibrateHeldProjectiles(); // dev tools, see docs/CALIBRATION.md
      window.calibrateSheet = () => this.showCalibrationSheet();
      // God mode, for testing: was the "god mode" import code (SAVES section, removed 2026-09-22 - see docs/NOTES.md "The
      // leaderboard"); this is its replacement, a console-only dev tool. Builds the same save the old code did (a huge wallet,
      // 999 of every projectile / buff, flagged god so Economy never uses anything up or charges) and reloads into it.
      // Refuses while signed in to a real account (the owner's rule, 2026-09-22 - "I'm a player too!"): a god save must
      // never locally overwrite a real signed-in save. The other half of the same guard lives in cloud.js's signIn(),
      // which refuses to sign in while a god save is active - so a god save can never reach an account in either direction.
      window.godMode = async () => {
        if (typeof Cloud !== "undefined" && Cloud.getUser && Cloud.getUser()) {
          console.warn("godMode: signed in to a real account - sign out first (OPTIONS > ACCOUNT), then try again.");
          return;
        }
        let eco;
        try {
          eco = await (await fetch("economy.json?t=" + Date.now())).json();
        } catch (e) {
          console.error("godMode: could not load economy.json", e);
          return;
        }
        const s = JSON.parse(Economy.freshJson());
        s.god = true;
        s.coins = 999999999;
        s.lifetimeCoins = 999999999;
        for (const [id, p] of Object.entries(eco.projectiles || {})) if (id !== "snowball" && !p.infinite && !p.regen) s.projectiles[id] = 999;
        for (const it of (eco.shop && eco.shop.items) || []) if (it.category === "consumable") s.buffItems[it.id] = 999;
        localStorage.setItem(Economy.storageKey, JSON.stringify(s));
        location.reload();
      };
    }
    window.snowyBallsReady = true; // the game is up: the "grand cleansing" screen (index.html) may fade out now
    const loadingEl = document.getElementById("loading-screen");
    if (loadingEl) loadingEl.classList.add("hide"); // its job is done - no minimum hold time, unlike the cleansing screen

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
    const available =
      known &&
      !(this.eco.projectiles[id].godOnly && !Economy.isGod()) && // (a test projectile equipped in a god save, then a normal save loaded)
      (this.eco.projectiles[id].infinite || this.eco.projectiles[id].regen || Economy.getProjectileCount(id) > 0);
    if (!known || !available) {
      id = known && !this.eco.projectiles[id].godOnly ? this.nextProjectileAfter(id) : "snowball"; // one that ran out: the next one (same rarity, then one step down); else the default
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
  //    "WEIGHT" above), narrowed by a precision buff (a bigger hit zone); smaller = more precise.
  //  powerRange: how much of the power span the strength slider covers (1 = all of it; strength-control buff).
  takeAimSnapshot() {
    const b = Buffs.modifiers();
    const cfg = { ...AIM_DEFAULTS, ...(this.eco.aim || {}) };
    // The offset hit zone (the share of the bar that hits) comes from the projectile's weight tier, then a precision buff
    // makes it bigger (zone x precision).
    const zone = (typeof this.proj.offsetZone === "number" ? this.proj.offsetZone : DEFAULT_OFFSET_ZONE) * b.precision;
    this.aim = {
      markerHz: cfg.markerHz, // the STRENGTH marker's fixed speed
      angleMarkerHz: cfg.markerHz * b.offsetSpeed, // the OFFSET marker's: the same, x the slow-down buffs (Triangles 0.8 x 0.9 ...)
      angleRange: offsetRangeForZone(zone),
      offsetCenter: b.offsetCenter, // where on the bar the hit zone is centered (0.5 = the middle; the Blizzard weather: 0.25)
      powerRange: 1 / b.strengthControl,
      coinMultiplier: b.coinMultiplier,
      guideLines: b.guideLines > 0, // the green guarantee lines are only drawn while a buff (Orange Skyr) gives them
      miracleId: b.miracle > 0 ? b.miracleBy : null, // the Diamond Cross that helps THIS throw (used up when the throw reaches its apex)
      centerLine: b.centerLine > 0, // one green line at the middle of the hit zone on each slider (Blue Skyr)
      eventHitzone: b.eventHitzone > 0, // the hitzone that marks an event's face on the sliders is only drawn with a buff that shows it (the epic Skyr)
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

  // Throwing away an aim in progress (opening the shop, equipping something else, closing the app): before the offset was chosen it costs nothing (the
  // projectile is only used up when the offset is chosen); after that it counts as a failed throw - the projectile is NOT given back and the streak is
  // lost, otherwise a bad aim could be escaped for free. (No miss coins, no message: nothing was thrown.) Call it while the state is still the aim's.
  abandonAim() {
    const committed = this.state === STATE.AIM_POWER; // the offset was chosen: the projectile is gone
    Economy.setAiming(false);
    if (!committed) return;
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

  // Consumable projectiles: one is used up the moment the player CHOOSES THE OFFSET (the second tap of the aim; a tap on "TAP to aim" alone, or
  // an aim thrown away before that, costs nothing). The throw still uses it (this.proj is unchanged until the throw is over); if it was the LAST
  // one, the next projectile is equipped (nextProjectileAfter) - saved right now, applied when the throw concludes (pendingProjectile), so the
  // aim isn't disturbed.
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
      const next = this.nextProjectileAfter(id);
      Economy.setEquipped("projectile", next);
      this.pendingProjectile = next;
    }
  }

  // What to equip when `id` has run out: a projectile of the SAME rarity that the player still has (the one with the highest hit value, like the list);
  // none -> the same for the rarity ONE STEP LOWER; and so on down to the snowball (rarity default; it refills, so it is always there). Deliberately
  // one step down and not "the best one they have": a player may be saving their best projectile (for an event) and must not throw it by accident.
  nextProjectileAfter(id) {
    const order = (this.eco.rarities || []).map((r) => r.id);
    const rank = (pid) => order.indexOf((this.eco.projectiles[pid] || {}).rarity);
    const usable = (pid) => {
      const p = this.eco.projectiles[pid];
      return pid !== id && p && PROJECTILE_VISUALS[pid] && !(p.godOnly && !Economy.isGod()) && (p.infinite || p.regen || Economy.getProjectileCount(pid) > 0);
    };
    for (let r = Math.max(0, rank(id)); r >= 0; r--) {
      const cands = Object.keys(this.eco.projectiles)
        .filter((pid) => rank(pid) === r && usable(pid))
        .sort((a, b) => (this.eco.projectiles[b].hitValue || 0) - (this.eco.projectiles[a].hitValue || 0));
      if (cands.length) return cands[0];
    }
    return "snowball";
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

  // The always-visible counter under the top-right buttons (where the STREAK counter was): the equipped projectile's picture and how many are left,
  // "[picture] x12" ("xINF" in god mode; the snowball shows its refilling stock). Redrawn only when the projectile or the number changes (checked every
  // frame). The text shrinks a little if it would be wider than the box. (The streak itself is still counted and saved, just not shown.)
  updateAmmoHud() {
    if (!this.projectileId) return; // (not chosen yet while the scene is being built)
    const n = Economy.isGod() ? "INF" : String(Economy.getProjectileCount(this.projectileId));
    const key = this.projectileId + ":" + n;
    if (key === this.ammoHudShown) return;
    this.ammoHudShown = key;
    const box = document.getElementById("ammo-box");
    if (box) this.tintAmmoBox(box, (this.eco.projectiles[this.projectileId] || {}).rarity);
    const icon = document.getElementById("ammo-icon");
    const text = document.getElementById("ammo-text");
    if (!icon || !text) return;
    const src = Collection.projectileImage(this.projectileId);
    if (icon.getAttribute("src") !== src) icon.setAttribute("src", src);
    text.textContent = "x" + n;
    text.style.fontSize = Math.min(8, Math.floor(60 / (n.length + 1))) + "px"; // 60px = the box minus its border, padding and the picture
  }

  // The counter's background reflects the equipped projectile's rarity (economy.json rarities colour; the legendary rainbow is animated: .rainbow
  // in index.html, like the buff cards).
  tintAmmoBox(box, rarityId) {
    const r = Rarity.info(rarityId);
    box.classList.remove("tinted", "rainbow");
    box.style.removeProperty("--tint");
    if (!r) return;
    if (r.color === "rainbow") {
      box.classList.add("rainbow");
      return;
    }
    const m = /^#([0-9a-f]{6})$/i.exec(r.color || "");
    if (!m) return;
    const n = parseInt(m[1], 16);
    box.style.setProperty("--tint", `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.6)`);
    box.classList.add("tinted");
  }

  // A projectile was saved this throw (Water Bottle/etc. - see this.savedBy): the counter's outline flashes bright
  // white once, alongside its "Saved Projectile" message. Restarts cleanly even if the previous flash hasn't finished.
  flashAmmoSaved() {
    const box = document.getElementById("ammo-box");
    if (!box) return;
    box.classList.remove("saved-flash");
    void box.offsetWidth; // restart the CSS animation from frame 0 rather than no-op if it's already mid-flash
    box.classList.add("saved-flash");
  }

  updateStreakHud() {
    this.updateAmmoHud(); // (the streak is no longer shown; the counter is redrawn whenever it changes)
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
    // A camera whose width / height is ODD gets a half-pixel offset in that direction (its matrix translates by -0.5), and with
    // roundPixels on, the vertices of a sprite then round unevenly: a picture such as the face window came out 1px stretched and
    // shifted in this window. Scrolling by the same half pixel puts everything back on whole pixels.
    this.targetCam.scrollX = worldXFrom - (viewW % 2 ? 0.5 : 0);
    this.targetCam.scrollY = this.worldY(heightTo) - (viewH % 2 ? 0.5 : 0);
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
    this.theme = this.sound.add("theme", { loop: true, volume: THEME_VOLUME });
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

  // Crossfades between the theme and the event music. Safe to call at any time and as often as you like: a fade that is still
  // running is stopped and the new one starts from the volumes the tracks have right now, so nothing ever jumps.
  setEventMusic(on) {
    if (this.eventMusicOn === on) return;
    this.eventMusicOn = on;
    if (!this.eventMusic) this.eventMusic = this.sound.add("event_banana_face", { loop: true, volume: 0 });
    if (on && !this.eventMusic.isPlaying) {
      this.eventMusic.play({ loop: true, volume: 0 }); // (a plain play() would restart it at full volume)
      this.eventMusic.setVolume(0);
    }
    (this.musicTweens || []).forEach((tw) => tw.stop());
    const fade = (sound, to, onDone) =>
      this.tweens.add({ targets: sound, volume: to, duration: MUSIC_FADE_MS, ease: "Sine.easeInOut", onComplete: onDone });
    this.musicTweens = [
      this.theme ? fade(this.theme, on ? 0 : THEME_VOLUME) : null,
      fade(this.eventMusic, on ? EVENT_MUSIC_VOLUME : 0, () => {
        if (!on) this.eventMusic.stop(); // faded out: it starts from the beginning next time
      }),
    ].filter(Boolean);
  }

  // INTENTIONAL (owner's decision, 2026-09-20 - keep it): this ducks the THEME and the banana event music only. A disco track (or its applause)
  // that is playing is NOT ducked, so the angels of a miracle in the middle of the disco play over it.
  // The miracle of the Diamond Cross: the music (theme, and the event music if it is on) fades out quickly so only the angels are
  // heard, and fades back in after the projectile's impact. The volumes it fades back to are read at that moment (an event may have changed them).
  duckMusic() {
    (this.musicTweens || []).forEach((tw) => tw.stop());
    if (this.duckTween) this.duckTween.forEach((tw) => tw.stop());
    const to0 = (sound) => (sound ? this.tweens.add({ targets: sound, volume: 0, duration: MIRACLE_MUSIC_FADE_MS, ease: "Sine.easeInOut" }) : null);
    this.duckTween = [to0(this.theme), to0(this.eventMusic)].filter(Boolean);
  }

  unduckMusic() {
    if (this.duckTween) this.duckTween.forEach((tw) => tw.stop());
    // (a crossfade that finishThrow may just have started - a face hit ends the event music - is replaced by this one, which goes to the same volumes)
    (this.musicTweens || []).forEach((tw) => tw.stop());
    const back = (sound, to, onDone) =>
      sound ? this.tweens.add({ targets: sound, volume: to, duration: MIRACLE_MUSIC_FADE_MS, ease: "Sine.easeInOut", onComplete: onDone }) : null;
    this.duckTween = [
      back(this.theme, this.eventMusicOn || this.songPhase ? 0 : THEME_VOLUME), // (the disco event keeps it down until it is over)
      back(this.eventMusic, this.eventMusicOn ? EVENT_MUSIC_VOLUME : 0, () => {
        if (!this.eventMusicOn && this.eventMusic) this.eventMusic.stop(); // (the event is over: it starts from the beginning next time)
      }),
    ].filter(Boolean);
  }

  // Turns what economy.json says about each projectile into what the game uses, once, right after loading:
  //  - weight: the tier name -> its strength band, its label (shown on the card) and its offset hit zone (offsetZone);
  //  - hitValue: from the projectile's rarity (rarities[].projectileHitValue), unless the projectile has a hitValue of its own.
  prepareProjectiles() {
    const tiers = Object.fromEntries((this.eco.weightTiers || []).map((t) => [t.id, t]));
    const rarities = Object.fromEntries((this.eco.rarities || []).map((r) => [r.id, r]));
    for (const [id, p] of Object.entries(this.eco.projectiles || {})) {
      if (p.weightId) continue; // (already prepared: the scene was restarted with the same cached economy.json)
      const t = tiers[p.weight] || tiers.moderate;
      if (!t) throw new Error(`economy.json: projectile ${id} has an unknown weight tier '${p.weight}'`);
      p.weightId = t.id;
      p.weightLabel = t.label;
      p.strengthBand = { from: t.from, to: t.to };
      p.offsetZone = typeof t.offsetZone === "number" ? t.offsetZone : DEFAULT_OFFSET_ZONE; // the share of the offset bar that hits
      if (typeof p.hitValue !== "number") {
        const r = rarities[p.rarity];
        p.hitValue = r && typeof r.projectileHitValue === "number" ? r.projectileHitValue : 1;
      }
    }
  }

  worldY(heightFromGround) {
    // Phaser y grows downward; our "height climbed" grows upward.
    return -heightFromGround;
  }

  // Character sprite (64x64 frames, feet at the bottom edge). Pose follows game state - see
  // updateCharacterPose().
  drawCharacter() {
    const baseY = this.worldY(0) + CHARACTER_Y_OFFSET;
    this.characterId = this.characterKeyFor(Economy.getEquipped("character")); // which CHARACTERS entry the equipped character uses
    this.character = this.add.image(Math.round(ORIGIN_X), baseY + 1, CHARACTERS[this.characterId].sprites.idle).setOrigin(0.5, 1);
    this.character.setDepth(2);
    this.heldBall = this.add.image(0, 0, "snowball").setVisible(false); // the projectile in the hand, see CHARACTERS
  }

  updateCharacterPose() {
    if (this.calibrating) return; // calibrateHeldProjectiles() sets the pose itself
    const sprites = this.projVisuals.sprites; // the equipped projectile's own set (used when USE_HELD_PROJECTILES is off)
    const mine = CHARACTERS[this.characterId].sprites; // the character's empty-handed pictures
    const held = USE_HELD_PROJECTILES; // the empty-handed pictures + the projectile drawn in the hand
    let key = held ? mine.idle : sprites.idle;
    let pose = "idle";
    if (this.state === STATE.IDLE && !this.hasAmmo()) {
      key = mine.idle; // out of snowballs: empty hands
      pose = "empty";
    }
    if (this.state === STATE.AIM_ANGLE || this.state === STATE.AIM_POWER) {
      key = held ? mine.aiming : sprites.aiming;
      pose = "aiming";
    } else if (this.state === STATE.FLIGHT && this.flightTime < 0.35) {
      key = held ? mine.throwing : sprites.throwing;
      pose = "throwing";
    }
    if (this.character.texture.key !== key) this.character.setTexture(key);
    this.updateHeldBall(held ? pose : "none");
  }

  // CALIBRATION CHECK (a dev tool, also `calibrateHeld()` in the console on localhost): for every character x every projectile x the two poses it
  // places the projectile in the hand exactly as the game does and compares the picture rendered at the DEFAULT zoom with and without the projectile,
  // so it counts the pixels the projectile really adds. Returns the rows; `ok` is false when fewer than 4 pixels show (a 2 x 2 dot: what the rowan
  // berry has), i.e. the projectile vanishes (too small, hidden behind the hand, wrong place). It cannot judge how it LOOKS (position, upside down,
  // layer): after it passes, look at each new pair zoomed in (docs/CALIBRATION.md).
  async calibrateHeldProjectiles() {
    const frames = (n) =>
      new Promise((res) => {
        let k = 0;
        const f = () => (++k >= n ? res() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      });
    const grab = (x, y, w, h) =>
      new Promise((res) =>
        this.game.renderer.snapshotArea(x, y, w, h, (img) => {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const g = c.getContext("2d");
          g.drawImage(img, 0, 0);
          res(g.getImageData(0, 0, w, h).data);
        })
      );
    const rows = [];
    const cam = this.cameras.main;
    const saved = { proj: this.projVisuals, char: this.characterId, tex: this.character.texture.key, sx: cam.scrollX, sy: cam.scrollY, z: cam.zoom };
    this.calibrating = true;
    cam.setZoom(1);
    cam.scrollX = INITIAL_SCROLL_X;
    cam.scrollY = INITIAL_SCROLL_Y;
    try {
      for (const charId of Object.keys(CHARACTERS)) {
        this.characterId = charId;
        for (const projId of Object.keys(PROJECTILE_VISUALS)) {
          if (!this.eco.projectiles[projId]) continue;
          this.projVisuals = PROJECTILE_VISUALS[projId];
          for (const pose of ["idle", "aiming"]) {
            this.character.setTexture(CHARACTERS[charId].sprites[pose]);
            const b = this.heldBall;
            b.setAlpha(1);
            this.updateHeldBall(pose);
            await frames(3);
            const sx = Math.round((b.x - cam.scrollX) * cam.zoom) - 12;
            const sy = Math.round((b.y - cam.scrollY) * cam.zoom) - 12;
            const withBall = await grab(sx, sy, 24, 24);
            b.setAlpha(0);
            await frames(3);
            const without = await grab(sx, sy, 24, 24);
            b.setAlpha(1);
            let added = 0;
            for (let i = 0; i < withBall.length; i += 4) if (withBall[i] !== without[i] || withBall[i + 1] !== without[i + 1] || withBall[i + 2] !== without[i + 2]) added++;
            const drawn = (this.textureContentPx(b.texture.key) * b.displayWidth) / b.frame.width;
            rows.push({ character: charId, projectile: projId, pose, drawnPx: +drawn.toFixed(1), spritePx: b.displayWidth, layer: b.depth < this.character.depth ? "under" : "over", addedPixels: added, ok: added >= 4 });
          }
        }
      }
    } finally {
      this.calibrating = false;
      this.characterId = saved.char;
      this.projVisuals = saved.proj;
      this.character.setTexture(saved.tex);
      cam.setZoom(saved.z);
      cam.scrollX = saved.sx;
      cam.scrollY = saved.sy;
    }
    return rows;
  }

  // CONTACT SHEET (a dev tool, `calibrateSheet()` in the console on localhost; tap it to close): every character x every projectile, the idle hand
  // on the top row and the aiming hand under it, cut out of the rendered game at the default zoom and enlarged 4 times - for LOOKING at each pair
  // (position, size, upside down, layer) after calibrateHeldProjectiles() has said they all show. See docs/CALIBRATION.md.
  async showCalibrationSheet() {
    const frames = (n) =>
      new Promise((res) => {
        let k = 0;
        const f = () => (++k >= n ? res() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      });
    const grab = (x, y, w, h) =>
      new Promise((res) =>
        this.game.renderer.snapshotArea(x, y, w, h, (img) => {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          c.getContext("2d").drawImage(img, 0, 0);
          res(c);
        })
      );
    const ids = Object.keys(PROJECTILE_VISUALS).filter((id) => this.eco.projectiles[id]);
    const chars = Object.keys(CHARACTERS);
    const CW = 24, CH = 22, K = 4, GAP = 6, LABEL = 26;
    const sheet = document.createElement("canvas");
    sheet.width = ids.length * (CW * K + GAP) + GAP;
    sheet.height = chars.length * (2 * CH * K + LABEL * 2 + GAP) + GAP;
    const g = sheet.getContext("2d");
    g.fillStyle = "#222";
    g.fillRect(0, 0, sheet.width, sheet.height);
    g.imageSmoothingEnabled = false;
    g.font = "11px monospace";
    const cam = this.cameras.main;
    const saved = { proj: this.projVisuals, char: this.characterId, tex: this.character.texture.key, sx: cam.scrollX, sy: cam.scrollY, z: cam.zoom };
    this.calibrating = true;
    cam.setZoom(1);
    cam.scrollX = INITIAL_SCROLL_X;
    cam.scrollY = INITIAL_SCROLL_Y;
    try {
      let y0 = GAP;
      for (const charId of chars) {
        this.characterId = charId;
        g.fillStyle = "#ffd";
        g.fillText(charId, GAP, y0 + 10);
        ids.forEach(() => {});
        for (let i = 0; i < ids.length; i++) {
          this.projVisuals = PROJECTILE_VISUALS[ids[i]];
          for (let r = 0; r < 2; r++) {
            const pose = r === 0 ? "idle" : "aiming";
            this.character.setTexture(CHARACTERS[charId].sprites[pose]);
            this.heldBall.setAlpha(1);
            this.updateHeldBall(pose);
            await frames(3);
            const left = Math.round(this.character.x - 32 - cam.scrollX);
            const top = Math.round(this.character.y - 64 - cam.scrollY);
            const img = await grab(left + 28, top + (r === 0 ? 22 : -2), CW, CH);
            const x = GAP + i * (CW * K + GAP);
            const y = y0 + LABEL + r * (CH * K + LABEL);
            g.drawImage(img, x, y, CW * K, CH * K);
            if (r === 0) {
              g.fillStyle = "#fff";
              g.fillText(ids[i], x, y - 3);
            }
          }
        }
        y0 += 2 * CH * K + LABEL * 2 + GAP;
      }
    } finally {
      this.calibrating = false;
      this.characterId = saved.char;
      this.projVisuals = saved.proj;
      this.character.setTexture(saved.tex);
      cam.setZoom(saved.z);
      cam.scrollX = saved.sx;
      cam.scrollY = saved.sy;
    }
    const el = document.createElement("img");
    el.src = sheet.toDataURL();
    el.style.cssText = "position:fixed;left:0;top:0;z-index:99999;background:#222;width:100vw;image-rendering:pixelated";
    el.addEventListener("click", () => el.remove());
    document.body.appendChild(el);
  }

  // How many pixels the drawn part of a picture is wide / high (the larger of the two; its opaque bounding box), measured once per picture.
  textureContentPx(key) {
    this.contentPx = this.contentPx || {};
    if (this.contentPx[key] !== undefined) return this.contentPx[key];
    let px = 32;
    try {
      const img = this.textures.get(key).getSourceImage();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      if (x1 >= 0) px = Math.max(1, x1 - x0 + 1, y1 - y0 + 1);
    } catch (e) {
      /* keep the default */
    }
    this.contentPx[key] = px;
    return px;
  }

  // ---- SKINS (the SKINS button, collection.js): characters and sceneries, economy.json characters / sceneries ----

  // The CHARACTERS entry (pictures, hand numbers) a character of economy.json uses (its `character`); the default one if unknown.
  characterKeyFor(id) {
    const c = ((this.eco && this.eco.characters) || []).find((x) => x.id === id);
    return c && CHARACTERS[c.character] ? c.character : DEFAULT_CHARACTER;
  }

  // Called by the list when the player equips another character: it is used from the next frame (the pose code reads characterId every frame).
  onCharacterEquipped(id) {
    this.characterId = this.characterKeyFor(id);
    this.updateCharacterPose();
  }

  // The wall picture of a scenery. It must be exactly as big as background.png (704 x 1000) with the windows in the same places, so this is only
  // a visual change - nothing else in the game moves. The default background is already loaded ("background"); another one is loaded the first time it is used.
  applyScenery(id) {
    const list = (this.eco && this.eco.sceneries) || [];
    const s = list.find((x) => x.id === id) || list[0];
    if (!s) return;
    const key = s.background === DEFAULT_BACKGROUND ? "background" : "scenery_" + s.id;
    const set = () => {
      const img = this.textures.get(key).getSourceImage();
      if (img.width !== WORLD_WIDTH || img.height !== 1000) console.warn(`scenery ${s.id}: ${s.background} is ${img.width}x${img.height}, it must be ${WORLD_WIDTH}x1000 like background.png`);
      this.bgImage.setTexture(key);
    };
    if (this.textures.exists(key)) set();
    else {
      this.load.image(key, s.background);
      this.load.once("complete", set);
      this.load.start();
    }
  }

  onSceneryEquipped(id) {
    this.applyScenery(id);
  }

  // ---- WEATHER (economy.json weathers, the third skins category) ----
  // Particles fall from the sky just like the roses of the applause (they start above the top of the world, fall and are gone below the bottom of
  // the default view), over the whole game picture, for as long as the weather is equipped. A weather names its density and its fall speed (economy.json
  // weatherDensities / weatherSpeeds): the density is how many particles are in the picture (432 x 243) at once, so the spawn rate is worked out from it and the
  // fall speed - a slow weather is not thinner than a fast one. When a weather starts the sky is already full (the particles are spread over the whole fall).
  // A weather may fall at an ANGLE (degrees from straight down, positive = towards the right: the Blizzard's 65 blows from the left to the right at speed): the
  // speed is then along the path, and the particles also come in over the left edge (or the right one for a negative angle) - the same number per area as
  // everywhere else - and are gone when they leave over the other side.
  applyWeather(id) {
    this.clearWeather();
    const list = (this.eco && this.eco.weathers) || [];
    const def = list.find((x) => x.id === id) || list[0];
    if (!def) return;
    let w;
    if (!def.particle) {
      w = { id: def.id, def, noParticles: true, particles: [] }; // a weather with no particles (Sunny): nothing falls, and it does not affect the event particles either
    } else {
      const speed = ((this.eco.weatherSpeeds || {})[def.fallSpeed]) || { from: 50, to: 75 };
      const onScreen = ((this.eco.weatherDensities || {})[def.density]) ?? 15;
      const angle = ((def.angle || 0) * Math.PI) / 180;
      // Keyed by the PARTICLE'S OWN PATH, not the weather's id - see the static preload's snowflake.png comment: two
      // weathers sharing the same file (Blizzard reuses Snow's) must share the same texture key, or loading that URL
      // under a second key while the first is already loaded hangs Phaser's loader completely.
      w = { id: def.id, def, key: def.particle, onScreen, from: speed.from, to: speed.to, sin: Math.sin(angle), cos: Math.cos(angle), accTop: 0, accSide: 0, particles: [], age: 0 };
      const mean = (speed.from + speed.to) / 2;
      w.left = INITIAL_SCROLL_X - WEATHER_MARGIN; // the sides of the sky the particles live in (a little wider than the picture)
      w.right = INITIAL_SCROLL_X + GAME_WIDTH + WEATHER_MARGIN;
      w.top = this.worldY(TOP_BOUNDARY_HEIGHT);
      w.bottom = INITIAL_SCROLL_Y + GAME_HEIGHT; // the bottom edge of the default camera view: a particle is gone once it is below it
      const perArea = onScreen / ((w.right - w.left) * GAME_HEIGHT); // particles per px of sky
      w.rateTop = (onScreen * mean * w.cos) / GAME_HEIGHT; // a second, over the top: the ones in the picture x how fast they leave it downwards / its height
      w.rateSide = perArea * (w.bottom - w.top) * mean * Math.abs(w.sin); // a second, over the left / right edge (0 for a straight fall)
    }
    this.weather = w;
    // What the weather needs is loaded the first time it is used (its particle picture, its sound): both are queued before ONE start, then the weather starts.
    // Keyed by its own path too (see the particle key above) - the same fix, in case two weathers ever share a sound file.
    const soundKey = def.sound;
    const needPicture = !!def.particle && !this.textures.exists(w.key);
    const needSound = !!def.sound && !this.cache.audio.exists(soundKey);
    const start = () => {
      if (this.weather !== w) return; // another weather was equipped while this one loaded
      if (def.particle && !w.filled && this.textures.exists(w.key)) this.fillWeather();
      this.startWeatherSound(w, soundKey);
    };
    if (needPicture) this.load.image(w.key, def.particle);
    if (needSound) this.load.audio(soundKey, def.sound);
    if (needPicture || needSound) {
      this.load.once("complete", start);
      this.load.start();
    } else start();
  }

  // A weather's sound (economy.json `sound`, `soundVolume`): a loop for as long as the weather is equipped, played ALONGSIDE everything else - the theme, the events'
  // music and songs, the applause, the throws' sounds: it always plays, EVEN DURING EVENTS, and is never ducked, cut or paused by them (the master volume and the
  // Weather slider of OPTIONS still scale it). Nothing may stop or duck `weather.sound`: the duck / crossfade code only ever touches the theme and the event music.
  startWeatherSound(w, key) {
    if (!w.def.sound || w.sound || !this.cache.audio.exists(key)) return;
    w.sound = this.sound.add(key, { loop: true, volume: this.weatherSoundVolume(w.def) });
    w.sound.play();
  }

  // The volume of a weather's sound: its own (`soundVolume`) x the player's Weather slider (Volume.getWeather).
  weatherSoundVolume(def) {
    return (typeof def.soundVolume === "number" ? def.soundVolume : 0.5) * Volume.getWeather();
  }

  // The Weather slider was moved: the sound that is playing follows at once.
  applyWeatherVolume() {
    const w = this.weather;
    if (w && w.sound) w.sound.setVolume(this.weatherSoundVolume(w.def));
  }

  onWeatherEquipped(id) {
    this.applyWeather(id);
  }

  clearWeather() {
    if (this.weather) {
      this.weather.particles.forEach((p) => p.img.destroy());
      if (this.weather.sound) {
        this.weather.sound.stop();
        this.weather.sound.destroy();
      }
    }
    this.weather = null;
  }

  // The sky is full from the first frame: as many particles as there are in a steady fall, spread over the whole sky.
  fillWeather() {
    const w = this.weather;
    w.filled = true;
    const n = Math.round((w.onScreen * (w.bottom - w.top)) / GAME_HEIGHT);
    for (let i = 0; i < n; i++) this.spawnWeatherParticle(Phaser.Math.FloatBetween(w.left, w.right), Phaser.Math.FloatBetween(w.top, w.bottom));
  }

  // One particle at world (x, y). Called without them it comes in over the top of the sky (anywhere across).
  spawnWeatherParticle(x, y) {
    const w = this.weather;
    const size = (w.def.particleSize || 10) * Phaser.Math.FloatBetween(0.8, 1.2);
    if (x === undefined) x = Phaser.Math.FloatBetween(w.left, w.right);
    const img = this.add.image(x, y === undefined ? w.top - size : y, w.key);
    img.setDisplaySize(size, size).setDepth(WEATHER_DEPTH);
    const s = Phaser.Math.FloatBetween(w.from, w.to);
    const drift = w.def.drift || 0;
    w.particles.push({
      img,
      x0: x,
      age: 0,
      vy: s * w.cos,
      vx: s * w.sin + drift * Phaser.Math.FloatBetween(-1, 1), // the slant, and a sideways drift (economy.json `drift`, none by default)
      swayPx: (w.def.sway || 0) * Phaser.Math.FloatBetween(0.5, 1.2), // a gentle swing from side to side (`sway`, none by default)
      swayHz: Phaser.Math.FloatBetween(0.4, 0.9),
      phase: Phaser.Math.FloatBetween(0, Math.PI * 2),
    });
  }

  updateWeather(dt) {
    const w = this.weather;
    if (!w || w.noParticles || !w.filled) return;
    w.accTop += dt * w.rateTop;
    while (w.accTop >= 1) {
      w.accTop -= 1;
      this.spawnWeatherParticle();
    }
    if (w.rateSide > 0) {
      w.accSide += dt * w.rateSide;
      while (w.accSide >= 1) {
        w.accSide -= 1;
        this.spawnWeatherParticle(w.sin > 0 ? w.left : w.right, Phaser.Math.FloatBetween(w.top, w.bottom)); // over the edge the wind blows in from
      }
    }
    w.particles = w.particles.filter((p) => {
      p.age += dt;
      p.img.y += p.vy * dt;
      p.img.x = p.x0 + p.vx * p.age + Math.sin(p.age * p.swayHz * Math.PI * 2 + p.phase) * p.swayPx;
      if (p.img.y - p.img.displayHeight / 2 > w.bottom || p.img.x < w.left - 40 || p.img.x > w.right + 40) {
        p.img.destroy();
        return false;
      }
      return true;
    });
  }

  // The projectile in the character's hand (idle: upside down, aiming: upright), placed by CHARACTERS[..].hands and the projectile's `hold`; hidden when the hands are empty
  // or while the projectile is being thrown.
  updateHeldBall(pose) {
    const base = CHARACTERS[this.characterId].hands[pose];
    const adj = ((this.projVisuals.hold || {})[this.characterId] || {})[pose] || {}; // this projectile's own adjustment for this character and pose
    const hand = base ? { ...base, ...adj, x: base.x + (adj.dx || 0), y: base.y + (adj.dy || 0), rest: base.rest !== undefined ? base.rest + (adj.dy || 0) : undefined } : null;
    const b = this.heldBall;
    if (!hand) {
      b.setVisible(false);
      return;
    }
    if (b.texture.key !== this.projVisuals.ball) b.setTexture(this.projVisuals.ball);
    const c = this.character;
    b.setPosition(c.x - c.displayWidth / 2 + hand.x, c.y - c.displayHeight + hand.y);
    // A picture with only a few pixels in a big canvas (the rowan berry: a 4 px dot in 32 px) would shrink to a fraction of a pixel at hand size and
    // the renderer would drop it: the sprite is made big enough that what is drawn in it is at least HELD_MIN_CONTENT_PX wide.
    // A projectile can be held bigger than the others (`heldScale`, the drone's 3: it must be clearly bigger in the hand).
    const handSize = hand.size * (this.projVisuals.heldScale || 1);
    const size = Math.max(handSize, (b.frame.width * HELD_MIN_CONTENT_PX) / this.textureContentPx(b.texture.key));
    // A projectile whose drawn part is smaller than the normal one (the rowan berry, 2 px) would vanish behind the fist if it were centred like a
    // full-size one: it rests on the fingertips (its bottom edge at hand.rest) instead.
    const content = (this.textureContentPx(b.texture.key) * size) / b.frame.width;
    if (hand.rest !== undefined && content < handSize) b.y = c.y - c.displayHeight + hand.rest - content / 2;
    b.setDisplaySize(size, size).setRotation(hand.rotation).setDepth(hand.behind ? c.depth - 0.5 : c.depth + 0.5).setVisible(true);
  }

  handleFreezeInput() {
    // Belt and braces: never advance the throw while the shop or a list covers the game.
    const cls = document.getElementById("game-container").classList;
    if (cls.contains("shop-open") || cls.contains("list-open")) return;
    if (this.state === STATE.IDLE) {
      if (!this.hasAmmo()) return; // out of snowballs: nothing to throw (updateStockMessage tells the player when the next one comes)
      this.takeAimSnapshot(); // the one moment the player's buffs are read for this throw
      this.state = STATE.AIM_ANGLE;
      this.aimStartTime = this.time.now;
      this.showMessage("");
    } else if (this.state === STATE.AIM_ANGLE) {
      // The offset is chosen: NOW the projectile is used up (a tap on "TAP to aim" alone costs nothing) and the aim is committed.
      this.consumeProjectile();
      Economy.setAiming(true); // an aim is open until the ball is thrown (see abandonAim)
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
    this.miracle = null;
    Economy.setAiming(false); // thrown: the aim is no longer open

    const swing = (this.angleValue - 0.5) * 2; // -1..1
    this.ballVX = swing * MAX_SWING_SPEED;
    // The strength marker's position (0..1) -> the apex, from the projectile's weight tier (see "WEIGHT" above); never below
    // the lowest allowed stick height.
    const apex = apexForPower(this.proj, this.powerValue);
    this.ballVY0 = Math.sqrt(2 * GRAVITY * apex);
    this.ballStartX = ORIGIN_X;
    this.apexTime = this.ballVY0 / GRAVITY; // the snowball sticks to the wall here - see updateFlight
    // An apex above the roof edge would be a stick in the sky: that ball doesn't stick, it falls back.
    this.fallsBehind = (this.ballVY0 * this.ballVY0) / (2 * GRAVITY) > ROOF_EDGE_HEIGHT;
    this.cameraFollowing = true;
    this.bounce = null;
    this.ball.setTexture(this.projVisuals.ball);
    this.ball.setDisplaySize(this.ballSize(), this.ballSize());
    this.ball.clearMask(); // in front of the wall until (and unless) it falls back behind the roof
    this.ball.setRotation(0);
    this.ball.setAlpha(1);
    this.ball.setVisible(true);
    this.flightWorst = 0;
    this.stopLaunchSound();
    const sound = this.projVisuals.launchSound || "throw_whoosh";
    const volume = this.projVisuals.launchVolume || 0.6;
    if (this.projVisuals.launchLoop) {
      // A sound that lasts the whole flight (the drone's): kept, so the landing can cut it (stopLaunchSound).
      this.launchLoopSound = this.sound.add(sound, { loop: true, volume });
      this.launchLoopSound.play();
    } else {
      this.sound.play(sound, { volume });
    }
  }

  // Cuts the looping launch sound (the drone's), if one is playing: when the projectile lands or leaves the picture, and before the next throw.
  stopLaunchSound() {
    if (!this.launchLoopSound) return;
    this.launchLoopSound.stop();
    this.launchLoopSound.destroy();
    this.launchLoopSound = null;
  }

  // How big the projectile in the air is at the start of its flight (BALL_SIZE, times the projectile's `ballScale`).
  ballSize() {
    return BALL_SIZE * (this.projVisuals.ballScale || 1);
  }

  updateFlight(dt) {
    if (this.miracle) {
      this.updateMiracle(dt);
      return;
    }
    this.flightTime += dt;
    // A Diamond Cross throw ALWAYS stops at its apex (also one that would have gone over the roof: it stops at the top of the picture),
    // keeping its size, so it can be carried to the goal.
    const helping = !!this.aim.miracleId;
    const stopT = helping ? this.miracleStopTime() : this.apexTime;
    const reachedApex = this.flightTime >= stopT;
    // Normally the flight freezes at the apex (the ball sticks there); a ball that fell behind the
    // roof keeps following its arc back down.
    const t = helping ? Math.min(this.flightTime, stopT) : reachedApex && !this.fallsBehind ? this.apexTime : this.flightTime;

    const x = this.ballStartX + this.ballVX * t;
    const heightClimbed = this.ballVY0 * t - 0.5 * GRAVITY * t * t;
    const y = this.worldY(heightClimbed);
    this.ball.setPosition(x, y);
    // Smaller and smaller on the way to the apex, shrinking faster the closer it gets (progress 0..1 of the flight up to it; it stays small for a ball that goes on over the roof).
    const shrink = BALL_APEX_SCALE + (1 - BALL_APEX_SCALE) * logCurve(1 - Math.min(1, t / this.apexTime));
    this.ball.setDisplaySize(this.ballSize() * shrink, this.ballSize() * shrink);
    if (this.proj.spins) this.ball.setRotation(t * SPIN_RATE); // stops turning at the apex, where it hits the wall

    this.followBallCamera(y, dt);

    // Flew out through the top of the building: no wall to stick to, so end the throw right
    // here as if it had landed (camera goes back to the character via the normal result flow).
    if (!helping && heightClimbed >= TOP_BOUNDARY_HEIGHT) {
      this.finishThrow(false, null, x, heightClimbed, false, true);
      return;
    }

    if (!reachedApex) return;

    if (helping) {
      this.resolveMiracleThrow(x, heightClimbed);
      return;
    }

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
        const fb = this.eventFaceBox(); // the face of the running event (banana or disco), or null
        const faceHit = !!fb && win === W20 && x >= fb.xFrom && x <= fb.xTo && heightClimbed >= fb.heightFrom && heightClimbed <= fb.heightTo;
        this.finishThrow(true, win, x, heightClimbed, faceHit);
        return;
      }
    }

    this.finishThrow(false, null, x, heightClimbed, false);
  }

  // The camera follows the ball (from the launch until the throw is over).
  followBallCamera(y, dt) {
    if (!this.cameraFollowing) return;
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

  // ---- DIAMOND CROSS (buff effect `miracle`) ----
  // When the flight of a throw made with the buff stops (the projectile is at its apex, or - for a throw that would have gone over the
  // roof - at the top of the picture) (the buff is used up by the throw: its card stays until the impact) and:
  //  - no event running: a throw that landed in a goal window is left alone (a normal hit); one that missed is carried to the middle of W20;
  //  - the face event running: a throw that hit the face is left alone; anything else (a hit on W20 / W21 without the face, or a miss) is
  //    carried to the middle of the face.
  // "Carried": it hangs where it is for half a second, then angels.mp3 plays (3 s) while it moves to the target, shining, it hangs there for
  // half a second and is released as a normal hit (finishThrow: sound, mark or bounce, coins, streak, and the face reaction).

  // The flight time at which a Diamond Cross throw stops: its apex, but never above the top of the picture.
  miracleStopTime() {
    const top = TOP_BOUNDARY_HEIGHT - 2;
    const apexHeight = (this.ballVY0 * this.ballVY0) / (2 * GRAVITY);
    if (apexHeight < top) return this.apexTime;
    return (this.ballVY0 - Math.sqrt(this.ballVY0 * this.ballVY0 - 2 * GRAVITY * top)) / GRAVITY;
  }

  resolveMiracleThrow(x, h) {
    const fb = this.eventFaceBox(); // the face of the running event (banana or disco), or null
    const eventOn = !!fb;
    let hitWin = null;
    let faceHit = false;
    if (!this.fallsBehind) {
      for (const win of WINDOWS) {
        if (x >= win.xFrom && x <= win.xTo && h >= win.heightFrom && h <= win.heightTo) {
          hitWin = win;
          faceHit = eventOn && win === W20 && x >= fb.xFrom && x <= fb.xTo && h >= fb.heightFrom && h <= fb.heightTo;
          break;
        }
      }
    }
    if (eventOn ? faceHit : hitWin) {
      this.finishThrow(true, hitWin, x, h, faceHit); // nothing to help with: exactly the normal hit
      Buffs.consumeCharge(this.aim.miracleId); // the Diamond Cross is used up by this throw (its "+1" card goes at the impact)
      return;
    }
    const box = eventOn ? fb : W20;
    this.startMiracle(x, h, {
      x: (box.xFrom + box.xTo) / 2,
      h: (box.heightFrom + box.heightTo) / 2,
      win: W20,
      faceHit: eventOn,
    });
  }

  startMiracle(x, h, target) {
    if (!this.textures.exists("miracle_glow")) this.makeMiracleGlowTexture();
    // Shines brighter with stronger projectiles: the glow grows with the log of the projectile's hit value (snowball 0.85, grenade 1.55).
    const strength = 0.7 + 0.25 * Math.log10(Math.max(1, this.proj.hitValue));
    this.miracle = { phase: "hang1", t: 0, fromX: x, fromH: h, target, strength, glow: null };
    this.duckMusic(); // quiet by the time the angels start (the pause is half a second)
  }

  makeMiracleGlowTexture() {
    const tex = this.textures.createCanvas("miracle_glow", 128, 128);
    const ctx = tex.getContext();
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.2, "rgba(255,250,215,0.9)");
    grad.addColorStop(0.5, "rgba(255,232,150,0.4)");
    grad.addColorStop(1, "rgba(255,220,120,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    tex.refresh();
    tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  // The shine around the carried projectile: a big soft halo and a hot core that pulse, plus a few sparkles circling it.
  createMiracleGlow() {
    const add = () => this.add.image(0, 0, "miracle_glow").setDepth(11).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    const glow = { halo: add(), core: add(), sparks: [] };
    for (let i = 0; i < 6; i++) glow.sparks.push(add());
    return glow;
  }

  updateMiracleGlow(m, dt) {
    const g = m.glow;
    if (!g) return;
    m.spin = (m.spin || 0) + dt * 2.2;
    const pulse = 0.5 + 0.5 * Math.sin(m.spin * 3.1);
    const k = m.strength;
    const bx = this.ball.x;
    const by = this.ball.y;
    g.halo.setPosition(bx, by).setDisplaySize(k * (56 + 26 * pulse), k * (56 + 26 * pulse)).setAlpha(Math.min(1, 0.75 + 0.25 * pulse));
    g.core.setPosition(bx, by).setDisplaySize(k * (20 + 9 * pulse), k * (20 + 9 * pulse)).setAlpha(1);
    g.sparks.forEach((sp, i) => {
      const a = m.spin + (i * Math.PI * 2) / g.sparks.length;
      const r = k * (15 + 4 * Math.sin(m.spin * 2 + i));
      const tw = 0.5 + 0.5 * Math.sin(m.spin * 5 + i * 1.7);
      sp.setPosition(bx + Math.cos(a) * r, by + Math.sin(a) * r * 0.8).setAlpha(tw).setDisplaySize(6 * k + 2, 6 * k + 2);
    });
  }

  destroyMiracleGlow(m) {
    const g = m && m.glow;
    if (!g) return;
    [g.halo, g.core, ...g.sparks].forEach((o) => o.destroy());
    m.glow = null;
  }

  updateMiracle(dt) {
    const m = this.miracle;
    m.t += dt * 1000;
    const tg = m.target;
    if (m.phase === "hang1") {
      this.followBallCamera(this.worldY(m.fromH), dt);
      if (m.t >= MIRACLE_HANG_MS) {
        m.phase = "move";
        m.t = 0;
        const snd = this.sound.add("angels", { volume: 0.9 });
        m.moveMs = snd.duration > 0.5 ? snd.duration * 1000 : MIRACLE_MOVE_MS;
        snd.play();
        m.sound = snd;
        m.glow = this.createMiracleGlow();
      }
    } else if (m.phase === "move") {
      const k = Math.min(1, m.t / m.moveMs);
      const e = -(Math.cos(Math.PI * k) - 1) / 2; // Sine.easeInOut
      const x = m.fromX + (tg.x - m.fromX) * e;
      const h = m.fromH + (tg.h - m.fromH) * e;
      this.ball.setPosition(x, this.worldY(h));
      this.followBallCamera(this.worldY(h), dt);
      this.updateMiracleGlow(m, dt);
      if (k >= 1) {
        m.phase = "hang2";
        m.t = 0;
      }
    } else if (m.phase === "hang2") {
      this.followBallCamera(this.worldY(tg.h), dt);
      this.updateMiracleGlow(m, dt);
      if (m.t >= MIRACLE_HANG_MS) {
        this.destroyMiracleGlow(m);
        this.miracle = null;
        this.finishThrow(true, tg.win, tg.x, tg.h, tg.faceHit);
        Buffs.consumeCharge(this.aim.miracleId); // the Diamond Cross is used up by this throw (its "+1" card goes at the impact)
        this.unduckMusic(); // the music comes back only now, after the projectile's impact (its sound has just started)
      }
    }
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
      age: 0,
    };
  }

  // The result screen can be skipped (or ends) while a bounced-off projectile is still falling. It must not vanish on the
  // spot: it is handed over to a sprite of its own (the main ball is needed for the next throw) that keeps falling, in the
  // same way, and is removed only once it has dropped below the bottom edge of the default (idle) camera view.
  releaseBounce() {
    const b = this.bounce;
    if (!b || b.resting || !this.ball.visible) return;
    const img = this.add.image(b.x, this.worldY(b.h), this.ball.texture.key);
    img.setDisplaySize(this.ball.displayWidth, this.ball.displayHeight).setRotation(this.ball.rotation).setDepth(10);
    this.fallingBalls.push({ img, b: { ...b }, spins: !!this.proj.spins, size: this.ballSize() });
  }

  updateFallingBalls(dt) {
    const edge = INITIAL_SCROLL_Y + GAME_HEIGHT; // world y of the bottom edge of the default camera view
    this.fallingBalls = this.fallingBalls.filter((f) => {
      const b = f.b;
      b.age += dt * 1000;
      const grow = BALL_APEX_SCALE + (1 - BALL_APEX_SCALE) * logCurve(b.age / BALL_REGROW_MS);
      f.img.setDisplaySize(f.size * grow, f.size * grow);
      b.vh -= GRAVITY * dt;
      b.h += b.vh * dt;
      b.x += b.vx * dt; // (no ground for it: it keeps falling out of the picture)
      f.img.setPosition(b.x, this.worldY(b.h));
      if (f.spins) f.img.setRotation(f.img.rotation + b.spin * SPIN_RATE * dt);
      if (f.img.y - f.img.displayHeight / 2 >= edge) {
        f.img.destroy();
        return false;
      }
      return true;
    });
  }

  updateBounce(dt) {
    const b = this.bounce;
    if (!b) return;
    // Bouncing back towards the player: it grows from its apex size back to full size, fastest at first, slower the further it gets.
    b.age += dt * 1000;
    const grow = BALL_APEX_SCALE + (1 - BALL_APEX_SCALE) * logCurve(b.age / BALL_REGROW_MS);
    this.ball.setDisplaySize(this.ballSize() * grow, this.ballSize() * grow);
    if (b.resting) return;
    b.vh -= GRAVITY * dt;
    b.h += b.vh * dt;
    b.x += b.vx * dt;
    const GROUND_CONTACT = this.ballSize() / 2; // ball radius: it rests on the ground, not in it
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
    const look = this.projVisuals.mark || { texture: "snowball_mark", size: 10 }; // (was 20)
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
    this.stopLaunchSound(); // the launch sound (the drone's, which lasts the whole flight) ends here; the impact sound below takes over
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
    if (!escaped) {
      // A projectile can have its own sound for hitting a window (the stone's hard_impact); otherwise its one impact sound.
      const v = this.projVisuals;
      if (v.hitSound && (hit || hitsAnyWindow(stickX, stickHeight))) this.sound.play(v.hitSound, { volume: v.hitVolume });
      else this.sound.play(v.impactSound, { volume: v.impactVolume });
    }
    // An exploding projectile lights up the wall where it hit (not when it flew out of the top / fell behind the roof).
    if (!escaped && this.projVisuals.explosion) this.playExplosion(stickX, this.worldY(stickHeight), this.projVisuals.explosion);

    if (hit) {
      this.streak += 1;
      let coins = this.proj.hitValue; // one hit value, for both goal windows: it comes from the projectile's rarity (see prepareProjectiles)
      // (The streak is only counted and shown - it no longer adds coins.)

      if (faceHit) {
        if (SONG_EVENTS[this.activeEvent]) {
          coins *= this.songConfig().faceMultiplier; // a song event's face hit (disco, guitar): a fixed bonus; the face stays, the event goes on
        } else {
          this.bananaHitTriggered = true;
          coins *= this.eco.events.faceWindow.faceMultiplier; // hitting the banana face multiplies this throw's coins (events.faceWindow.faceMultiplier, x2) and ends the event
          this.triggerBananaHit(mark);
        }
      }

      // The coin multiplier of the buffs that were active when the player tapped to aim. Only whole coins are paid; the fraction
      // left over (5 x 1.1 = 5.5 pays 5 and keeps 0.5) is carried over to the next payout.
      coins = Economy.takePayout(coins * this.aim.coinMultiplier); // whole coins; the fraction is carried over to the next payout

      // (The streak itself is shown all the time in the top-right STREAK box now.)
      Economy.addCoins(coins);
      Economy.reportStreak(this.streak);
      Economy.setStreak(this.streak);
      this.updateStreakHud();
      // (a buff that saved the projectile - Water Bottle - adds a "Saved Projectile" line at the bottom)
      this.showMessage("HIT\n+" + coins + " coins" + (this.savedBy ? "\nSaved Projectile" : ""));
    } else {
      this.streak = 0;
      Economy.setStreak(0);
      if (this.eco.rewards.missCoins) Economy.addCoins(this.eco.rewards.missCoins);
      this.updateStreakHud();
      this.showMessage("MISS" + (this.savedBy ? "\nSaved Projectile" : ""));
    }

    if (this.savedBy) this.flashAmmoSaved(); // the counter's outline flashes bright white once, alongside the "Saved Projectile" message

    // Push this throw's outcome to the cloud right away, not on the normal cadence - otherwise a miss (or a spent
    // projectile) could be undone by refreshing before the next periodic sync: the restored-session read-on-load
    // flow (cloud.js) adopts whatever the cloud currently has whenever it differs from local, which would mean
    // reloading before this throw synced hands back the pre-throw state.
    if (typeof Cloud !== "undefined" && Cloud.noteThrow) Cloud.noteThrow();

    this.maybeStartRandomEvent();

    this.time.delayedCall(1400, () => {
      if (this.state === STATE.RESULT) this.resetForNextThrow();
    });
  }

  // ---- The face of the event that is running NOW (the one a hit gives a bonus for, and the one the purple / yellow dot marks) ----
  // Banana event: its face, until it is hit. Disco event: the singer's face while the song plays (not during the applause).
  eventFaceBox() {
    if (this.bananaActive && !this.bananaHitTriggered) return BANANA_FACE_BOX;
    if (this.songPhase === "song") return this.songDef().faceBox;
    return null;
  }

  eventColor() {
    return this.songPhase === "song" ? this.songDef().color : EVENT_COLOR_FACE;
  }

  // Marks stuck on W20 fade out quickly when its picture changes (so nothing looks glued to a picture that is about to be swapped).
  fadeMarksOnW20() {
    for (const mark of this.marks.slice()) {
      const heightClimbed = -mark.y;
      if (mark.x >= W20.xFrom && mark.x <= W20.xTo && heightClimbed >= W20.heightFrom && heightClimbed <= W20.heightTo) {
        if (mark.fadeTimer) mark.fadeTimer.remove();
        this.fadeAndRemoveMark(mark, MARK_QUICK_FADE_MS);
      }
    }
  }

  // ---- DISCO event ----
  // Natural chance: by RARITY (legendary, like its summon buff - see rollNaturalEvent). What happens, in order:
  //  1. "song": disco.mp3 plays (about 2:44); W20 shows discoface1..6, changing every beat (120 bpm = every 0.5 s). Hitting the singer's FACE
  //     pays events.discoWindow.faceMultiplier times the coins of that throw; a plain W20 hit pays as usual. The face does NOT go away when it
  //     is hit: every hit during the song counts. A purple dot marks it on the aim bars.
  //  2. "applause": when the song is over W20 goes back to normal, applause.mp3 plays (21 s) and roses fall from the top of the picture to below
  //     the bottom edge of the default view for as long as it plays (spawned so the last one has left the picture when it ends).
  //  3. When the applause is over everything is normal again (the theme fades back in).
  // THE CLOCK: like the shop timers the event runs on the device clock. It is saved with the game as { name, startedAt } (Economy.getEvent), and
  // where it is (which phase, which face, where the audio is) is always worked out from Date.now() - startedAt - never from the audio or the
  // game's own timers. So it goes on while the tab is hidden or the app is closed: coming back finds it where it would be (in the song, in the
  // applause - the audio is started at the right place - or over). The audio is only followed to the clock (syncSongAudio).
  // The music (theme) is ducked for the whole event. Like every event it never changes phase while a throw is being aimed or is in the air
  // (heldEventStep). While the song plays no other event can start and no event buff can be used (Buffs.eventBlocked); during the APPLAUSE
  // another event may start: the applause fades out, no new rose is spawned (those in the air come down) - see cutApplause.
  // (The guitar event works the same way with its own song and pictures: every function below takes what is specific to the running event from its
  // SONG_EVENTS entry - songDef() - and its numbers from songConfig(). The names say "song" for both.)
  songDef() {
    return SONG_EVENTS[this.songEvent ? this.songEvent.name : this.activeEvent] || null;
  }

  // The numbers of a song event (default: the running one): economy.json events.<block> over the defaults.
  songConfig(name) {
    const def = SONG_EVENTS[name || (this.songEvent && this.songEvent.name)];
    return { ...def.defaults, ...((this.eco.events && this.eco.events[def.block]) || {}) };
  }

  // How long the song and the applause are (ms); the song of `name` (default: the running event's).
  songTimes(name) {
    return { songMs: this.songSounds[name || this.songEvent.name].duration * 1000, applauseMs: this.applauseSound.duration * 1000 };
  }

  // True while nothing may start an event: an event runs - except the disco's applause, which another event may cut short.
  eventBlocksStart() {
    return this.activeEvent !== null && this.songPhase !== "applause";
  }

  startSongEvent(name) {
    if (this.eventBlocksStart()) return;
    this.cutApplause();
    this.beginSong({ name, startedAt: Date.now() }, 0, true);
  }

  // Starts (or, after a reload, resumes) a song event (rec.name: "disco" or "guitar") at `elapsedMs` into it.
  beginSong(rec, elapsedMs, fresh) {
    const def = SONG_EVENTS[rec.name];
    const { songMs } = this.songTimes(rec.name);
    Economy.setEvent(rec);
    this.songEvent = rec;
    this.activeEvent = rec.name;
    this.songFrame = -1;
    this.songAudioCheck = 0;
    this.heldEventStep = null;
    this.fadeMarksOnW20();
    this.duckMusic();
    if (elapsedMs < songMs) {
      this.songPhase = "song";
      this.bananaOverlay.setTexture(def.frames[Math.floor(elapsedMs / this.songConfig().beatMs) % def.frames.length]);
      this.bananaOverlay.setVisible(true);
      if (fresh) this.tweens.add({ targets: this.bananaOverlay, alpha: 1, duration: BANANA_FADE_MS });
      else this.bananaOverlay.setAlpha(1);
      this.playSongTrack(this.songSounds[rec.name], elapsedMs, def.volume);
    } else {
      this.songPhase = "applause";
      this.roseAcc = 0;
      this.roseAccSide = 0;
      this.playSongTrack(this.applauseSound, elapsedMs - songMs, APPLAUSE_VOLUME);
    }
  }

  playSongTrack(sound, offsetMs, volume) {
    if (sound.isPlaying) sound.stop();
    if (offsetMs >= sound.duration * 1000 - 100) return; // (the clock is already past its end: nothing left to play)
    sound.play({ seek: Math.max(0, offsetMs) / 1000, volume });
  }

  // The disco's per-frame work: everything follows the clock (see above).
  updateSong(dt) {
    const rec = this.songEvent;
    if (this.songPhase && rec) {
      const { songMs, applauseMs } = this.songTimes();
      const el = Math.max(0, Date.now() - rec.startedAt); // (a device clock set back: it just waits)
      if (this.songPhase === "song") {
        const def = this.songDef();
        const f = Math.floor(el / this.songConfig().beatMs) % def.frames.length;
        if (f !== this.songFrame) {
          this.songFrame = f;
          this.bananaOverlay.setTexture(def.frames[f]);
        }
        this.syncSongAudio(this.songSounds[rec.name], el, songMs);
        if (el >= songMs && !this.heldEventStep) this.onSongEnd();
      } else if (this.songPhase === "applause") {
        const ap = el - songMs;
        if (ap < applauseMs - this.roseFallMs()) {
          // The number of roses in the picture stays the same whatever they fall like (see eventFallMotion): over the top, and - for a slanted fall - over the side the wind blows in from.
          const m = this.roseMotion();
          const sky = this.eventSky();
          const rates = this.eventFallRates(m, ROSE_ON_SCREEN);
          this.roseAcc += dt * rates.top;
          while (this.roseAcc >= 1) {
            this.roseAcc -= 1;
            this.spawnRose(m);
          }
          if (rates.side > 0) {
            this.roseAccSide += dt * rates.side;
            while (this.roseAccSide >= 1) {
              this.roseAccSide -= 1;
              this.spawnRose(m, m.sin > 0 ? sky.left : sky.right, Phaser.Math.FloatBetween(sky.top, sky.bottom));
            }
          }
        }
        this.syncSongAudio(this.applauseSound, ap, applauseMs);
        if (ap >= applauseMs && !this.heldEventStep) this.endSongEvent();
      }
    }
    this.updateRoses(dt);
  }

  // The audio follows the clock, once a second: not playing when it should be (it was blocked until the first tap, the app was closed) ->
  // started at the right place; playing but off by more than half a second (the tab was hidden, the phone slept) -> put back.
  syncSongAudio(sound, offMs, lenMs) {
    if (this.time.now < this.songAudioCheck || this.sound.locked || offMs >= lenMs - 700) return;
    this.songAudioCheck = this.time.now + 1000;
    if (!sound.isPlaying) sound.play({ seek: offMs / 1000, volume: sound === this.applauseSound ? APPLAUSE_VOLUME : this.songDef().volume });
    else if (Math.abs(sound.seek * 1000 - offMs) > 500) sound.seek = offMs / 1000;
  }

  onSongEnd() {
    if (this.songPhase !== "song") return;
    if (!this.canEventEnd()) {
      this.heldEventStep = () => this.onSongEnd(); // a throw is being aimed / is in the air: the face stays until it is over
      return;
    }
    const { songMs } = this.songTimes();
    this.songPhase = "applause";
    this.fadeMarksOnW20();
    const song = this.songSounds[this.songEvent.name];
    if (song.isPlaying) song.stop();
    this.tweens.add({
      targets: this.bananaOverlay,
      alpha: 0,
      duration: BANANA_FADE_MS,
      onComplete: () => {
        if (this.songPhase !== "song") this.bananaOverlay.setVisible(false);
      },
    });
    this.roseAcc = 0;
    this.roseAccSide = 0;
    this.songAudioCheck = 0;
    this.playSongTrack(this.applauseSound, Date.now() - this.songEvent.startedAt - songMs, APPLAUSE_VOLUME);
  }

  endSongEvent() {
    if (this.songPhase !== "applause") return;
    if (!this.canEventEnd()) {
      this.heldEventStep = () => this.endSongEvent();
      return;
    }
    this.finishSong();
    this.unduckMusic();
  }

  // Everything of the disco is over (or was cut): the state goes back to normal. (The roses already in the air keep falling - updateRoses.)
  finishSong() {
    this.songPhase = null;
    this.songEvent = null;
    this.activeEvent = null;
    Economy.setEvent(null);
    for (const snd of Object.values(this.songSounds)) if (snd.isPlaying) snd.stop();
    if (this.applauseSound.isPlaying) this.applauseSound.stop();
  }

  // Another event is starting during the applause: the applause fades out (0.8 s), no more roses are spawned (the phase is over), the ones in
  // the air come down as they were, and the disco is over. The music stays down - the new event takes it from here.
  cutApplause() {
    if (this.songPhase !== "applause") return;
    const snd = this.applauseSound;
    this.heldEventStep = null;
    this.songPhase = null;
    this.songEvent = null;
    this.activeEvent = null;
    Economy.setEvent(null);
    this.tweens.add({
      targets: snd,
      volume: 0,
      duration: 800,
      onComplete: () => {
        if (this.songPhase !== "applause") snd.stop(); // (unless a new applause has started meanwhile)
      },
    });
  }

  // After a reload: the disco that was running is taken up where the clock says it is (or dropped if it is over).
  resumeSavedEvent() {
    const ev = Economy.getEvent();
    if (!ev) return;
    if (SONG_EVENTS[ev.name]) {
      const { songMs, applauseMs } = this.songTimes(ev.name);
      const el = Date.now() - ev.startedAt;
      if (el >= 0 && el < songMs + applauseMs) {
        this.beginSong({ name: ev.name, startedAt: ev.startedAt }, el, false);
        if (this.theme) this.theme.setVolume(0); // silent from the first moment
        return;
      }
    }
    Economy.setEvent(null);
  }

  // ---- EVENT PARTICLES ----
  // Anything an event drops from the sky - the applause roses today, and EVERY event item added in the future - must fall through these three, so the
  // equipped weather always affects it (the owner's rule): eventFallMotion (how it falls), eventSky (where it lives) and eventFallRates (how many are
  // spawned a second, over the top and over the side the wind blows in from). Never give a new event particle a motion of its own.
  //
  // eventFallMotion({ from, to }): the particle falls straight down at its own speed range (`base`, px/s) - unless the equipped weather falls at least as
  // fast as that (the mean of its speed range is not below the particle's own mean): then it falls the way the weather does, its speed range and its angle,
  // so a Blizzard's applause is blown across the picture like the snow. A slower weather (Snow) leaves the particles as they are; so does a weather with no
  // particles (Sunny), and a weather that says `affectsEvents: false` in economy.json (Rain, although it falls fast). Speeds are along the path. Returns { from, to, sin, cos }.
  eventFallMotion(base) {
    const w = this.weather;
    if (w && !w.noParticles && w.def.affectsEvents !== false && (w.from + w.to) / 2 >= (base.from + base.to) / 2) return { from: w.from, to: w.to, sin: w.sin, cos: w.cos };
    return { from: base.from, to: base.to, sin: 0, cos: 1 };
  }

  // The sky an event particle lives in: the same as the weather's (a little wider than the picture, from the top of the world to the bottom of the default view).
  eventSky() {
    return { left: INITIAL_SCROLL_X - 6, right: INITIAL_SCROLL_X + GAME_WIDTH + 6, top: this.worldY(TOP_BOUNDARY_HEIGHT), bottom: INITIAL_SCROLL_Y + GAME_HEIGHT };
  }

  // How many particles to spawn a second - { top, side } - so that `onScreen` of them are in the picture (432 x 243) at once whatever the motion `m` is:
  // over the top, and (for a slanted fall) over the left edge (or the right one) so the picture is as full at the side as everywhere else.
  eventFallRates(m, onScreen) {
    const mean = (m.from + m.to) / 2;
    const sky = this.eventSky();
    return {
      top: (onScreen * mean * m.cos) / GAME_HEIGHT,
      side: (onScreen * (sky.bottom - sky.top) * mean * Math.abs(m.sin)) / ((sky.right - sky.left) * GAME_HEIGHT),
    };
  }

  // The roses' own fall (ROSE_SPEED_MIN-MAX), through the rules above.
  roseMotion() {
    return this.eventFallMotion({ from: ROSE_SPEED_MIN, to: ROSE_SPEED_MAX });
  }

  // One rose, a little tilted (each its own angle), falling the way roseMotion says: by default at the very top of the picture (anywhere across) - or at (x, y).
  spawnRose(m, x, y) {
    m = m || this.roseMotion();
    const sky = this.eventSky();
    const size = ROSE_SIZE * Phaser.Math.FloatBetween(0.85, 1.15);
    // (across the whole default view: it starts at world x INITIAL_SCROLL_X, not at 0)
    const img = this.add.image(x === undefined ? Phaser.Math.FloatBetween(sky.left, sky.right) : x, y === undefined ? sky.top - size : y, "rose");
    img.setDisplaySize(size, size).setDepth(9).setRotation(Phaser.Math.FloatBetween(-0.55, 0.55));
    const s = Phaser.Math.FloatBetween(m.from, m.to);
    this.roses.push({ img, vy: s * m.cos, vx: s * m.sin + Phaser.Math.FloatBetween(-10, 10) }); // (a hair of sideways drift)
  }

  updateRoses(dt) {
    if (!this.roses.length) return;
    const bottom = INITIAL_SCROLL_Y + GAME_HEIGHT; // the bottom edge of the default camera view: a rose is gone once it is below it
    this.roses = this.roses.filter((r) => {
      r.img.y += r.vy * dt;
      r.img.x += r.vx * dt;
      if (r.img.y - r.img.displayHeight / 2 > bottom || r.img.x < INITIAL_SCROLL_X - 80 || r.img.x > INITIAL_SCROLL_X + GAME_WIDTH + 80) {
        r.img.destroy();
        return false;
      }
      return true;
    });
  }

  // Seconds a rose needs from the top of the picture to below the bottom edge of the default view at the slowest speed.
  roseFallMs() {
    const dist = INITIAL_SCROLL_Y + GAME_HEIGHT + TOP_BOUNDARY_HEIGHT + 2 * ROSE_SIZE;
    const m = this.roseMotion();
    return (dist / (m.from * m.cos)) * 1000; // (its downward speed: the slowest rose's)
  }

  // True while any timed event is running (the banana face, the disco) - add every new event
  // here, so two events never overlap.
  isEventActive() {
    return this.activeEvent !== null;
  }

  // Every random event is listed here: its name, its chance after a throw, and how it starts. To add an event, add
  // it here and make it set `this.activeEvent = name` when it starts and `null` when it ends - the rule that only
  // one event can run at a time is enforced in startEvent(), so a new event can't overlap the others.
  eventDefs() {
    return [
      { name: "face", start: () => this.startBananaEvent() },
      { name: "disco", start: () => this.startSongEvent("disco") },
      { name: "guitar", start: () => this.startSongEvent("guitar") },
    ].map((d) => ({ ...d, rarity: this.eventRarity(d.name) }));
  }

  // The rarity of an event: the rarity of its SUMMON BUFF (the shop item whose triggerEvent effect names the event); failing that the
  // event's own "rarity" in economy.json (events.<block>.rarity), failing that legendary.
  eventRarity(name) {
    const item = (this.eco.shop.items || []).find((it) => !it.godOnly && (it.effects || []).some((e) => e.type === "triggerEvent" && e.value === name)); // (a test buff does not count)
    const block = (this.eco.events || {})[name === "face" ? "faceWindow" : (SONG_EVENTS[name] || {}).block] || {};
    return (item && item.rarity) || block.rarity || "legendary";
  }

  // How many throws an hour the snowball stock allows: its real refill rate (one every regen.everySeconds), unless economy.json overrides it
  // with events.throwsPerHour.
  throwsPerHour() {
    const ev = this.eco.events || {};
    if (typeof ev.throwsPerHour === "number" && ev.throwsPerHour > 0) return ev.throwsPerHour;
    const regen = this.eco.projectiles.snowball && this.eco.projectiles.snowball.regen;
    return regen && regen.everySeconds > 0 ? 3600 / regen.everySeconds : 120;
  }

  // The chance per throw that an event of this RARITY starts by itself, so that on average it takes as many throws as it takes to see an item
  // of that rarity in the shop (see events._rarityNote in economy.json): 1 / (meanShopHours x throwsPerHour), where meanShopHours = 1 / (the
  // rarity's share of the shop's rarity roll x slots x 3600 / availabilitySeconds). 0 if the rarity cannot come up in the shop.
  eventRarityChance(rarityId) {
    const ev = this.eco.events || {};
    if (ev.rarityChances && typeof ev.rarityChances[rarityId] === "number") return ev.rarityChances[rarityId];
    const rarities = this.eco.rarities || [];
    const has = new Set((this.eco.shop.items || []).filter((it) => !it.godOnly).map((it) => (it.category === "projectile" ? (this.eco.projectiles[it.id] || {}).rarity : it.rarity)));
    const total = rarities.filter((r) => r.chance > 0 && has.has(r.id)).reduce((a, r) => a + r.chance, 0);
    const r = rarities.find((x) => x.id === rarityId);
    if (!r || !(r.chance > 0) || !has.has(rarityId) || total <= 0) return 0;
    const rollsPerHour = (this.eco.shop.slots * 3600) / (r.availabilitySeconds || 1800);
    const meanShopHours = 1 / ((r.chance / total) * rollsPerHour);
    return 1 / (meanShopHours * this.throwsPerHour());
  }

  // One throw's roll for a natural event: an independent roll for EACH RARITY that has events (not one per event). If several rarities hit on the
  // same throw the BETTER (rarer) one wins; its rarity then picks one of its events at random. Returns the event's name or null. (So adding
  // an event to a rarity does not make that rarity's events more frequent; a rarity that loses to a better one on the same throw is only a
  // little rarer than its chance - by that better one's chance.)
  rollNaturalEvent() {
    const byRarity = {};
    for (const d of this.eventDefs()) (byRarity[d.rarity] = byRarity[d.rarity] || []).push(d.name);
    const rank = (id) => (this.eco.rarities || []).findIndex((r) => r.id === id);
    let best = null;
    for (const rar of Object.keys(byRarity)) {
      if (Math.random() < this.eventRarityChance(rar) && (best === null || rank(rar) > rank(best))) best = rar;
    }
    if (best === null) return null;
    const names = byRarity[best];
    return names[Math.floor(Math.random() * names.length)];
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
    if (this.eventBlocksStart()) return; // the previous face is still fading out: start after it (a disco's applause is cut by the new event)
    this.startBananaEvent(b.msLeft, b.id);
  }

  // A summon buff (the disco ball) was used: the event it names starts as soon as the game is idle (no aim, no flight) and no event runs; the
  // charge is used up then. (Checked every frame; using it while an event runs is refused by Buffs.eventBlocked, so it never waits for that.)
  syncSummonBuff() {
    if (this.state !== STATE.IDLE || this.eventBlocksStart()) return;
    const s = Buffs.summonBuff();
    if (!s) return;
    if (!this.startEvent(s.event)) return; // (it could not start: the charge waits)
    const rec = Economy.getEvent();
    // The buff's card stays for the whole song and counts it down (a real timer now); it is gone when the song is over, the applause is free.
    if (SONG_EVENTS[s.event] && rec) Buffs.setBuffEnd(s.id, rec.startedAt + this.songTimes().songMs);
    else Buffs.consumeCharge(s.id);
  }

  // The single way to start an event by name. Refuses (returns false) while another event is running.
  startEvent(name) {
    if (this.eventBlocksStart()) return false;
    const def = this.eventDefs().find((d) => d.name === name);
    if (!def) return false;
    def.start();
    return this.activeEvent === name;
  }

  // After every throw (hit, miss or escape) roll for a random event - but never while one is running.
  // The chances are by rarity (eventRarityChance / rollNaturalEvent; economy.json events._rarityNote).
  maybeStartRandomEvent() {
    if (this.isEventActive()) return;
    const name = this.rollNaturalEvent();
    if (name) this.startEvent(name);
  }

  // Random face-window event (1% chance after each throw): swaps W20's texture to the banana art for events.faceWindow.durationMs, then fades
  // back on its own. Any existing marks on W20's left section fade out quickly first, so they
  // don't look like they're stuck to a texture that's about to change out from under them.
  // `durationMs` / `buffId`: given when a buff (Tomato Juice) starts it - then it lasts as long as the buff (see syncBuffEvent).
  startBananaEvent(durationMs, buffId) {
    if (this.eventBlocksStart()) return; // only one event at a time (except that a disco's applause is cut short by the new event)
    this.cutApplause();
    this.buffEventId = buffId || null;
    this.activeEvent = "face";
    this.bananaActive = true;
    this.setEventMusic(true);
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
    // An event never ends while a throw is being aimed or is in the air (whatever ends it: its own timer, or the buff that made it):
    // the end waits until the throw is over (checked every frame in update()).
    if (!this.canEventEnd()) {
      this.heldEventStep = () => this.endBananaEvent();
      return;
    }
    this.heldEventStep = null;
    this.setEventMusic(false);
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

  // False while the player is aiming or the projectile is flying (the miracle of the Diamond Cross included): see endBananaEvent.
  canEventEnd() {
    return this.state !== STATE.AIM_ANGLE && this.state !== STATE.AIM_POWER && this.state !== STATE.FLIGHT;
  }

  // Hitting the face: cancels the pending 20s revert, quickly swaps to goal_window_face_hit,
  // then after events.faceWindow.hitRevertMs fades both the texture and the mark that triggered it back
  // to nothing together.
  triggerBananaHit(mark) {
    this.heldEventStep = null; // (the hit ends the event by itself)
    this.setEventMusic(false); // the event is over the moment the face is hit: the music fades out while the face fades away
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
    this.releaseBounce(); // (a projectile still on its way down is not cut off - see releaseBounce)
    this.bounce = null;
    this.ball.setVisible(false);
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

  showMessage(msg) {
    // Text lives in HTML now (see index.html #message), not as a Phaser Text object - canvas
    // text at this resolution renders as blurry upscaled pixels, an HTML element with a real
    // web font doesn't.
    const el = document.getElementById("message");
    el.textContent = msg;
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
    const b = this.eventFaceBox(); // the face of the running event
    if (!b) return null;
    const band = swing === undefined ? { from: this.powerForApex(b.heightFrom), to: this.powerForApex(b.heightTo) } : this.powerBandFor(swing, b);
    const tMin = Math.sqrt((2 * b.heightFrom) / GRAVITY);
    const tMax = Math.sqrt((2 * b.heightTo) / GRAVITY);
    const dxFrom = b.xFrom - ORIGIN_X;
    const dxTo = b.xTo - ORIGIN_X;
    return {
      color: this.eventColor(),
      swingFrom: Math.max(dxFrom / (MAX_SWING_SPEED * tMin), dxFrom / (MAX_SWING_SPEED * tMax)),
      swingTo: Math.min(dxTo / (MAX_SWING_SPEED * tMin), dxTo / (MAX_SWING_SPEED * tMax)),
      powerFrom: band ? band.from : null,
      powerTo: band ? band.to : null,
    };
  }

  // The strength-bar value whose throw peaks at `apex` (a world height) with the equipped projectile - the inverse
  // of launchBall(). May fall outside 0..1 (then that apex can't be reached with the bar).
  powerForApex(apex) {
    return powerForApexOf(this.proj, apex);
  }

  // `hitWidthPx` = how wide (on the bar) the range that really hits is - the hitzone spans it exactly (no longer a
  // smaller "safe" dot that only ever undersold the true range), so a marker anywhere inside the zone is a hit.
  drawEventHitzone(g, x, y, color, hitWidthPx, height) {
    if (hitWidthPx < 2) return; // a sliver too thin to show meaningfully: no zone rather than one narrower than a pixel
    g.fillStyle(color, 0.55); // semi-transparent so the aim marker stays visible on top of it
    g.fillRect(Math.round(x - hitWidthPx / 2), Math.round(y - height / 2), Math.round(hitWidthPx), Math.round(height));
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
      const center = this.aim.offsetCenter; // where on the bar swing 0 - the middle of the hit zone - is (0.5 normally)
      markerPos = center + (this.angleValue - 0.5) / range;

      const lineAt = (swing, color, alpha, width, extra) => {
        for (const sign of [-1, 1]) {
          const x = Math.round(barX + (center + (sign * swing) / 2 / range) * barW);
          g.lineStyle(width, color, alpha);
          g.lineBetween(x, barY - extra, x, barY + barH + extra);
        }
      };
      // (There are no graduation lines any more - the bar is plain, apart from the green lines below.)
      const guide = this.aim.guideLines;
      // The two lines that guarantee a hit on W20 (sideways) - nothing else is drawn between them. Buff only.
      if (guide) lineAt(W20_SWING_GUARANTEE, 0x5cff5c, 1, 2, 5);
      // Blue Skyr: ONE line in the middle of that zone (the middle of the bar).
      if (this.aim.centerLine) lineAt(0, 0x5cff5c, 1, 2, 5);

      const target = this.aim.eventHitzone ? this.activeEventTarget() : null; // (no hitzone without the buff)
      if (target) {
        const swing = (target.swingFrom + target.swingTo) / 2;
        const dotPos = center + swing / 2 / range;
        if (dotPos > 0 && dotPos < 1) {
          const x = barX + dotPos * barW;
          this.drawEventHitzone(g, x, barY + barH / 2, target.color, ((target.swingTo - target.swingFrom) / 2 / range) * barW, barH);
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
      if (band && this.aim.centerLine) lineAtPower((lo + hi) / 2, 0x5cff5c, 1, 2, 5); // Blue Skyr: the middle of the strength band

      const target = this.aim.eventHitzone ? this.activeEventTarget(swingNow) : null; // (no hitzone without the buff)
      if (target && target.powerFrom !== null) {
        // The hit band can stick out past the ends of the bar (a heavy projectile's band ends beyond the tip):
        // show only the part that is on the bar.
        const from = Math.max(target.powerFrom, pLo);
        const to = Math.min(target.powerTo, pLo + pRange);
        if (from < to) {
          const hitWidthPx = ((to - from) / pRange) * barW;
          this.drawEventHitzone(g, barX + barPos((from + to) / 2) * barW, barY + barH / 2, target.color, hitWidthPx, barH);
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
      const pos = pingPong(elapsed * a.angleMarkerHz);
      this.angleValue = 0.5 + (pos - a.offsetCenter) * a.angleRange; // (swing 0 - straight up - is where the zone is centered)
    } else if (this.state === STATE.AIM_POWER) {
      const elapsed = (time - this.aimStartTime) / 1000;
      // Same for strength: fixed marker speed along the bar, the bar covers `powerRange` of the power span (centered).
      const r = this.aim.powerRange;
      this.powerValue = 0.5 + (pingPong(elapsed * this.aim.markerHz) - 0.5) * r;
    } else if (this.state === STATE.FLIGHT) {
      this.updateFlight(dt);
    }
    if (this.heldEventStep && this.canEventEnd()) {
      const step = this.heldEventStep; // a change of an event that was held back by a throw
      this.heldEventStep = null;
      step();
    }
    this.updateSong(dt);
    this.updateWeather(dt);
    this.updateBounce(dt);
    this.updateFallingBalls(dt);

    this.updateStockMessage();
    this.updateAmmoHud();
    this.syncBuffEvent();
    this.syncSummonBuff();
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
