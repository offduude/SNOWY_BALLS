// EMERGENCY FIX (2026-10-02): migrateSaves.js's normalize()-based backfill was the wrong tool for a real
// migration - it blindly defaulted every missing server-owned field to zero/empty for every real account
// (coins: 0, skinCounts: {}, etc.), which is exactly "reset everyone's progress," the thing the owner explicitly
// said never to do (see the snowy-balls-blaze-migration memory, item 6's own revision history). Caught live: the
// owner reported purchase/openBox being refused on a real (non-admin) account right after cutover - their real
// balance was genuinely 0 server-side.
//
// Nothing is actually lost: every account's real coins/inventory/equipped loadout still sits untouched in
// saves/{uid}.data - the OLD CLIENT's own save blob (src/economy.js clean()/snapshot()), which neither
// migrateSaves.js nor any Cloud Function has ever written to (it's a client-owned field). This script parses
// that blob and corrects the server-owned fields FROM it, instead of leaving them at migrateSaves.js's wrong
// zero-defaults.
//
// Merge strategy per field, reasoned through rather than a blind overwrite (in case anything has already
// legitimately changed server-side since the bad migration - e.g. a real claimThrow succeeding from a 0
// baseline, which does NOT throw the way purchase/openBox correctly did):
//   coins / lifetimeCoins: ADDED (old client value + whatever the live doc currently holds) - current can only
//     ever reflect genuine post-cutover earning, since it started at a known 0, so this can never double-count.
//   skinCounts / buffItems / projectiles (id->count maps): per-id MAX(old, current) - cannot lose whichever
//     source is bigger, immaterial if both happen to be real and distinct at this tiny scale.
//   buffs (the active-timed-buff array): current if non-empty, else old (a server-side buffs entry can only
//     exist if a real useBuff succeeded, which needs real buffItems - vanishingly unlikely from a 0 baseline).
//   equipped: the old client's value - nothing server-side can have legitimately changed this from a 0/empty
//     baseline (sellSkin's own re-equip-on-empty path needs a real owned skin to sell in the first place).
//   reserved / outgoingTradeId / personalShopStock / shopBought: left alone entirely - no legacy client
//     equivalent to recover, and nothing meaningful could have happened here from a 0/empty starting point.
//
// The ADMIN account is skipped outright - its coins are forced to ADMIN_COINS on every real read regardless
// (functions/lib/auth.js), already confirmed working; nothing to fix there, and it has no "real" balance to
// recover in the first place.
//
// Same safety discipline as migrateSaves.js: dry run by default, a real project+credentials match required,
// backs up the CURRENT (still-wrong) state before writing over it.
//
// Usage (from the repo root):
//   node scripts/fixZeroedSaves.js --project snowy-balls-5f7a5             (dry run - review the output)
//   node scripts/fixZeroedSaves.js --project snowy-balls-5f7a5 --apply     (the real, one-time write)

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
  console.error("Missing GOOGLE_APPLICATION_CREDENTIALS. Point it at a real service account key JSON file first.");
  process.exit(1);
}
if (!projectArg) {
  console.error("Missing --project <id>. Pass it explicitly (e.g. --project snowy-balls-5f7a5).");
  process.exit(1);
}

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const key = JSON.parse(fs.readFileSync(keyPath, "utf8"));
if (key.project_id !== projectArg) {
  console.error(`Refusing to run: the service account key is for project "${key.project_id}", but --project said "${projectArg}".`);
  process.exit(1);
}

const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(key), projectId: projectArg });
const db = admin.firestore();

const ADMIN_UID = "zrHVHG8QVXfZfMhUn0PJHf9TEKO2";

function cleanCounts(obj) {
  const out = {};
  if (obj && typeof obj === "object") {
    for (const [id, n] of Object.entries(obj)) if (Number.isInteger(n) && n > 0) out[id] = n;
  }
  return out;
}

function mergeCountsMax(a, b) {
  const out = { ...a };
  for (const [id, n] of Object.entries(b)) out[id] = Math.max(out[id] || 0, n);
  return out;
}

