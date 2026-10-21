// Pregnancy Care Tracker — store.js
//
// The data layer sitting above js/api.js — the module every view actually
// imports. Public surface intentionally mirrors what js/api.js used to
// expose directly (call/fetchWithCache/getCached/PIN+URL helpers/ApiError),
// so the view code built in steps 5-8 barely needed to change when this
// module took over from api.js in step 3 — just an `api.` -> `store.`
// rename at each call site. What's new here:
//   - call() routes to the mock fixtures below or to the real api.call(),
//     transparently, and always throws ApiError either way.
//   - fetchWithCache()/getCached() unchanged in spirit from v1, still the
//     "paint from localStorage instantly, then resolve with fresh data"
//     pattern used by Home/Emergency.
//   - bootstrap(): the one-call batch load (step 2's backend action) with
//     its own localStorage persistence, so a cold reload can paint from the
//     last-known bootstrap before the network round-trip finishes.
//   - startVersionPolling(): the freshness mechanism — checks version.get
//     on load/focus and every 30s while the tab is visible (paused while
//     hidden), and tells its caller when something actually changed instead
//     of blindly refetching on a timer.
//   - step 9 still owed: the offline write queue (backoff, de-dupe by
//     client-generated id). Everything above already passes an optional
//     client id through on creates (see mockCall below) in anticipation.

import * as api from "./api.js";
import { REQUIRED_BACKEND_VERSION } from "./defaults.js";

export {
  ApiError, getPin, setPin, clearPin, hasPin,
  getApiUrl, hasApiUrl, isValidApiUrl,
  getApiUrlOverride, setApiUrlOverride, clearApiUrlOverride, hasApiUrlOverride
} from "./api.js";

const MOCK_QUERY_PARAM = "mock";
const MOCK_STORAGE_KEY = "pct_mock";

// Mock mode is a frontend-only flag (no config.js file at all, per the v2
// security rules — nothing like an API URL should need to exist in a
// committed file). Can be forced either way without editing source via
// ?mock=1 / ?mock=0 in the URL once — the choice is remembered in
// localStorage after that, and takes priority over everything below.
//
// With no explicit choice ever made, the default depends on where the app
// is running: on over a real domain (GitHub Pages, the live deployment)
// it's OFF — production defaults to real mode with the first-run URL+PIN
// screen, never silently showing sample data. On localhost/127.0.0.1 (or
// file://, e.g. opening index.html directly) it's ON, so a fresh clone
// still "just works" with zero setup.
function isLocalDev() {
  try {
    if (location.protocol === "file:") return true;
    const host = location.hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "";
  } catch {
    return true; // can't tell — default to mock rather than risk silently hitting a real backend
  }
}

export function isMockMode() {
  try {
    const params = new URLSearchParams(location.search);
    if (params.has(MOCK_QUERY_PARAM)) {
      const value = params.get(MOCK_QUERY_PARAM) === "1";
      localStorage.setItem(MOCK_STORAGE_KEY, value ? "1" : "0");
      return value;
    }
    const stored = localStorage.getItem(MOCK_STORAGE_KEY);
    if (stored !== null) return stored === "1";
  } catch {
    // localStorage/URLSearchParams unavailable (very old browser, privacy
    // mode) — fall through to the hostname-based default below.
  }
  return isLocalDev();
}

// --- Core call + response cache --------------------------------------------

const CACHE_PREFIX = "pct_cache:";

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
    // Storage full/unavailable — caching is a nice-to-have, not fatal.
  }
}

export async function call(action, payload) {
  const data = isMockMode() ? await callMock(action, payload) : await api.call(action, payload);
  setCached(action, payload, data);
  return data;
}

async function callMock(action, payload) {
  try {
    return await mockCall(action, payload);
  } catch (err) {
    throw new api.ApiError(err.message || String(err), "server");
  }
}

// Cache-then-network: paints instantly from localStorage if there's a
// cached response, then resolves with fresh data once the network call
// finishes. Throws the ApiError on network failure — the caller decides
// whether to keep showing the cached paint or surface the error.
export async function fetchWithCache(action, payload, onCache) {
  const cached = getCached(action, payload);
  if (cached && onCache) onCache(cached);
  return call(action, payload);
}

// --- Bootstrap: one-call batch load for the initial app load ---------------

const BOOTSTRAP_CACHE_KEY = "pct_bootstrap";
let inMemoryBootstrap = null;

