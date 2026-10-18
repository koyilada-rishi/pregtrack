// Copy this file to js/config.js (which is gitignored) and fill in your
// real values. Never commit js/config.js.
//
// This file is only a LOCAL DEV convenience. The real, deployed app on
// GitHub Pages never has a config.js with a real API_URL in it (it can't —
// the security rules forbid committing the API URL, and GitHub Pages only
// ever serves what's actually committed). Instead, on first run, the app
// asks for the Apps Script web app URL once and stores it in that device's
// localStorage, the same way it already handles the PIN. So API_URL below
// is purely optional, for skipping that one-time prompt while developing
// locally against your real backend.

export const CONFIG = {
  // Optional for local dev only — see the note above. Leave blank for the
  // real deployed app; it will prompt for this once per device instead.
  API_URL: "",

  // When true, js/api.js serves data from js/mock.js fixtures instead of
  // calling the real backend. Lets you build/test the whole UI with no
  // Apps Script deployment. Set to false for the real app.
  MOCK: true,

  // App language. "en" now; "te" (Telugu) once js/i18n.js has translations.
  LANGUAGE: "en",
};
