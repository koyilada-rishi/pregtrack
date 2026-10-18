# Pregnancy Care Tracker

A private, mobile-first PWA for tracking my wife's pregnancy care. Static
frontend on GitHub Pages, Google Apps Script as the API, Google Sheets +
Drive as the database. No other backend, no paid services. 2-5 users.

> **Mid-migration to v2.** The app was fully built once already (v1: all 11
> steps, see `git log`), then revised with a bigger work order — no
> `config.js` at all (first-run screen instead), `data_version`-based
> freshness polling, an offline write queue, thumbnails, a batch
> `bootstrap` endpoint, and a live local countdown. We're rebuilding in
> place per the new step list below rather than starting over, so some
> sections of this README (and the app itself) still describe the v1
> behavior until their step lands. `DEVELOPMENT.md` has the full history of
> both versions.

## Status (v2 work order)

- [x] Step 1 — scaffold, mock-mode flag groundwork (`js/store.js`, `js/countdown.js`)
- [x] Step 2 — backend: setup, auth, settings, version, dashboard, bootstrap
- [x] Step 3 — frontend shell, first-run screen, router, Home with live countdown, Emergency card
- [x] Step 4 — content JSON + guide
- [ ] Step 5 — medicines + appointments
- [ ] Step 6 — health log + charts
- [ ] Step 7 — records vault: upload, thumbnails, viewer, syncFolder
- [ ] Step 8 — checklists + settings
- [ ] Step 9 — PWA, offline cache + write queue, icons
- [ ] Step 10 — Telegram reminders
- [ ] Step 11 — final README

Steps 5, 6, 8 (partially), 9 (PWA shell/icons), and 10 are already
functionally built from v1 and mostly need re-verifying against the v2 data
layer rather than rebuilding from scratch — marked done as each is actually
revisited in order.

## Repo layout (target)

```
/index.html
/css/style.css
/js/app.js               router + views
/js/api.js                raw network calls (POST, PIN/URL storage)
/js/store.js               data layer: mock mode, caching, version polling,
                           offline write queue (grows through steps 1/2/3/9)
/js/countdown.js            live local countdown math (step 3)
/js/i18n.js                string table (English now, Telugu-ready)
/data/weeks.json  food.json  warnings.json
/manifest.json  /sw.js  /icons/
/backend/Code.gs  /backend/appsscript.json
```

No `config.js` / `config.example.js` / `js/mock.js` in v2 — the first-run
screen collects the API URL and PIN together and stores both in
`localStorage` (see "Local setup" below), and mock-mode fixtures live
inside `js/store.js` itself, toggled with a URL flag instead of a file.

Working on the code itself (new views, new backend actions, understanding
how the pieces fit together)? See **[DEVELOPMENT.md](DEVELOPMENT.md)** —
architecture, a file-by-file reference, the full build history, and how the
PIN/API-URL/offline-cache machinery actually works. This README stays
focused on deploying and running the app.

## Local setup

No config file to copy — just serve the folder with any static file server:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`. **Mock mode is on by default**: the app
runs entirely on sample data from `js/store.js`, no Apps Script deployment
needed, no first-run screen — it goes straight to Home. This is how the
app works right after a fresh clone, with zero setup.

**To develop against your real deployed backend instead**, visit
`http://localhost:8000?mock=0` once — this disables mock mode (remembered
in `localStorage` after that) and shows the real first-run screen asking
for your Apps Script URL and PIN. Switch back to mock mode any time with
`?mock=1`.

**Stop the dev server** with `Ctrl+C` in that terminal (or
`pkill -f "http.server 8000"`).

## Signing in (first-run screen)

The first time the app loads on a device (outside mock mode), it asks for
two things together: the Apps Script web app URL (see "Apps Script deploy"
below) and the PIN. Both are validated with one `auth.check` call and saved
to that device's `localStorage` — never in a file, never committed. Every
later visit skips straight past this screen.

To sign out of a device (e.g. to switch URL or PIN, or hand the phone back
after testing), use **More → Settings → "Sign out / change PIN or URL"** —
this clears both values and shows the first-run screen again.

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
     and Drive folder URL. Open the Sheet and confirm it has 9 tabs with
     headers: Settings, Medicines, MedicineLog, Appointments, HealthLog,
     Contacts, FoodLog, Checklist, Files.
   - `setup()` is safe to re-run — it reuses the Sheet and folders already
     recorded in Script Properties instead of making duplicates.

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

