// Entry point Firebase (and the emulator) loads. Just re-exports every callable/scheduled Function from its own
// file - see functions/economy.js, functions/trading.js and functions/shop.js for the actual logic, functions/
// lib/ for shared helpers.
require("./lib/admin"); // admin.initializeApp() exactly once, before anything else touches Firestore

Object.assign(exports, require("./economy"));
Object.assign(exports, require("./trading"));
// Only the two actual Cloud Functions, not shop.js's `rerollIfDue` (a plain function it also exports so
// functions/test/run.js can call it directly, in-process, without going through the Functions Emulator's HTTP
// layer - see that file's own note on why a scheduled trigger can't be exercised that way).
const shop = require("./shop");
exports.rerollShop = shop.rerollShop;
exports.forceRerollShop = shop.forceRerollShop;
