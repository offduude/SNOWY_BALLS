// Cost ceiling, not a feature (2026-10-01 - the owner's own question: can many botted accounts overload the
// project's Firebase limits? applyRateLimits (lib/rateLimit.js) caps how often ONE uid can call a function, but
// nothing caps how many uids exist - an attacker willing to create accounts can multiply their effective
// throughput by however many they make. `maxInstances` is the actual backstop for that: it bounds how many
// concurrent instances of a single Function Cloud Functions will ever spin up, no matter how many callers (real
// or Sybil) hit it at once - once the cap is reached, further calls queue or get refused rather than autoscaling
// (and billing) without limit. This is a BLUNT, cost-side guard, not a replacement for the real allowlist (built
// the same day - see lib/auth.js ALLOWED_EMAILS) or Firebase App Check (see src/cloud.js's own note); it's the
// floor under both.
//
// Numbers picked for a 5-person invite-only group, not a public game: PLAYER_MAX comfortably covers every real
// player calling at once with room to spare, ADMIN_MAX is deliberately tiny since only the owner's own account
// ever reaches that path.
const PLAYER_MAX_INSTANCES = 10;
const ADMIN_MAX_INSTANCES = 2;

module.exports = { PLAYER_MAX_INSTANCES, ADMIN_MAX_INSTANCES };
