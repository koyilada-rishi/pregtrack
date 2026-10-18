# Development Notes

Internal reference for working on this codebase: what's built, how it fits
together, and the day-to-day commands (run, stop, PIN, testing). `README.md`
is the deploy/setup guide for *using* the app; this file is for *changing*
it.

> **v2 migration in progress.** Everything below this note describes **v1**
> (fully built, all 11 original steps — still accurate for the files it
> hasn't touched yet). A revised work order is now being built in place on
> top of it: no `config.js`, `data_version` polling, offline write queue,
> thumbnails, `bootstrap`/`syncFolder`, a live local countdown. See
> `README.md`'s Status section for current v2 step progress. This file gets
> a full rewrite at v2's step 11 ("final README"); until then, treat
> anything here about `js/mock.js`, `js/config.js`, or the PIN/API-URL flow
> as v1-accurate but soon-superseded by `js/store.js` + the first-run screen
> (step 3).

## What this is, in one paragraph

A PIN-locked, installable PWA for tracking a pregnancy: dashboard/countdown,
medicines, appointments, health log with charts, a Drive-backed records
vault, a week-by-week guide, checklists, and settings. Static frontend
(vanilla JS, no build step) on GitHub Pages; Google Apps Script is the only
backend, reading/writing a single Google Sheet plus a Drive folder tree. Two
users, no paid services.

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

## Architecture

```
┌─────────────────────┐        text/plain POST        ┌──────────────────────┐
│  GitHub Pages        │  {pin, action, payload}       │  Apps Script          │
│  (static files only) │ ─────────────────────────────▶│  doPost → routeAction │
│                      │ ◀───────────────────────────── │  {ok, data, error}    │
│  js/app.js (router)  │        JSON response           │                      │
│  js/api.js (network) │                                 │  Sheet (9 tabs)       │
│  js/mock.js (dev)    │                                 │  Drive (4 folders)    │
└─────────────────────┘                                 └──────────────────────┘
        │
        ▼
  localStorage: PIN, API URL, last-good response per action (offline cache)
```

- **No CORS preflight**: the frontend always POSTs with `Content-Type:
  text/plain` (a "simple request"), carrying `{pin, action, payload}` as a
  JSON string body. Apps Script web apps respond with
  `Access-Control-Allow-Origin: *` automatically, so this works without any
  CORS configuration.
- **Every action requires the PIN**, checked by `handleRequest()` in
  `Code.gs` before `routeAction()` ever runs. A wrong PIN or a backend-side
  validation error both come back as `{ok: false, error: "..."}` with
  HTTP 200 — `js/api.js` is what turns that into an `ApiError` with a
  `.kind` (`auth` / `lockout` / `network` / `server`) that `app.js` reacts to.
- **`js/api.js` is the only file that knows about the network.** Every view
  in `app.js` calls `api.call(action, payload)` and gets back plain data or
  an `ApiError` — it never touches `fetch` directly. This is also the file
  to extend when adding a new backend action.
- **Offline reads**: `api.call()` caches every successful response in
  `localStorage` keyed by `action + JSON.stringify(payload)`. Views that
  want instant paint + background refresh use `api.fetchWithCache(action,
  payload, onCache)` instead of a plain `api.call()`.
- **`js/mock.js`** is a parallel implementation of every backend action as
  an in-memory JS object, used whenever `CONFIG.MOCK` is `true`. Keep it in
  sync with `Code.gs` when adding actions — it's what makes local UI dev
  possible without touching Apps Script at all.

## File-by-file reference

```
index.html            Static shell — just a <div id="app">, everything else is
                       rendered by app.js. Links css/style.css, manifest.json,
                       and loads js/app.js as a module.

js/app.js              ~2200 lines. Router (hash-based, see ROUTES table
                       below), every view's render + event-handler functions,
                       shared helpers (escapeHtml, formField, date formatting,
                       genericSkeleton, errorMarkup). This is where almost all
                       new frontend work happens.

js/api.js               The network boundary. call(action, payload), PIN and
                        API-URL storage (localStorage), response caching,
                        fetchWithCache(). Re-exports CONFIG from config.js.

js/mock.js               In-memory fixture backend for CONFIG.MOCK: true.
                        Mirrors every Code.gs action — update both together.

js/i18n.js                English string table behind t(key, vars). Every
                        user-visible string should go through this, not be
                        hardcoded in app.js, so Telugu can be added later by
                        adding a "te" object with the same keys.

js/config.example.js      Committed template. Copy to js/config.js (gitignored)
                        for local dev. See "Local dev" below.

css/style.css            ~800 lines. Design tokens on :root, dark mode via
                        prefers-color-scheme + explicit [data-theme], bottom
                        nav, cards, forms, charts container, etc.

data/weeks.json           37 entries (weeks 4-40): size comparison, length/
                        weight, development note, common symptoms, tips.
                        "review": true entries have a review_note.
data/food.json            Per-trimester recommended/limit lists + an
                        always-avoid list, each item with a plain-language
                        reason and the same review flag convention.
data/warnings.json        14 red-flag symptoms with action + urgency.

backend/Code.gs            ~1140 lines. setup(), auth, routeAction() switch,
                        per-entity CRUD (medicines/appointments/healthlog/
                        contacts/foodlog/checklist/files), generic
                        createRow/updateRowById/deleteRowById helpers,
                        validation helpers, date helpers, Telegram reminder
                        functions. See "Backend action reference" below.
backend/appsscript.json    Apps Script manifest: Asia/Kolkata timezone,
                        webapp execute-as/access config.

manifest.json              PWA manifest (icons, standalone display, theme).
sw.js                      Service worker: stale-while-revalidate for
                        same-origin GETs only (app shell + data/*.json).
                        Bump CACHE_VERSION when shell files change.
icons/                     Generated heart-icon PNGs (192/512, + maskable).

README.md                  User-facing: status, deploy steps, GitHub Pages
                        setup, Telegram setup, troubleshooting, security notes.
DEVELOPMENT.md             This file.
```

## Routes (frontend)

Hash-based router in `js/app.js` (`ROUTES` object). The lock screen is not
a route — it's a separate render mode gated by `state.locked`, independent
of the current hash, so navigating while locked always shows the PIN
screen.

| Hash | View | Bottom nav? |
|---|---|---|
| `#/dashboard` | Dashboard (default) | Home |
| `#/meds` | Medicines | Meds |
| `#/visits` | Appointments | Visits |
| `#/records` | Records vault | Records |
| `#/more` | More menu | More |
| `#/emergency` | Emergency card | — (reached via button/menu) |
| `#/guide` | Food & body guide (+ FoodLog quick-add) | — (via More) |
| `#/health` | Health log (list + charts) | — (via More) |
| `#/health/new` | Health log, form opened immediately | — (dashboard "Log vitals") |
| `#/checklist` | Checklists | — (via More) |
| `#/settings` | Settings (+ Contacts, + Server URL) | — (via More) |

## Backend action reference

All actions are routed through `routeAction(action, payload)` in
`backend/Code.gs`. Every one requires a valid PIN (checked before routing).

```
auth.check
settings.get / settings.set
dashboard.get

medicines.list / .create / .update / .delete / .logTaken / .history
appointments.list / .create / .update / .delete
healthlog.list / .create / .update / .delete
contacts.list / .create / .update / .delete
foodlog.list / .create / .update / .delete
checklist.list / .create / .update / .delete
files.list / .upload / .get / .delete
```

`medicines.logTaken` is an upsert keyed on `(medicine_id, date, time)` —
calling it twice for the same dose on the same day updates the existing
`MedicineLog` row instead of creating a duplicate. `files.upload` takes
base64 + a type (`report`/`scan`/`prescription`/`document`), rejects
anything over 8MB, and saves into the matching Drive subfolder.

## Running it locally

### Mock mode (default, no backend needed)

```sh
cd /Users/rishi/workspace-auto/preg
cp js/config.example.js js/config.js   # only if you haven't already — it's gitignored
python3 -m http.server 8000
```

Open `http://localhost:8000`. With `MOCK: true` in `js/config.js` (the
default), **any PIN unlocks the app** — `js/mock.js` serves realistic
sample data for every view, in-memory, reset on every page reload.

**Stop it**: `Ctrl+C` in that terminal, or `pkill -f "http.server 8000"`.

### Against the real backend

1. Deploy `backend/Code.gs` per the README's "Apps Script deploy" section
   and get the web app URL.
2. Edit `js/config.js`: set `API_URL` to that URL and `MOCK: false`.
3. Reload. The lock screen now does a real `auth.check` against Apps
   Script, and a wrong PIN is genuinely rejected (with the real 5-attempt
   lockout).

If `js/config.js` doesn't exist at all, the app shows a "not set up yet"
screen instead of breaking. If it exists with `MOCK: false` but no
`API_URL`, the app shows the one-time "Set up this device" screen asking
for the URL (see "PIN and the API URL" below) — useful for testing that
flow without touching `config.js`.

## PIN: how it actually works

- The PIN itself is **never stored in any file** — not in `Code.gs`, not in
  `config.js`, nowhere in git. It lives in two places only:
  1. **Apps Script Script Properties** (`APP_PIN`), set by hand via the
     Apps Script editor (Project Settings → Script properties).
  2. **Each device's own `localStorage`** (`pct_pin`), set the first time
     that device's user types it into the lock screen successfully.
- **First unlock on a device**: lock screen → type PIN → `app.js` calls
  `api.setPin(pin)` (writes to localStorage) → `api.call("auth.check", {})`
  → if the backend accepts it, `state.locked = false` and the PIN stays in
  localStorage for next time. If rejected, `api.clearPin()` wipes it and
  the error shows.
- **Every subsequent app load**: if a PIN is already in localStorage, the
  app tries `auth.check` once, silently. Success → straight to the
  dashboard. Rejected (`kind: "auth"`) → PIN cleared, back to lock screen.
  Any other failure (network/server) → **trusts the stored PIN and lets you
  in anyway**, so you can read cached data offline without the app locking
  you out just because you have no signal.
- **Changing the PIN**: edit `APP_PIN` in Apps Script's Script properties,
  then on *each* device, enter the new PIN at the lock screen once (or tap
  **More → Settings → Lock app now** first, then enter the new PIN).
  Instructions for this are also shown directly in the Settings view.
- **Locking manually**: **More → Lock app now** (also present in Settings)
  clears the stored PIN and returns to the lock screen immediately.
- **Lockout**: 5 wrong attempts within 10 minutes → 15-minute lockout,
  tracked server-side via `CacheService` (not per-device, since there's one
  shared PIN) — see `isLockedOut`/`recordFailedAttempt` in `Code.gs`.
- **Mock mode PIN**: `js/mock.js`'s `auth.check` always succeeds, so any
  non-empty PIN "works" locally. This is intentional — it's a dev
  convenience, not a security surface (nothing real is behind it).

## The API URL (companion to the PIN)

Added in step 11 to fix a real deployment gap. Same pattern as the PIN:

- Stored in `localStorage` (`pct_api_url`), entered once per device via a
  "Set up this device" screen that appears before the lock screen if
  `CONFIG.MOCK` is `false` and no URL is known yet.
- `CONFIG.API_URL` in `js/config.js` is only a **local-dev shortcut** that
  skips this prompt — it's never what the live GitHub Pages deployment
  uses, since `config.js` is never committed.
- To change it later (e.g. after redeploying Apps Script to a new URL):
  **More → Settings → Change server URL**.
- Validation requires `https://` — the setup screen rejects anything else.

## Testing approach used during development

There's no committed automated test suite (the brief didn't ask for a CI
pipeline), but everything was verified before each commit:

