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
| v2-6 | `PIN-only first run` (3 commits) | New `js/defaults.js` (`DEFAULT_API_URL`, committed on purpose — see "The API URL" below). `js/api.js` now resolves the URL from a per-device override (`getApiUrlOverride`/`setApiUrlOverride`/`clearApiUrlOverride`/`hasApiUrlOverride`, Settings → Advanced) or that default; the first-run screen dropped its URL field entirely and asks for the PIN only. Settings' sign-in card split in two: sign-out now clears only the PIN (was PIN+URL together), and a new Advanced card owns the URL override independently. Found and fixed a real bug while testing: the Advanced override's `<input type="url">` let the browser's own native constraint validation silently block malformed submissions before the custom JS https-only check ever ran — switched to `type="text" inputmode="url"`. Also caught and fixed `sw.js` not precaching the new `js/defaults.js` (bumped to v3) — the same class of bug as the earlier `js/mock.js` incident, just a narrower blast radius this time. README/DEVELOPMENT.md updated throughout for the new flow and the updated secrets framing (API URL now intentionally committed; PIN/Sheet ID/Drive IDs still never). Testing: full mock-mode regression, and — since the override's https-only check meant a plain-HTTP fake backend could no longer even reach the first-run screen — stood up a throwaway self-signed HTTPS local server to test the real path faithfully (config-missing screen, PIN-only form, wrong/correct PIN, Advanced override set/validate/reset, sign-out clearing only the PIN while the override survives). Backend/countdown.js suites unaffected (not touched this round): 103/103 and 59/59 still passing. |

**v2 is where the table above ends.** A third work order ("v3") then
revised Home, medicine scheduling, and day-to-day tracking — again built
in place, same repo, same `main`. v3 is split into 4 phases; only Phase 1
has shipped so far.

