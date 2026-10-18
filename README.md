# Pregnancy Care Tracker

A private, mobile-first PWA for tracking my wife's pregnancy care. Static
frontend on GitHub Pages, Google Apps Script as the API, Google Sheets +
Drive as the database. No other backend, no paid services, only two people
use it.

This README is a skeleton for now — each section below is filled in as the
matching build step lands. By the end it should let you go from a fresh
clone to a working install with no guessing.

## Status

- [x] Step 1 — repo scaffold
- [x] Step 2 — backend (Code.gs: setup, auth, settings, dashboard)
- [ ] Step 3 — frontend shell, lock screen, dashboard, Emergency card
- [ ] Step 4 — content JSON + guide view
- [ ] Step 5 — medicines + appointments
- [ ] Step 6 — health log + charts
- [ ] Step 7 — records vault + upload
- [ ] Step 8 — checklists + settings
- [ ] Step 9 — PWA (manifest, service worker, icons)
- [ ] Step 10 — Telegram reminders
- [ ] Step 11 — final polish

## Repo layout

```
/index.html
/css/style.css
/js/app.js               router + views
/js/api.js                all fetch calls
/js/i18n.js                string table (English now, Telugu-ready)
/js/config.example.js       API_URL / MOCK placeholder — copy to js/config.js
/data/weeks.json  food.json  warnings.json
/manifest.json  /sw.js  /icons/
/backend/Code.gs  /backend/appsscript.json
```

## Local setup (placeholder)

```sh
cp js/config.example.js js/config.js
# edit js/config.js — leave MOCK: true to develop without a real backend
```

Serve the folder with any static file server, e.g.:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

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

9. **Wire up the frontend.** Copy `js/config.example.js` to `js/config.js`
   (gitignored), set `API_URL` to the URL from step 6, and set `MOCK: false`.

## GitHub Pages setup

_Added in step 11._

## Install to home screen

_Added in step 11._

## Troubleshooting

_Added in step 11._

## Security notes

- No real data, Sheet ID, Drive IDs, PIN, or API URL is ever committed.
  `js/config.js` is gitignored; only `js/config.example.js` is tracked.
- The PIN lives only in Apps Script Script Properties (`APP_PIN`), compared
  constant-time, with lockout after repeated failures.
- Drive files are never made public; the backend serves them through the
  API.
- This app does not replace medical advice from a doctor.
