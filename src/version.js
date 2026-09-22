// The game's version, shown in the top-right corner of the OPTIONS list as "v<major>.<minor>.<build>".
//  major, minor: bumped BY HAND when the owner says so.
//  build: bumped automatically with every commit by the git pre-commit hook (.git/hooks/pre-commit): it is the number of commits
//         including the one being made. (It also rewrites the ?v= of this file in index.html, so a browser never keeps an old copy.)
const GAME_VERSION = { major: 1, minor: 0, build: 249 };
const GAME_VERSION_TEXT = `v${GAME_VERSION.major}.${GAME_VERSION.minor}.${GAME_VERSION.build}`;