export function getCachedBootstrap() {
  if (inMemoryBootstrap) return inMemoryBootstrap;
  try {
    const raw = localStorage.getItem(BOOTSTRAP_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCachedBootstrap(data) {
  inMemoryBootstrap = data;
  try {
    localStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

// Views call this without forceRefresh and get the cache instantly once
// it's warm — startVersionPolling()'s onChanged callback is the only thing
// that should pass forceRefresh: true, when data_version actually moved.
// This is "cache aggressively" taken literally: a view navigation alone
// never re-hits the (slow) bootstrap action, only a real server-side change
// does. Throws on a genuine network failure during the first (uncached)
// load; after that, a view with nothing cached yet will fall back to its
// own error state the same way it always did with fetchWithCache.
export async function loadBootstrap(onCache, forceRefresh) {
  const cached = getCachedBootstrap();
  if (cached && !forceRefresh) {
    if (onCache) onCache(cached);
    return cached;
  }
  if (cached && onCache) onCache(cached); // paint the stale copy while refreshing
  const fresh = await call("bootstrap", {});
  setCachedBootstrap(fresh);
  return fresh;
}

// --- Freshness: data_version polling ---------------------------------------
//
// Checks version.get on load, on the tab regaining focus/visibility, and
// every POLL_INTERVAL_MS while visible (paused while hidden, so a
// backgrounded tab doesn't keep hitting the network). Calls onChanged()
// — not a full refetch itself — whenever the version actually moved, so
// the caller (app.js) decides what to do: reload the bootstrap, re-render
// whatever view is open, etc. A failed version.get (offline, slow network)
// is silently skipped; it just tries again next cycle.

const POLL_INTERVAL_MS = 30000;
let lastKnownVersion = null;
let pollIntervalId = null;
let pollingOnChanged = null;
let pollingOnBackendOutdated = null;

// onBackendOutdated(isOutdated, backendVersion) fires every successful
// version.get — not just on a change — so a caller that mounts after the
// first check (or missed it) still finds out the current state, and a
// banner it's driving can always be told to hide again once the mismatch
// is gone (e.g. the backend gets redeployed while the tab stays open).
export function startVersionPolling(onChanged, onBackendOutdated) {
  if (isMockMode()) return; // nothing to poll — there's no server
  pollingOnChanged = onChanged;
  pollingOnBackendOutdated = onBackendOutdated || null;

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("focus", checkVersionOnce);
  checkVersionOnce();
  if (document.visibilityState === "visible") startInterval();
}

export function stopVersionPolling() {
  stopInterval();
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener("focus", checkVersionOnce);
  pollingOnChanged = null;
  pollingOnBackendOutdated = null;
}

function handleVisibilityChange() {
  if (document.visibilityState === "visible") {
    checkVersionOnce();
    startInterval();
  } else {
    stopInterval();
  }
}

function startInterval() {
  if (pollIntervalId) return;
  pollIntervalId = setInterval(checkVersionOnce, POLL_INTERVAL_MS);
}

function stopInterval() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
}

async function checkVersionOnce() {
  try {
    const { data_version, backend_version } = await api.call("version.get", {});
    if (lastKnownVersion !== null && data_version !== lastKnownVersion) {
      lastKnownVersion = data_version;
      if (pollingOnChanged) pollingOnChanged(data_version);
    } else {
      lastKnownVersion = data_version;
    }
    if (pollingOnBackendOutdated) {
      pollingOnBackendOutdated(backend_version !== REQUIRED_BACKEND_VERSION, backend_version);
    }
  } catch {
    // Offline or a slow network hiccup — just try again next cycle. Not
    // treated as "backend outdated": that's a specific, confirmed mismatch,
    // not the absence of an answer.
  }
}

// --- Mock fixture data ------------------------------------------------------
// Ported from the old js/mock.js. Will grow new entity support (and new
// fields like data_version) alongside the matching backend/Code.gs changes
// in later steps, rather than guessing ahead now.

function uid() {
  return "mock-" + Math.random().toString(36).slice(2, 10);
}

// Local calendar date, not UTC — toISOString() would be off by a day for
// part of the day in any timezone ahead of UTC, which matters now that
// js/schedule.js does real local-date arithmetic (course day counts, due
// dates) against these same mock fixtures.
function todayStr(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + (offsetDays || 0));
  return formatLocalDateStr(d);
}

function todayTime() {
  const d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// Local calendar date for an arbitrary Date (not just "today") — same
// local-not-UTC reasoning as todayStr() above.
function formatLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

const db = {
  settings: {
    due_date: todayStr(90),
    lmp_date: "",
    wife_name: "Priya",
    blood_group: "O+",
    allergies: "Penicillin",
    hospital_name: "City Women's Hospital",
    hospital_phone: "+91 90000 00000",
    hospital_address: "12 MG Road, Hyderabad",
    language: "en",
    water_goal_glasses: "8",
    photos_enabled: "true",
    ingredients_enabled: "true",
    expiry_tracking_enabled: "true",
    expiry_alert_days: "30"
  },
  medicines: [
    { id: "mock-med-1", name: "Folic acid", dose: "5mg", frequency: "Once daily", times: "08:00", start_date: todayStr(-60), end_date: "", prescribed_by: "Dr. Rao", notes: "", active: true, stock_count: "", doses_per_day: "", refill_alert_days: 3, schedule_type: "daily", anchor_mode: "fixed", grace_minutes: 60, instructions: "before_food", status: "active", composition: "Folic Acid", brand: "Folvite", strength: "5mg", expiry_date: todayStr(20) },
    { id: "mock-med-2", name: "Iron", dose: "1 tablet", frequency: "Twice daily", times: "08:00,20:00", start_date: todayStr(-30), end_date: "", prescribed_by: "Dr. Rao", notes: "Take after food", active: true, stock_count: 9, doses_per_day: 2, refill_alert_days: 5, schedule_type: "daily", anchor_mode: "fixed", grace_minutes: 60, instructions: "after_food", status: "active", composition: "Ferrous Ascorbate", brand: "Fera-G", strength: "100mg", expiry_date: todayStr(-3) },
    // Every-8h, counted from the last dose actually taken (anchor_mode:
    // from_last) — a real taken dose below gives it something to anchor to.
    { id: "mock-med-3", name: "Amoxicillin", dose: "500mg", frequency: "Every 8 hours", times: "08:00", start_date: todayStr(-2), end_date: todayStr(5), prescribed_by: "Dr. Rao", notes: "Finish full course", active: true, stock_count: "", doses_per_day: "", refill_alert_days: 3, schedule_type: "interval", anchor_mode: "from_last", interval_hours: 8, grace_minutes: 60, instructions: "with_food", total_doses: 21, status: "active" },
    // Weekly shot, due every Sunday.
    { id: "mock-med-4", name: "Iron shot", dose: "1 injection", frequency: "Weekly", times: "10:00", start_date: todayStr(-14), end_date: "", prescribed_by: "Dr. Rao", notes: "", active: true, stock_count: "", doses_per_day: "", refill_alert_days: 3, schedule_type: "weekly", weekdays: "sun", grace_minutes: 240, instructions: "none", status: "active" },
    // PRN (as-needed) — 6h gap, 3/day cap.
    { id: "mock-med-5", name: "Paracetamol", dose: "650mg", frequency: "As needed", times: "", start_date: todayStr(-10), end_date: "", prescribed_by: "Dr. Rao", notes: "For headache or fever", active: true, stock_count: 18, doses_per_day: "", refill_alert_days: 5, schedule_type: "prn", prn_min_gap_hours: 6, prn_max_per_day: 3, instructions: "none", status: "active" },
    // Finished course — shows up only in the Medicines-used history view.
    { id: "mock-med-6", name: "Doxylamine", dose: "10mg", frequency: "Once daily", times: "21:00", start_date: todayStr(-45), end_date: todayStr(-20), prescribed_by: "Dr. Rao", notes: "For morning sickness", active: false, stock_count: "", doses_per_day: "", refill_alert_days: 3, schedule_type: "daily", grace_minutes: 60, instructions: "bedtime", status: "finished", stopped_on: todayStr(-20), stop_note: "Symptoms eased" }
  ],
  // A few taken/skipped doses — mock-med-3's gives the from_last interval
  // countdown something real to anchor to; the rest make the Home/Meds
  // status badges (taken/due_now/late/missed) visible without real data.
  medicineLog: [
    { id: "mock-ml-1", medicine_id: "mock-med-2", date: todayStr(), time: "08:00", taken: true, status: "taken", taken_at: new Date(new Date().setHours(8, 5, 0, 0)).toISOString(), note: "" },
    { id: "mock-ml-2", medicine_id: "mock-med-3", date: todayStr(), time: "08:00", taken: true, status: "taken", taken_at: new Date(Date.now() - 3 * 3600000).toISOString(), note: "" },
    { id: "mock-ml-3", medicine_id: "mock-med-1", date: todayStr(-1), time: "08:00", taken: false, status: "missed", taken_at: "", note: "" }
  ],
  packs: [
    { id: "mock-pack-1", name: "Evening pack", times: "20:00", member_medicine_ids: "mock-med-1,mock-med-2", created_at: new Date(Date.now() - 20 * 86400000).toISOString() }
  ],
  appointments: [
    { id: "mock-appt-1", datetime: new Date(Date.now() + 5 * 86400000).toISOString(), doctor: "Dr. Rao", purpose: "Routine checkup", location: "City Women's Hospital", status: "upcoming", notes_after_visit: "" },
    { id: "mock-appt-2", datetime: new Date(Date.now() - 20 * 86400000).toISOString(), doctor: "Dr. Rao", purpose: "Anomaly scan", location: "City Women's Hospital", status: "done", notes_after_visit: "Scan reviewed at the visit." }
  ],
  healthlog: [
    { id: "mock-hl-1", date: todayStr(-14), weight_kg: 60.5, bp_sys: 112, bp_dia: 74, sugar_fasting: 85, sugar_pp: 115, kicks: 8, mood: "Good", symptoms: "", notes: "" },
    { id: "mock-hl-2", date: todayStr(-7), weight_kg: 61.5, bp_sys: 114, bp_dia: 75, sugar_fasting: 88, sugar_pp: 120, kicks: 10, mood: "Tired", symptoms: "Mild backache", notes: "" },
    { id: "mock-hl-3", date: todayStr(-2), weight_kg: 62, bp_sys: 112, bp_dia: 74, sugar_fasting: 88, sugar_pp: 120, kicks: 12, mood: "Good", symptoms: "", notes: "" }
  ],
  contacts: [
    { id: "mock-contact-1", name: "Dr. Rao", role: "OB-GYN", phone: "+91 98765 43210", address: "", maps_link: "", is_emergency: true },
    { id: "mock-contact-2", name: "Apollo Pharmacy", role: "Pharmacy", phone: "+91 98765 00000", address: "", maps_link: "", is_emergency: false }
  ],
  foodlog: [
    { id: "mock-fl-1", date: todayStr(), meal: "Breakfast", items: "Idli, sambar", craving_or_aversion: "", notes: "" },
    { id: "mock-fl-2", date: todayStr(-1), meal: "Dinner", items: "Dal, rice, curd", craving_or_aversion: "Craving something sweet", notes: "" },
    { id: "mock-fl-3", date: todayStr(-1), meal: "Lunch", items: "Vegetable khichdi", craving_or_aversion: "", notes: "" }
  ],
  foodPrefs: [
    { id: "mock-fp-1", name: "Eggs", status: "not_interested", date: todayStr(-10), notes: "Off them this trimester" },
    { id: "mock-fp-2", name: "Mango", status: "interested", date: todayStr(-5), notes: "" }
  ],
  notes: [
    { id: "mock-note-1", date: todayStr(-1), time: "19:00", category: "question", text: "Ask about iron levels", created_at: new Date().toISOString() }
  ],
  checkins: [
    { id: "mock-ci-1", date: todayStr(), time: "09:15", mood: 4, note: "Slept well", created_at: new Date().toISOString() }
  ],
  symptoms: [
    { id: "mock-sym-1", date: todayStr(-1), time: "20:00", symptom_key: "heartburn", custom_name: "", severity: "mild", bleeding_scale: "", note: "", created_at: new Date().toISOString() }
  ],
  water: [
    { id: "mock-w-1", date: todayStr(), time: "08:30", glasses: 1, created_at: new Date().toISOString() },
    { id: "mock-w-2", date: todayStr(), time: "11:00", glasses: 1, created_at: new Date().toISOString() },
    { id: "mock-w-3", date: todayStr(-1), time: "09:00", glasses: 1, created_at: new Date().toISOString() },
    { id: "mock-w-4", date: todayStr(-1), time: "14:00", glasses: 1, created_at: new Date().toISOString() },
    { id: "mock-w-5", date: todayStr(-1), time: "19:00", glasses: 1, created_at: new Date().toISOString() }
  ],
  checklist: [
    { id: "mock-cl-1", list: "hospital_bag", item: "Phone charger", done: false },
    { id: "mock-cl-2", list: "hospital_bag", item: "Comfortable clothes", done: true },
    { id: "mock-cl-3", list: "documents", item: "ID proof", done: false },
    { id: "mock-cl-4", list: "baby_items", item: "Onesies", done: false }
  ],
  files: [
    { id: "mock-file-1", drive_file_id: "mock-drive-1", title: "Anomaly scan report", type: "scan", date: todayStr(-20), doctor: "Dr. Rao", notes: "", mime: "", thumb_file_id: "", type_v2: "scan_report", linked_booking_id: "mock-booking-2", linked_file_ids: "mock-file-3" },
    { id: "mock-file-2", drive_file_id: "mock-drive-2", title: "Old lab slip", type: "report", date: todayStr(-90), doctor: "", notes: "", mime: "", thumb_file_id: "", type_v2: "", linked_booking_id: "", linked_file_ids: "" },
    { id: "mock-file-3", drive_file_id: "mock-drive-3", title: "Scan bill", type: "document", date: "", doctor: "Dr. Rao", notes: "", mime: "", thumb_file_id: "", type_v2: "bill", linked_booking_id: "mock-booking-2", linked_file_ids: "mock-file-1" }
  ],
  bookings: [
    { id: "mock-booking-1", type: "doctor_visit", title: "Routine checkup", provider: "Dr. Rao", datetime: new Date(Date.now() + 5 * 86400000).toISOString(), booked_via: "call", location: "City Women's Hospital", notes: "", approx_report_days: "", status: "booked", booked_at: new Date(Date.now() - 2 * 86400000).toISOString(), done_at: "", waiting_for_report_at: "", report_uploaded_at: "", closed_at: "", closed_without_prescription: false, no_prescription_note: "", questions: "[ ] Ask about iron levels\n[x] Ask about kicks per day", created_at: new Date(Date.now() - 2 * 86400000).toISOString() },
    { id: "mock-booking-2", type: "scan", title: "Anomaly scan", provider: "City Imaging", datetime: new Date(Date.now() - 20 * 86400000).toISOString(), booked_via: "online", location: "", notes: "Scan reviewed at the visit.", approx_report_days: 2, status: "closed", booked_at: new Date(Date.now() - 25 * 86400000).toISOString(), done_at: new Date(Date.now() - 20 * 86400000).toISOString(), waiting_for_report_at: new Date(Date.now() - 20 * 86400000).toISOString(), report_uploaded_at: new Date(Date.now() - 18 * 86400000).toISOString(), closed_at: new Date(Date.now() - 17 * 86400000).toISOString(), closed_without_prescription: false, no_prescription_note: "", questions: "", created_at: new Date(Date.now() - 25 * 86400000).toISOString() }
  ],
  suggestions: [
    { id: "mock-sugg-1", booking_id: "mock-booking-2", type: "diet_lifestyle", text: "More iron-rich foods", follow_up_date: "", status: "pending", created_at: new Date().toISOString() }
  ],
  bills: [
    { id: "mock-bill-1", booking_id: "mock-booking-2", amount: 1500, status: "paid", paid_on: todayStr(-19), receipt_file_id: "", notes: "" }
  ],
  // One example of every kind, covering upcoming/dueSoon/overdue/done states
  // for visual testing without touching a real backend.
  countdowns: [
    { id: "mock-cd-1", title: "Baby shower", kind: "event", target_datetime: new Date(Date.now() + 9 * 86400000).toISOString(), start_date: "", repeat: "none", interval_hours: "", linked_medicine_id: "", show_on_home: true, pinned_order: 1, notes: "At Priya's parents' place", done: false, created_at: new Date(Date.now() - 10 * 86400000).toISOString() },
    { id: "mock-cd-2", title: "Amoxicillin course", kind: "course", target_datetime: new Date(Date.now() + 5 * 86400000).toISOString(), start_date: todayStr(-2), repeat: "none", interval_hours: "", linked_medicine_id: "mock-med-3", show_on_home: true, pinned_order: 2, notes: "", done: false, created_at: new Date(Date.now() - 2 * 86400000).toISOString() },
    { id: "mock-cd-3", title: "Iron dose", kind: "interval", target_datetime: "", start_date: "", repeat: "none", interval_hours: 12, linked_medicine_id: "mock-med-2", show_on_home: true, pinned_order: 3, notes: "", done: false, created_at: new Date(Date.now() - 30 * 86400000).toISOString() },
    { id: "mock-cd-4", title: "Weekly midwife check-in", kind: "recurring", target_datetime: new Date(Date.now() - 2 * 86400000).toISOString(), start_date: "", repeat: "weekly", interval_hours: "", linked_medicine_id: "", show_on_home: false, pinned_order: 0, notes: "Phone call", done: false, created_at: new Date(Date.now() - 40 * 86400000).toISOString() },
    { id: "mock-cd-5", title: "Trying since", kind: "countup", target_datetime: "", start_date: todayStr(-220), repeat: "none", interval_hours: "", linked_medicine_id: "", show_on_home: false, pinned_order: 0, notes: "", done: false, created_at: new Date(Date.now() - 220 * 86400000).toISOString() },
    { id: "mock-cd-6", title: "Pack hospital bag", kind: "event", target_datetime: new Date(Date.now() - 36 * 3600000).toISOString(), start_date: "", repeat: "none", interval_hours: "", linked_medicine_id: "", show_on_home: false, pinned_order: 0, notes: "Past its target date, for visual testing", done: false, created_at: new Date(Date.now() - 15 * 86400000).toISOString() },
    { id: "mock-cd-7", title: "First prenatal yoga class", kind: "event", target_datetime: new Date(Date.now() - 5 * 86400000).toISOString(), start_date: "", repeat: "none", interval_hours: "", linked_medicine_id: "", show_on_home: false, pinned_order: 0, notes: "", done: true, created_at: new Date(Date.now() - 20 * 86400000).toISOString() }
  ]
};

function requireFields(payload, fields) {
  fields.forEach((f) => {
    if (payload[f] === undefined || payload[f] === null || String(payload[f]).trim() === "") {
      throw new Error("Missing required field: " + f);
    }
  });
}

function upsertInto(list, id, fields) {
  const row = list.find((r) => r.id === id);
  if (!row) throw new Error("Not found: " + id);
  Object.assign(row, fields);
  return clone(row);
}

function removeFrom(list, id) {
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) throw new Error("Not found: " + id);
  list.splice(idx, 1);
  return { id };
}

function computeGestationalAge() {
  const due = db.settings.due_date ? new Date(db.settings.due_date) : null;
  const lmp = db.settings.lmp_date ? new Date(db.settings.lmp_date) : due ? new Date(due.getTime() - 280 * 86400000) : null;
  if (!lmp) return null;
  const today = new Date();
  const daysSinceLmp = Math.max(0, Math.round((today - lmp) / 86400000));
  return {
    weeks: Math.floor(daysSinceLmp / 7),
    days: daysSinceLmp % 7,
    trimester: daysSinceLmp < 13 * 7 ? 1 : daysSinceLmp < 28 * 7 ? 2 : 3,
    days_left: due ? Math.round((due - today) / 86400000) : null
  };
}

// Mirrors the backend's adjustMedicineStock() — same +-1/clamp-at-0/
// opt-in-only rules, kept in sync so mock mode behaves identically.
function adjustMockMedicineStock(medicineId, delta) {
  const med = db.medicines.find((m) => m.id === medicineId);
  if (!med || med.stock_count === "" || med.stock_count === undefined || med.stock_count === null) return;
  const current = Number(med.stock_count);
  if (isNaN(current)) return;
  med.stock_count = Math.max(0, current + delta);
}

// Mirrors the backend's getLatestMedicineDoses().
function mockLatestMedicineDoses() {
  const latestByMedicine = {};
  db.medicineLog.forEach((log) => {
    if (!log.taken) return;
    const sortKey = log.date + " " + log.time;
    const current = latestByMedicine[log.medicine_id];
    if (!current || sortKey > current._sortKey) {
      latestByMedicine[log.medicine_id] = { medicine_id: log.medicine_id, date: log.date, time: log.time, _sortKey: sortKey };
    }
  });
  return Object.values(latestByMedicine).map(({ _sortKey, ...rest }) => rest);
}

// Mirrors backend/Code.gs's validateCountdownFieldsForKind, loosely — just
// enough to keep mock mode's dev experience consistent with the real thing.
function validateMockCountdown(fields, kind) {
  if (!["event", "course", "interval", "recurring", "countup"].includes(kind)) {
    throw new Error("Invalid countdown kind: " + kind);
  }
  if (kind === "event" && !fields.target_datetime) throw new Error('A "event" countdown requires target_datetime');
  if (kind === "course" && (!fields.start_date || !fields.target_datetime)) {
    throw new Error('A "course" countdown requires start_date and target_datetime');
  }
  if (kind === "interval") {
    if (!fields.linked_medicine_id) throw new Error('An "interval" countdown requires linked_medicine_id');
    if (!fields.interval_hours || fields.interval_hours <= 0) throw new Error('An "interval" countdown requires a positive interval_hours');
  }
  if (kind === "recurring") {
    if (!fields.target_datetime) throw new Error('A "recurring" countdown requires target_datetime');
    if (!fields.repeat || fields.repeat === "none") throw new Error('A "recurring" countdown requires a repeat value other than "none"');
  }
  if (kind === "countup" && !fields.start_date) throw new Error('A "countup" countdown requires start_date');
}

function mockDashboard() {
  const today = todayStr();
  const takenToday = {};
  db.medicineLog.forEach((l) => { if (l.date === today && l.taken) takenToday[l.medicine_id + "|" + l.time] = true; });

  const pending = [];
  db.medicines.filter((m) => m.active).forEach((m) => {
    String(m.times || "").split(",").map((t) => t.trim()).filter(Boolean).forEach((time) => {
      if (!takenToday[m.id + "|" + time]) pending.push({ medicine_id: m.id, name: m.name, dose: m.dose, time });
    });
  });
  pending.sort((a, b) => a.time.localeCompare(b.time));

  const upcoming = db.appointments
    .filter((a) => a.status === "upcoming" && new Date(a.datetime) >= new Date())
    .sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

  const sortedVitals = [...db.healthlog].sort((a, b) => b.date.localeCompare(a.date));

  return {
    due_date: db.settings.due_date,
    lmp_date: db.settings.lmp_date,
    gestational_age: computeGestationalAge(),
    next_appointment: upcoming[0]
      ? { id: upcoming[0].id, datetime: upcoming[0].datetime, doctor: upcoming[0].doctor, purpose: upcoming[0].purpose, location: upcoming[0].location }
      : null,
    today_medicines: pending,
    latest_vitals: sortedVitals[0] || null
  };
}

// Mirrors the backend's data_version, loosely — bumped on any mock action
// that isn't a read. startVersionPolling() is a no-op in mock mode (no real
// server to poll), so nothing currently depends on this being exact; it's
// here mainly so version.get/bootstrap return something sane if called
// directly.
let mockDataVersion = 1;
const MOCK_READ_ONLY_SUFFIXES = [".list", ".get", ".history"];

export async function mockCall(action, payload) {
  // Simulate real network latency so loading states are visible in dev.
  await new Promise((resolve) => setTimeout(resolve, 250));
  payload = payload || {};

  if (action !== "auth.check" && action !== "version.get" && action !== "bootstrap" &&
      !MOCK_READ_ONLY_SUFFIXES.some((suffix) => action.endsWith(suffix))) {
    mockDataVersion++;
  }

  switch (action) {
    case "auth.check":
      return { authenticated: true };

    case "settings.get":
      return clone(db.settings);
    case "settings.set": {
      Object.assign(db.settings, payload);
      // Mirrors the backend's USG back-calculation: a scan's reported
      // gestational age on a given date overwrites due_date/lmp_date,
      // recomputed on every settings.set call so it never goes stale.
      if (db.settings.dating_method === "usg" && db.settings.usg_date) {
        const usgDate = new Date(db.settings.usg_date);
        const gaDays = (Number(db.settings.usg_weeks) || 0) * 7 + (Number(db.settings.usg_days) || 0);
        if (!isNaN(usgDate.getTime()) && gaDays > 0) {
          const lmp = new Date(usgDate.getTime());
          lmp.setDate(lmp.getDate() - gaDays);
          const due = new Date(lmp.getTime());
          due.setDate(due.getDate() + 280);
          db.settings.lmp_date = formatLocalDateStr(lmp);
          db.settings.due_date = formatLocalDateStr(due);
        }
      }
      return clone(db.settings);
    }

    case "dashboard.get":
      return mockDashboard();
    case "version.get":
      return { data_version: mockDataVersion, backend_version: REQUIRED_BACKEND_VERSION };
    case "bootstrap":
      return {
        data_version: mockDataVersion,
        backend_version: REQUIRED_BACKEND_VERSION,
        settings: clone(db.settings),
        dashboard: mockDashboard(),
        medicines: clone(db.medicines),
        appointments: clone(db.appointments),
        healthlog: clone(db.healthlog),
        contacts: clone(db.contacts),
        foodlog: clone(db.foodlog),
        checklist: clone(db.checklist),
        files: clone(db.files).map(({ _base64, _mimeType, _filename, ...rest }) => rest),
        countdowns: clone(db.countdowns),
        packs: clone(db.packs),
        latest_medicine_doses: mockLatestMedicineDoses()
      };

    case "medicines.list":
      return clone(db.medicines);
    case "medicines.create": {
      requireFields(payload, ["name"]);
      const row = {
        id: payload.id || uid(), name: "", dose: "", frequency: "", times: "", start_date: todayStr(), end_date: "",
        prescribed_by: "", notes: "", active: true, stock_count: "", doses_per_day: "", refill_alert_days: 3,
        schedule_type: "daily", anchor_mode: "fixed", weekdays: "", interval_hours: "", interval_days: "",
        month_day: "", every_n_weeks: "", total_doses: "", grace_minutes: 60, instructions: "none",
        prn_min_gap_hours: "", prn_max_per_day: "", phases: "", reason: "", pack_id: "", status: "active",
        stopped_on: "", stop_note: "", source: "",
        ...payload
      };
      db.medicines.push(row);
      return clone(row);
    }
    case "medicines.update": {
      requireFields(payload, ["id"]);
      const fields = { ...payload };
      if (fields.status && !Object.prototype.hasOwnProperty.call(payload, "active")) {
        fields.active = fields.status === "active";
      }
      return upsertInto(db.medicines, payload.id, fields);
    }
    case "medicines.stop":
      requireFields(payload, ["id"]);
      return upsertInto(db.medicines, payload.id, {
        status: "stopped", active: false,
        stopped_on: payload.stopped_on || todayStr(), stop_note: payload.stop_note || ""
      });
    case "medicines.delete":
      requireFields(payload, ["id"]);
      return removeFrom(db.medicines, payload.id);
    case "medicines.logTaken": {
      requireFields(payload, ["medicine_id", "date", "time"]);
      const hasStatus = Object.prototype.hasOwnProperty.call(payload, "status");
      const status = hasStatus ? payload.status : (payload.taken === undefined ? true : !!payload.taken) ? "taken" : "skipped";
      const taken = status === "taken";
      const takenAt = taken ? (payload.taken_at || new Date().toISOString()) : "";
      const existing = db.medicineLog.find((l) => l.medicine_id === payload.medicine_id && l.date === payload.date && l.time === payload.time);
      const wasTaken = existing ? !!existing.taken : false;
      let row;
      if (existing) {
        existing.taken = taken;
        existing.status = status;
        existing.taken_at = takenAt;
        if (Object.prototype.hasOwnProperty.call(payload, "note")) existing.note = payload.note;
        row = existing;
      } else {
        row = { id: payload.id || uid(), medicine_id: payload.medicine_id, date: payload.date, time: payload.time, taken, status, taken_at: takenAt, note: payload.note || "" };
        db.medicineLog.push(row);
      }
      if (taken !== wasTaken) adjustMockMedicineStock(payload.medicine_id, taken ? -1 : 1);
      return clone(row);
    }
    case "medicines.history": {
      const days = payload.days || 14;
      const cutoff = todayStr(-days);
      return { days, logs: clone(db.medicineLog.filter((l) => l.date >= cutoff)) };
    }
    case "medicinelog.list": {
      let rows = clone(db.medicineLog);
      if (payload.medicine_id) rows = rows.filter((l) => l.medicine_id === payload.medicine_id);
      return rows.sort((a, b) => b.date.localeCompare(a.date) || a.time.localeCompare(b.time));
    }

    case "packs.list":
      return clone(db.packs);
    case "packs.create": {
      requireFields(payload, ["name"]);
      const ids = Array.isArray(payload.member_medicine_ids) ? payload.member_medicine_ids.join(",") : (payload.member_medicine_ids || "");
      const row = { id: payload.id || uid(), name: "", times: "", ...payload, member_medicine_ids: ids, created_at: new Date().toISOString() };
      db.packs.push(row);
      return clone(row);
    }
    case "packs.update": {
      requireFields(payload, ["id"]);
      const fields = { ...payload };
      if (Array.isArray(fields.member_medicine_ids)) fields.member_medicine_ids = fields.member_medicine_ids.join(",");
      return upsertInto(db.packs, payload.id, fields);
    }
    case "packs.delete":
      requireFields(payload, ["id"]);
      return removeFrom(db.packs, payload.id);
    case "packs.tickAll": {
      requireFields(payload, ["id", "date", "time"]);
      const pack = db.packs.find((p) => p.id === payload.id);
      if (!pack) throw new Error("Not found: " + payload.id);
      const status = payload.status || "taken";
      const memberIds = String(pack.member_medicine_ids || "").split(",").map((s) => s.trim()).filter(Boolean);
      const logs = memberIds.map((medicineId) => mockCall("medicines.logTaken", { medicine_id: medicineId, date: payload.date, time: payload.time, status }));
      return Promise.all(logs).then((resolved) => ({ pack_id: payload.id, logs: resolved }));
    }

    case "checkins.list": {
      let rows = clone(db.checkins);
      if (payload.date_from) rows = rows.filter((r) => r.date >= payload.date_from);
      if (payload.date_to) rows = rows.filter((r) => r.date <= payload.date_to);
      return rows.sort((a, b) => (b.date + " " + b.time).localeCompare(a.date + " " + a.time));
    }
    case "checkins.create": {
      requireFields(payload, ["date", "mood"]);
      const row = { id: payload.id || uid(), time: todayTime(), note: "", ...payload, created_at: new Date().toISOString() };
      db.checkins.push(row);
      return clone(row);
    }
    case "checkins.delete":
      requireFields(payload, ["id"]);
      return removeFrom(db.checkins, payload.id);

    case "symptoms.list": {
      let rows = clone(db.symptoms);
      if (payload.date_from) rows = rows.filter((r) => r.date >= payload.date_from);
      if (payload.date_to) rows = rows.filter((r) => r.date <= payload.date_to);
      if (payload.symptom_key) rows = rows.filter((r) => r.symptom_key === payload.symptom_key);
      return rows.sort((a, b) => (b.date + " " + b.time).localeCompare(a.date + " " + a.time));
    }
    case "symptoms.create": {
      requireFields(payload, ["date", "symptom_key"]);
      const row = { id: payload.id || uid(), time: todayTime(), custom_name: "", severity: "", bleeding_scale: "", note: "", ...payload, created_at: new Date().toISOString() };
      db.symptoms.push(row);
      return clone(row);
    }
    case "symptoms.update": {
      requireFields(payload, ["id"]);
      const fields = {};
      if (Object.prototype.hasOwnProperty.call(payload, "note")) fields.note = payload.note;
      return upsertInto(db.symptoms, payload.id, fields);
    }
    case "symptoms.delete":
      requireFields(payload, ["id"]);
      return removeFrom(db.symptoms, payload.id);

    case "water.list": {
      let rows = clone(db.water);
      if (payload.date_from) rows = rows.filter((r) => r.date >= payload.date_from);
      if (payload.date_to) rows = rows.filter((r) => r.date <= payload.date_to);
      return rows;
    }
    case "water.add": {
      requireFields(payload, ["date"]);
      const row = { id: payload.id || uid(), time: todayTime(), glasses: 1, ...payload, created_at: new Date().toISOString() };
      db.water.push(row);
      return clone(row);
    }
    case "water.delete":
      requireFields(payload, ["id"]);
      return removeFrom(db.water, payload.id);

    case "foodprefs.list": {
      let rows = clone(db.foodPrefs);
      if (payload.status) rows = rows.filter((r) => r.status === payload.status);
      return rows;
    }
    case "foodprefs.create": {
      requireFields(payload, ["name", "status"]);
      const row = { id: payload.id || uid(), notes: "", ...payload, date: todayStr() };
      db.foodPrefs.push(row);
      return clone(row);
    }
    case "foodprefs.update": {
      requireFields(payload, ["id"]);
      const fields = { ...payload };
      if (fields.status) fields.date = todayStr();
      return upsertInto(db.foodPrefs, payload.id, fields);
    }
    case "foodprefs.delete":
      requireFields(payload, ["id"]);
      return removeFrom(db.foodPrefs, payload.id);

    case "notes.list": {
      let rows = clone(db.notes);
      if (payload.category) rows = rows.filter((n) => n.category === payload.category);
      if (payload.date_from) rows = rows.filter((n) => n.date >= payload.date_from);
      if (payload.date_to) rows = rows.filter((n) => n.date <= payload.date_to);
      return rows.sort((a, b) => (b.date + " " + b.time).localeCompare(a.date + " " + a.time));
    }
    case "notes.create": {
      requireFields(payload, ["date", "text"]);
      const row = { id: payload.id || uid(), time: todayTime(), category: "note", ...payload, created_at: new Date().toISOString() };
      db.notes.push(row);
      return clone(row);
    }
    case "notes.delete":
      requireFields(payload, ["id"]);
      return removeFrom(db.notes, payload.id);

    case "appointments.list":
      return clone(db.appointments);
    case "appointments.create": {
      requireFields(payload, ["datetime"]);
      const row = { id: payload.id || uid(), doctor: "", purpose: "", location: "", status: "upcoming", notes_after_visit: "", ...payload };
      db.appointments.push(row);
      return clone(row);
    }
    case "appointments.update":
      requireFields(payload, ["id"]);
      return upsertInto(db.appointments, payload.id, payload);
    case "appointments.delete":
      requireFields(payload, ["id"]);
      return removeFrom(db.appointments, payload.id);

    case "healthlog.list":
      return clone(db.healthlog);
    case "healthlog.create": {
      requireFields(payload, ["date"]);
      const row = { id: payload.id || uid(), weight_kg: "", bp_sys: "", bp_dia: "", sugar_fasting: "", sugar_pp: "", kicks: "", mood: "", symptoms: "", notes: "", ...payload };
      db.healthlog.push(row);
      return clone(row);
    }
    case "healthlog.update":
      requireFields(payload, ["id"]);
      return upsertInto(db.healthlog, payload.id, payload);
    case "healthlog.delete":
      requireFields(payload, ["id"]);
      return removeFrom(db.healthlog, payload.id);

    case "contacts.list":
      return clone(db.contacts);
    case "contacts.create": {
      requireFields(payload, ["name"]);
      const row = { id: payload.id || uid(), role: "", phone: "", address: "", maps_link: "", is_emergency: false, ...payload };
      db.contacts.push(row);
      return clone(row);
    }
    case "contacts.update":
      requireFields(payload, ["id"]);
      return upsertInto(db.contacts, payload.id, payload);
    case "contacts.delete":
      requireFields(payload, ["id"]);
      return removeFrom(db.contacts, payload.id);

    case "foodlog.list":
      return clone(db.foodlog);
    case "foodlog.create": {
      requireFields(payload, ["date", "meal"]);
      const row = { id: payload.id || uid(), items: "", craving_or_aversion: "", notes: "", ...payload };
      db.foodlog.push(row);
      return clone(row);
    }
    case "foodlog.update":
      requireFields(payload, ["id"]);
      return upsertInto(db.foodlog, payload.id, payload);
    case "foodlog.delete":
      requireFields(payload, ["id"]);
      return removeFrom(db.foodlog, payload.id);

    case "checklist.list":
      return payload.list ? clone(db.checklist.filter((c) => c.list === payload.list)) : clone(db.checklist);
    case "checklist.create": {
      requireFields(payload, ["list", "item"]);
      const row = { id: payload.id || uid(), done: false, ...payload };
      db.checklist.push(row);
      return clone(row);
    }
    case "checklist.update":
      requireFields(payload, ["id"]);
      return upsertInto(db.checklist, payload.id, payload);
    case "checklist.delete":
      requireFields(payload, ["id"]);
      return removeFrom(db.checklist, payload.id);

    case "files.list": {
      let rows = clone(db.files);
      if (payload.type) rows = rows.filter((f) => f.type === payload.type);
      if (payload.type_v2) rows = rows.filter((f) => f.type_v2 === payload.type_v2);
      if (payload.needs_sorting) rows = rows.filter((f) => !f.type_v2);
      if (payload.linked_booking_id) rows = rows.filter((f) => f.linked_booking_id === payload.linked_booking_id);
      if (payload.date_from) rows = rows.filter((f) => f.date >= payload.date_from);
      if (payload.date_to) rows = rows.filter((f) => f.date <= payload.date_to);
      return rows.sort((a, b) => b.date.localeCompare(a.date));
    }
    case "files.upload": {
      requireFields(payload, ["title", "type", "base64", "filename"]);
      const approxBytes = Math.floor((payload.base64.length * 3) / 4);
      if (approxBytes > 8 * 1024 * 1024) throw new Error("File is too large (max 8 MB). Please choose a smaller file.");
      const row = {
        id: payload.id || uid(),
        drive_file_id: "mock-drive-" + uid(),
        title: payload.title,
        type: payload.type,
        date: payload.date || "", // deliberately not defaulted to today — see filesUpload's backend comment
        doctor: payload.doctor || "",
        notes: payload.notes || "",
        type_v2: payload.type_v2 || "",
        linked_booking_id: payload.linked_booking_id || "",
        linked_file_ids: "",
        _base64: payload.base64,
        _mimeType: payload.mimeType || "application/octet-stream",
        _filename: payload.filename
      };
      db.files.push(row);
      const { _base64, _mimeType, _filename, ...publicRow } = row;
      return publicRow;
    }
    case "files.get": {
      requireFields(payload, ["id"]);
      const row = db.files.find((f) => f.id === payload.id);
      if (!row) throw new Error("File not found.");
      return { id: row.id, title: row.title, type: row.type, date: row.date, doctor: row.doctor, notes: row.notes, filename: row._filename, mimeType: row._mimeType, base64: row._base64 };
    }
    case "files.update":
      requireFields(payload, ["id"]);
      return upsertInto(db.files, payload.id, payload);
    case "files.delete":
      requireFields(payload, ["id"]);
      return removeFrom(db.files, payload.id);
    case "files.link": {
      requireFields(payload, ["id", "link_to_id"]);
      const a = db.files.find((f) => f.id === payload.id);
      const b = db.files.find((f) => f.id === payload.link_to_id);
      if (!a || !b) throw new Error("One of these records was not found.");
      const aLinks = String(a.linked_file_ids || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!aLinks.includes(payload.link_to_id)) aLinks.push(payload.link_to_id);
      const bLinks = String(b.linked_file_ids || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!bLinks.includes(payload.id)) bLinks.push(payload.id);
      a.linked_file_ids = aLinks.join(",");
      b.linked_file_ids = bLinks.join(",");
      return clone(a);
    }
    case "files.unlink": {
      requireFields(payload, ["id", "link_to_id"]);
      const a = db.files.find((f) => f.id === payload.id);
      const b = db.files.find((f) => f.id === payload.link_to_id);
      if (!a || !b) throw new Error("One of these records was not found.");
      a.linked_file_ids = String(a.linked_file_ids || "").split(",").map((s) => s.trim()).filter((id) => id && id !== payload.link_to_id).join(",");
      b.linked_file_ids = String(b.linked_file_ids || "").split(",").map((s) => s.trim()).filter((id) => id && id !== payload.id).join(",");
      return clone(a);
    }

    case "bookings.list": {
      let rows = clone(db.bookings);
      if (payload.type) rows = rows.filter((b) => b.type === payload.type);
      if (payload.status) rows = rows.filter((b) => b.status === payload.status);
      return rows.sort((a, b) => b.datetime.localeCompare(a.datetime));
    }
    case "bookings.create": {
      requireFields(payload, ["type", "title", "datetime"]);
      const now = new Date().toISOString();
      const row = {
        id: payload.id || uid(), provider: "", booked_via: "", location: "", notes: "", approx_report_days: "",
        status: "booked", booked_at: now, done_at: "", waiting_for_report_at: "", report_uploaded_at: "", closed_at: "",
        closed_without_prescription: false, no_prescription_note: "", questions: "", created_at: now,
        ...payload
      };
      db.bookings.push(row);
      return clone(row);
    }
    case "bookings.update": {
      requireFields(payload, ["id"]);
      const fields = { ...payload };
      const stampField = { done: "done_at", waiting_for_report: "waiting_for_report_at", report_uploaded: "report_uploaded_at", closed: "closed_at" }[payload.status];
      if (stampField) fields[stampField] = new Date().toISOString();
      return upsertInto(db.bookings, payload.id, fields);
    }
    case "bookings.delete":
      requireFields(payload, ["id"]);
      return removeFrom(db.bookings, payload.id);
    case "bookings.close": {
      requireFields(payload, ["id"]);
      const booking = db.bookings.find((b) => b.id === payload.id);
      if (!booking) throw new Error("Not found: " + payload.id);
      const linkedFiles = db.files.filter((f) => f.linked_booking_id === payload.id);
      if (booking.type === "doctor_visit") {
        const hasPrescription = linkedFiles.some((f) => f.type_v2 === "prescription");
        const note = payload.no_prescription_note !== undefined ? payload.no_prescription_note : booking.no_prescription_note;
        if (!hasPrescription && !String(note || "").trim()) {
          throw new Error('Closing a doctor visit needs either an uploaded prescription or a "No prescription this time" note.');
        }
        return upsertInto(db.bookings, payload.id, { status: "closed", closed_at: new Date().toISOString(), closed_without_prescription: !hasPrescription, no_prescription_note: hasPrescription ? "" : note });
      }
      if (booking.type === "scan" || booking.type === "blood_test") {
        const hasReport = linkedFiles.some((f) => f.type_v2 === "lab_report" || f.type_v2 === "scan_report");
        if (!hasReport) throw new Error("Closing a scan/blood test needs the report uploaded and linked first.");
      }
      return upsertInto(db.bookings, payload.id, { status: "closed", closed_at: new Date().toISOString() });
    }

    case "suggestions.list": {
      let rows = clone(db.suggestions);
      if (payload.booking_id) rows = rows.filter((s) => s.booking_id === payload.booking_id);
      if (payload.status) rows = rows.filter((s) => s.status === payload.status);
      return rows;
    }
    case "suggestions.create": {
      requireFields(payload, ["booking_id", "type", "text"]);
      const row = { id: payload.id || uid(), follow_up_date: "", status: "pending", created_at: new Date().toISOString(), ...payload };
      db.suggestions.push(row);
      return clone(row);
    }
    case "suggestions.update":
      requireFields(payload, ["id"]);
      return upsertInto(db.suggestions, payload.id, payload);
    case "suggestions.delete":
      requireFields(payload, ["id"]);
      return removeFrom(db.suggestions, payload.id);

    case "bills.list": {
      let rows = clone(db.bills);
      if (payload.booking_id) rows = rows.filter((b) => b.booking_id === payload.booking_id);
      if (payload.status) rows = rows.filter((b) => b.status === payload.status);
      return rows;
    }
    case "bills.create": {
      requireFields(payload, ["booking_id", "status"]);
      const row = { id: payload.id || uid(), amount: "", paid_on: "", receipt_file_id: "", notes: "", ...payload };
      db.bills.push(row);
      return clone(row);
    }
    case "bills.update":
      requireFields(payload, ["id"]);
      return upsertInto(db.bills, payload.id, payload);
    case "bills.delete":
      requireFields(payload, ["id"]);
      return removeFrom(db.bills, payload.id);

    case "countdowns.list": {
      let rows = clone(db.countdowns);
      if (payload.kind) rows = rows.filter((c) => c.kind === payload.kind);
      if (payload.show_on_home) rows = rows.filter((c) => !!c.show_on_home);
      return rows;
    }
    case "countdowns.add": {
      requireFields(payload, ["title", "kind"]);
      validateMockCountdown(payload, payload.kind);
      const row = {
        id: payload.id || uid(), target_datetime: "", start_date: "", repeat: "none", interval_hours: "",
        linked_medicine_id: "", show_on_home: false, pinned_order: 0, notes: "", done: false,
        ...payload, created_at: new Date().toISOString()
      };
      db.countdowns.push(row);
      return clone(row);
    }
    case "countdowns.update": {
      requireFields(payload, ["id"]);
      const existingCd = db.countdowns.find((c) => c.id === payload.id);
      validateMockCountdown({ ...existingCd, ...payload }, payload.kind || (existingCd && existingCd.kind));
      return upsertInto(db.countdowns, payload.id, payload);
    }
    case "countdowns.delete":
      requireFields(payload, ["id"]);
      return removeFrom(db.countdowns, payload.id);
    case "countdowns.markDone":
      requireFields(payload, ["id"]);
      return upsertInto(db.countdowns, payload.id, { done: payload.done === undefined ? true : !!payload.done });

    default:
      throw new Error("Mock backend: unknown action " + action);
  }
}
