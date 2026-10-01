// Run by firebase.json's functions.predeploy hook, right before every real `firebase deploy --only functions`.
// A separate file (not an inline `node -e "..."` string) on purpose - firebase-tools' predeploy runner splits its
// command by whitespace itself rather than handing it to a real shell, which mangles any quoting an inline one-
// liner needs (confirmed live, 2026-10-02: it stripped the quotes around the copyFileSync arguments entirely,
// breaking the JS syntax). A plain `node <path>` with no arguments needing their own quoting sidesteps that
// class of bug outright. See functions/lib/economyData.js's own note for why this copy exists at all.
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "economy.json");
const dest = path.join(__dirname, "..", "functions", "economy.json");
fs.copyFileSync(src, dest);
console.log(`Copied ${src} -> ${dest}`);
