# Pregnancy Care Tracker

A private, mobile-first PWA for tracking my wife's pregnancy care. Static
frontend on GitHub Pages, Google Apps Script as the API, Google Sheets +
Drive as the database. No other backend, no paid services. 2-5 users.

> **v1, v2 and v3 are all complete.** v3 ("friendly Home, real medicine
> scheduling, daily check-in, bookings and reimbursement, timeline") was
> built in 4 phases, in place on top of v2 rather than starting over.
> `DEVELOPMENT.md`'s "Build history" table has the full history of all
> three. **Nothing in this repo has been deployed to the real backend by
> this assistant or pushed to GitHub as part of v3 yet — see "Deploying
> this update" below for exactly what to do before testing on your phone.**

## Status (v3 work order)

- [x] Phase 1 — Home redesign, simple medicine entry, schedule engine, packs, history
- [x] Phase 2 — daily check-in, symptoms, water, food, timeline
- [x] Phase 3 — bookings, doctor visits, records, bills, reimbursement
- [x] Phase 4 — medicine photos and details, expiry, polish

## Deploying this update

All four v3 phases changed `backend/Code.gs` (new tabs, new columns, new
actions — see `DEVELOPMENT.md`'s build-history table for the full list).
To get this onto your real backend:

1. Open your Apps Script project's `Code.gs` in the editor.
2. Select all the existing content and delete it.
3. Copy the entire contents of `backend/Code.gs` from this repo and paste
   it in.
4. Save.
5. **Deploy → Manage deployments → pencil icon → New version → Deploy.**
   Never "New deployment" — that would change your `/exec` URL and break
   `js/defaults.js`.

Nothing in Script Properties needs to change. The migration is automatic:
the next `bootstrap` call adds every new tab/column to your real Sheet
without touching anything already there. If you use the Telegram daily
reminder, no extra setup is needed for its new lines (bookings, water,
expiry) — they just start appearing once there's matching data.

These commits are local only until you've tested — nothing has been
pushed to GitHub or deployed by the assistant.

## Repo layout (target)

```
/index.html
/css/style.css
/js/app.js               router + views
/js/api.js                raw network calls (POST), PIN storage, URL resolution
/js/defaults.js            DEFAULT_API_URL — committed, edit after deploying
/js/store.js               data layer: mock mode, caching, version polling,
                           offline write queue (grows through steps 1/2/3/9)
/js/countdown.js            live local countdown math (step 3)
/js/schedule.js             medicine-scheduling math (v3 — slots, next
                           dose, course/stock, due dates, PRN gating)
/js/i18n.js                string table (English now, Telugu-ready)
/data/weeks.json  food.json  warnings.json
/manifest.json  /sw.js  /icons/
/backend/Code.gs  /backend/appsscript.json
/test/backend.test.js  /test/schedule.test.mjs   committed unit tests —
                           run with `node test/backend.test.js` and
                           `node test/schedule.test.mjs`
```

No `config.js` / `config.example.js` / `js/mock.js` in v2. The API URL
lives in the committed `js/defaults.js` (edit it once after deploying the
backend — see "Apps Script deploy" below); the first-run screen asks for
the PIN only and stores it in `localStorage` (see "Signing in" below).
Mock-mode fixtures live inside `js/store.js` itself, toggled with a URL
flag instead of a file.

Working on the code itself (new views, new backend actions, understanding
how the pieces fit together)? See **[DEVELOPMENT.md](DEVELOPMENT.md)** —
architecture, a file-by-file reference, the full build history, and how the
PIN/API-URL/offline-cache machinery actually works. This README stays
focused on deploying and running the app.

## Local setup

No per-device config file to copy — just serve the folder with any static
file server:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`. **Mock mode is on by default on
localhost** (and `file://`): the app runs entirely on sample data from
`js/store.js`, no Apps Script deployment needed, no first-run screen — it
goes straight to Home. This is how the app works right after a fresh
clone, with zero setup. On any other host — including the real deployed
site — it defaults the other way: real mode, PIN-only first-run screen,
never silently sample data.

**To develop against your real deployed backend instead**, visit
`http://localhost:8000?mock=0` once — this disables mock mode (remembered
in `localStorage` after that) and shows the real first-run screen asking
for your PIN. The server URL comes from `js/defaults.js` (see "Apps Script
deploy" below) — edit that file if you're testing against a backend other
than the one already configured there. Switch back to mock mode any time
with `?mock=1`.

**Stop the dev server** with `Ctrl+C` in that terminal (or
`pkill -f "http.server 8000"`).

## Signing in (first-run screen)

The first time the app loads on a device (outside mock mode), it asks for
**just the PIN** — the server URL is already resolved from `js/defaults.js`
(see "Apps Script deploy" step 9), no per-device entry needed. The PIN is
validated with one `auth.check` call and saved to that device's
`localStorage` — never in a file, never committed. Every later visit skips
straight past this screen; the PIN stays remembered until you sign out or
the backend rejects it (e.g. after you change `APP_PIN`).

To sign out of a device (e.g. to hand the phone back after testing, or
before re-entering a changed PIN), use **More → Settings → Sign out** —
this clears only the PIN. It does not touch any server URL override (see
"Changing the server URL later" below) — those are deliberately
independent, since one is "who's using this device" and the other is
"which backend this device talks to."

## Apps Script deploy

These steps take you from an empty Apps Script project to a working,
PIN-protected API URL. Do this once; repeat only "Push a new version" below
whenever you change `backend/Code.gs`.

1. **Create the project.** Go to [script.google.com](https://script.google.com/),
   click **New project**, and rename it (top left) to "Pregnancy Care Tracker".

2. **Paste in the code.** Delete the default contents of `Code.gs` in the
   editor and paste in the full contents of this repo's `backend/Code.gs`.

3. **Paste in the manifest.** Click the gear icon (Project Settings) on the
   left, check **"Show `appsscript.json` manifest file in editor"**. Go back
   to the editor, open `appsscript.json`, and replace its contents with this
   repo's `backend/appsscript.json`.

4. **Run `setup()` once.** In the function dropdown at the top of the editor
   (next to Run/Debug), select `setup`, then click **Run**.
   - The first run asks you to authorize the script (it needs access to
     Google Sheets and Drive — your own data, under your own account). You'll
     see an "unverified app" warning because this is a personal script, not
     a published one; click **Advanced > Go to Pregnancy Care Tracker
     (unsafe)** and allow it.
   - Open **View > Logs** (or press `Ctrl+Enter`) to see the new Sheet's URL
     and Drive folder URL. Open the Sheet and confirm it has 10 tabs with
     headers: Settings, Medicines, MedicineLog, Appointments, HealthLog,
     Contacts, FoodLog, Checklist, Files, Countdowns.
   - `setup()` is safe to re-run — it reuses the Sheet and folders already
     recorded in Script Properties instead of making duplicates. Its tab/
     column creation is handled by `ensureTabs()`, which also runs on every
     `bootstrap` call — so after you paste in a `Code.gs` update that adds a
     column or tab and redeploy a **new version**, just loading the app
     once upgrades the Sheet automatically. No need to re-run `setup()` by
     hand for a schema-only change (only for the very first run, to create
     the Sheet and Drive folders at all).

5. **Set the PIN.** Still in Project Settings, scroll to **Script
   properties**, click **Add script property**, and add:
   - Property: `APP_PIN`
   - Value: a PIN only you and your wife know (6+ characters recommended —
     it's the only thing standing between the internet and this data; see
     Security notes below).

   Click **Save script properties**. The PIN is never written into the code
   or committed anywhere.

6. **Deploy as a web app.** Click **Deploy > New deployment**. Click the
   gear next to "Select type" and choose **Web app**. Fill in:
   - Description: `v1`
   - Execute as: **Me** (your Google account)
   - Who has access: **Anyone**

   Click **Deploy**, authorize again if asked, then copy the **Web app
   URL** — it looks like `https://script.google.com/macros/s/AKfycb.../exec`.
   This is your `API_URL`.

   "Who has access: Anyone" is unavoidable for a browser-based frontend
   calling this API — it's why every action requires the PIN and why the
   lockout logic exists. Don't skip setting a real `APP_PIN`.

7. **Push a new version (later edits).** Editing `Code.gs` in the browser
   editor does *not* update the live URL. After any change, go to
   **Deploy > Manage deployments**, click the pencil icon on the existing
   deployment, change **Version** to **New version**, and click **Deploy**.
   The URL stays the same.

8. **Test it from a terminal.** Export the URL and your PIN in your own
   shell first — never paste them into a chat, a file, or a command for
   someone else to run:

   ```sh
   export API_URL="https://script.google.com/macros/s/AKfycb.../exec"
   export API_PIN="your-pin"
   ```

   Then, **important**: use `-L` (follow redirects) and do **not** pass
   `-X POST` — Apps Script's web app URL redirects once to
   `script.googleusercontent.com`, and curl only carries the POST body
   through that redirect correctly when the method is implied by `-d`
   rather than forced with `-X`:

   ```sh
   curl -L -H "Content-Type: text/plain" \
     -d "{\"pin\":\"$API_PIN\",\"action\":\"auth.check\"}" \
     "$API_URL"
   ```

   Expect `{"ok":true,"data":{"authenticated":true}}`. Then try:

   ```sh
   curl -L -H "Content-Type: text/plain" \
     -d "{\"pin\":\"$API_PIN\",\"action\":\"dashboard.get\"}" \
     "$API_URL"
   ```

   You should get back a JSON object with `due_date`, `gestational_age`,
   `next_appointment`, `today_medicines`, and `latest_vitals` (all empty/null
   until you fill in Settings, Medicines, and Appointments). Try a wrong PIN
   too — you should get `{"ok":false,"error":"Incorrect PIN."}`, and seeing
   that 5 times in a row should lock you out for 15 minutes.

   Two more worth trying (v2 additions):

   ```sh
   curl -L -H "Content-Type: text/plain" \
     -d "{\"pin\":\"$API_PIN\",\"action\":\"version.get\"}" "$API_URL"
   # {"ok":true,"data":{"data_version":1}} — the counter setup() seeded at 0,
   # already bumped once if you've made any change since.

   curl -L -H "Content-Type: text/plain" \
     -d "{\"pin\":\"$API_PIN\",\"action\":\"bootstrap\"}" "$API_URL"
   # One response with data_version, settings, dashboard, and every entity
   # list (medicines, appointments, healthlog, contacts, foodlog, checklist,
   # files) in one call.
   ```

   Then try any write (e.g. `settings.set` with a small payload) and call
   `version.get` again — the number should have gone up by exactly 1.

   The frontend's own `fetch()` call (`js/api.js`) follows the same rules:
   only a `Content-Type: text/plain` header (anything else triggers a CORS
   preflight Apps Script can't answer) and the browser's default redirect
   handling, untouched.

9. **Wire up the frontend.** Edit `js/defaults.js` — replace
   `DEFAULT_API_URL`'s placeholder with the URL from step 6 — and commit
   that file yourself:

   ```sh
   git add js/defaults.js
   git commit -m "Set deployed Apps Script URL"
   ```

   This is the one file in the whole project where committing a real value
   is intentional (see "Security notes" below for why that's fine). Never
   commit the PIN, a Sheet ID, or a Drive folder ID anywhere, ever.

10. **Try it in the browser.** Open the app locally with `?mock=0` (see
    "Local setup" above) and enter just your PIN on the first-run screen —
    the URL is already resolved from `js/defaults.js`.

### Changing the server URL later

If the Apps Script backend ever gets redeployed as a genuinely **new
deployment** (not just a new version of the existing one — see step 7
above), its URL changes. Two ways to point the app at the new URL:

- **Permanently, for everyone**: edit `js/defaults.js` again and commit +
  push. Every device picks it up automatically (once they load the new
  version of the site) — no per-device action needed.
- **Per device, without redeploying the site**: **More → Settings →
  Advanced**, paste the new URL, save. This overrides `js/defaults.js` on
  that device only — handy for testing a new deployment before making it
  the default for everyone. "Reset to built-in URL" clears the override.

## Telegram reminders (optional)

Once this is set up, the app sends a daily morning message to a Telegram
chat, via an Apps Script time-driven trigger. Nothing in the frontend
depends on this — skip it if you don't want reminders. As of v3, the
message includes: gestational week/days-to-go, any appointment or booking
in the next 24 hours, today's bookings, outstanding report/prescription
follow-ups, today's due medicines (schedule-aware — daily/weekdays/
every-few-days/from-last-dose interval medicines), weekly/monthly shots
due within 2 days (including overdue), a water-behind-goal nudge, and
expiry alerts — finished/stopped medicines never appear.

1. **Create a bot.** In Telegram, message **[@BotFather](https://t.me/BotFather)**,
   send `/newbot`, and follow the prompts. BotFather replies with a token
   that looks like `123456789:AAH...`. That's your `TELEGRAM_BOT_TOKEN`.

2. **Get the chat ID.** Message your new bot anything (e.g. "hi") first —
   bots can't message you until you've messaged them. Then message
   **[@userinfobot](https://t.me/userinfobot)** (or any similar "get my
   Telegram ID" bot) to get your numeric chat ID. That's your
   `TELEGRAM_CHAT_ID`. (For a group chat instead, add the bot to the group
   and use the group's chat ID, which is negative.)

3. **Add both as script properties.** In the Apps Script editor: Project
   Settings → Script properties → add `TELEGRAM_BOT_TOKEN` and
   `TELEGRAM_CHAT_ID` with the values from above.

4. **Create the trigger.** In the function dropdown, select
   `createDailyReminderTrigger`, then click **Run**. This schedules
   `sendDailyReminder` to run once a day around 7:00 AM Asia/Kolkata. The
   first run will ask you to authorize a new permission (it now makes
   external requests, to Telegram) — allow it.

5. **Test it immediately.** Instead of waiting until tomorrow morning,
   select `sendDailyReminder` in the function dropdown and click **Run**
   once by hand. You should get a message in Telegram within a few seconds.
   If nothing arrives, check **View > Executions** in the Apps Script editor
   for the error (usually a wrong token, or the bot hasn't been messaged
   first).

To stop the reminders later, run `removeDailyReminderTriggers()` once from
the editor, or delete the trigger from the clock icon ("Triggers") in the
left sidebar.

## GitHub Pages setup

1. **Create the GitHub repo and push.** GitHub Pages on a free personal
   account only serves **public** repositories — and that's fine here: the
   app's own code has no secrets in it (see "Why the repo can be public"
   below). This repo: `https://github.com/koyilada-rishi/pregtrack`.

   ```sh
   git remote add origin https://github.com/koyilada-rishi/pregtrack.git
   git push -u origin main
   ```

2. **Enable Pages.** In the GitHub repo: **Settings → Pages**. Under
   "Build and deployment", set **Source: Deploy from a branch**, **Branch:
   main**, folder **/ (root)**. Save.

   A `.nojekyll` file sits at the repo root — without it, GitHub Pages runs
   everything through Jekyll by default, which ignores any file or folder
   starting with `_` and can mangle things in ways that have nothing to do
   with this being a plain static site. `.nojekyll` turns that off.

3. **Wait a minute, then open the site.** GitHub shows the URL at the top
   of that same Pages settings page once it's live:
   `https://koyilada-rishi.github.io/pregtrack/`.

   Because Pages serves from that `/pregtrack/` subpath rather than the
   domain root, every asset reference in this app (CSS/JS/icons/manifest,
   the service worker's own precache list, `fetch()` calls for the content
   JSON) uses a **relative** path (`./...`), never a leading `/`. Routing
   within the app is hash-based (`#/home`, `#/meds`, …) for the same
   reason — the actual URL path never changes, so there's nothing for the
   subpath to break.

4. **Mock mode is off by default on the real domain.** Visiting
   `koyilada-rishi.github.io` (or any non-localhost host) shows the real
   first-run screen, never sample data — mock mode only defaults on when
   running on `localhost`/`127.0.0.1` (local dev) or opened directly as a
   `file://` path. You can still force it with `?mock=1` on any host (and
   `?mock=0` to force real mode locally) — see `DEVELOPMENT.md`.

5. **First visit, per device.** The very first time the app loads on a
   given phone/browser, it shows the one-time first-run screen asking for
   **just the PIN** — the server URL is already resolved from the committed
   `js/defaults.js` (step 9 of "Apps Script deploy" above), no per-device
   URL entry needed. After a correct PIN it skips straight to Home on every
   future visit. Do this once on each phone.

   If the PIN changes (you edited `APP_PIN` in Script Properties), sign out
   on each device (**More → Settings → Sign out**) and re-enter the new
   one. If the server URL changes instead (a genuinely new deployment, not
   just a new version), see "Changing the server URL later" above.

### Why the repo can be public

The non-negotiable rule is that the **PIN**, a **Sheet ID**, or a **Drive
folder ID** are never committed — and none of those are anywhere in this
repo's tracked files, ever. The PIN only ever lives in Script Properties on
the backend and in each device's own `localStorage` (entered via the
first-run screen) — never in a file, committed or not. The actual medical
data lives in your Google Sheet and Drive folder, neither of which this
repo touches.

The **API URL is different**, and is committed on purpose, in
`js/defaults.js` — because it isn't actually a secret once the app is
running: anyone using the live site can already see it in their browser's
network tab, the same as any client-side API endpoint. Committing it is
what lets the first-run screen ask for only a PIN instead of both. The PIN
(never shipped in any file) is the real gate, which is why it's
constant-time-compared with a lockout, and why you should pick one that
isn't easily guessed.

If you'd rather keep the source itself private, that's a GitHub Pro/Team
feature (private-repo Pages) and is the one thing in this project that
isn't free — everything else here stays within "no paid services".

## Install to home screen

**iPhone (Safari):** open the site → Share button → "Add to Home Screen".
**Android (Chrome):** open the site → ⋮ menu → "Install app" (or "Add to Home screen").

Once installed, the app opens full-screen (no browser address bar), and the
service worker lets it open — showing the last-saved data — even with no
signal. New API calls (and anything not read before) still need a connection.

## Troubleshooting

**"This app isn't set up yet" instead of a PIN screen.** `js/defaults.js`
still has its placeholder `DEFAULT_API_URL` and no override is set either.
Edit that file (step 9 of "Apps Script deploy") or, if you're testing
before committing it, set a temporary override in **Settings → Advanced**
— except you can't reach Settings without signing in first, so for local
testing just edit `js/defaults.js` directly (it's fine to leave uncommitted
while testing, just don't forget to put the placeholder back — or just
commit the real value once you're sure, per "Security notes" above).

**Stuck on the PIN screen / "Incorrect PIN" even though it's right.**
- Confirm `APP_PIN` is actually set in the Apps Script project's Script
  properties (Project Settings → Script properties) — without it, every PIN
  is rejected with a different-sounding error ("APP_PIN is not set...").
- Check you're on the latest deployment: editing `Code.gs` doesn't update
  the live URL until you do **Deploy → Manage deployments → (pencil) → New
  version → Deploy**.
- 5 wrong attempts locks you out for 15 minutes (by design) — wait it out.
- If the backend was redeployed as a genuinely new deployment (a new URL,
  not just a new version) and `js/defaults.js` hasn't been updated yet, set
  a temporary override in **Settings → Advanced** rather than assuming the
  PIN itself is wrong.

**"Could not reach the server" / everything stuck loading.**
- Open the deployed web app URL directly in a browser tab. A correctly
  deployed Apps Script web app returns
  `{"ok":false,"error":"This API only accepts POST requests."}` on a plain
  GET — if you see a Google sign-in page or a 404 instead, the deployment
  itself is broken (re-check "Execute as: Me" / "Who has access: Anyone" in
  the deployment settings).
- Check you're online — the offline banner should appear automatically,
  and the app falls back to the last-saved data per view.
- Testing with `curl` yourself? Use `-L` and do **not** pass `-X POST` —
  see step 8 of "Apps Script deploy" for why; the wrong combination breaks
  the redirect Apps Script's web app URL issues.

**Dashboard/views show nothing, no errors.** Normal on a fresh setup — fill
in a due date in Settings, then add a medicine/appointment/health entry to
see the dashboard populate.

**Uploads fail with a size error.** The limit is 8 MB per file (Apps
Script's own request-size ceiling is the real constraint here). Compress
the photo or split a multi-page scan into smaller files.

**Telegram reminder never arrives.** See step 5 of "Telegram reminders"
above — check **View → Executions** in the Apps Script editor for the
actual error. The most common cause is not having messaged the bot first
(bots can't initiate a conversation).

**Changes to `Code.gs` don't seem to take effect.** Same as above — Apps
Script requires a new deployment version after every edit; saving the file
alone isn't enough.

**Install-to-home-screen option missing.** Some browsers only offer this
after the service worker has registered and the page has been visited at
least once over HTTPS. Reload once, wait a few seconds, then check again.

## Scope notes

Two small deviations from the original 10-view list, both logical fits for
existing views rather than new tabs:
- **Contacts** (doctor/emergency numbers) has no dedicated screen — it's
  managed in Settings and surfaced read-only on the Emergency card.
- **FoodLog** (meal/craving/aversion logging) has no dedicated screen either
  — it's a quick-add section at the bottom of the Food & body guide view,
  since that's its natural home.

## Content & medical disclaimer

`data/weeks.json`, `data/food.json`, and `data/warnings.json` hold the
baby-development, food, and warning-sign content shown in the dashboard and
the Food & body guide view (More > Food & body guide). This is general,
conservative information, not medical advice, and every view that uses it
says so.

Some entries are marked `"review": true` with a `review_note` — these are
places where mainstream guidance is broadly consistent but the exact
numbers or emphasis vary by source (e.g. the daily caffeine limit, weekly
fish servings, side-sleeping guidance, and the cholestasis itching warning).
The guide view shows a "confirm with doctor" note on these. It's worth
having her doctor glance at just those flagged items.

## Security notes

- **The PIN, any Sheet ID, and any Drive folder ID must never appear in
  this repo** — not committed, not in an issue, not in a commit message,
  not pasted into a chat or shared document. They live only in Apps
  Script's Script Properties (server-side) and, for the PIN, in each
  device's own `localStorage` after a successful first-run sign-in.
- **The API URL is the one exception, and that's intentional**: it's
  committed in `js/defaults.js`. It isn't a secret once the app is
  deployed — anyone using the live site can already see it in their
  browser's network tab — so there's nothing lost by committing it, and it
  means the first-run screen only has to ask for a PIN. Don't read "it's
  committed" as "it's safe to also commit the PIN" — those are different
  categories for different reasons.
- The PIN is compared constant-time, with lockout after repeated failures
  (5 wrong attempts / 10 minutes → 15-minute lockout).
- If the PIN is ever accidentally exposed (pasted somewhere it shouldn't
  have been, etc.), rotate it: edit `APP_PIN` in Script properties, push a
  new deployment **version**, then sign out and re-enter the new PIN on
  each device (**More → Settings → Sign out**).
- Drive files are never made public; the backend serves them through the
  API.
- This app does not replace medical advice from a doctor.
