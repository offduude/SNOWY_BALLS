// One-time production data migration (Blaze migration plan item 6 - see the snowy-balls-blaze-migration memory
// and docs/NOTES.md). Backfills every existing real player's saves/{uid} doc with the new server-owned fields
// (coins, lifetimeCoins, skinCounts, buffItems, projectiles, buffs, equipped, reserved, outgoingTradeId,
// personalShopStock, shopBought) a brand-new/already-migrated doc already has, using the EXACT SAME normalize()
// the real Cloud Functions use - reused directly from functions/lib/saves.js, not reimplemented here, so there is
// no chance of this script's own idea of "the right defaults" drifting from what purchase/openBox/claimThrow/etc.
// will actually read the moment they touch the same doc for real.
//
// Why a dedicated script, not just "the first real Cloud Function call lazily backfills it" (true, and already
// how every function in this project is written - "safe to run against a doc in ANY state"): a bulk, up-front
// pass means every account is known-good BEFORE any player touches the live system, with a real backup and a
// real diff to review - not "find out whichever account breaks first, live, in front of a player." See the
// plan's own item 6 reasoning (memory) for why "reset everyone" was explicitly rejected in favor of this.
//
// SAFETY, in order:
//   1. Connects to the REAL project only - reads the service account key's own project_id and REFUSES to run
//      unless --project matches it exactly, so this can never silently run against the wrong project (or,
//      conversely, give a false sense of safety by being pointed at a throwaway one).
//   2. DRY RUN BY DEFAULT. Nothing is ever written unless --apply is passed - the first run should always be a
//      dry run, reviewed, before ever adding --apply.
//   3. Backs up the ENTIRE saves collection to a local timestamped JSON file BEFORE touching anything (even in
//      dry-run mode - the backup costs nothing and means the one-time real --apply run is never the first time
//      a backup exists).
//   4. Idempotent - re-running against already-migrated docs is a safe no-op (normalize() applied twice to the
//      same data returns the same shape), so this can be run more than once without risk.
//
// Usage (from the repo's functions/ directory, since that's where firebase-admin and this project's own
// functions/lib modules already live as dependencies):
//   node ../scripts/migrateSaves.js --project snowy-balls-5f7a5                 (dry run - review the output)
//   node ../scripts/migrateSaves.js --project snowy-balls-5f7a5 --apply        (the real, one-time write)
//
// Needs GOOGLE_APPLICATION_CREDENTIALS set to a real service account key's path (Firebase console -> Project
// Settings -> Service Accounts -> Generate new private key) - see docs/DEPLOY_CHECKLIST.md for exactly how to
// get one. This script refuses to run against the Local Emulator Suite - it is only ever meant to touch the
// real project, once.

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const projectArg = (() => {
  const i = args.indexOf("--project");
  return i >= 0 ? args[i + 1] : null;
})();

if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("Refusing to run: an emulator host env var is set. This script only ever touches the REAL project.");
  process.exit(1);
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error("Missing GOOGLE_APPLICATION_CREDENTIALS. Point it at a real service account key JSON file first - see docs/DEPLOY_CHECKLIST.md.");
  process.exit(1);
}
if (!projectArg) {
  console.error("Missing --project <id>. Pass it explicitly (e.g. --project snowy-balls-5f7a5) - this script never guesses which project to touch.");
  process.exit(1);
}

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const key = JSON.parse(fs.readFileSync(keyPath, "utf8"));
if (key.project_id !== projectArg) {
  console.error(`Refusing to run: the service account key is for project "${key.project_id}", but --project said "${projectArg}". These must match exactly.`);
  process.exit(1);
}

const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(key), projectId: projectArg });
const db = admin.firestore();

const { normalize } = require("../functions/lib/saves");

const SERVER_OWNED_FIELDS = ["coins", "lifetimeCoins", "skinCounts", "buffItems", "projectiles", "buffs", "equipped", "reserved", "outgoingTradeId", "personalShopStock", "shopBought"];

function changedFields(raw, normalized) {
  const changed = [];
  for (const key of SERVER_OWNED_FIELDS) {
    const before = JSON.stringify(raw ? raw[key] : undefined);
    const after = JSON.stringify(normalized[key]);
    if (before !== after) changed.push(key);
  }
  return changed;
}

async function main() {
  console.log(`Project: ${projectArg}${apply ? " (APPLY - this WILL write)" : " (dry run - nothing will be written)"}`);

  const snap = await db.collection("saves").get();
  console.log(`Found ${snap.size} saves/{uid} docs.`);

  const backupDir = path.join(__dirname, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `saves-backup-${projectArg}-${Date.now()}.json`);
  const backup = {};
  snap.forEach((doc) => (backup[doc.id] = doc.data()));
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`Backed up ${snap.size} docs to ${backupPath} (always, even in dry-run mode).`);

  let unchanged = 0;
  let toChange = 0;
  for (const doc of snap.docs) {
    const raw = doc.data();
    const normalized = normalize(raw);
    const changed = changedFields(raw, normalized);
    if (changed.length === 0) {
      unchanged++;
      continue;
    }
    toChange++;
    console.log(`  ${doc.id}: ${changed.join(", ")}`);
    if (apply) {
      // Same shape of write as the real functions/lib/saves.js writeSave() - replace each server-owned field
      // wholesale, never touch data/updatedAt/session (the client-owned fields, untouched by this migration).
      await db.collection("saves").doc(doc.id).set(normalized, { mergeFields: SERVER_OWNED_FIELDS });
    }
  }

  console.log(`\n${unchanged} already fully migrated (no-op), ${toChange} ${apply ? "migrated" : "would be migrated"}.`);
  if (!apply) console.log("Dry run only - nothing was written. Re-run with --apply once you've reviewed this output.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  });
