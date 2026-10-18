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

export { ApiError, getPin, setPin, clearPin, hasPin, getApiUrl, setApiUrl, clearApiUrl, hasApiUrl } from "./api.js";

const MOCK_MODE_DEFAULT = true;
const MOCK_QUERY_PARAM = "mock";
const MOCK_STORAGE_KEY = "pct_mock";

// Mock mode is a frontend-only flag now (no config.js file at all, per the
// v2 security rules — nothing like an API URL should need to exist in a
// committed file). Defaults to on, like the old CONFIG.MOCK default, so a
// fresh clone still "just works" with sample data. Can be forced either way
// without editing source via ?mock=1 / ?mock=0 in the URL once — the choice
// is remembered in localStorage after that.
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
    // mode) — fall through to the default below.
  }
  return MOCK_MODE_DEFAULT;
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

export function startVersionPolling(onChanged) {
  if (isMockMode()) return; // nothing to poll — there's no server
  pollingOnChanged = onChanged;

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
    const { data_version } = await api.call("version.get", {});
    if (lastKnownVersion !== null && data_version !== lastKnownVersion) {
      lastKnownVersion = data_version;
      if (pollingOnChanged) pollingOnChanged(data_version);
    } else {
      lastKnownVersion = data_version;
    }
  } catch {
    // Offline or a slow network hiccup — just try again next cycle.
  }
}

// --- Mock fixture data ------------------------------------------------------
// Ported from the old js/mock.js. Will grow new entity support (and new
// fields like data_version) alongside the matching backend/Code.gs changes
// in later steps, rather than guessing ahead now.

function uid() {
  return "mock-" + Math.random().toString(36).slice(2, 10);
}

function todayStr(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + (offsetDays || 0));
  return d.toISOString().slice(0, 10);
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
    insurance_info: "",
    language: "en"
  },
  medicines: [
    { id: "mock-med-1", name: "Folic acid", dose: "5mg", frequency: "Once daily", times: "08:00", start_date: todayStr(-60), end_date: "", prescribed_by: "Dr. Rao", notes: "", active: true },
    { id: "mock-med-2", name: "Iron", dose: "1 tablet", frequency: "Once daily", times: "20:00", start_date: todayStr(-30), end_date: "", prescribed_by: "Dr. Rao", notes: "Take after food", active: true }
  ],
  medicineLog: [],
  appointments: [
    { id: "mock-appt-1", datetime: new Date(Date.now() + 5 * 86400000).toISOString(), doctor: "Dr. Rao", purpose: "Routine checkup", location: "City Women's Hospital", status: "upcoming", notes_after_visit: "" },
    { id: "mock-appt-2", datetime: new Date(Date.now() - 20 * 86400000).toISOString(), doctor: "Dr. Rao", purpose: "Anomaly scan", location: "City Women's Hospital", status: "done", notes_after_visit: "Everything looked normal." }
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
  foodlog: [],
  checklist: [
    { id: "mock-cl-1", list: "hospital_bag", item: "Phone charger", done: false },
    { id: "mock-cl-2", list: "hospital_bag", item: "Comfortable clothes", done: true },
    { id: "mock-cl-3", list: "documents", item: "ID proof", done: false },
    { id: "mock-cl-4", list: "baby_items", item: "Onesies", done: false }
  ],
  files: []
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
    case "settings.set":
      Object.assign(db.settings, payload);
      return clone(db.settings);

    case "dashboard.get":
      return mockDashboard();
    case "version.get":
      return { data_version: mockDataVersion };
    case "bootstrap":
      return {
        data_version: mockDataVersion,
        settings: clone(db.settings),
        dashboard: mockDashboard(),
        medicines: clone(db.medicines),
        appointments: clone(db.appointments),
        healthlog: clone(db.healthlog),
        contacts: clone(db.contacts),
        foodlog: clone(db.foodlog),
        checklist: clone(db.checklist),
        files: clone(db.files).map(({ _base64, _mimeType, _filename, ...rest }) => rest)
      };

    case "medicines.list":
      return clone(db.medicines);
    case "medicines.create": {
      requireFields(payload, ["name"]);
      const row = { id: payload.id || uid(), name: "", dose: "", frequency: "", times: "", start_date: todayStr(), end_date: "", prescribed_by: "", notes: "", active: true, ...payload };
      db.medicines.push(row);
      return clone(row);
    }
    case "medicines.update":
      requireFields(payload, ["id"]);
      return upsertInto(db.medicines, payload.id, payload);
    case "medicines.delete":
      requireFields(payload, ["id"]);
      return removeFrom(db.medicines, payload.id);
    case "medicines.logTaken": {
      requireFields(payload, ["medicine_id", "date", "time"]);
      const taken = payload.taken === undefined ? true : !!payload.taken;
      const existing = db.medicineLog.find((l) => l.medicine_id === payload.medicine_id && l.date === payload.date && l.time === payload.time);
      if (existing) { existing.taken = taken; return clone(existing); }
      const row = { id: payload.id || uid(), medicine_id: payload.medicine_id, date: payload.date, time: payload.time, taken };
      db.medicineLog.push(row);
      return clone(row);
    }
    case "medicines.history": {
      const days = payload.days || 14;
      const cutoff = todayStr(-days);
      return { days, logs: clone(db.medicineLog.filter((l) => l.date >= cutoff)) };
    }

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
        date: payload.date || todayStr(),
        doctor: payload.doctor || "",
        notes: payload.notes || "",
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
    case "files.delete":
      requireFields(payload, ["id"]);
      return removeFrom(db.files, payload.id);

    default:
      throw new Error("Mock backend: unknown action " + action);
  }
}
