# Going live: the real cutover checklist

Everything up to here has been built and tested only against the Firebase Local Emulator Suite. Nothing has
ever touched the real project (`snowy-balls-5f7a5`). This is the one-time sequence to actually ship the whole
Blaze-migration economy (server-authoritative purchase/openBox/sellSkin/claimThrow/trading, the invite-only
allowlist, private inventories, the box-odds/Mints rework) to your 5 real players.

Blaze billing is already enabled (done). App Check and the automated billing kill-switch are deliberately not
part of this pass - see `docs/NOTES.md` and the `snowy-balls-blaze-migration` memory for why.

**Do these in order. Steps 1-2 can happen anytime before the window. Steps 3-6 should all happen inside one
short maintenance break** (tell your 5 friends first - "give me 10 minutes, don't play right now").

## 1. Get a service account key (one-time, needed for step 2 only)

1. [Firebase console](https://console.firebase.google.com/) -> your project -> the gear icon -> **Project
   settings** -> **Service accounts** tab.
2. Click **Generate new private key**. A JSON file downloads.
3. Save it as `scripts/serviceAccountKey.json` in this repo. It's already gitignored - it will never be
   committed, but don't share it or post it anywhere; it's a real credential with full access to your project.

## 2. Run the production data migration (backs up + backfills every real player's save)

From the repo root:

```bash
# Windows PowerShell:
$env:GOOGLE_APPLICATION_CREDENTIALS = "scripts\serviceAccountKey.json"
node scripts/migrateSaves.js --project snowy-balls-5f7a5
```

This is a **dry run** - it backs up the entire real `saves` collection to `scripts/backups/` (always, even in
dry-run mode) and prints exactly which fields each account is missing, but writes nothing. Read the output:
every real player should show a line listing the same server-owned fields (`coins, lifetimeCoins, skinCounts, ...`)
since none of them have ever been touched by a Cloud Function yet. If anything looks surprising, stop and ask.

Once it looks right, run it for real:

```bash
node scripts/migrateSaves.js --project snowy-balls-5f7a5 --apply
```

This is safe to run more than once (it's a no-op on anything already migrated) - if you're ever unsure whether
it finished, just run it again without `--apply` first to see what (if anything) it would still change.

**This step can happen before the maintenance window** - it only adds fields nothing reads yet (the old
client/rules don't know these fields exist), so it's invisible to players until step 4 ships.

## 3. Hand-paste the final `firestore.rules`

[Firebase console](https://console.firebase.google.com/) -> **Firestore Database** -> **Rules** tab -> replace
the whole contents with this repo's current `firestore.rules` (the version with the allowlist, `inventoryMirror`,
`config/minVersion`) -> **Publish**.

## 4. Deploy Cloud Functions for real

The very first real `firebase deploy` this project will ever run:

```bash
firebase deploy --only functions --project snowy-balls-5f7a5
```

This needs you logged into the Firebase CLI as an account with access to the project (`firebase login` first if
you haven't). Watch the output for errors - it should list `purchase`, `useBuff`, `openBox`, `sellSkin`,
`claimThrow`, `proposeTrade`, `acceptTrade`, `declineTrade`, `cancelTrade`, `getTargetInventory`, `rerollShop`,
`forceRerollShop` all deploying successfully.

## 5. Flip the client

Only now, with rules and Functions already live, merge the branch and push so GitHub Pages serves the new build:

```bash
git checkout main
git merge shop-redesign
git push origin main
```

GitHub Pages can take a few minutes to actually serve the new page - a friend who loads it in that window gets
the OLD page, which is harmless (the old client's direct writes to now-server-owned fields just get rejected by
the new rules; nothing breaks for them, they just can't do anything new until they reload).

## 6. Verify, then tell your friends it's safe to play again

- Sign in yourself (the admin account) and do one real purchase, one real box open, one real throw - confirm
  coins/inventory move and the leaderboard updates.
- Spot-check one or two other real accounts' `saves/{uid}` docs in the Firestore console - confirm they have
  real server-owned fields now (not all-defaults, unless that player genuinely never played before).
- Tell the group it's live again.

## If something looks wrong

The backup from step 2 (`scripts/backups/saves-backup-<project>-<timestamp>.json`) has every real player's
pre-migration save. Nothing in this whole pass deletes or overwrites a player's `data`/`session` fields - only
the server-owned half is ever touched, and only additively (missing -> defaulted). Firestore rules can be
reverted by re-pasting the previous version from git history in the same Rules tab.
