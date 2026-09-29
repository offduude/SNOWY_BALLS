// Single admin.initializeApp() call, shared by every function file (calling it twice throws). Also the one place
// `db`/`FieldValue` are exported from, so nothing else has to touch the admin SDK directly.
//
// Uses the modular `firebase-admin/firestore` entry point rather than the legacy `admin.firestore.FieldValue`
// namespace - found the hard way (2026-09-29, emulator smoke test): the legacy namespace's `FieldValue` came back
// `undefined` specifically inside the Functions Emulator's runtime (a lazy-loading quirk that didn't reproduce
// running the same file with plain `node`), while the modular import worked correctly in both.
const admin = require("firebase-admin");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

if (admin.apps.length === 0) admin.initializeApp();

const db = getFirestore();

module.exports = { admin, db, FieldValue };