| # | Commit(s) | What it added |
|---|--------|----------------|
| v3-1 | `Backend: v3 medicine scheduling…` | `Medicines` gains the full scheduling model (`schedule_type, anchor_mode, weekdays, interval_hours/days, month_day, every_n_weeks, total_doses, grace_minutes, instructions, prn_min_gap_hours/max_per_day, phases, reason, pack_id, status, stopped_on, stop_note, source`) — additive via `ensureTabs`, a blank `schedule_type` on an old row still means "daily". `medicines.stop` moves a medicine to history instead of deleting it, keeping the old `active` boolean in sync for the still-unmodified dashboard code. `medicinesLogTaken` now accepts `{status: taken\|skipped\|missed, note, taken_at}` alongside the original `{taken: true/false}` (unchanged, still works) — `taken_at` is the *real* instant a dose was logged, which `anchor_mode: from_last` medicines key their next dose off. New `medicinelog.list` (unbounded, lazy) and a `Packs` entity (`packs.list/create/update/delete/tickAll`). New `test/backend.test.js` (the mock-Apps-Script Node harness, finally committed instead of living only in a scratch file) — 140 assertions, `node test/backend.test.js`. |
| v3-2 | `js/schedule.js: pure medicine-scheduling engine` | New dependency-free module: `slotsForDay`, `nextDose` (interval, fixed vs. from_last), `courseProgress`, `stockDaysLeft` (daily/weekly/monthly/interval/PRN-average), `weeklyMonthlyDueState` (overdue/due_today/due_soon/upcoming, calendar-based), `canTakeNow` (PRN gap+cap — advisory only, never blocks), `packStatus`, `timeOfDayBucket`. New `test/schedule.test.mjs` — 60 assertions covering every must-pass case from the work order (from_last recompute after a late dose, Mon/Thu course, weekly/monthly due-state incl. Feb/Apr clamping, PRN gap+cap, a course ending mid-week, a rolled-back device clock, pack tick-all/untick), `node test/schedule.test.mjs`. |
| v3-3 | `Frontend: Home redesign, progressive Add Medicine, Packs, Medicines used` | Home rebuilt: static day-count hero (tap to expand hours/minutes, no more ticking seconds), "Today's medicines" grouped Morning/Afternoon/Evening/Night via `schedule.js`, Packs card (tick-all), "Coming up" (weekly/monthly shots due within 2 days or overdue), pinned countdowns/next appointment/quick actions now open as bottom sheets. New shared bottom-sheet + 6-second-undo-toast infrastructure (`openSheet`/`closeSheet`/`showUndoToast` near the top of `app.js`) — every delete/stop applies locally first and only calls the network if the toast's undo isn't pressed. One shared progressive-disclosure "Add Medicine" sheet (`openMedicineSheet`) used from both Home and the Meds page: chips reveal only their own sub-fields (same show/hide pattern the Countdowns form already used), a live plain-language summary, and the required "Enter exactly what your doctor or the label says" line. New "Medicines used" view (`#/meds/history`). Found and fixed a real pre-existing bug while wiring this up: `store.js`'s mock `todayStr()` formatted via `toISOString()` (UTC) after computing the date in local time — off by a day for part of the day in any timezone ahead of UTC, invisible until `schedule.js`'s real date arithmetic started depending on it. Verified via Playwright against mock mode (every Home section tappable, zero console/page errors, all four sheet types open/close cleanly). `sw.js` bumped to v4 (added `js/schedule.js`). |
| v3-4 | `Checkins, Symptoms, Water, FoodPrefs` (backend) + `daily check-in, symptoms, water, food, timeline` (frontend) | **Backend**: four new tabs — `Checkins` (mood 1-5 + note, multiple per day), `Symptoms` (14 fixed chips + `custom`, severity, a bleeding/spotting pad-comparison scale, `symptoms.update` only ever writes `note` — a "fix note" added later never rewrites what was actually selected), `Water` (one row per glass tap), `FoodPrefs` (liked/not-interested, re-dated on each status change). None are in `bootstrap` — all lazy/date-ranged. **Frontend**: three new Home cards (check-in with mood faces + symptom chips opening a severity/bleeding-scale sheet, a calm fixed "contact your doctor now" box + Emergency button on a severe selection; water glasses row with the optimistic-add-then-6s-undo pattern; a food quick-add with recent-foods one-tap re-add). Three new views: `#/water` (totals, a 14-day Chart.js bar chart, a goal streak), `#/food` (quick-add, liked/not-interested management, searchable history), `#/timeline` (one chronological feed merging check-ins/symptoms/water/food/medicine-started-stopped/skipped-or-missed-dose-counts/appointments/vitals — entries are always laid side by side, never implying one caused another; a "Show my doctor" toggle re-groups the same filtered entries by type for a cleaner visit summary). `sw.js` -> v5. |
| v3-5 | `Bookings, Suggestions, Bills, Records type_v2` (backend) + `Bookings, rebuilt Records, Reimbursement` (frontend) | **Backend**: `Bookings` (replaces plain quick-add Appointments for anything needing real status tracking — Booked -> Done -> Waiting for report -> Report uploaded -> Closed, each stage stamping its own timestamp; `bookings.close` enforces a doctor_visit needs an uploaded+linked prescription or an explicit no-prescription note, a scan/blood_test needs its report linked first, vaccine/other close freely), `Suggestions` (doctor suggestions, pending/done/skipped), `Bills` (amount/status/paid_on per booking). `Files` gains `type_v2` (the new six-category typing) and `linked_booking_id` — fully additive; the original `type` column and every existing upload are untouched, anything with no `type_v2` just shows up in a "needs sorting" bucket. New `files.update` for metadata-only edits. **Frontend**: Records rebuilt into folder tiles by `type_v2` + "Needs sorting", with search/date-range/edit-metadata/delete-with-undo. New `#/bookings`: filters, a status-progression button, a Close button that surfaces the backend's real validation error inline, a "prepare" section (questions checklist stored as plain `[x]`-prefixed text on the booking, "what the doctor said last time" auto-pulled from the previous closed booking of the same type, a "since last visit" symptom/medicine summary), after-visit notes + suggestions with one-tap follow-through (add as medicine / book a test / set a countdown — reusing the medicine/countdown sheets with a generalized "is this new" check so a prefilled object without an `id` still creates instead of trying to update), a bill section, upload-and-link-in-one-step for records. New `#/reimbursement`: date-range totals (monthly + grand), missing-report/receipt flags, CSV export, print. `sw.js` -> v6. |
| v3-6 | `medicine photos/details/expiry, reminder extension` (backend) + `composition search` (frontend) | **Backend**: `Medicines` gains `photo_front_file_id`/`photo_back_file_id` (pointers to `Files` rows, same pattern as `thumb_file_id`), `composition`/`brand`/`strength`/`expiry_date`; `Settings` gains four global on/off switches plus `expiry_alert_days`. Extended the Telegram daily reminder with today's bookings, outstanding report/prescription follow-ups, a leaner GAS-side reimplementation of `schedule.js`'s due-today logic (not a full port — just enough for a once-a-day text summary), weekly/monthly shots due within 2 days, a water-behind-goal nudge, and expiry alerts — finished/stopped medicines excluded everywhere. **Frontend**: the Add Medicine sheet's More section gains brand/strength/composition/expiry (each gated behind its own Settings toggle) and front/back photo capture (client-side canvas resize to <=1600px + JPEG 0.8 before upload, via the existing `files.upload` path as `type_v2: medicine_photo`). Expiry badges on the Meds list and Medicines-used view. Composition search: the Medicines-used search box also matches brand/composition. New Settings "Medicine details" card. `sw.js` -> v7. Polish: confirmed via Playwright that the app still fully loads and is usable completely offline (service worker `activated`, a fresh page navigated while offline renders Home from cache with the "You're offline" banner and zero errors) — this was re-verified after all four phases, not assumed. |

