// requireMinVersion(data) - a version-gate precheck, called as the second line of every callable (right after
// requireAuth(context), before any other data parsing). Reads config/minVersion - a plain, non-transactional
// get(), same as requireAuth this must happen BEFORE db.runTransaction() starts, since Firestore transactions
// require all reads before any writes (the same constraint applyRateLimits works around).
//
// config/minVersion does not exist by default - the gate is fully OFF, zero behavior change, until the owner
// hand-sets it via the Firestore console (matching this project's existing discipline of hand-pasting
// firestore.rules rather than automating deploys). Fails OPEN on no doc / a misconfigured (non-numeric) build -
// a bad console edit must never accidentally lock out every player. Fails CLOSED only when the gate is genuinely
// on and the caller's own build is missing, unparseable, or below the minimum.
//
// src/version.js's GAME_VERSION.build is auto-incremented by the git pre-commit hook on every commit (= total
// commit count), so it's already a single, global, monotonically-increasing ordinal - no need to compare
// major/minor at all, just the trailing integer parsed out of GAME_VERSION_TEXT ("v1.1.331" -> 331).
const functions = require("firebase-functions");
const { db } = require("./admin");

function parseBuild(versionText) {
  const m = typeof versionText === "string" && /\.(\d+)$/.exec(versionText);
  return m ? parseInt(m[1], 10) : null;
}

async function requireMinVersion(data) {
  const snap = await db.collection("config").doc("minVersion").get();
  if (!snap.exists) return; // gate disabled - no minimum has ever been set
  const minBuild = snap.data().build;
  if (typeof minBuild !== "number") return; // misconfigured doc - fail OPEN, never lock everyone out over a typo

  const myBuild = parseBuild(data.clientVersion);
  if (myBuild === null || myBuild < minBuild) {
    // details.reason (not the message text) is what the client branches on - see src/cloud.js callFunction.
    throw new functions.https.HttpsError("failed-precondition", "Update required.", { reason: "outdated-client" });
  }
}

module.exports = { requireMinVersion };
