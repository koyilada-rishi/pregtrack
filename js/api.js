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

const PIN_STORAGE_KEY = "pct_pin";
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
  if (!CONFIG.API_URL) {
    throw new ApiError("API_URL is not set in js/config.js.", "server");
  }

  let response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    response = await fetch(CONFIG.API_URL, {
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