## Architecture

```
┌─────────────────────┐        text/plain POST        ┌──────────────────────┐
│  GitHub Pages        │  {pin, action, payload}       │  Apps Script          │
│  (static files only) │ ─────────────────────────────▶│  doPost → routeAction │
│                      │ ◀───────────────────────────── │  {ok, data, error}    │
│  js/app.js (router)  │        JSON response           │                      │
│  js/store.js (data)  │                                 │  Sheet (11 tabs)      │
│  js/api.js (network) │                                 │  Drive (5 folders)    │
│  js/defaults.js (url)│                                 │                      │
│  js/countdown.js     │                                 │                      │
└─────────────────────┘                                 └──────────────────────┘
        │
        ▼
  localStorage: PIN, API URL override (optional), bootstrap cache, last-good
                response per action
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

js/app.js              ~3900 lines. Router (hash-based, see ROUTES table
                       below), first-run screen, every view's render +
                       event-handler functions, the shared bottom-sheet +
                       undo-toast infrastructure (openSheet/closeSheet/
                       showUndoToast, near the top, right after the module
                       imports), shared helpers (escapeHtml, formField, date
                       formatting, genericSkeleton, errorMarkup). This is
                       where almost all new frontend work happens. boot()
                       and registerServiceWorker() are invoked at the very
                       bottom of the file, not the top — see the comment
                       where ROUTES is defined for why (a temporal-dead-zone
                       bug bit this once already).

js/store.js              The data layer every view actually imports — not
                        js/api.js directly. Mock-mode flag + fixtures, plus
                        call/fetchWithCache/getCached/loadBootstrap/
                        startVersionPolling. Re-exports api.js's PIN/URL
                        helpers and ApiError too, so app.js only ever needs
                        one import. See "Architecture" above.

js/api.js               Pure network transport. One call(action, payload)
                        that always hits the real backend (no mock
                        branching — that's store.js), PIN storage in
                        localStorage, and API URL resolution (committed
                        default + optional per-device override). See "The
                        API URL" below.

js/defaults.js             Exports DEFAULT_API_URL. Committed on purpose,
                        unlike the PIN/Sheet ID/Drive IDs — see "The API
                        URL" below for why. Ships with an obvious
                        placeholder; edit + commit it yourself after
                        deploying the backend.

js/countdown.js           Pure local countdown math, no DOM/fetch/
                        localStorage — computeCountdown, formatDuration,
                        msUntil, isTimePastToday, plus the custom-countdown
                        kinds (computeEventCountdown/computeCourseCountdown/
                        computeStockCountdown/computeIntervalCountdown/
                        nextRecurringOccurrence+computeRecurringCountdown/
                        computeCountupCountdown), classifyCountdownState,
                        and the computeCustomCountdown dispatcher.
                        Unit-testable standalone (see "Testing approach").

js/schedule.js            Pure medicine-scheduling math (v3), same no-DOM/
                        fetch/localStorage rule as countdown.js — imports
                        only parseLocalDateOnly from it. slotsForDay,
                        nextDose (interval, fixed vs. from_last anchor),
                        courseProgress, stockDaysLeft, weeklyMonthlyDueState,
                        canTakeNow (PRN), packStatus, timeOfDayBucket. Every
                        function takes the device clock as an explicit `now`
                        parameter — never reads Date.now()/new Date()
                        itself — which is what makes it unit-testable with
                        exact, reproducible timestamps. See
                        test/schedule.test.mjs.

js/i18n.js                English string table behind t(key, vars). Every
                        user-visible string should go through this, not be
                        hardcoded in app.js, so Telugu can be added later by
                        adding a "te" object with the same keys.

css/style.css            ~1250 lines. Design tokens on :root (incl. the
                        shared dose-state colors --color-state-calm/amber/
                        rose/sage, light + dark), dark mode via
                        prefers-color-scheme + explicit [data-theme], bottom
                        nav, cards, forms, charts container, chips, tick
                        circles, the hero countdown card, and the shared
                        bottom-sheet + undo-toast components.

test/backend.test.js      Node mock-Apps-Script harness (fakes
                        SpreadsheetApp/PropertiesService/CacheService/
                        LockService/Utilities/DriveApp, then eval()s the
                        real backend/Code.gs) — run with
                        `node test/backend.test.js`.
test/schedule.test.mjs    Standalone unit tests for js/schedule.js — run
                        with `node test/schedule.test.mjs`.

data/weeks.json           37 entries (weeks 4-40): size comparison, length/
                        weight, development note, common symptoms, tips.
                        "review": true entries have a review_note.
data/food.json            Per-trimester recommended/limit lists + an
                        always-avoid list, each item with a plain-language
                        reason and the same review flag convention.
data/warnings.json        14 red-flag symptoms with action + urgency.

backend/Code.gs            ~1730 lines. setup(), auth, routeAction() switch,
                        data_version machinery, bootstrap(), per-entity CRUD
                        (medicines/appointments/healthlog/contacts/foodlog/
                        checklist/files/countdowns/packs), generic createRow/
                        updateRowById/deleteRowById helpers (each bumps
                        data_version), validation helpers, date helpers,
                        Telegram reminder functions. See "Backend action
                        reference" below.
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
| `#/home` | Home: hero countdown, today's meds by time of day, packs, coming-up shots, next appointment, pinned countdowns | Home |
| `#/meds` | Medicines | Meds |
| `#/meds/history` | Medicines used (active + finished + stopped) | — (via Meds "See medicines used") |
| `#/visits` | Appointments | Visits |
| `#/records` | Records vault | Records |
| `#/more` | More menu | More |
| `#/emergency` | Emergency card | — (reached via button/menu) |
| `#/guide` | Food & body guide (+ FoodLog quick-add) | — (via More) |
| `#/health` | Health log (list + charts) | — (via More) |
| `#/health/new` | Health log, form opened immediately | — (Home "Log vitals") |
| `#/checklist` | Checklists | — (via More) |
| `#/countdowns` | Custom countdowns (event/course/interval/recurring/countup) | — (via More) |
| `#/water` | Water totals, 14-day chart, goal streak | — (via More) |
| `#/food` | Food quick-add, liked/not-interested, history | — (via More) |
| `#/timeline` | Combined chronological feed + "Show my doctor" grouping | — (via More) |
| `#/bookings` | Booking tracker (status/reports/bills/suggestions) | — (via More) |
| `#/reimbursement` | Bookings + bills totals, CSV/print | — (via More) |
| `#/settings` | Settings (+ Contacts, medicine-detail toggles, + sign-out) | — (via More) |

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

