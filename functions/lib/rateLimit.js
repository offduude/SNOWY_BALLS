const functions = require("firebase-functions");
const { db } = require("./admin");

// Firestore-backed, not in-memory (Cloud Functions cold starts / multiple concurrent instances make an in-memory
// counter unreliable - see the plan's Part 4). Fixed windows, not a sliding log: cheap (one doc, one field per
// key) and good enough for "stop a runaway script," not meant to be a precise leaky-bucket. MUST be called with
// reads already done (see callers) - Firestore transactions require every tx.get() before any tx.set()/update(),
// so this takes the already-read doc snapshot rather than reading it itself.
//
// `checks` is an array of { uid, key, limit, windowMs } - every check in the same transaction shares one
// `rateLimits/{uid}` doc read per uid (a trade touches two different uids' limits in the same transaction, so the
// caller passes one entry per uid+key pair and this batches the doc reads/writes per uid).
function rateLimitRef(uid) {
  return db.collection("rateLimits").doc(uid);
}

// Reads every rateLimits/{uid} doc this transaction will need to check - call ONCE, before any writes, then pass
// the result into applyRateLimits.
async function readRateLimitDocs(tx, uids) {
  const unique = [...new Set(uids)];
  const snaps = await Promise.all(unique.map((uid) => tx.get(rateLimitRef(uid))));
  const byUid = {};
  unique.forEach((uid, i) => (byUid[uid] = snaps[i]));
  return byUid;
}

// Applies every { uid, key, limit, windowMs } check against the docs readRateLimitDocs already fetched, throws
// "resource-exhausted" on the first one that's over its cap, and (only if every check passes) queues the tx.set()
// writes that record this call. Also updates `rateLimits/_global` the same way, as a combined backstop across
// every player (the plan's Part 4) - one extra key on the SAME per-call uid docs would double-count it, so the
// global backstop lives on its own doc, read/written alongside the per-uid ones.
async function applyRateLimits(tx, checks) {
  const uids = checks.map((c) => c.uid);
  const globalUid = "_global";
  const docs = await readRateLimitDocs(tx, [...uids, globalUid]);
  const now = Date.now();
  const writes = []; // { uid, key, entry } - only committed after every check has passed

  function evaluate(uid, key, limit, windowMs) {
    const data = docs[uid].exists ? docs[uid].data() : {};
    const entry = data[key];
    let next;
    if (!entry || now - entry.windowStart >= windowMs) {
      next = { count: 1, windowStart: now };
    } else if (entry.count < limit) {
      next = { count: entry.count + 1, windowStart: entry.windowStart };
    } else {
      throw new functions.https.HttpsError("resource-exhausted", `Rate limit exceeded for ${key}.`);
    }
    writes.push({ uid, key, entry: next });
  }

  for (const { uid, key, limit, windowMs } of checks) {
    evaluate(uid, key, limit, windowMs);
    // The global backstop: 10x every per-uid limit, shared across all players, same key namespace.
    evaluate(globalUid, key, limit * 10, windowMs);
  }

  for (const { uid, key, entry } of writes) {
    tx.set(rateLimitRef(uid), { [key]: entry }, { merge: true });
  }
}

module.exports = { readRateLimitDocs, applyRateLimits };