9. **Try it in the browser.** Open the app locally with `?mock=0` (see
   "Local setup" above) and enter the URL from step 6 plus your PIN on the
   first-run screen — same validation as the curl test, just through the UI.

## Telegram reminders (optional)

Once this is set up, the app sends a daily morning message (gestational
week/days-to-go, any appointment in the next 24 hours, and today's medicine
list) to a Telegram chat, via an Apps Script time-driven trigger. Nothing in
the frontend depends on this — skip it if you don't want reminders.

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
   below). Create a repo (e.g. `preg`), then from this folder:

   ```sh
   git remote add origin https://github.com/<you>/preg.git
   git push -u origin main
   ```

2. **Enable Pages.** In the GitHub repo: **Settings → Pages**. Under
   "Build and deployment", set **Source: Deploy from a branch**, **Branch:
   main**, folder **/ (root)**. Save.

3. **Wait a minute, then open the site.** GitHub shows the URL at the top
   of that same Pages settings page once it's live — typically
   `https://<you>.github.io/preg/`.

4. **First visit, per device.** The very first time the app loads on a
   given phone/browser, it shows the one-time first-run screen asking for
   the Apps Script web app URL (from "Apps Script deploy" step 6 above) and
   the PIN together. After that it skips straight to Home on every future
   visit. Do this once on each phone.

   If the Apps Script deployment is ever redeployed and gets a new URL, or
   the PIN changes, use **More → Settings → "Sign out / change PIN or
   URL"** to clear both and re-enter them.

### Why the repo can be public

The non-negotiable rule is that no real data, Sheet ID, Drive ID, PIN, or
API URL is ever **committed** — and nothing in this repo's tracked files is.
There's no config file in the whole v2 architecture that could even hold a
real API URL; the live site gets it from each device's own `localStorage`
instead (step 4 above), entered once through the first-run screen, never
from a file GitHub Pages serves. The PIN never appears in any file,
committed or not — it only ever lives in Script Properties on the backend
and in the browser's `localStorage` on each device. The actual medical data
lives in your Google Sheet and Drive folder, neither of which this repo
touches.

The API URL itself isn't a secret once the app is running, anyway — anyone
using the live site can see it in their browser's network tab, the same as
any client-side API endpoint. The PIN (never shipped in any file) is the
real gate, which is why it's constant-time-compared with a lockout, and why
you should pick one that isn't easily guessed.

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

**First-run screen keeps reappearing after you enter the URL.** The URL
must start with `https://` (Apps Script URLs always do). Check for typos or
a stray trailing space. If it still fails after a valid-looking URL is
accepted, the problem is likely the next item below.

**Stuck on the first-run screen / "Incorrect PIN" even though it's right.**
- Confirm `APP_PIN` is actually set in the Apps Script project's Script
  properties (Project Settings → Script properties) — without it, every PIN
  is rejected with a different-sounding error ("APP_PIN is not set...").
- Check you're on the latest deployment: editing `Code.gs` doesn't update
  the live URL until you do **Deploy → Manage deployments → (pencil) → New
  version → Deploy**.
- 5 wrong attempts locks you out for 15 minutes (by design) — wait it out.
- If you signed out (Settings → "Sign out / change PIN or URL") and the
  server URL changed since, re-enter both fresh rather than assuming only
  the PIN needs updating.

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

- No real data, Sheet ID, Drive IDs, PIN, or API URL is ever committed —
  there's no config file at all in v2 to accidentally commit. Both the API
  URL and the PIN live only in each device's own `localStorage`, entered
  once via the first-run screen.
- The PIN lives server-side only in Apps Script Script Properties
  (`APP_PIN`), compared constant-time, with lockout after repeated
  failures (5 wrong attempts / 10 minutes → 15-minute lockout).
- Never paste the real API URL or PIN into a chat, commit, or shared
  document — treat them like any other credential. If one is ever
  accidentally exposed, rotate the PIN (edit `APP_PIN` in Script
  properties, push a new deployment version) and re-enter it on both
  phones via "Sign out / change PIN or URL" in Settings.
- Drive files are never made public; the backend serves them through the
  API.
- This app does not replace medical advice from a doctor.