medicines.list / .create / .update / .delete / .logTaken / .history / .stop
medicinelog.list          -- unbounded log fetch (optional medicine_id filter), lazy-loaded
appointments.list / .create / .update / .delete
healthlog.list / .create / .update / .delete
contacts.list / .create / .update / .delete
foodlog.list / .create / .update / .delete
checklist.list / .create / .update / .delete
files.list / .upload / .get / .update / .delete
countdowns.list / .add / .update / .delete / .markDone
packs.list / .create / .update / .delete / .tickAll
checkins.list / .create / .delete
symptoms.list / .create / .update / .delete        -- .update only ever writes `note`
water.list / .add / .delete
foodprefs.list / .create / .update / .delete
bookings.list / .create / .update / .delete / .close
suggestions.list / .create / .update / .delete
bills.list / .create / .update / .delete
```

`medicines.create`/`.update` now also accept the full v3 scheduling fields
(`schedule_type`, `anchor_mode`, `weekdays`, `interval_hours`,
`interval_days`, `month_day`, `every_n_weeks`, `total_doses`,
`grace_minutes`, `instructions`, `prn_min_gap_hours`, `prn_max_per_day`,
`phases`, `reason`, `pack_id`, `status`, `source`) plus the Phase 4 detail
fields (`photo_front_file_id`, `photo_back_file_id`, `composition`,
`brand`, `strength`, `expiry_date`) — all optional, a blank
`schedule_type` still means "daily" (interpreted in `js/schedule.js`, never
rewritten server-side). `medicines.logTaken` accepts either the original
`{taken: true/false}` or the richer `{status: taken|skipped|missed, note,
taken_at}` — both still work, the richer shape is what the v3 frontend
actually sends. `files.upload`/`.update` accept `type_v2` (the six-category
Records typing) and `linked_booking_id`, both optional/additive — a blank
`type_v2` is how a file ends up in the Records "needs sorting" bucket.
`bookings.close` enforces the closing rules described in the build-history
table above rather than letting the frontend decide; its error message is
meant to be shown to her as-is.

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
2. Edit `js/defaults.js`'s `DEFAULT_API_URL` to that URL (this is also
   what the live deployment needs — see "The API URL" below — so this step
   doubles as wiring up production). Don't commit a throwaway/test value;
   either use your real URL and commit it, or set a **per-device override**
   instead (see step 4) and leave `defaults.js` at its placeholder locally.
3. Open `http://localhost:8000?mock=0`. This shows the real first-run
   screen — PIN only — same one the live site shows.
