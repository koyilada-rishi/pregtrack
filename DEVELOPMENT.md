# Development Notes

Internal reference for working on this codebase: what's built, how it fits
together, and the day-to-day commands (run, stop, PIN, testing). `README.md`
is the deploy/setup guide for *using* the app; this file is for *changing*
it.

> **v2 migration in progress.** v1 (all 11 original steps) is fully built;
> a revised work order is now being built in place on top of it — steps 1-4
> below are done (no `config.js`/`mock.js` at all anymore, `data_version`
> polling, `bootstrap`, a live local countdown). Steps 5-11 (offline write
> queue, thumbnails, `syncFolder`, etc.) are still ahead — see `README.md`'s
> Status section for exact progress. Everything in this file is kept
> accurate as each step lands, rather than deferred to the end.

## What this is, in one paragraph

A PIN-locked, installable PWA for tracking a pregnancy: dashboard/countdown,
medicines, appointments, health log with charts, a Drive-backed records
vault, a week-by-week guide, checklists, and settings. Static frontend
(vanilla JS, no build step) on GitHub Pages; Google Apps Script is the only
backend, reading/writing a single Google Sheet plus a Drive folder tree.
2-5 users sharing one PIN, no paid services.

## Build history (what shipped in each step)

Commits are in order on `main`; each step's commit message has the fuller
rationale and test notes. This is the short version.

