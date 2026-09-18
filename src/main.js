// SNOWY BALLS - core game scene (vertical slice)
// Two-phase aim: freeze the angle pointer, then freeze the power pointer, then the
// snowball launches with those two frozen values driving its trajectory.

const GAME_WIDTH = 480;
const GAME_HEIGHT = 270;

const GRAVITY = 900; // px/s^2
const MAX_SWING_SPEED = 110; // px/s horizontal drift at full left/right
const MIN_POWER_SPEED = 500; // px/s vertical launch speed at 0 power (apex ~139px - a clear miss)
const MAX_POWER_SPEED = 1300; // px/s vertical launch speed at full power (apex ~939px)

const ANGLE_HZ = 0.85; // full sweep cycles per second (placeholder feel, tune later)
const POWER_HZ = 0.65;

const ORIGIN_X = GAME_WIDTH / 2;
const ORIGIN_Y = 40; // world height where the character throws from (0 = ground)
const INITIAL_SCROLL_Y = -(GAME_HEIGHT - 40); // keeps ground near the bottom of the frame

// Placeholder building/window layout - swap for real art-driven values later.
const BUILDING = { x: 60, width: GAME_WIDTH - 120, topHeight: 1400 };
const WINDOW_TARGET = { offsetX: 30, height: 500, width: 46, depth: 40 };
const HEAD_CHANCE = 0.3;
const HEAD_BONUS_COINS = 8;
const WINDOW_COINS = 3;

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

  create() {
    this.state = STATE.IDLE;
    this.streak = 0;
    this.angleValue = 0.5;
    this.powerValue = 0.5;
    this.flightTime = 0;
    this.headPresent = false;

    this.cameras.main.setBounds(0, -BUILDING.topHeight, GAME_WIDTH, BUILDING.topHeight + GAME_HEIGHT);
    this.cameras.main.setBackgroundColor("#2b3a55");
    this.cameras.main.scrollY = INITIAL_SCROLL_Y;

    // Static world graphics: sky gradient stripe, building, window, character.
    this.worldGfx = this.add.graphics();
    this.drawWorld();

    this.ball = this.add.circle(ORIGIN_X, this.worldY(ORIGIN_Y), 4, 0xffffff);
    this.ball.setDepth(10);

    // Aim HUD (screen-space, ignores camera scroll).
    this.aimGfx = this.add.graphics().setScrollFactor(0).setDepth(20);
    this.hudText = this.add
      .text(8, 6, "", { fontFamily: "monospace", fontSize: "12px", color: "#ffffff" })
      .setScrollFactor(0)
      .setDepth(21);
    this.messageText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, "", {
        fontFamily: "monospace",
        fontSize: "16px",
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

  drawWorld() {
    const g = this.worldGfx;
    g.clear();

    // Building face.
    g.fillStyle(0x555b6e, 1);
    g.fillRect(BUILDING.x, this.worldY(BUILDING.topHeight), BUILDING.width, BUILDING.topHeight + GAME_HEIGHT);

    // Ground strip.
    g.fillStyle(0xd8e6f0, 1);
    g.fillRect(0, this.worldY(0), GAME_WIDTH, 20);

    // Window target.
    const wx = ORIGIN_X + WINDOW_TARGET.offsetX - WINDOW_TARGET.width / 2;
    const wy = this.worldY(WINDOW_TARGET.height + WINDOW_TARGET.depth / 2) ;
    g.fillStyle(0xffe08a, 1);
    g.fillRect(wx, this.worldY(WINDOW_TARGET.height + WINDOW_TARGET.depth / 2), WINDOW_TARGET.width, WINDOW_TARGET.depth);

    // Character placeholder: back turned, facing the building (up).
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

  getWindowBounds() {
    return {
      x: ORIGIN_X + WINDOW_TARGET.offsetX - WINDOW_TARGET.width / 2,
      width: WINDOW_TARGET.width,
      heightFrom: WINDOW_TARGET.height - WINDOW_TARGET.depth / 2,
      heightTo: WINDOW_TARGET.height + WINDOW_TARGET.depth / 2,
    };
  }

  getHeadBounds() {
    return {
      x: ORIGIN_X + WINDOW_TARGET.offsetX - 8,
      width: 16,
      heightFrom: WINDOW_TARGET.height + WINDOW_TARGET.depth / 2,
      heightTo: WINDOW_TARGET.height + WINDOW_TARGET.depth / 2 + 14,
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
        x >= hb.x &&
        x <= hb.x + hb.width &&
        heightClimbed >= hb.heightFrom &&
        heightClimbed <= hb.heightTo
      ) {
        this.finishThrow(true, true);
        return;
      }
    }

    const wb = this.getWindowBounds();
    if (
      x >= wb.x &&
      x <= wb.x + wb.width &&
      heightClimbed >= wb.heightFrom &&
      heightClimbed <= wb.heightTo
    ) {
      this.finishThrow(true, false);
      return;
    }

    if (heightClimbed < 0 && t > 0.2) {
      this.finishThrow(false, false);
    }
  }

  finishThrow(hit, headHit) {
    this.state = STATE.RESULT;
    this.cameraFollowing = false;

    if (hit) {
      this.streak += 1;
      let coins = WINDOW_COINS;
      if (headHit) coins += HEAD_BONUS_COINS;
      const streakBonus = Math.floor(coins * 0.15 * (this.streak - 1));
      coins += streakBonus;
      Economy.addCoins(coins);
      Economy.reportStreak(this.streak);
      this.showMessage(
        (headHit ? "HEADSHOT! +" : "HIT! +") + coins + " coins" + (this.streak > 1 ? "\nstreak x" + this.streak : "")
      );
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

    const barX = 90;
    const barY = GAME_HEIGHT - 30;
    const barW = GAME_WIDTH - 180;
    const barH = 10;

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