4. Enter the PIN, submit. `app.js`'s `attemptFirstRun(pin)` calls
   `store.setPin(pin)` then a real `store.call("auth.check", {})`. A wrong
   PIN is genuinely rejected (with the real 5-attempt lockout).

   Prefer not to touch `js/defaults.js` at all for a quick local test?
   Set a per-device override instead, from the browser console or a test
   script, before loading the app:
   ```js
   localStorage.setItem('pct_api_url_override', 'https://your-test-url/exec');
   ```
   Same effect as pasting it into Settings → Advanced, just skippable
   without signing in first.

To skip the PIN form entirely while testing (e.g. driving it from a
script), also seed `localStorage.pct_pin` directly before reload. That's
what `boot()`'s own silent background re-check on every subsequent load
exercises too — see "PIN" below.

## PIN: how it actually works

- The PIN itself is **never stored in any file, ever** — not in `Code.gs`,
  not anywhere in git. It lives in two places only:
  1. **Apps Script Script Properties** (`APP_PIN`), set by hand via the
     Apps Script editor (Project Settings → Script properties).
  2. **Each device's own `localStorage`** (`pct_pin`), set the first time
     that device enters it successfully on the first-run screen.
- **The first-run screen asks for the PIN only** — the server URL is
  already resolved (see "The API URL" below) before this screen ever
  renders. `app.js`'s `attemptFirstRun(pin)` calls `store.setPin(pin)`
  then one `store.call("auth.check", {})`. Accepted → into the app, PIN
  stays stored. Rejected for a wrong PIN → `store.clearPin()` and the form
  reappears. Rejected for a network failure → the PIN is **not** cleared
  (it's very likely fine — the URL is the more probable culprit, and
  that's fixed in Settings → Advanced, not by retyping a correct PIN).
- **Every subsequent app load**: `boot()` tries `auth.check` once,
  silently, using whatever PIN's already in localStorage. Success →
  straight to Home. Rejected (`kind: "auth"`) → PIN cleared, first-run
  screen shown again. Any other failure (network/server) → **trusts the
  stored PIN and lets you in anyway**, so you can read cached data offline
  without the app locking you out just because there's no signal.
- **Signing out**: **More → Settings → Sign out** clears *only* the PIN.
  It's deliberately independent from the server URL override (see below) —
  "who's using this device" vs. "which backend this device talks to" are
  different concerns now, unlike v1's combined "Sign out / change PIN or
  URL" button.
- **Changing the PIN**: edit `APP_PIN` in Apps Script's Script properties
  (a Script Properties change doesn't need a new deployment version — only
  `Code.gs` edits do), then sign out and re-enter it on each device.
- **Lockout**: 5 wrong attempts within 10 minutes → 15-minute lockout,
  tracked server-side via `CacheService` (not per-device, since there's one
  shared PIN) — see `isLockedOut`/`recordFailedAttempt` in `Code.gs`.
- **Mock mode**: `boot()`/`renderRoute()` auto-provision a dummy PIN
  (`ensureMockCredentials()`) and never show the first-run screen at all —
  not even after signing out while in mock mode, which self-heals straight
  back into the app instead of getting stuck on a form mock mode doesn't
  need filled in.

## The API URL

Resolved, not entered, for almost every device — see `js/defaults.js` and
`js/api.js`'s `getApiUrl()`:

- **`js/defaults.js`** exports `DEFAULT_API_URL` and is **committed**,
  unlike the PIN — it isn't actually a secret once deployed (anyone using
  the live site can already see it in their browser's network tab), and
  committing it is what lets the first-run screen ask for only a PIN.
  Ships with an obviously-not-a-URL placeholder
  (`"REPLACE_WITH_YOUR_DEPLOYED_APPS_SCRIPT_URL"`) that must never be
  guessed or invented — someone with repo access edits it to their real
  deployed URL and commits that themselves.
- **Per-device override**: `localStorage` (`pct_api_url_override`), set
  via **Settings → Advanced**, independent of the PIN and independent of
  signing out. Takes priority over the default when present; "Reset to
  built-in URL" clears it. This exists for the gap between "the backend
  got redeployed as a new deployment" (changes the URL) and "someone
  updates and commits the new `js/defaults.js`" — or just for testing a
  different backend without touching the committed default at all.
- **`getApiUrl()`** = the override if one is set, else `DEFAULT_API_URL`.
  **`hasApiUrl()`** = `isValidApiUrl(getApiUrl())` — true only once that
  resolves to something that actually looks like `https://...`. False
  (showing a "not set up yet" screen, `renderConfigMissing()`) only when
  `defaults.js` is still its placeholder *and* no override is set either.
- `isValidApiUrl()` requires `https://` specifically — both because Apps
  Script URLs always are, and so a plaintext PIN never goes out over an
  insecure connection by accident.
- A real bug surfaced while building this: the Advanced override `<input>`
  was `type="url"`, so the *browser's own* native constraint validation
  silently blocked submitting anything that didn't look URL-shaped (e.g.
  `"not-a-url"`) before the custom JS https-only check ever ran — no error
  shown, nothing visibly happened. Fixed by switching to
  `type="text" inputmode="url"` (keeps the mobile keyboard hint, loses the
  native validation that was masking the real one). Worth remembering for
  any future `type="url"`/`type="email"` input paired with custom JS
  validation — the native check runs first and can eat the submit event
  entirely for inputs that don't even reach your own code.

