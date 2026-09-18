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
const GAME_WIDTH = 426;
const GAME_HEIGHT = 243;

const GRAVITY = 900; // px/s^2
const MAX_SWING_SPEED = 180; // px/s horizontal drift at full left/right - needs to reach W21

const ORIGIN_X = WORLD_WIDTH / 2 + 58 + 30 + 10 - 30; // 420 - nudged right of dead-center three times, then left once (+58, +30, +10, -30)
const ORIGIN_Y = 40; // world height where the character throws from (0 = ground)
const CHARACTER_Y_OFFSET = 20 - 5; // 15 - nudged down 20px, then up 5px, across separate requests (positive = down)
const BUILDING_TOP_HEIGHT = IMG_GROUND_Y - IMG_ROOF_Y + 100; // camera/world bounds, with headroom above the roofline

// Resting camera framing: horizontally centered on the character. Vertically, true-centering
// on the character wasted half the frame on plain sidewalk below - instead the ground sits
// near the bottom (small margin for the sidewalk underfoot), leaving most of the frame to show
// the building above, same idea as looking up at it from where you're standing.
const INITIAL_SCROLL_X = ORIGIN_X - GAME_WIDTH / 2;
const INITIAL_SCROLL_Y = -(GAME_HEIGHT - 20);

// The snowball must always stick somewhere between just above the restricted ground/doors zone
// and the roofline - never in the sky, never in the red-marked restricted area (+10px buffer
// above it) from the user's reference image. Restricted zone's top edge was image-y=486;
// converted via IMG_GROUND_Y - imageY, plus the 10px buffer, that's a minimum stick height of
// 184. The roofline (IMG_GROUND_Y - IMG_ROOF_Y = 643) is the maximum. MIN/MAX_POWER_SPEED are
// calibrated so a 0%/100% power throw's apex lands exactly on those two bounds -
// vy0 = sqrt(2 * GRAVITY * height).
const MIN_STICK_HEIGHT = IMG_GROUND_Y - 486 + 10; // 184
const MAX_STICK_HEIGHT = IMG_GROUND_Y - IMG_ROOF_Y; // 643
const MIN_POWER_SPEED = Math.sqrt(2 * GRAVITY * MIN_STICK_HEIGHT); // ~575.6
const MAX_POWER_SPEED = Math.sqrt(2 * GRAVITY * MAX_STICK_HEIGHT); // ~1075.8

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
  { name: "W20", xFrom: 385, xTo: 436, heightFrom: IMG_GROUND_Y - 316, heightTo: IMG_GROUND_Y - 273, coins: 6 },
  { name: "W21", xFrom: 472, xTo: 494, heightFrom: IMG_GROUND_Y - 316, heightTo: IMG_GROUND_Y - 273, coins: 3 },
];
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
    this.load.audio("theme", "assets/audio/theme.mp3");
    this.load.audio("throw_whoosh", "assets/audio/throw_whoosh.mp3");
    this.load.audio("snowball_impact", "assets/audio/snowball_impact.mp3");
    this.load.audio("coin_sound", "assets/audio/coin_sound.mp3");
  }

  create() {
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
      -BUILDING_TOP_HEIGHT,
      WORLD_WIDTH * 3,
      BUILDING_TOP_HEIGHT + GAME_HEIGHT
    );
    this.cameras.main.setBackgroundColor("#65bfd5");
    this.cameras.main.scrollX = INITIAL_SCROLL_X;
    this.cameras.main.scrollY = INITIAL_SCROLL_Y;

    // background.png's own row IMG_GROUND_Y lines up with world height 0 (the ground):
    // image pixel row r sits at Phaser y = -IMG_GROUND_Y + r, so placing the top-left origin
    // at y = -IMG_GROUND_Y puts row IMG_GROUND_Y exactly at y = 0.
    this.bgImage = this.add.image(0, -IMG_GROUND_Y, "background").setOrigin(0, 0);

    this.worldGfx = this.add.graphics();
    this.drawCharacter();

    this.marks = []; // stuck-snowball sprites; each one schedules its own fade-out in addMark()

    this.ball = this.add.image(ORIGIN_X, this.worldY(ORIGIN_Y), "snowball");
    this.ball.setDisplaySize(16, 16);
    this.ball.setDepth(10);
    this.ball.setVisible(false); // only shown mid-flight - see launchBall/finishThrow

    // Aim HUD (screen-space, ignores camera scroll).
    this.aimGfx = this.add.graphics().setScrollFactor(0).setDepth(20);

    this.createTargetCamera();

    // Loops forever so the theme doesn't just play once and go silent - it's a few minutes
    // long, not actually infinite on its own.
    this.sound.play("theme", { loop: true, volume: 0.5 });

    this.input.on("pointerdown", () => this.handleFreezeInput());
    this.input.keyboard.on("keydown-SPACE", () => this.handleFreezeInput());

    this.showMessage("TAP or SPACE to aim");
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

  worldY(heightFromGround) {
    // Phaser y grows downward; our "height climbed" grows upward.
    return -heightFromGround;
  }

  drawCharacter() {
    // Placeholder: back turned, facing the building. Swap for real character art later.
    const g = this.worldGfx;
    g.clear();
    const baseY = this.worldY(0) + CHARACTER_Y_OFFSET;
    g.fillStyle(0x2f2f3a, 1);
    g.fillRoundedRect(ORIGIN_X - 8, baseY - 22, 16, 22, 3);
    g.fillCircle(ORIGIN_X, baseY - 26, 7);
  }

  handleFreezeInput() {
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
    this.ballVY0 = MIN_POWER_SPEED + this.powerValue * (MAX_POWER_SPEED - MIN_POWER_SPEED);
    this.ballStartX = ORIGIN_X;
    this.apexTime = this.ballVY0 / GRAVITY; // the snowball sticks to the wall here - see updateFlight
    this.cameraFollowing = true;
    this.ball.setVisible(true);
    this.sound.play("throw_whoosh", { volume: 0.6 });
  }

  updateFlight(dt) {
    this.flightTime += dt;
    const reachedApex = this.flightTime >= this.apexTime;
    const t = reachedApex ? this.apexTime : this.flightTime;

    const x = this.ballStartX + this.ballVX * t;
    const heightClimbed = this.ballVY0 * t - 0.5 * GRAVITY * t * t;
    const y = this.worldY(heightClimbed);
    this.ball.setPosition(x, y);

    if (this.cameraFollowing) {
      const targetScrollY = y - GAME_HEIGHT * 0.6;
      this.cameras.main.scrollY = Phaser.Math.Linear(this.cameras.main.scrollY, targetScrollY, 0.12);
    }

    if (!reachedApex) return;

    // The snowball always sticks to the wall at the top of its arc - a hit only counts if
    // that exact point lands inside W20 or W21.
    for (const win of WINDOWS) {
      if (x >= win.xFrom && x <= win.xTo && heightClimbed >= win.heightFrom && heightClimbed <= win.heightTo) {
        this.finishThrow(true, win, x, heightClimbed);
        return;
      }
    }

    this.finishThrow(false, null, x, heightClimbed);
  }

  addMark(x, heightClimbed) {
    const mark = this.add.image(x, this.worldY(heightClimbed), "snowball_mark");
    mark.setDisplaySize(20, 20);
    mark.setDepth(5); // above the building, below the live ball (depth 10)
    this.marks.push(mark);

    // Starts fading MARK_LIFETIME_MS after it's placed, regardless of what the camera's doing -
    // a smooth fade doesn't have the "vanished while I was looking" problem a hard cull did.
    this.time.delayedCall(MARK_LIFETIME_MS, () => {
      this.tweens.add({
        targets: mark,
        alpha: 0,
        duration: MARK_FADE_MS,
        onComplete: () => {
          mark.destroy();
          const idx = this.marks.indexOf(mark);
          if (idx !== -1) this.marks.splice(idx, 1);
        },
      });
    });
  }

  finishThrow(hit, win, stickX, stickHeight) {
    this.state = STATE.RESULT;
    this.cameraFollowing = false;
    this.ball.setVisible(false); // the mark now represents where it stuck
    this.addMark(stickX, stickHeight);
    this.sound.play("snowball_impact", { volume: 0.6 });

    if (hit) {
      this.streak += 1;
      let coins = win.coins;
      const streakBonus = Math.floor(coins * 0.15 * (this.streak - 1));
      coins += streakBonus;
      Economy.addCoins(coins);
      Economy.reportStreak(this.streak);
      this.sound.play("coin_sound", { volume: 0.7 });
      this.showMessage(
        win.name + " HIT! +" + coins + " coins" + (this.streak > 1 ? "\nstreak x" + this.streak : "")
      );
    } else {
      this.streak = 0;
      this.showMessage("MISS\nstreak reset");
    }

    this.time.delayedCall(1400, () => {
      if (this.state === STATE.RESULT) this.resetForNextThrow();
    });
  }

  resetForNextThrow() {
    this.state = STATE.IDLE;
    this.ball.setPosition(ORIGIN_X, this.worldY(ORIGIN_Y));
    this.tweens.add({
      targets: this.cameras.main,
      scrollY: INITIAL_SCROLL_Y,
      duration: 500,
      ease: "Sine.easeInOut",
    });
    this.showMessage("TAP or SPACE to aim");
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

    g.fillStyle(0x000000, 0.4);
    g.fillRect(barX, barY, barW, barH);

    const value = this.state === STATE.AIM_ANGLE ? this.angleValue : this.powerValue;
    const color = this.state === STATE.AIM_ANGLE ? 0x6fb1ff : 0xff6f6f;
    g.fillStyle(color, 1);
    const markerX = barX + value * barW;
    g.fillRect(markerX - 2, barY - 4, 4, barH + 8);

    g.lineStyle(1, 0xffffff, 0.6);
    g.strokeRect(barX, barY, barW, barH);
  }

  update(time, delta) {
    const dt = delta / 1000;

    if (this.state === STATE.AIM_ANGLE) {
      const elapsed = (time - this.aimStartTime) / 1000;
      this.angleValue = pingPong(elapsed * ANGLE_HZ);
    } else if (this.state === STATE.AIM_POWER) {
      const elapsed = (time - this.aimStartTime) / 1000;
      this.powerValue = pingPong(elapsed * POWER_HZ);
    } else if (this.state === STATE.FLIGHT) {
      this.updateFlight(dt);
    }

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
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [MainScene],
};

window.addEventListener("load", () => {
  const game = new Phaser.Game(config);
  window.snowyBallsGame = game; // exposed for debugging/driven tests, not used by gameplay code
  window.snowyBallsFreeze = () => {
    const scene = game.scene.getScene("main");
    if (scene) scene.handleFreezeInput();
  };
});
