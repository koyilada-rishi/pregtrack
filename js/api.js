// Pregnancy Care Tracker — API client.
//
// Every call goes through call(action, payload):
//   - sends {pin, action, payload} as a text/plain POST (no CORS preflight)
//   - on success, caches the result in localStorage under its action+payload
//   - on failure, throws an ApiError tagged with .kind so app.js can react
//     ('auth' -> wrong PIN, 'lockout' -> too many attempts, 'network' -> offline
//     /unreachable, 'server' -> backend returned some other error)
//
// When CONFIG.MOCK is true, calls are served by js/mock.js instead, so the
// whole UI can be built and tested without a deployed backend.

import { CONFIG } from "./config.js";
import { mockCall } from "./mock.js";

export { CONFIG };

const PIN_STORAGE_KEY = "pct_pin";
const API_URL_STORAGE_KEY = "pct_api_url";
const CACHE_PREFIX = "pct_cache:";
const REQUEST_TIMEOUT_MS = 15000;

export class ApiError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = "ApiError";
    this.kind = kind || "server"; // 'auth' | 'lockout' | 'network' | 'server'
  }
}

// --- PIN storage -----------------------------------------------------------

export function getPin() {
  try {
    return localStorage.getItem(PIN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function setPin(pin) {
  try {
    localStorage.setItem(PIN_STORAGE_KEY, pin);
  } catch {
    // localStorage unavailable (private mode etc.) — PIN just won't persist.
  }
}

export function clearPin() {
  try {
    localStorage.removeItem(PIN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function hasPin() {
  return getPin().length > 0;
}

// --- API URL storage --------------------------------------------------------
//
// js/config.js is gitignored and never committed (the security rules forbid
// committing the real API URL), so a plain `git push` to main never ships a
// working config.js to GitHub Pages. Instead, in non-mock mode, the API URL
// is entered once per device (same as the PIN) and stored here — it never
// needs to exist in any file served by Pages. CONFIG.API_URL still works as
// a local-dev convenience (skips the prompt), and takes priority if both are
// set, since a developer's js/config.js is a deliberate override.

export function getApiUrl() {
  try {
    return CONFIG.API_URL || localStorage.getItem(API_URL_STORAGE_KEY) || "";
  } catch {
    return CONFIG.API_URL || "";
  }
}

export function setApiUrl(url) {
  try {
    localStorage.setItem(API_URL_STORAGE_KEY, url);
  } catch {
    // localStorage unavailable — URL just won't persist across reloads.
  }
}

export function clearApiUrl() {
  try {
    localStorage.removeItem(API_URL_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function hasApiUrl() {
  return getApiUrl().length > 0;
}

// --- Response cache (last-good data per action, for offline reading) ------

function cacheKey(action, payload) {
  return CACHE_PREFIX + action + ":" + JSON.stringify(payload || {});
}

export function getCached(action, payload) {
  try {
    const raw = localStorage.getItem(cacheKey(action, payload));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCached(action, payload, data) {
  try {
    localStorage.setItem(cacheKey(action, payload), JSON.stringify(data));
  } catch {
    // Storage full or unavailable — caching is a nice-to-have, not fatal.
  }
}

// --- Core call ---------------------------------------------------------

export async function call(action, payload) {
  const data = CONFIG.MOCK
    ? await callMock(action, payload)
    : await callReal(action, payload);
  setCached(action, payload, data);
  return data;
}

async function callMock(action, payload) {
  try {
    return await mockCall(action, payload);
  } catch (err) {
    throw new ApiError(err.message || String(err), "server");
  }
}

async function callReal(action, payload) {
  const apiUrl = getApiUrl();
  if (!apiUrl) {
    throw new ApiError("No server URL is set up on this device yet.", "server");
  }

  let response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ pin: getPin(), action, payload: payload || {} }),
      signal: controller.signal
    });
    clearTimeout(timeout);
  } catch {
    throw new ApiError("Could not reach the server.", "network");
  }

  let json;
  try {
    json = await response.json();
  } catch {
    throw new ApiError("Server returned an unexpected response.", "server");
  }

  if (!json.ok) {
    const message = json.error || "Something went wrong.";
    if (/too many/i.test(message)) throw new ApiError(message, "lockout");
    if (/pin/i.test(message)) throw new ApiError(message, "auth");
    throw new ApiError(message, "server");
  }

  return json.data;
}

// --- Cache-then-network helper for views -----------------------------------
//
// Calls onCache synchronously (if cached data exists) so the view can paint
// instantly, then resolves with fresh data once the network call finishes.
// Throws the ApiError if the network call fails (caller decides whether to
// keep showing cached data or surface the error).

export async function fetchWithCache(action, payload, onCache) {
  const cached = getCached(action, payload);
  if (cached && onCache) onCache(cached);
  return call(action, payload);
}
