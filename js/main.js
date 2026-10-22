// Entry point. Boots the app shell (router, first-run screen, bottom nav)
// from legacy-shell.js. As each tab gets its from-scratch rebuild (see
// js/tabs/), its route moves out of legacy-shell.js and gets wired in here
// directly — until then, legacy-shell.js still owns every route.
import "./legacy-shell.js";