async function main() {
  console.log(`Project: ${projectArg}${apply ? " (APPLY - this WILL write)" : " (dry run - nothing will be written)"}`);

  const snap = await db.collection("saves").get();
  console.log(`Found ${snap.size} saves/{uid} docs.`);

  const backupDir = path.join(__dirname, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `saves-pre-fix-${projectArg}-${Date.now()}.json`);
  const backup = {};
  snap.forEach((doc) => (backup[doc.id] = doc.data()));
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`Backed up the CURRENT (still-wrong) state to ${backupPath} before touching anything.`);

  let fixed = 0;
  let skipped = 0;
  for (const doc of snap.docs) {
    if (doc.id === ADMIN_UID) {
      console.log(`  ${doc.id}: skipped (admin account, already correct - see this script's own note)`);
      skipped++;
      continue;
    }
    const raw = doc.data();
    let old;
    try {
      old = typeof raw.data === "string" ? JSON.parse(raw.data) : null;
    } catch (e) {
      old = null;
    }
    if (!old) {
      console.log(`  ${doc.id}: skipped (no parseable legacy data - nothing to recover, already correct or genuinely new)`);
      skipped++;
      continue;
    }

    const oldCoins = Number.isInteger(old.coins) && old.coins >= 0 ? old.coins : 0;
    const oldLifetime = Number.isInteger(old.lifetimeCoins) && old.lifetimeCoins >= 0 ? old.lifetimeCoins : oldCoins;
    const curCoins = Number.isInteger(raw.coins) && raw.coins >= 0 ? raw.coins : 0;
    const curLifetime = Number.isInteger(raw.lifetimeCoins) && raw.lifetimeCoins >= 0 ? raw.lifetimeCoins : 0;

    const oldSkins = old.skinCounts && typeof old.skinCounts === "object" ? old.skinCounts : { character: {}, scenery: {}, weather: {} };
    const curSkins = raw.skinCounts && typeof raw.skinCounts === "object" ? raw.skinCounts : { character: {}, scenery: {}, weather: {} };
    const skinCounts = {};
    for (const kind of ["character", "scenery", "weather"]) {
      skinCounts[kind] = mergeCountsMax(cleanCounts(oldSkins[kind]), cleanCounts(curSkins[kind]));
    }

    const buffItems = mergeCountsMax(cleanCounts(old.buffItems), cleanCounts(raw.buffItems));
    const projectiles = mergeCountsMax(cleanCounts(old.projectiles), cleanCounts(raw.projectiles));
    const curBuffs = Array.isArray(raw.buffs) ? raw.buffs.filter((b) => b && typeof b.id === "string" && typeof b.endsAt === "number") : [];
    const oldBuffs = Array.isArray(old.buffs) ? old.buffs.filter((b) => b && typeof b.id === "string" && typeof b.endsAt === "number") : [];
    const buffs = curBuffs.length ? curBuffs : oldBuffs;
    const equipped =
      old.equipped && typeof old.equipped === "object"
        ? { character: "andek", scenery: "frosty", weather: "snow", projectile: "snowball", ...old.equipped }
        : raw.equipped;

    const fixedFields = {
      coins: oldCoins + curCoins,
      lifetimeCoins: oldLifetime + curLifetime,
      skinCounts,
      buffItems,
      projectiles,
      buffs,
      equipped,
    };

    console.log(`  ${doc.id}: coins ${raw.coins || 0} -> ${fixedFields.coins}, lifetimeCoins ${raw.lifetimeCoins || 0} -> ${fixedFields.lifetimeCoins}, ` +
      `skins ${JSON.stringify(curSkins)} -> ${JSON.stringify(skinCounts)}`);
    fixed++;

    if (apply) {
      await db.collection("saves").doc(doc.id).set(fixedFields, { mergeFields: ["coins", "lifetimeCoins", "skinCounts", "buffItems", "projectiles", "buffs", "equipped"] });
    }
  }

  console.log(`\n${fixed} account(s) ${apply ? "fixed" : "would be fixed"}, ${skipped} skipped.`);
  if (!apply) console.log("Dry run only - nothing was written. Re-run with --apply once you've reviewed this output.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Fix failed:", e);
    process.exit(1);
  });
