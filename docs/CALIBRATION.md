# Calibrating projectiles and characters (a standing rule)

**A new projectile is calibrated with every existing character, and a new character with every existing projectile - and ONLY the new one is
checked, never the pairs that already exist (they are unaffected; the owner asked for this on 2026-09-21).** (Characters today: `character1` only.) A projectile in the hand is a small sprite drawn at the hand's place on the character's EMPTY-handed idle / aiming pictures
(`CHARACTERS` and `updateHeldBall` in `src/main.js`), so the two must be matched: position, size, the upside-down idle hold, and the layer (in the
aiming pose the projectile is one layer under the character, so the fist covers its lower part).

## Adding a projectile
1. Wire it as usual (`PROJECTILE_VISUALS.<id>` with its `ball` texture, the shop item, the catalog entry). It needs NO character pictures any more.
2. On localhost open the game, and in the browser console run `await calibrateHeld()` (`calibrateHeldProjectiles()` in main.js). It places the
   projectile in the hand exactly as the game does, for every character x every projectile x idle and aiming, and counts the pixels it really adds
   (**read only the rows of the NEW projectile** - the others were calibrated when they were added)
   at the DEFAULT zoom. Every row must be `ok` (at least 4 pixels: a 2 x 2 dot). A `FAIL` means it vanishes: too small (the renderer drops a picture
   that is a fraction of a pixel - `HELD_MIN_CONTENT_PX` already enlarges tiny ones), hidden behind the hand, or in the wrong place.
3. Then LOOK: `calibrateSheet()` shows a contact sheet (every character x every projectile, idle on top, aiming under it, enlarged 4 times; tap it to
   close) - look only at the new one's column. Check position, size, that the idle one hangs upside down at the end of the hand and the aiming one sits on the fist with the fingers
   over it. Anything off is adjusted for that pair only, in the projectile's `PROJECTILE_VISUALS` entry:
   `hold: { character1: { idle: { dx: 0, dy: 1, size: 6 }, aiming: { dy: -1 } } }` (dx / dy move it from the character's hand point; `size`,
   `rotation`, `behind` replace the character's values). A projectile smaller than the normal size rests on the fingertips (`rest`).
4. Note in `docs/NOTES.md` which characters it was calibrated with and any `hold` it needed.

## Adding a character
1. Draw the three poses: idle and aiming EMPTY-handed and the throwing pose; load them in `preload` (keys like `char_idle`, `char_aiming`, `char_throwing` - or
   the character's own).
2. Register it in `CHARACTERS` with `sprites` and `hands.idle` / `hands.aiming`: x, y = where the middle of the projectile goes in its 64 x 64
   picture (pixels from the top-left corner; measure it by comparing a picture with a projectile in the hand against the empty one, or by eye at a
   zoom), `size` (5-6 px at the moment), the aiming `rest` row (the fingertips), `rotation` PI for idle, `behind: true` for aiming.
3. Run `await calibrateHeld()` - it covers every projectile with the new character (**read only the new character's rows**) - then `calibrateSheet()`
   (only the new character's block), and adjust with per-projectile `hold` entries for the new character id where needed.
4. Note it in `docs/NOTES.md`. (Selecting a character in the game is not built yet: `DEFAULT_CHARACTER` is used; `this.characterId` is where it will plug in.)

## What the tools can and cannot tell
`calibrateHeld()` is exact about visibility (pixels added at the default zoom) but cannot judge how it looks; `calibrateSheet()` shows it, a person (or
Claude looking at the picture) judges. Both only exist on localhost.
