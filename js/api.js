// Pregnancy Care Tracker — API client.
// Wraps every backend call as call(action, payload) -> {ok, data, error}.
// Sends POST with Content-Type: text/plain (no CORS preflight) carrying
// {pin, action, payload} as JSON. When CONFIG.MOCK is true, serves fixtures
// from js/mock.js instead of hitting the real Apps Script backend.
// Built out starting step 2 (auth/settings/dashboard actions).
