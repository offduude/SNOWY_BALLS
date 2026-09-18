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

// Canvas resolution IS the resting camera framing - the user marked a reference crop directly
// on background.png (image x=215-641, y=435-678, the entrance-doors-and-ground area) and asked
// for the default view to roughly match it, so the canvas is sized to that crop exactly rather
// than showing the full building width. (We tried camera.zoom instead of this - Phaser 3.80's
// WebGL renderer clips world content at the viewport edge when zoom != 1, cutting off a strip
// of the image for no reason tied to scroll/bounds. Shrinking the actual canvas avoids that
// renderer bug entirely and gets the identical framing.)
const GAME_WIDTH = 426;
const GAME_HEIGHT = 243;
const INITIAL_SCROLL_X = 215; // left edge of the reference crop
const INITIAL_SCROLL_Y = -(IMG_GROUND_Y - 435); // -225: top edge of the reference crop

const GRAVITY = 900; // px/s^2
const MAX_SWING_SPEED = 180; // px/s horizontal drift at full left/right - needs to reach W21
const MIN_POWER_SPEED = 300; // px/s vertical launch speed at 0 power (apex ~50px - a clear miss)
const MAX_POWER_SPEED = 1150; // px/s vertical launch speed at full power (apex ~735px, just above the roofline)

const ANGLE_HZ = 0.85; // full sweep cycles per second (placeholder feel, tune later)
const POWER_HZ = 0.65;

const ORIGIN_X = WORLD_WIDTH / 2; // 352 - centered between the two entrance doors (world position, not canvas-relative)
const ORIGIN_Y = 40; // world height where the character throws from (0 = ground)
const BUILDING_TOP_HEIGHT = IMG_GROUND_Y - IMG_ROOF_Y + 100; // camera/world bounds, with headroom above the roofline

// W20 and W21 (see docs/background_annotated.png), converted from image pixels to world
// "height climbed" (IMG_GROUND_Y - imageY). Both sit in the same window row (image y 273-316).
const WINDOWS = [
  { name: "W20", xFrom: 385, xTo: 436, heightFrom: IMG_GROUND_Y - 316, heightTo: IMG_GROUND_Y - 273, coins: 6 },
  { name: "W21", xFrom: 472, xTo: 494, heightFrom: IMG_GROUND_Y - 316, heightTo: IMG_GROUND_Y - 273, coins: 3 },
];
const HEAD_CHANCE = 0.3; // chance a bonus head appears above W20 on a given throw
const HEAD_BONUS_COINS = 8;

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
    this.load.image("background", "assets/building/background.png");
  }

  create() {
    this.state = STATE.IDLE;
    this.streak = 0;
    this.angleValue = 0.5;
    this.powerValue = 0.5;
    this.flightTime = 0;
    this.headPresent = false;

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

    this.ball = this.add.circle(ORIGIN_X, this.worldY(ORIGIN_Y), 4, 0xffffff);
    this.ball.setDepth(10);

    // Aim HUD (screen-space, ignores camera scroll).
    this.aimGfx = this.add.graphics().setScrollFactor(0).setDepth(20);
    this.hudText = this.add
      .text(6, 4, "", { fontFamily: "monospace", fontSize: "9px", color: "#ffffff" })
      .setScrollFactor(0)
      .setDepth(21);
    this.messageText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, "", {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#ffffff",
        align: "center",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(21);

    this.input.on("pointerdown", () => this.handleFreezeInput());
    this.input.keyboard.on("keydown-SPACE", () => this.handleFreezeInput());

    this.updateHud();
    this.showMessage("TAP or SPACE to aim");
  }

  worldY(heightFromGround) {
    // Phaser y grows downward; our "height climbed" grows upward.
    return -heightFromGround;
  }

  drawCharacter() {
    // Placeholder: back turned, facing the building. Swap for real character art later.
    const g = this.worldGfx;
    g.clear();
    g.fillStyle(0x2f2f3a, 1);
    g.fillRoundedRect(ORIGIN_X - 8, this.worldY(0) - 22, 16, 22, 3);
    g.fillCircle(ORIGIN_X, this.worldY(0) - 26, 7);
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
    this.headPresent = Math.random() < HEAD_CHANCE;

    const swing = (this.angleValue - 0.5) * 2; // -1..1
    this.ballVX = swing * MAX_SWING_SPEED;
    this.ballVY0 = MIN_POWER_SPEED + this.powerValue * (MAX_POWER_SPEED - MIN_POWER_SPEED);
    this.ballStartX = ORIGIN_X;
    this.cameraFollowing = true;
  }

  getHeadBounds() {
    // Sits just above W20 (the "main" window) - see WINDOWS[0].
    const w20 = WINDOWS[0];
    const centerX = (w20.xFrom + w20.xTo) / 2;
    return {
      xFrom: centerX - 8,
      xTo: centerX + 8,
      heightFrom: w20.heightTo,
      heightTo: w20.heightTo + 14,
    };
  }

  updateFlight(dt) {
    this.flightTime += dt;
    const t = this.flightTime;
    const x = this.ballStartX + this.ballVX * t;
    const heightClimbed = this.ballVY0 * t - 0.5 * GRAVITY * t * t;
    const y = this.worldY(heightClimbed);
    this.ball.setPosition(x, y);

    if (this.cameraFollowing) {
      const targetScrollY = y - GAME_HEIGHT * 0.6;
      this.cameras.main.scrollY = Phaser.Math.Linear(this.cameras.main.scrollY, targetScrollY, 0.12);
    }

    if (this.headPresent) {
      const hb = this.getHeadBounds();
      if (
        x >= hb.xFrom &&
        x <= hb.xTo &&
        heightClimbed >= hb.heightFrom &&
        heightClimbed <= hb.heightTo
      ) {
        this.finishThrow(true, WINDOWS[0], HEAD_BONUS_COINS);
        return;
      }
    }

    for (const win of WINDOWS) {
      if (
        x >= win.xFrom &&
        x <= win.xTo &&
        heightClimbed >= win.heightFrom &&
        heightClimbed <= win.heightTo
      ) {
        this.finishThrow(true, win, 0);
        return;
      }
    }

    if (heightClimbed < 0 && t > 0.2) {
      this.finishThrow(false, null, 0);
    }
  }

  finishThrow(hit, win, headBonus) {
    this.state = STATE.RESULT;
    this.cameraFollowing = false;

    if (hit) {
      this.streak += 1;
      let coins = (win ? win.coins : 0) + headBonus;
      const streakBonus = Math.floor(coins * 0.15 * (this.streak - 1));
      coins += streakBonus;
      Economy.addCoins(coins);
      Economy.reportStreak(this.streak);
      const label = headBonus > 0 ? "HEADSHOT! +" : win.name + " HIT! +";
      this.showMessage(label + coins + " coins" + (this.streak > 1 ? "\nstreak x" + this.streak : ""));
    } else {
      this.streak = 0;
      this.showMessage("MISS\nstreak reset");
    }

    this.updateHud();

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
    this.messageText.setText(msg);
  }

  updateHud() {
    this.hudText.setText(
      "COINS " + Economy.getCoins() + "   STREAK " + this.streak + "   BEST " + Economy.getBestStreak()
    );
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
  backgroundColor: "#2b3a55",
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
