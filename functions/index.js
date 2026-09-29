// Entry point Firebase (and the emulator) loads. Just re-exports every callable Function from its own file - see
// functions/economy.js and functions/trading.js for the actual logic, functions/lib/ for shared helpers.
require("./lib/admin"); // admin.initializeApp() exactly once, before anything else touches Firestore

Object.assign(exports, require("./economy"));
Object.assign(exports, require("./trading"));
