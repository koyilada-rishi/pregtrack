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
- [ ] Step 2 — backend (Code.gs: setup, auth, settings, dashboard)
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

_Added in step 2._

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