- **Backend logic**: a throwaway Node harness (not committed) fakes just
  enough of the Apps Script runtime (`SpreadsheetApp`, `PropertiesService`,
  `DriveApp`, `Utilities`, etc. — in-memory fakes, real SHA-256 via Node's
  `crypto` for the PIN compare) to `eval()` the real `backend/Code.gs` and
  run 48 assertions: CRUD round-trips, validation rejections, the
  `medicines.logTaken` upsert path, the 8MB file-size limit, and
  `dashboard.get` integration. Re-run it after any `Code.gs` change by
  recreating that harness (see the step-5 commit message / this file's git
  history for the exact approach) — or just re-deploy and use the `curl`
  smoke tests in the README.
- **Frontend**: headless Playwright (Chromium) driving a local
  `python3 -m http.server`, exercising real user flows — lock/unlock,
  every CRUD form, chart rendering, file upload with size-limit rejection,
  offline mode after a real service-worker registration, and a full
  regression pass loading all 9 non-dashboard routes. None of this is
  committed to the repo (it was scratch tooling), so there's nothing to run
  here directly — if you want a repeatable test suite, that'd be new work.

If you add a new view or action, the fastest way to sanity-check it without
writing new test infra: serve locally in mock mode, add the action's mock
implementation to `js/mock.js`, and click through it in a browser.

## Known trade-offs / things intentionally left out

- **No Telugu strings yet** — `js/i18n.js` is structured for it (just add a
  `"te"` object with the same keys as `"en"`), but no translations exist.
- **No dedicated Contacts or FoodLog screens** — Contacts live in Settings
  (feeding the Emergency card); FoodLog is a quick-add section at the
  bottom of the Guide view. Neither was in the original 10-view list.
- **Records vault "grid" view doesn't show real thumbnails** — it shows a
  type icon, not the actual image, to avoid fetching every file's base64
  just to render a list. Only the detail viewer loads the real content.
- **Health log reference thresholds are deliberately generic** (BP ≥140/90,
  sugar ≥95 fasting / ≥140 post-meal) — framed as "worth mentioning at the
  next visit," never a diagnosis. These are the kind of numbers that
  legitimately vary by guideline/doctor.
- **No CI/automated test suite committed** — see "Testing approach" above.