| # | Commit | What it added |
|---|--------|----------------|
| 1 | `Step 1` | Repo scaffold, `.gitignore`, placeholder files for every path in the layout, README skeleton. |
| 2 | `Step 2` | `backend/Code.gs`: `setup()` (creates the Sheet's 9 tabs + Drive folder tree), PIN auth (constant-time compare + CacheService lockout), `settings.get/set`, `dashboard.get`. Deploy instructions in the README. |
| 3 | `Step 3` | Frontend shell: hash router, lock screen, bottom nav, dashboard (countdown/next appointment/today's meds), Emergency card. `js/api.js` (the single network boundary) and `js/mock.js` (in-memory fixtures for `MOCK: true`). |
| 4 | `Step 4` | `data/weeks.json` (37 weeks), `data/food.json`, `data/warnings.json` — conservative content with `review: true` flags where guidance varies by source. Guide view wired to the real gestational week. |
| — | `Backend: CRUD for …` | Full CRUD actions for Medicines/Appointments/HealthLog/Contacts/FoodLog/Checklist, `medicines.logTaken` (upsert), `files.upload/get/delete` via Drive (8MB cap), and the Telegram daily-reminder trigger — all in one backend commit, consumed by steps 5–8/10's frontend work. 48-assertion mock-Apps-Script test harness (see "Testing the backend" below). |
| 5 | `Step 5` | Medicines view (today's doses, tap-to-check-off, add/edit/delete, 14-day history) and Appointments view (upcoming/past, mark-done, add/edit/delete). `js/mock.js` expanded to a full CRUD store so every view works with no deployed backend. |
| 6 | `Step 6` | Health log view: vitals form, history list, 3 Chart.js line charts (weight/BP/sugar), gentle non-diagnostic "worth mentioning at the next visit" notice on out-of-range latest readings. Chart.js lazy-loaded from a pinned CDN URL only when this view opens. |
| 7 | `Step 7` | Records vault: list/grid toggle, filter by type + date range, upload (camera capture or file picker, client-side 8MB check), inline viewer (image preview or open-in-tab), delete. |
| 8 | `Step 8` | Checklist view (3 tabs, add/check-off/delete) and Settings view (pregnancy/hospital fields, Contacts CRUD, change-PIN instructions). Contacts now feed the Emergency card's doctor-contacts section. FoodLog quick-add added to the Guide view (no dedicated screen was ever specified for it — see "Scope decisions" in README). |
| 9 | `Step 9` | Real `manifest.json`, generated icon set (192/512 + maskable), service worker (stale-while-revalidate app-shell cache), registration wired into `app.js`. Verified fully offline after one visit. |
| 10 | `Step 10` | Telegram reminders: README walkthrough for the backend trigger that was already built in the "Backend: CRUD…" commit (BotFather bot, chat ID, script properties, `createDailyReminderTrigger()`). |
| 11 | `Step 11` | Found and fixed two real bugs: `api.js` never re-exported `CONFIG` (silently `undefined` everywhere read from `app.js`), and — bigger — `js/config.js` being correctly gitignored meant a plain GitHub Pages deploy would have **no API URL at all**, stuck forever. Fixed by having the app ask for the Apps Script URL once per device and store it in `localStorage`, exactly like the PIN. Filled in README's GitHub Pages setup + Troubleshooting. |

**v1 is where the table above ends.** A second, more detailed work order
then revised the architecture — the rows below are v2, built in place on
top of v1 rather than starting over (same repo, same `main`, continuing
history).

| # | Commit(s) | What it added |
|---|--------|----------------|
| v2-1 | `v2 Step 1` | Added `js/store.js` (mock-mode flag — now frontend-only via a `?mock=1/0` URL param, no file at all — plus the v1 mock fixtures ported over) and a `js/countdown.js` placeholder. Deliberately left `app.js`/`api.js`/`config.js`/`mock.js` untouched at this point — ripping them out before the step-3 rewrite was ready would've left a broken intermediate state for no reason. |
| v2-2 | `v2 Step 2` | Backend: a `data_version` counter (Settings sheet + CacheService, bumped from inside every mutating action's existing lock — see `incrementDataVersion()`), the `version.get` and `bootstrap` actions, `Files` schema gains `mime`/`thumb_file_id` (appended, not inserted mid-row, so re-running `setup()` on a populated sheet never misaligns existing data), a `Thumbs` Drive folder. Extended the mock-Apps-Script Node test harness (real in-memory `CacheService` now, was a no-op stub) — 64 assertions passing. |
| v2-3/4 | `v2 Step 3/4` (one commit) | The real cutover: deleted `js/config.js`, `js/config.example.js`, `js/mock.js`. Rewrote `js/api.js` to pure transport (no mock branching, no `CONFIG` — matches the exact `fetch()` shape verified against the live deployment: only a `Content-Type: text/plain` header, default redirect-follow). Grew `js/store.js` into the real data layer (`call`/`fetchWithCache`/`getCached`/`loadBootstrap`/`startVersionPolling` — see "Architecture" below). Real `js/countdown.js` (pure local math, unit-tested standalone). Rewrote `app.js`'s boot/router/shell into one first-run screen (URL + PIN together) and a Home view with a live countdown (1s ticker for seconds, 30s full re-render, paused/resumed on tab visibility) — then did a mechanical `api.` → `store.` rename through the already-built Meds/Appointments/Health/Records/Checklist/Settings view code rather than rewriting it (unchanged logic, just a different module to call). Settings' old two sign-out-ish buttons (PIN-only "Lock app now" in both Settings and More, a separate "Change server URL") collapsed into one "Sign out / change PIN or URL" per the new spec. Wired Home's "this week" card to `data/weeks.json` (content itself was already correct from v1 step 4, unchanged). Found and fixed two real bugs during this pass: a temporal-dead-zone crash (`boot()` was invoked before a `const` it transitively depended on had been declared later in the file — fixed by moving the boot call to the very end), and `store.js`'s mock fixtures never got `bootstrap`/`version.get` cases added despite `app.js` needing them immediately. |
| v2-5 | `Countdowns + stock tracking + GitHub Pages readiness` (4 commits) | **Backend**: `ensureTabs(ss)` replaces the old unconditional-rewrite tab setup — appends only genuinely missing columns/tabs, never touches existing data, called from both `setup()` and every `bootstrap()` so a `Code.gs` redeploy alone migrates the Sheet. New `Countdowns` tab/actions (5 kinds: event/course/interval/recurring/countup), `Medicines` gains stock_count/doses_per_day/refill_alert_days, `medicines.logTaken` adjusts stock on real taken-state transitions only. **`js/countdown.js`**: pure per-kind math (`computeEventCountdown`/`computeCourseCountdown`/`computeStockCountdown`/`computeIntervalCountdown`/`nextRecurringOccurrence`+`computeRecurringCountdown`/`computeCountupCountdown`), a shared `classifyCountdownState` (upcoming/dueSoon(≤24h)/overdue/done), and a `computeCustomCountdown` dispatcher. **Frontend**: new `#/countdowns` view, Home's "Pinned countdowns" card (ticks every 1s, same mechanism as the pregnancy countdown), Medicines view shows next-dose/course/stock figures per row, the one-tap "taken" checkbox became genuinely optimistic (local state + re-render before the network call resolves). **GitHub Pages readiness**: found and fixed a real, serious bug — `sw.js`'s precache list still referenced `js/mock.js`, deleted in the v2 cutover; `cache.addAll()` is all-or-nothing, so the service worker had been **completely unable to install since that cutover**, silently breaking all offline support with no visible error. Also added `js/store.js`/`countdown.js` to the precache list (new files it was missing) and bumped `CACHE_VERSION`. Mock mode's default changed from an unconditional `true` to hostname-based (`isLocalDev()`): on in local dev, off in production — real mode and the first-run screen by default on any real domain, never silent sample data. Audited every asset reference for GitHub-Pages-subpath safety (all already relative — manifest, sw.js, imports, fetches) and the full git history for secrets (clean — confirmed via direct commands, not inferred). Added `.nojekyll`. Testing: backend harness grew to 103 assertions (was 64), `countdown.js` standalone tests grew to 59 (was 19), plus Playwright verification of the actual offline-after-subpath-deploy scenario (DNS-spoofed to a realistic hostname to test the production mock-mode default for real, not just in theory). |

## Architecture

```
┌─────────────────────┐        text/plain POST        ┌──────────────────────┐
│  GitHub Pages        │  {pin, action, payload}       │  Apps Script          │
│  (static files only) │ ─────────────────────────────▶│  doPost → routeAction │
│                      │ ◀───────────────────────────── │  {ok, data, error}    │
│  js/app.js (router)  │        JSON response           │                      │
│  js/store.js (data)  │                                 │  Sheet (9 tabs)       │
│  js/api.js (network) │                                 │  Drive (5 folders)    │
│  js/countdown.js     │                                 │                      │
└─────────────────────┘                                 └──────────────────────┘
        │
        ▼
  localStorage: PIN, API URL, bootstrap cache, last-good response per action
```

- **No CORS preflight**: the frontend always POSTs with `Content-Type:
  text/plain` as the *only* header (a "simple request"), carrying
  `{pin, action, payload}` as a JSON string body, and leaves `redirect` at
  fetch's default (`"follow"`) — any other header triggers a preflight
  Apps Script can't answer, and Apps Script's web app URL redirects once to
  `script.googleusercontent.com`. This exact shape was verified against the
  live deployment; don't add headers or override redirect handling in
  `js/api.js`. The `curl` equivalent is `-L` with **no** `-X POST` (see
  README's "Apps Script deploy" step 8 for why that combination matters).
- **Every action requires the PIN**, checked by `handleRequest()` in
  `Code.gs` before `routeAction()` ever runs. A wrong PIN or a backend-side
  validation error both come back as `{ok: false, error: "..."}` with
  HTTP 200 — `js/api.js` turns that into an `ApiError` with a `.kind`
  (`auth` / `lockout` / `network` / `server`) that `app.js` reacts to.
- **Three layers, not two.** `js/api.js` is pure transport: one `call()`
  that always hits the real backend, plus PIN/URL storage — nothing else,
  no mock branching. `js/store.js` sits above it and is what views actually
  import: it decides mock-vs-real, adds response caching
  (`getCached`/`fetchWithCache`), the `bootstrap` batch-load with its own
  cache (`loadBootstrap`/`getCachedBootstrap`), and `data_version` polling
  (`startVersionPolling`). `js/countdown.js` is pure math with no
  dependencies on either — due-date/gestational-age/duration calculations
  from a `Date`, used by Home's live ticker.
- **Freshness, not polling-everything.** `store.loadBootstrap()` serves the
  in-memory/`localStorage` cache instantly on every call *unless*
  `forceRefresh` is passed — only `startVersionPolling()`'s `onChanged`
  callback (fired when `version.get`, checked every 30s while the tab is
  visible, reports a different number than last time) ever passes that.
  So a view navigation is always instant after the first load; only an
  actual backend change triggers a real `bootstrap` re-fetch. Mock mode
  skips polling entirely (`startVersionPolling` no-ops — there's no real
  server to poll).
- **Mock fixtures live inside `js/store.js`** (not a separate file) as an
  in-memory object mirroring every `Code.gs` action, including `bootstrap`
  and `version.get`. Keep it in sync with `Code.gs` when adding backend
  actions — it's what makes local UI dev possible with zero setup.

## File-by-file reference

```
index.html            Static shell — just a <div id="app">, everything else is
                       rendered by app.js. Links css/style.css, manifest.json,
                       and loads js/app.js as a module.

js/app.js              ~2200 lines. Router (hash-based, see ROUTES table
                       below), first-run screen, every view's render +
                       event-handler functions, shared helpers (escapeHtml,
                       formField, date formatting, genericSkeleton,
                       errorMarkup). This is where almost all new frontend
                       work happens. boot() and registerServiceWorker() are
                       invoked at the very bottom of the file, not the top —
                       see the comment where ROUTES is defined for why
                       (a temporal-dead-zone bug bit this once already).

js/store.js              The data layer every view actually imports — not
                        js/api.js directly. Mock-mode flag + fixtures, plus
                        call/fetchWithCache/getCached/loadBootstrap/
                        startVersionPolling. Re-exports api.js's PIN/URL
                        helpers and ApiError too, so app.js only ever needs
                        one import. See "Architecture" above.

js/api.js               Pure network transport. One call(action, payload)
                        that always hits the real backend (no mock
                        branching — that's store.js), plus PIN/API-URL
                        storage in localStorage.

js/countdown.js           Pure local countdown math, no DOM/fetch/
                        localStorage — computeCountdown, formatDuration,
                        msUntil, isTimePastToday. Unit-testable standalone
                        (see "Testing approach" below).

js/i18n.js                English string table behind t(key, vars). Every
                        user-visible string should go through this, not be
                        hardcoded in app.js, so Telugu can be added later by
                        adding a "te" object with the same keys.

css/style.css            ~800+ lines. Design tokens on :root, dark mode via
                        prefers-color-scheme + explicit [data-theme], bottom
                        nav, cards, forms, charts container, the first-run
                        screen's two-field form (.field-pin vs the plain
                        .field[type="url"] — don't let the PIN's large
                        letter-spaced style leak onto the URL input), etc.

data/weeks.json           37 entries (weeks 4-40): size comparison, length/
                        weight, development note, common symptoms, tips.
                        "review": true entries have a review_note.
data/food.json            Per-trimester recommended/limit lists + an
                        always-avoid list, each item with a plain-language
                        reason and the same review flag convention.
data/warnings.json        14 red-flag symptoms with action + urgency.

backend/Code.gs            ~1250 lines. setup(), auth, routeAction() switch,
                        data_version machinery, bootstrap(), per-entity CRUD
                        (medicines/appointments/healthlog/contacts/foodlog/
                        checklist/files), generic createRow/updateRowById/
                        deleteRowById helpers (each bumps data_version),
                        validation helpers, date helpers, Telegram reminder
                        functions. See "Backend action reference" below.
backend/appsscript.json    Apps Script manifest: Asia/Kolkata timezone,
                        webapp execute-as/access config.

manifest.json              PWA manifest (icons, standalone display, theme),
                        all relative paths/URLs so it resolves correctly
                        from GitHub Pages' /<repo-name>/ subpath.
sw.js                      Service worker: stale-while-revalidate for
                        same-origin GETs only (app shell + data/*.json),
                        every APP_SHELL entry relative for the same subpath
                        reason. MUST list every file app.js actually
                        imports — cache.addAll() is all-or-nothing, so one
                        stale/wrong entry (e.g. a deleted file still listed)
                        fails the *entire* install silently, breaking
                        offline support completely with no visible error.
                        This happened for real during the v2 cutover (js/
                        mock.js stayed listed after being deleted) and went
                        unnoticed until an explicit GitHub-Pages-readiness
                        pass caught it — bump CACHE_VERSION and double-check
                        this list against the actual import graph whenever
                        a JS file is added, renamed, or removed.
icons/                     Generated heart-icon PNGs (192/512, + maskable).

README.md                  User-facing: status, deploy steps, GitHub Pages
                        setup, Telegram setup, troubleshooting, security notes.
DEVELOPMENT.md             This file.
```

## Routes (frontend)

Hash-based router in `js/app.js` (`ROUTES` object). The first-run screen is
not a route — it's a separate render mode gated by `state.locked`,
independent of the current hash, so navigating while locked always shows
it (or, in mock mode, self-heals straight past it — see `renderRoute()`).

| Hash | View | Bottom nav? |
|---|---|---|
| `#/home` | Home: live countdown, next appointment, today's meds | Home |
| `#/meds` | Medicines | Meds |
| `#/visits` | Appointments | Visits |
| `#/records` | Records vault | Records |
| `#/more` | More menu | More |
| `#/emergency` | Emergency card | — (reached via button/menu) |
| `#/guide` | Food & body guide (+ FoodLog quick-add) | — (via More) |
| `#/health` | Health log (list + charts) | — (via More) |
| `#/health/new` | Health log, form opened immediately | — (Home "Log vitals") |
| `#/checklist` | Checklists | — (via More) |
| `#/countdowns` | Custom countdowns (event/course/interval/recurring/countup) | — (via More) |
| `#/settings` | Settings (+ Contacts, + sign-out) | — (via More) |

Home and Emergency share one `store.loadBootstrap()` cache — visiting
Emergency right after Home is instant, no second network round-trip.

## Backend action reference

All actions are routed through `routeAction(action, payload)` in
`backend/Code.gs`. Every one requires a valid PIN (checked before routing).

```
auth.check
settings.get / settings.set
dashboard.get
version.get                 -- cheap, cache-backed: {data_version}
bootstrap                   -- settings + dashboard + every entity list in one call

medicines.list / .create / .update / .delete / .logTaken / .history
appointments.list / .create / .update / .delete
healthlog.list / .create / .update / .delete
contacts.list / .create / .update / .delete
foodlog.list / .create / .update / .delete
checklist.list / .create / .update / .delete
files.list / .upload / .get / .delete
countdowns.list / .add / .update / .delete / .markDone
```

`medicines.logTaken` is an upsert keyed on `(medicine_id, date, time)` —
calling it twice for the same dose on the same day updates the existing
`MedicineLog` row instead of creating a duplicate. `files.upload` takes
base64 + a type (`report`/`scan`/`prescription`/`document`), rejects
anything over 8MB, and saves into the matching Drive subfolder.
`bootstrap` deliberately omits raw `MedicineLog` (not needed for first
paint, can grow large, fetched on demand by the Meds view via
`medicines.history`). Every mutating action bumps `data_version` by
exactly 1 — see "Data version" in `backend/Code.gs`.

## Running it locally

No config file to create — v2 has none at all. Just:

```sh
cd /Users/rishi/workspace-auto/preg
python3 -m http.server 8000
```

**Stop it**: `Ctrl+C` in that terminal, or `pkill -f "http.server 8000"`.

### Mock mode (default)

Open `http://localhost:8000` — mock mode defaults on here (`isLocalDev()`
in `js/store.js` checks for `localhost`/`127.0.0.1`/`file://`), so it goes
straight to Home with sample data, no first-run screen, no backend. On any
other host — the real deployed site included — that same default flips to
real mode instead (first-run screen, no silent sample data in production).
**Any PIN "works"** in mock mode in the sense that `store.js`'s
`mockCall("auth.check", ...)` always succeeds — there's nothing real
behind it.

Force a mode without editing source: `?mock=1` / `?mock=0` in the URL once
(remembered in `localStorage`, key `pct_mock`, after that).

### Against the real backend

1. Deploy `backend/Code.gs` per the README's "Apps Script deploy" section
   and get the web app URL.
2. Open `http://localhost:8000?mock=0`. This shows the real first-run
   screen (same one the live site shows) asking for the URL and PIN
   together.
3. Enter both, submit. `app.js`'s `attemptFirstRun()` calls
   `store.setApiUrl()` + `store.setPin()` (both to `localStorage`), then a
   real `store.call("auth.check", {})`. A wrong PIN is genuinely rejected
   (with the real 5-attempt lockout); a non-`https://` URL is rejected
   client-side before any network call.

To skip the form while testing (e.g. driving it from a script), seed
`localStorage` directly before reload: `pct_api_url` and `pct_pin`. That's
what `boot()`'s own silent background re-check on every subsequent load
exercises too — see "PIN" below.

## PIN: how it actually works

- The PIN itself is **never stored in any file** — not in `Code.gs`, not
  anywhere in git (there's no config file in v2 at all). It lives in two
  places only:
  1. **Apps Script Script Properties** (`APP_PIN`), set by hand via the
     Apps Script editor (Project Settings → Script properties).
  2. **Each device's own `localStorage`** (`pct_pin`), set the first time
     that device enters it successfully on the first-run screen.
- **First entry on a device**: first-run screen → type URL + PIN together
  → `app.js`'s `attemptFirstRun()` calls `store.setApiUrl()` +
  `store.setPin()` (both written to localStorage) → one
  `store.call("auth.check", {})`. Accepted → into the app, both values
  stay stored. Rejected for a wrong PIN → `store.clearPin()` wipes the PIN
  only (the URL stays, so there's no need to retype it) and the form
  reappears. Rejected for a network failure → **both** are cleared, since
  nothing was proven to work yet on this device.
- **Every subsequent app load**: `boot()` tries `auth.check` once,
  silently, using whatever's already in localStorage. Success → straight
  to Home. Rejected (`kind: "auth"`) → PIN cleared, first-run screen shown
  again. Any other failure (network/server) → **trusts the stored
  credentials and lets you in anyway**, so you can read cached data
  offline without the app locking you out just because there's no signal.
- **Signing out**: **More → Settings → "Sign out / change PIN or URL"**
  clears *both* the PIN and the URL and shows the first-run screen again —
  there's no separate "just lock, keep the URL" action anymore (v1 had
  two different buttons for this; v2 collapsed them into one, per spec).
- **Changing the PIN**: edit `APP_PIN` in Apps Script's Script properties
  (push a new deployment version isn't needed for a Script Properties
  change, only for `Code.gs` edits), then sign out and re-enter it on each
  device.
- **Lockout**: 5 wrong attempts within 10 minutes → 15-minute lockout,
  tracked server-side via `CacheService` (not per-device, since there's one
  shared PIN) — see `isLockedOut`/`recordFailedAttempt` in `Code.gs`.
- **Mock mode**: `boot()`/`renderRoute()` auto-provision dummy credentials
  (`ensureMockCredentials()`) and never show the first-run screen at all —
  not even after signing out while in mock mode, which self-heals straight
  back into the app instead of getting stuck on a form that mock mode
  doesn't need filled in.

## The API URL (companion to the PIN)

Same pattern as the PIN, entered together on the same form:

- Stored in `localStorage` (`pct_api_url`), entered once per device.
- Validated client-side as `https://...` before any network call —
  Apps Script URLs are always https, and this also means a plaintext PIN
  never goes out over an insecure connection by accident.
- To change it later (e.g. after redeploying Apps Script to a new URL):
  same **"Sign out / change PIN or URL"** action as the PIN — there's no
  separate "just the URL" control in v2.
- There's no local-dev-only shortcut file for this anymore (v1's
  `CONFIG.API_URL` in `config.js` is gone) — use `?mock=0` + the form, or
  seed `localStorage` directly, per "Running it locally" above.

## Testing approach used during development

There's no committed automated test suite (the brief didn't ask for a CI
pipeline), but everything was verified before each commit:

- **Backend logic**: a throwaway Node harness (not committed) fakes just
  enough of the Apps Script runtime (`SpreadsheetApp`, `PropertiesService`,
  `DriveApp`, `Utilities`, a real in-memory `CacheService` — real SHA-256
  via Node's `crypto` for the PIN compare) to `eval()` the real
  `backend/Code.gs` and run assertions against it: CRUD round-trips,
  validation rejections, the `medicines.logTaken` upsert path, the 8MB
  file-size limit, `dashboard.get` integration, `data_version` bumping on
  every write path (verified by tampering the underlying fake sheet
  directly and confirming cache-hit reads ignore it, and that a cold cache
  falls back to the sheet correctly), and `bootstrap`'s shape. 64
  assertions as of v2 step 2. Re-run it after any `Code.gs` change by
  recreating that harness — or just re-deploy and use the `curl` smoke
  tests in the README.
- **`js/countdown.js`**: unit-tested standalone in Node (it's dependency-free
  by design) — parseLocalDateOnly, gestational age at several week
  boundaries, overdue vs. upcoming, formatDuration, msUntil,
  isTimePastToday. 19 assertions.
- **Frontend**: headless Playwright (Chromium) driving a local
  `python3 -m http.server`, exercising real user flows in mock mode (no
  credentials needed) — first-run/sign-out, every CRUD form, chart
  rendering, file upload with size-limit rejection, offline mode after a
  real service-worker registration, the live countdown actually ticking
  second-to-second, timers correctly stopping when navigating away from
  Home (a leaked `setInterval` was a real risk given the 1s ticker), and a
  full regression pass loading every route. Separately, a small local HTTP
  server stood in for Apps Script to verify the real (non-mock) `fetch()`
  path end-to-end — first-run validation, wrong/correct PIN, bootstrap
  data flowing into Home and Emergency identically. None of this is
  committed to the repo (it was scratch tooling), so there's nothing to run
  here directly — if you want a repeatable test suite, that'd be new work.
- **Real credentials**: this session never had the real deployed API URL
  or PIN, by design (see README's security notes) — everything above was
  verified against mock data or a local fake backend standing in for Apps
  Script, never the real deployment.

If you add a new view or action, the fastest way to sanity-check it without
writing new test infra: serve locally in mock mode, add the action's mock
implementation to `js/store.js`'s `mockCall()`, and click through it in a
browser.

## Known trade-offs / things intentionally left out

- **No Telugu strings yet** — `js/i18n.js` is structured for it (just add a
  `"te"` object with the same keys as `"en"`), but no translations exist.
- **No dedicated Contacts or FoodLog screens** — Contacts live in Settings
  (feeding the Emergency card); FoodLog is a quick-add section at the
  bottom of the Guide view. Neither was in the original 10-view list.
- **Records vault "grid" view doesn't show real thumbnails yet** — v1 shows
  a type icon, not the actual image. Real per-file thumbnails (client-side
  generated, uploaded alongside the original, `Files.thumb_file_id`) are
  v2 step 7 work, not done yet.
- **No offline write queue yet** — v1/early-v2 writes (medicines, etc.)
  just fail with an error message if offline; they don't queue and retry
  on reconnect. That's v2 step 9. The schema is already ready for it
  (creates accept an optional client-supplied `id` in both the mock and
  real `createRow`, so a retried/de-duped write won't be a problem once
  the queue exists), but the actual queue/backoff/de-dupe logic doesn't
  exist yet.
- **No `syncFolder` yet** — scanning Drive for files dropped in by hand and
  adding `Files` rows for them is v2 step 7 work.
- **Health log reference thresholds are deliberately generic** (BP ≥140/90,
  sugar ≥95 fasting / ≥140 post-meal) — framed as "worth mentioning at the
  next visit," never a diagnosis. These are the kind of numbers that
  legitimately vary by guideline/doctor.
- **No CI/automated test suite committed** — see "Testing approach" above.
