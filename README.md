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
- [ ] Step 3 — frontend shell, first-run screen, router, Home with live countdown, Emergency card
- [ ] Step 4 — content JSON + guide
- [ ] Step 5 — medicines + appointments
- [ ] Step 6 — health log + charts
- [ ] Step 7 — records vault: upload, thumbnails, viewer, syncFolder
- [ ] Step 8 — checklists + settings
- [ ] Step 9 — PWA, offline cache + write queue, icons
- [ ] Step 10 — Telegram reminders
- [ ] Step 11 — final README

Steps 4, 8 (partially), 9 (PWA shell/icons), and 10 are already functionally
done from v1 and mostly need re-verifying against the v2 data layer rather
than rebuilding from scratch — marked as their step is actually revisited.

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

No `config.js` / `config.example.js` in v2 — the first-run screen (step 3)
collects the API URL and PIN together and stores both in `localStorage`.
`js/mock.js` and the old config files are still present and in active use
by the current (v1) `app.js`/`api.js` until step 3's cutover removes them;
see the note at the top of `js/mock.js`.

Working on the code itself (new views, new backend actions, understanding
how the pieces fit together)? See **[DEVELOPMENT.md](DEVELOPMENT.md)** —
architecture, a file-by-file reference, the full build history, and how the
PIN/API-URL/offline-cache machinery actually works. This README stays
focused on deploying and running the app.

## Local setup

```sh
cp js/config.example.js js/config.js
# edit js/config.js — leave MOCK: true to develop without a real backend
```

Serve the folder with any static file server, e.g.:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

With `MOCK: true`, `js/api.js` serves fixtures from `js/mock.js` instead of
calling the real backend — any PIN unlocks it, and the dashboard shows
sample data. This is how the app works right after cloning, with no Apps
Script deployment needed. Flip `MOCK` to `false` and set `API_URL` once
you've deployed the backend (see "Apps Script deploy" below) and want to
test against your real Sheet/Drive data.

If `js/config.js` doesn't exist at all (fresh clone, before the `cp`
above), the app shows a plain "not set up yet" screen instead of a blank
page or console error.

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

8. **Test it from a terminal**, replacing `<API_URL>` and `<pin>`:

   ```sh
   curl -i -X POST "<API_URL>" \
     -H "Content-Type: text/plain" \
     --data '{"pin":"<pin>","action":"auth.check"}'
   ```

   Expect `{"ok":true,"data":{"authenticated":true}}`. Then try:

   ```sh
   curl -s -X POST "<API_URL>" \
     -H "Content-Type: text/plain" \
     --data '{"pin":"<pin>","action":"dashboard.get"}'
   ```

   You should get back a JSON object with `due_date`, `gestational_age`,
   `next_appointment`, `today_medicines`, and `latest_vitals` (all empty/null
   until you fill in Settings, Medicines, and Appointments — that comes with
   step 3+). Try a wrong PIN too — you should get
   `{"ok":false,"error":"Incorrect PIN."}`, and seeing that 5 times in a row
   should lock you out for 15 minutes.

   Two more worth trying (v2 additions):

   ```sh
   curl -s -X POST "<API_URL>" -H "Content-Type: text/plain" \
     --data '{"pin":"<pin>","action":"version.get"}'
   # {"ok":true,"data":{"data_version":1}} — the counter setup() seeded at 0,
   # already bumped once if you've made any change since.

   curl -s -X POST "<API_URL>" -H "Content-Type: text/plain" \
     --data '{"pin":"<pin>","action":"bootstrap"}'
   # One response with data_version, settings, dashboard, and every entity
   # list (medicines, appointments, healthlog, contacts, foodlog, checklist,
   # files) in one call.
   ```

   Then try any write (e.g. `settings.set` with a small payload) and call
   `version.get` again — the number should have gone up by exactly 1.

9. **Wire up the frontend.** For local dev, copy `js/config.example.js` to
   `js/config.js` (gitignored), set `API_URL` to the URL from step 6, and
   set `MOCK: false` — this skips the one-time URL prompt described in
   "GitHub Pages setup" below. The deployed app on GitHub Pages never has
   this file; it asks for the URL once per device instead, since the URL
   can't be committed to a file GitHub Pages would serve.

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
   given phone/browser, it shows a one-time **"Set up this device"** screen
   asking for the Apps Script web app URL (from "Apps Script deploy" step 6
   above). After that it goes straight to the normal PIN lock screen on
   every future visit. Do this once on your phone and once on your wife's.

   If the Apps Script deployment is ever redeployed and gets a new URL, use
   **More → Settings → Change server URL** to update it without needing to
   re-enter anything else.

### Why the repo can be public

The non-negotiable rule is that no real data, Sheet ID, Drive ID, PIN, or
API URL is ever **committed** — and nothing in this repo's tracked files is.
`js/config.js` (the only file that could hold a real API URL) is gitignored
and was never committed; the live site gets its API URL from each device's
own `localStorage` instead (step 4 above), never from a file GitHub Pages
serves. The PIN never appears in any file, committed or not — it only ever
lives in Script Properties on the backend and in the browser's `localStorage`
on each device. The actual medical data lives in your Google Sheet and
Drive folder, neither of which this repo touches.

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

**"App isn't set up yet" on load.** `js/config.js` is missing. Run
`cp js/config.example.js js/config.js` (local dev only — the live site
doesn't need this file at all; see "GitHub Pages setup").

**"Set up this device" keeps reappearing after you enter the URL.** The URL
must start with `https://` (Apps Script URLs always do). Check for typos or
a stray trailing space. If it still fails after a valid-looking URL is
accepted, the problem is likely the next item below.

**Stuck on the PIN screen / "Incorrect PIN" even though it's right.**
- Confirm `APP_PIN` is actually set in the Apps Script project's Script
  properties (Project Settings → Script properties) — without it, every PIN
  is rejected with a different-sounding error ("APP_PIN is not set...").
- Check you're on the latest deployment: editing `Code.gs` doesn't update
  the live URL until you do **Deploy → Manage deployments → (pencil) → New
  version → Deploy**.
- 5 wrong attempts locks you out for 15 minutes (by design) — wait it out.

**"Could not reach the server" / everything stuck loading.**
- Open the deployed web app URL directly in a browser tab. A correctly
  deployed Apps Script web app returns
  `{"ok":false,"error":"This API only accepts POST requests."}` on a plain
  GET — if you see a Google sign-in page or a 404 instead, the deployment
  itself is broken (re-check "Execute as: Me" / "Who has access: Anyone" in
  the deployment settings).
- Check you're online — the offline banner should appear automatically,
  and the app falls back to the last-saved data per view.

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

- No real data, Sheet ID, Drive IDs, PIN, or API URL is ever committed.
  `js/config.js` is gitignored; only `js/config.example.js` is tracked.
- The PIN lives only in Apps Script Script Properties (`APP_PIN`), compared
  constant-time, with lockout after repeated failures.
- Drive files are never made public; the backend serves them through the
  API.
- This app does not replace medical advice from a doctor.