## Testing approach used during development

As of v3 phase 1, there's a small **committed** automated test suite —
plain Node scripts, no framework, no `package.json`/dependencies:

- **`node test/backend.test.js`** — a Node harness that fakes just enough
  of the Apps Script runtime (`SpreadsheetApp`, `PropertiesService`,
  `DriveApp`, `Utilities`, a real in-memory `CacheService` — real SHA-256
  via Node's `crypto` for the PIN compare) to `eval()` the real
  `backend/Code.gs` and run assertions against it: CRUD round-trips,
  validation rejections, the `medicines.logTaken` upsert path (both the
  old boolean shape and the v3 `status`/`note`/`taken_at` shape), Packs
  CRUD + `tickAll`, `medicines.stop`, Bookings' full lifecycle including
  every `bookings.close` validation branch, Suggestions, Bills,
  `files.update`/the Records needs-sorting filter, every Phase 2 entity
  (Checkins/Symptoms/Water/FoodPrefs), the Phase 4 medicine detail fields
  and every reminder helper, the 8MB file-size limit, `dashboard.get`
  integration, `data_version` bumping on every write path, schema
  migration safety (`ensureTabs()` on a simulated pre-v3 sheet), and
  `bootstrap`'s shape. 223 assertions. Run it after any `Code.gs` change —
  it won't catch everything (it's a fake Apps Script runtime, not the real
  one), but it catches off-by-one row/column bugs and validation gaps
  before you touch Script Properties for real.
