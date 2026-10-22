// Pregnancy Care Tracker — defaults.js
//
// Committed on purpose, unlike the PIN or any Sheet/Drive ID. The Apps
// Script web app URL isn't actually a secret once the app is deployed —
// anyone using the live site can already see it in their browser's network
// tab, the same as any client-side API endpoint (see README's security
// notes). Committing it here means the deployed app works with just a PIN,
// no per-device URL entry.
//
// Edit DEFAULT_API_URL below to your own deployed /exec URL (see README's
// "Apps Script deploy" step 6), then commit this file yourself. Until it's
// edited, the app shows a "not set up yet" screen instead of guessing.
//
// Redeploying later as a genuinely new deployment (not just a new version
// of the same one) changes the URL — update it here, or use Settings →
// Advanced → override the URL per device without touching this file.

export const DEFAULT_API_URL = "https://script.google.com/macros/s/AKfycbzGXFv4W_QFQCRCjx0k2i6NoMqN0b_wcXYrzpC3yFh8J1wY1Cvj3NSY89rPCzI4LwldqQ/exec";

// Must match BACKEND_VERSION in backend/Code.gs exactly. js/store.js's
// version polling compares this against what the deployed backend reports
// (version.get's backend_version) and shows an "update needed" banner on a
// mismatch — bump both together whenever a Code.gs change needs a redeploy.
export const REQUIRED_BACKEND_VERSION = 1;
