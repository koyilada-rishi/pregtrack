// Pregnancy Care Tracker — api.js
//
// Pure network transport. Nothing else: no mock branching (that's
// js/store.js), no caching, no version polling. Just one function — raw
// POSTs to the Apps Script backend — plus PIN storage and API URL
// resolution (committed default + optional per-device override), since
// those are what every request needs.
//
// Request shape is exactly what was verified against the real deployment
// (see the work order's "Rules learned while testing"):
//   fetch(apiUrl, {
//     method: "POST",
//     headers: { "Content-Type": "text/plain" },   // no other header —
//                                                   // anything else makes
//                                                   // the browser send a
//                                                   // CORS preflight, which
//                                                   // an Apps Script web app
//                                                   // cannot answer.
//     body: JSON.stringify({ pin, action, payload })
//   })
// redirect is left at its fetch default ("follow") — Apps Script's web app
// URL redirects once to script.googleusercontent.com, and fetch follows
// that transparently as long as nothing here overrides it.

import { DEFAULT_API_URL } from "./defaults.js";

const PIN_STORAGE_KEY = "pct_pin";
const API_URL_OVERRIDE_KEY = "pct_api_url_override";
const REQUEST_TIMEOUT_MS = 30000; // Apps Script is typically 1-2s, but cold starts/slow days happen

export class ApiError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = "ApiError";
    this.kind = kind || "server"; // 'auth' | 'lockout' | 'network' | 'server'
  }
}

// --- PIN storage -------------------------------------------------------

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

// --- API URL ---------------------------------------------------------------
//
// DEFAULT_API_URL (js/defaults.js) is committed on purpose — see that
// file's comment for why that's fine even though the PIN never is. Most
// devices never need to touch any of this: getApiUrl() just resolves to
// the committed default. An override exists for when the backend gets
// redeployed as a genuinely new deployment (changing the URL) before
// defaults.js is updated and redeployed — Settings → Advanced sets one
// per device, independent of the PIN and independent of signing out.

export function getApiUrlOverride() {
  try {
    return localStorage.getItem(API_URL_OVERRIDE_KEY) || "";
  } catch {
    return "";
  }
}

export function setApiUrlOverride(url) {
  try {
    localStorage.setItem(API_URL_OVERRIDE_KEY, url);
  } catch {
    // ignore
  }
}

export function clearApiUrlOverride() {
  try {
    localStorage.removeItem(API_URL_OVERRIDE_KEY);
  } catch {
    // ignore
  }
}

export function hasApiUrlOverride() {
  return getApiUrlOverride().length > 0;
}

// The URL actually used for requests: the per-device override if one is
// set, else the committed default.
export function getApiUrl() {
  return getApiUrlOverride() || DEFAULT_API_URL;
}

export function isValidApiUrl(url) {
  return /^https:\/\/.+/.test(String(url || ""));
}

// False until the resolved URL (override or default) actually looks like
// a real https:// URL — i.e. still false if defaults.js hasn't been
// edited past its placeholder and no override has been set either.
export function hasApiUrl() {
  return isValidApiUrl(getApiUrl());
}

// --- The one network call -------------------------------------------------

export async function call(action, payload) {
  const apiUrl = getApiUrl();
  if (!hasApiUrl()) {
    throw new ApiError("No server URL is configured yet — edit js/defaults.js, or set one in Settings → Advanced.", "server");
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
    // Non-JSON back (an HTML error page, a Google sign-in redirect target,
    // etc.) always means a deploy/network problem, never a real {ok,error}
    // response — surface it as that, not a cryptic parse error.
    throw new ApiError("Server returned an unexpected response. Check the deployment is live.", "network");
  }

  if (!json.ok) {
    const message = json.error || "Something went wrong.";
    if (/too many/i.test(message)) throw new ApiError(message, "lockout");
    if (/pin/i.test(message)) throw new ApiError(message, "auth");
    throw new ApiError(message, "server");
  }

  return json.data;
}