- **`node test/schedule.test.mjs`** — standalone unit tests for
  `js/schedule.js` (the medicine-scheduling engine): every `schedule_type`,
  `nextDose`'s fixed vs. from_last anchor modes, course/stock math,
  weekly/monthly due-state (including Feb/Apr month-end clamping), PRN
  gap+cap, a rolled-back device clock, zero/missing fields, pack
  tick-all/untick. 60 assertions.
- **`js/countdown.js`**: unit-tested standalone in Node too (it's
  dependency-free by design) — parseLocalDateOnly, gestational age at
  several week boundaries, overdue vs. upcoming, formatDuration, msUntil,
  isTimePastToday, the custom-countdown kinds. Not yet moved into `test/`
  (still scratch-only) — doing that is good future cleanup, not required.
- **Frontend**: headless Playwright (Chromium) driving a local
  `python3 -m http.server`, exercising real user flows in mock mode (no
  credentials needed) — first-run/sign-out, every CRUD form and bottom
  sheet, chip switching in the Add Medicine sheet, chart rendering, file
  upload with size-limit rejection, offline mode after a real
  service-worker registration, timers correctly stopping when navigating
  away from Home, and a full regression pass loading every route.
  Separately, a small local HTTP server stood in for Apps Script to verify
  the real (non-mock) `fetch()` path end-to-end. This part is still
  scratch tooling (not committed) — if you want a repeatable Playwright
  suite, that'd be new work.
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
- **No dedicated Contacts screen** — Contacts live in Settings (feeding the
  Emergency card). Food now has its own dedicated screen (`#/food`, v3
  Phase 2), so that part of this old trade-off no longer applies.
- **Records vault "grid" view doesn't show real thumbnails yet** — shows a
  type icon, not the actual image. Real per-file thumbnails (client-side
  generated, uploaded alongside the original, `Files.thumb_file_id`) were
  never built; the column exists but nothing writes to it.
- **No offline write queue** — writes (medicines, bookings, etc.) just fail
  with an error message if offline; they don't queue and retry on
  reconnect. The schema is already ready for it (creates accept an
  optional client-supplied `id` in both the mock and real `createRow`, so
  a retried/de-duped write won't be a problem once the queue exists), but
  the actual queue/backoff/de-dupe logic doesn't exist. What v3 *does* have
  instead, everywhere a delete/stop/add happens, is the optimistic-local-
  update-then-6-second-undo-toast pattern — that makes the UI feel instant
  and reversible, but it is not the same thing as working fully offline:
  the real network call still has to succeed once the toast expires.
- **No `syncFolder`** — scanning Drive for files dropped in by hand and
  adding `Files` rows for them was never built.
- **Timeline/Reimbursement aren't paginated** — both are bounded by their
  own default date range (Timeline: last 30 days; Reimbursement: the
  current month) rather than true pagination, which keeps a typical
  month's data fetch small without needing more UI chrome. A Sheet with
  years of history would make the *unfiltered* lazy-loaded lists (e.g.
  `medicinelog.list` with no `medicine_id`, `files.list` with no filters)
  slower to fetch — nothing was added to bound those specifically, since
  every current caller of them already filters.
- **The Telegram reminder's due-today logic (`getTodaysDueMedicinesV3`) is
  a leaner reimplementation of `js/schedule.js`, not a full port** — fine
  for a once-a-day text summary (no late/missed grading, no grace
  windows, fixed-grid interval medicines are skipped), but the two will
  occasionally disagree with each other at the edges. The interactive
  app's own due-status display (`js/schedule.js`) is always the source of
  truth; the reminder is a convenience nudge.
- **A "Book this" suggestion action doesn't prefill the booking type** —
  tapping it from a scan/blood_test suggestion opens a blank booking-create
  sheet rather than one pre-set to that type. Minor; she just picks the
  type herself in the two-second form that follows.
- **Health log reference thresholds are deliberately generic** (BP ≥140/90,
  sugar ≥95 fasting / ≥140 post-meal) — framed as "worth mentioning at the
  next visit," never a diagnosis. These are the kind of numbers that
  legitimately vary by guideline/doctor.
- **Frontend Playwright tests still aren't committed** — `test/
  backend.test.js` and `test/schedule.test.mjs` are; the Playwright flows
  used to verify every phase (see each phase's commit message/build-history
  row above) remain scratch-only. Turning them into a committed suite would
  be new work, not a gap introduced by any of this.
