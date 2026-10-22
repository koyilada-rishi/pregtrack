/**
 * Pregnancy Care Tracker — Apps Script backend.
 *
 * Run setup() once from the Apps Script editor (not via the web app) to
 * create the Sheet, its tabs, and the Drive folder tree, and to store their
 * IDs in Script Properties. Then add the APP_PIN script property by hand
 * (Project Settings > Script properties) before deploying as a web app.
 * See the README for full step-by-step deploy instructions.
 *
 * body shape: {pin, action, payload}. Every action requires a valid pin.
 *
 * v2 additions (data_version freshness tracking, bootstrap, thumbnails):
 * every mutating action bumps a `data_version` counter (Settings tab +
 * CacheService, kept in sync — see "Data version" below), so the frontend
 * can poll the cheap version.get action and only refetch when something
 * actually changed. bootstrap() returns every tab in one call for the
 * initial app load. The CRUD actions for medicines/appointments/healthlog/
 * contacts/foodlog/checklist/files below predate this v2 pass (carried
 * over as-is from v1) — see DEVELOPMENT.md for the full history.
 */

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

function doPost(e) {
  return handleRequest(e);
}

function doGet(e) {
  return jsonResponse({ ok: false, error: 'This API only accepts POST requests.' });
}

function handleRequest(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: 'Missing request body.' });
    }

    var body = JSON.parse(e.postData.contents);
    var pin = body.pin;
    var action = body.action;
    var payload = body.payload || {};

    if (isLockedOut()) {
      return jsonResponse({ ok: false, error: 'Too many incorrect attempts. Try again in 15 minutes.' });
    }

    if (!checkPin(pin)) {
      recordFailedAttempt();
      return jsonResponse({ ok: false, error: 'Incorrect PIN.' });
    }
    recordSuccessfulAuth();

    var data = routeAction(action, payload);
    return jsonResponse({ ok: true, data: data });
  } catch (err) {
    return jsonResponse({ ok: false, error: String((err && err.message) || err) });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// Action routing
// ---------------------------------------------------------------------------

function routeAction(action, payload) {
  switch (action) {
    case 'auth.check':
      return { authenticated: true };
    case 'settings.get':
      return settingsGet();
    case 'settings.set':
      return settingsSet(payload);
    case 'dashboard.get':
      return dashboardGet();
    case 'version.get':
      return { data_version: getDataVersion(), backend_version: BACKEND_VERSION };
    case 'bootstrap':
      return bootstrap();

    case 'medicines.list':
      return listRows('Medicines');
    case 'medicines.create':
      return medicinesCreate(payload);
    case 'medicines.update':
      return medicinesUpdate(payload);
    case 'medicines.delete':
      return medicinesDelete(payload);
    case 'medicines.logTaken':
      return medicinesLogTaken(payload);
    case 'medicines.history':
      return medicinesHistory(payload);
    case 'medicines.stop':
      return medicinesStop(payload);

    case 'medicinelog.list':
      return medicineLogList(payload);

    case 'packs.list':
      return listRows('Packs');
    case 'packs.create':
      return packsCreate(payload);
    case 'packs.update':
      return packsUpdate(payload);
    case 'packs.delete':
      return packsDelete(payload);
    case 'packs.tickAll':
      return packsTickAll(payload);

    case 'checkins.list':
      return checkinsList(payload);
    case 'checkins.create':
      return checkinsCreate(payload);
    case 'checkins.delete':
      return checkinsDelete(payload);

    case 'symptoms.list':
      return symptomsList(payload);
    case 'symptoms.create':
      return symptomsCreate(payload);
    case 'symptoms.update':
      return symptomsUpdate(payload);
    case 'symptoms.delete':
      return symptomsDelete(payload);

    case 'water.list':
      return waterList(payload);
    case 'water.add':
      return waterAdd(payload);
    case 'water.delete':
      return waterDelete(payload);

    case 'foodprefs.list':
      return foodprefsList(payload);
    case 'foodprefs.create':
      return foodprefsCreate(payload);
    case 'foodprefs.update':
      return foodprefsUpdate(payload);
    case 'foodprefs.delete':
      return foodprefsDelete(payload);

    case 'notes.update':
      return notesUpdate(payload);
    case 'notes.list':
      return notesList(payload);
    case 'notes.create':
      return notesCreate(payload);
    case 'notes.delete':
      return notesDelete(payload);

    case 'appointments.list':
      return listRows('Appointments');
    case 'appointments.create':
      return appointmentsCreate(payload);
    case 'appointments.update':
      return appointmentsUpdate(payload);
    case 'appointments.delete':
      return appointmentsDelete(payload);

    case 'healthlog.list':
      return listRows('HealthLog');
    case 'healthlog.create':
      return healthlogCreate(payload);
    case 'healthlog.update':
      return healthlogUpdate(payload);
    case 'healthlog.delete':
      return healthlogDelete(payload);

    case 'contacts.list':
      return listRows('Contacts');
    case 'contacts.create':
      return contactsCreate(payload);
    case 'contacts.update':
      return contactsUpdate(payload);
    case 'contacts.delete':
      return contactsDelete(payload);

    case 'doctors.list':
      return listRows('Doctors');
    case 'doctors.create':
      return doctorsCreate(payload);
    case 'doctors.update':
      return doctorsUpdate(payload);
    case 'doctors.delete':
      return doctorsDelete(payload);

    case 'episodes.list':
      return listRows('Episodes');
    case 'episodes.create':
      return episodesCreate(payload);
    case 'episodes.update':
      return episodesUpdate(payload);
    case 'episodes.delete':
      return episodesDelete(payload);

    case 'foodlog.list':
      return listRows('FoodLog');
    case 'foodlog.create':
      return foodlogCreate(payload);
    case 'foodlog.update':
      return foodlogUpdate(payload);
    case 'foodlog.delete':
      return foodlogDelete(payload);

    case 'checklist.list':
      return checklistList(payload);
    case 'checklist.create':
      return checklistCreate(payload);
    case 'checklist.update':
      return checklistUpdate(payload);
    case 'checklist.delete':
      return checklistDelete(payload);

    case 'files.list':
      return filesList(payload);
    case 'files.upload':
      return filesUpload(payload);
    case 'files.get':
      return filesGet(payload);
    case 'files.update':
      return filesUpdate(payload);
    case 'files.delete':
      return filesDelete(payload);
    case 'files.link':
      return filesLink(payload);
    case 'files.unlink':
      return filesUnlink(payload);

    case 'bookings.list':
      return bookingsList(payload);
    case 'bookings.create':
      return bookingsCreate(payload);
    case 'bookings.update':
      return bookingsUpdate(payload);
    case 'bookings.delete':
      return bookingsDelete(payload);
    case 'bookings.close':
      return bookingsClose(payload);

    case 'suggestions.list':
      return suggestionsList(payload);
    case 'suggestions.create':
      return suggestionsCreate(payload);
    case 'suggestions.update':
      return suggestionsUpdate(payload);
    case 'suggestions.delete':
      return suggestionsDelete(payload);

    case 'bills.list':
      return billsList(payload);
    case 'bills.create':
      return billsCreate(payload);
    case 'bills.update':
      return billsUpdate(payload);
    case 'bills.delete':
      return billsDelete(payload);

    case 'countdowns.list':
      return countdownsList(payload);
    case 'countdowns.add':
      return countdownsAdd(payload);
    case 'countdowns.update':
      return countdownsUpdate(payload);
    case 'countdowns.delete':
      return countdownsDelete(payload);
    case 'countdowns.markDone':
      return countdownsMarkDone(payload);

    default:
      throw new Error('Unknown action: ' + action);
  }
}

// ---------------------------------------------------------------------------
// Auth: constant-time PIN compare + CacheService-based lockout
// ---------------------------------------------------------------------------

var CACHE_KEY_FAIL_COUNT = 'auth_fail_count';
var CACHE_KEY_LOCKOUT_UNTIL = 'auth_lockout_until';
var FAIL_WINDOW_SECONDS = 600; // 10 minutes
var LOCKOUT_SECONDS = 900; // 15 minutes
var MAX_FAILED_ATTEMPTS = 5;

function checkPin(pin) {
  var expected = PropertiesService.getScriptProperties().getProperty('APP_PIN');
  if (!expected) {
    throw new Error('APP_PIN is not set. Add it in Project Settings > Script properties.');
  }
  return constantTimeEquals(String(pin || ''), expected);
}

// Compares two strings via their SHA-256 digests, XOR-ing every byte without
// short-circuiting, so the comparison time does not leak how much of the PIN
// matched. (Digest computation time scales with input length, but PIN
// lengths vary by at most a couple of characters, so the leak is negligible.)
function constantTimeEquals(a, b) {
  var digestA = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.newBlob(a).getBytes());
  var digestB = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.newBlob(b).getBytes());
  var diff = 0;
  for (var i = 0; i < digestA.length; i++) {
    diff |= digestA[i] ^ digestB[i];
  }
  return diff === 0;
}

function isLockedOut() {
  var cache = CacheService.getScriptCache();
  var lockoutUntil = cache.get(CACHE_KEY_LOCKOUT_UNTIL);
  return !!lockoutUntil && Number(lockoutUntil) > Date.now();
}

function recordFailedAttempt() {
  var cache = CacheService.getScriptCache();
  var count = Number(cache.get(CACHE_KEY_FAIL_COUNT) || '0') + 1;
  cache.put(CACHE_KEY_FAIL_COUNT, String(count), FAIL_WINDOW_SECONDS);
  if (count >= MAX_FAILED_ATTEMPTS) {
    cache.put(CACHE_KEY_LOCKOUT_UNTIL, String(Date.now() + LOCKOUT_SECONDS * 1000), LOCKOUT_SECONDS);
    cache.remove(CACHE_KEY_FAIL_COUNT);
  }
}

function recordSuccessfulAuth() {
  var cache = CacheService.getScriptCache();
  cache.remove(CACHE_KEY_FAIL_COUNT);
  cache.remove(CACHE_KEY_LOCKOUT_UNTIL);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

var SETTINGS_KEYS = [
  'due_date', 'lmp_date', 'wife_name', 'blood_group', 'allergies',
  'hospital_name', 'hospital_phone', 'hospital_address', 'language',
  // Dating method: 'lmp' (default — due_date/lmp_date entered directly, as
  // before) or 'usg' (a scan's reported gestational age on a given date;
  // due_date/lmp_date are then back-computed and overwritten by
  // settingsSet() below, never entered by hand). usg_days is 0-6.
  'dating_method', 'usg_date', 'usg_weeks', 'usg_days',
  'water_goal_glasses', // Phase 2 — defaults to 8 client-side when blank, see js/app.js
  // Phase 4 — global on/off switches for the optional medicine-detail
  // fields (photos/ingredients/expiry), and the expiry alert window
  // (defaults to 30 days client-side when blank).
  'photos_enabled', 'ingredients_enabled', 'expiry_tracking_enabled', 'expiry_alert_days',
  // Stage: MamaCare Today — kick counter is off by default (a plain tap
  // counter, not a timed-interval kick-count session; she turns it on here
  // if she wants it at all).
  'kick_counter_enabled'
];

function settingsGet() {
  var result = {};
  SETTINGS_KEYS.forEach(function (key) { result[key] = ''; });
  sheetToObjects('Settings').forEach(function (row) {
    if (SETTINGS_KEYS.indexOf(row.key) !== -1) {
      result[row.key] = row.value === undefined || row.value === null ? '' : row.value;
    }
  });
  return result;
}

var DATING_METHODS = ['lmp', 'usg'];

function settingsSet(payload) {
  if (payload.hasOwnProperty('dating_method')) validateEnum(payload.dating_method, DATING_METHODS, 'dating_method');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheetByName('Settings');
    var values = sheet.getDataRange().getValues();
    var rowOfKey = {};
    for (var i = 1; i < values.length; i++) {
      rowOfKey[values[i][0]] = i + 1; // 1-based sheet row number
    }

    // Effective settings after this write (existing stored values,
    // overridden by whatever this payload actually sends) — used only to
    // decide the USG back-calculation below, not written directly.
    var effective = {};
    SETTINGS_KEYS.forEach(function (key) {
      var row = rowOfKey[key];
      effective[key] = payload.hasOwnProperty(key) ? payload[key] : (row ? values[row - 1][1] : '');
    });

    // USG dating: back-compute due_date/lmp_date from the scan's reported
    // gestational age instead of taking them directly — this overwrites
    // whatever due_date/lmp_date already held, the same way choosing
    // dating_method: 'lmp' instead just leaves them as entered by hand.
    // Recomputed on every settingsSet() call (not just when the USG fields
    // themselves change) so an unrelated save never leaves them stale.
    if (effective.dating_method === 'usg' && effective.usg_date) {
      var usgDate = parseISODate(dateStrOf(effective.usg_date));
      var gaDays = (Number(effective.usg_weeks) || 0) * 7 + (Number(effective.usg_days) || 0);
      if (usgDate && gaDays > 0) {
        var effectiveLmp = new Date(usgDate.getTime());
        effectiveLmp.setDate(effectiveLmp.getDate() - gaDays);
        var dueDate = new Date(effectiveLmp.getTime());
        dueDate.setDate(dueDate.getDate() + 280);
        payload.lmp_date = formatISODate(effectiveLmp);
        payload.due_date = formatISODate(dueDate);
      }
    }

    SETTINGS_KEYS.forEach(function (key) {
      if (!payload.hasOwnProperty(key)) return;
      var value = sanitizeText(payload[key], 2000);
      if (rowOfKey[key]) {
        sheet.getRange(rowOfKey[key], 2).setValue(value);
      } else {
        sheet.appendRow([key, value]);
      }
    });
    incrementDataVersion();
  } finally {
    lock.releaseLock();
  }
  return settingsGet();
}

// ---------------------------------------------------------------------------
// Data version — a counter bumped on every write (see incrementDataVersion,
// called from inside every mutating action's existing LockService lock), so
// the frontend can poll the cheap version.get action instead of refetching
// everything on a timer. Kept in both the Settings sheet (durable, and the
// schema explicitly lists it as a Settings key) and CacheService (fast
// reads — version.get should never need to open the Spreadsheet at all in
// the common case).
// ---------------------------------------------------------------------------

var DATA_VERSION_CACHE_KEY = 'data_version';
var DATA_VERSION_CACHE_TTL_SECONDS = 21600; // 6 hours — CacheService's max

// Backend code version — distinct from data_version above (that one tracks
// content changes; this one tracks Code.gs itself). Bump this integer by 1
// every time Code.gs changes in a way that needs a redeploy, and bump
// REQUIRED_BACKEND_VERSION in js/defaults.js to match in the same commit.
// version.get returns both; js/store.js compares this one against what the
// frontend was built expecting and shows a "the backend needs updating"
// banner instead of letting things fail in confusing, unrelated-looking
// ways against a backend that predates whatever Code.gs change the banner
// is there to catch.
var BACKEND_VERSION = 1;

function getDataVersion() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(DATA_VERSION_CACHE_KEY);
  if (cached !== null) return Number(cached);

  // Cold cache (first call since a cache eviction/expiry) — fall back to
  // the sheet once, then repopulate the cache for next time.
  var version = readDataVersionFromSheet();
  cache.put(DATA_VERSION_CACHE_KEY, String(version), DATA_VERSION_CACHE_TTL_SECONDS);
  return version;
}

function readDataVersionFromSheet() {
  var row = sheetToObjects('Settings').find(function (r) { return r.key === 'data_version'; });
  return row ? Number(row.value) || 0 : 0;
}

// Must be called from inside a LockService lock already held by the caller
// (every mutating action acquires one) — it does not acquire its own, since
// the whole point is to bump the counter atomically with the write that
// triggered it, under the same lock.
function incrementDataVersion() {
  var sheet = getSheetByName('Settings');
  var values = sheet.getDataRange().getValues();
  var rowNum = -1;
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === 'data_version') { rowNum = i + 1; break; }
  }
  var current = rowNum === -1 ? 0 : (Number(values[rowNum - 1][1]) || 0);
  var next = current + 1;
  if (rowNum === -1) {
    sheet.appendRow(['data_version', next]);
  } else {
    sheet.getRange(rowNum, 2).setValue(next);
  }
  CacheService.getScriptCache().put(DATA_VERSION_CACHE_KEY, String(next), DATA_VERSION_CACHE_TTL_SECONDS);
  return next;
}

// ---------------------------------------------------------------------------
// Bootstrap — everything the app needs for its initial load, in one call,
// to cut the round-trip latency of fetching each tab separately. MedicineLog
// is deliberately left out: it's not needed for the first paint (Home,
// nav), can grow large over months, and the Meds view fetches its own
// medicines.history on demand.
// ---------------------------------------------------------------------------

function bootstrap() {
  // Safe, additive schema migration on every bootstrap call, so a redeploy
  // (new Code.gs, same Sheet) upgrades automatically without re-running
  // setup() by hand. Cheap in the steady state (no missing tabs/columns to
  // add): a handful of header-row reads, no writes. See "Schema migration".
  ensureTabs();

  return {
    data_version: getDataVersion(),
    backend_version: BACKEND_VERSION,
    settings: settingsGet(),
    dashboard: dashboardGet(),
    medicines: listRows('Medicines'),
    appointments: listRows('Appointments'),
    healthlog: listRows('HealthLog'),
    contacts: listRows('Contacts'),
    foodlog: listRows('FoodLog'),
    checklist: listRows('Checklist'),
    files: filesList({}),
    countdowns: listRows('Countdowns'),
    packs: listRows('Packs'),
    // Most recent *taken* dose per medicine — enough for the frontend to
    // compute "next dose" for interval-kind countdowns pinned to Home,
    // without shipping the full MedicineLog on every load.
    latest_medicine_doses: getLatestMedicineDoses()
  };
}

function getLatestMedicineDoses() {
  var latestByMedicine = {};
  sheetToObjects('MedicineLog').forEach(function (log) {
    if (!isTruthy(log.taken)) return;
    var sortKey = dateStrOf(log.date) + ' ' + normalizeTimeForSort(log.time);
    var current = latestByMedicine[log.medicine_id];
    if (!current || sortKey > current._sortKey) {
      latestByMedicine[log.medicine_id] = { medicine_id: log.medicine_id, date: dateStrOf(log.date), time: log.time, _sortKey: sortKey };
    }
  });
  return Object.keys(latestByMedicine).map(function (medicineId) {
    var entry = latestByMedicine[medicineId];
    return { medicine_id: entry.medicine_id, date: entry.date, time: entry.time };
  });
}

// "9:00" and "09:00" must sort identically to "09:00" — a plain string
// comparison of unpadded hours (e.g. "9:00" vs "10:00") sorts wrong.
function normalizeTimeForSort(timeStr) {
  var match = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || '').trim());
  if (!match) return String(timeStr || '');
  return (match[1].length === 1 ? '0' + match[1] : match[1]) + ':' + match[2];
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function dashboardGet() {
  var settings = settingsGet();
  var today = new Date();
  var gestationalAge = computeGestationalAge(settings, today);

  return {
    due_date: settings.due_date || '',
    lmp_date: settings.lmp_date || '',
    gestational_age: gestationalAge, // {weeks, days, trimester, days_left} or null
    next_appointment: getNextAppointment(today),
    today_medicines: getTodayPendingMedicines(today),
    latest_vitals: getLatestVitals()
  };
}

function computeGestationalAge(settings, today) {
  var due = parseISODate(settings.due_date);
  var lmp = parseISODate(settings.lmp_date);
  if (!lmp && due) {
    lmp = new Date(due.getTime());
    lmp.setDate(lmp.getDate() - 280); // 40 weeks before the due date
  }
  if (!lmp) return null;

  var daysSinceLmp = daysBetween(lmp, today);
  if (daysSinceLmp < 0) daysSinceLmp = 0;

  return {
    weeks: Math.floor(daysSinceLmp / 7),
    days: daysSinceLmp % 7,
    trimester: daysSinceLmp < 13 * 7 ? 1 : (daysSinceLmp < 28 * 7 ? 2 : 3),
    days_left: due ? daysBetween(today, due) : null
  };
}

// Bug fix (dashboard rebuild follow-up): this used to only look at the
// legacy Appointments sheet, so a booking made through the Bookings flow
// (the one actually used everywhere now — Episodes, the booking form,
// etc.) never showed up here at all. Now checks both and returns
// whichever is soonest. A 'rescheduled' booking's own datetime is stale
// by definition — its tentative_date is what actually matters now.
function getNextAppointment(today) {
  var fromAppointments = sheetToObjects('Appointments')
    .filter(function (row) {
      var status = String(row.status || '').toLowerCase();
      if (status === 'done' || status === 'missed') return false;
      var dt = toDateTime(row.datetime);
      return dt && dt.getTime() >= today.getTime();
    })
    .map(function (row) {
      return {
        id: row.id, datetime: toDateTime(row.datetime).toISOString(),
        doctor: row.doctor || '', purpose: row.purpose || '', location: row.location || ''
      };
    });

  var bookingDoneStatuses = ['done', 'waiting_for_report', 'report_uploaded', 'closed', 'cancelled'];
  var fromBookings = sheetToObjects('Bookings')
    .filter(function (row) { return bookingDoneStatuses.indexOf(row.status) === -1; })
    .map(function (row) {
      var effectiveDt = (row.status === 'rescheduled' && row.tentative_date) ? row.tentative_date : row.datetime;
      return { id: row.id, datetime: toDateTime(effectiveDt), raw: row };
    })
    .filter(function (row) { return row.datetime && row.datetime.getTime() >= today.getTime(); })
    .map(function (row) {
      return {
        id: row.id, datetime: row.datetime.toISOString(),
        doctor: row.raw.provider || '', purpose: row.raw.title || '', location: row.raw.location || ''
      };
    });

  var upcoming = fromAppointments.concat(fromBookings);
  upcoming.sort(function (a, b) { return new Date(a.datetime) - new Date(b.datetime); });
  return upcoming.length ? upcoming[0] : null;
}

function getTodayPendingMedicines(today) {
  var todayStr = dateStrOf(today);

  var activeToday = sheetToObjects('Medicines').filter(function (m) {
    if (!isTruthy(m.active)) return false;
    var start = dateStrOf(m.start_date);
    var end = dateStrOf(m.end_date);
    if (start && start > todayStr) return false;
    if (end && end < todayStr) return false;
    return true;
  });

  var takenToday = {};
  sheetToObjects('MedicineLog').forEach(function (log) {
    if (dateStrOf(log.date) !== todayStr) return;
    if (isTruthy(log.taken)) takenToday[log.medicine_id + '|' + log.time] = true;
  });

  var pending = [];
  activeToday.forEach(function (m) {
    var times = String(m.times || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    times.forEach(function (time) {
      if (!takenToday[m.id + '|' + time]) {
        pending.push({ medicine_id: m.id, name: m.name, dose: m.dose, time: time });
      }
    });
  });
  pending.sort(function (a, b) { return a.time.localeCompare(b.time); });
  return pending;
}

function getLatestVitals() {
  var rows = sheetToObjects('HealthLog');
  if (rows.length === 0) return null;
  rows.sort(function (a, b) { return dateStrOf(b.date).localeCompare(dateStrOf(a.date)); });
  var latest = rows[0];
  return {
    date: dateStrOf(latest.date),
    weight_kg: latest.weight_kg,
    bp_sys: latest.bp_sys,
    bp_dia: latest.bp_dia,
    sugar_fasting: latest.sugar_fasting,
    sugar_pp: latest.sugar_pp,
    kicks: latest.kicks,
    mood: latest.mood
  };
}

function isTruthy(value) {
  return value === true || String(value).toUpperCase() === 'TRUE';
}

// ---------------------------------------------------------------------------
// Medicines + MedicineLog
// ---------------------------------------------------------------------------

var MEDICINE_SCHEDULE_TYPES = ['daily', 'interval', 'weekdays', 'every_n_days', 'weekly', 'monthly', 'prn'];
var MEDICINE_ANCHOR_MODES = ['fixed', 'from_last'];
var MEDICINE_INSTRUCTIONS = ['before_food', 'after_food', 'with_food', 'empty_stomach', 'bedtime', 'none'];
var MEDICINE_STATUSES = ['active', 'finished', 'stopped'];
// 'pending' is a deliberate "cleared, not yet decided" state distinct from
// no row at all — it's what the tick circle writes when you untick a dose
// that was marked taken, so untapping never silently records it as
// skipped. See js/app.js's nextTickStatus() for the full tap cycle.
var MEDICINE_LOG_STATUSES = ['taken', 'skipped', 'missed', 'pending'];

function validateEnum(value, allowed, fieldName) {
  if (value !== undefined && value !== '' && allowed.indexOf(value) === -1) {
    throw new Error('Invalid ' + fieldName + ': ' + value);
  }
}

function medicinesCreate(payload) {
  requireFields(payload, ['name']);
  return createRow('Medicines', medicineFields(payload, true));
}

function medicinesUpdate(payload) {
  requireId(payload);
  return updateRowById('Medicines', payload.id, medicineFields(payload, false));
}

function medicinesDelete(payload) {
  requireId(payload);
  return deleteRowById('Medicines', payload.id);
}

function medicineFields(payload, isCreate) {
  var fields = {};
  if (isCreate || payload.hasOwnProperty('name')) fields.name = sanitizeText(payload.name, 200);
  if (isCreate || payload.hasOwnProperty('dose')) fields.dose = sanitizeText(payload.dose, 100);
  if (isCreate || payload.hasOwnProperty('frequency')) fields.frequency = sanitizeText(payload.frequency, 100);
  if (isCreate || payload.hasOwnProperty('times')) fields.times = sanitizeText(payload.times, 200);
  if (isCreate || payload.hasOwnProperty('start_date')) {
    fields.start_date = sanitizeDate(payload.start_date || formatISODate(new Date()), 'start_date');
  }
  if (isCreate || payload.hasOwnProperty('end_date')) {
    fields.end_date = payload.end_date ? sanitizeDate(payload.end_date, 'end_date') : '';
  }
  if (isCreate || payload.hasOwnProperty('prescribed_by')) fields.prescribed_by = sanitizeText(payload.prescribed_by, 200);
  if (isCreate || payload.hasOwnProperty('notes')) fields.notes = sanitizeText(payload.notes, 2000);
  if (isCreate) {
    fields.active = payload.active === undefined ? true : sanitizeBoolean(payload.active);
  } else if (payload.hasOwnProperty('active')) {
    fields.active = sanitizeBoolean(payload.active);
  }
  // Stock tracking — all optional (sanitizeNumber leaves '' as '' rather
  // than erroring); a medicine with no stock_count just never shows a
  // "days of stock left" figure (see countdown.js's computeStock()).
  if (isCreate || payload.hasOwnProperty('stock_count')) {
    fields.stock_count = sanitizeNumber(payload.stock_count, 'stock_count');
  }
  if (isCreate || payload.hasOwnProperty('doses_per_day')) {
    fields.doses_per_day = sanitizeNumber(payload.doses_per_day, 'doses_per_day');
  }
  if (isCreate) {
    fields.refill_alert_days = (payload.refill_alert_days === undefined || payload.refill_alert_days === '')
      ? 3
      : sanitizeNumber(payload.refill_alert_days, 'refill_alert_days');
  } else if (payload.hasOwnProperty('refill_alert_days')) {
    var value = sanitizeNumber(payload.refill_alert_days, 'refill_alert_days');
    fields.refill_alert_days = value === '' ? 3 : value; // never leave it blank once set
  }

  // --- Phase 1 (v3) scheduling model — see js/schedule.js for the engine
  // that actually interprets these. A blank schedule_type means "old row,
  // treat as daily using times/frequency above" — enforced client-side,
  // not here, so nothing needs backfilling.
  if (isCreate || payload.hasOwnProperty('schedule_type')) {
    var scheduleType = payload.schedule_type || 'daily';
    validateEnum(scheduleType, MEDICINE_SCHEDULE_TYPES, 'schedule_type');
    fields.schedule_type = scheduleType;
  }
  if (isCreate || payload.hasOwnProperty('anchor_mode')) {
    var anchorMode = payload.anchor_mode || 'fixed';
    validateEnum(anchorMode, MEDICINE_ANCHOR_MODES, 'anchor_mode');
    fields.anchor_mode = anchorMode;
  }
  if (isCreate || payload.hasOwnProperty('weekdays')) fields.weekdays = sanitizeText(payload.weekdays, 50); // e.g. "mon,thu"
  if (isCreate || payload.hasOwnProperty('interval_hours')) fields.interval_hours = sanitizeNumber(payload.interval_hours, 'interval_hours');
  if (isCreate || payload.hasOwnProperty('interval_days')) fields.interval_days = sanitizeNumber(payload.interval_days, 'interval_days');
  if (isCreate || payload.hasOwnProperty('month_day')) fields.month_day = sanitizeNumber(payload.month_day, 'month_day');
  if (isCreate || payload.hasOwnProperty('every_n_weeks')) fields.every_n_weeks = sanitizeNumber(payload.every_n_weeks, 'every_n_weeks');
  if (isCreate || payload.hasOwnProperty('total_doses')) fields.total_doses = sanitizeNumber(payload.total_doses, 'total_doses');
  if (isCreate) {
    fields.grace_minutes = (payload.grace_minutes === undefined || payload.grace_minutes === '')
      ? 60
      : sanitizeNumber(payload.grace_minutes, 'grace_minutes');
  } else if (payload.hasOwnProperty('grace_minutes')) {
    var graceMinutes = sanitizeNumber(payload.grace_minutes, 'grace_minutes');
    fields.grace_minutes = graceMinutes === '' ? 60 : graceMinutes;
  }
  if (isCreate || payload.hasOwnProperty('instructions')) {
    var instructions = payload.instructions || 'none';
    validateEnum(instructions, MEDICINE_INSTRUCTIONS, 'instructions');
    fields.instructions = instructions;
  }
  if (isCreate || payload.hasOwnProperty('prn_min_gap_hours')) fields.prn_min_gap_hours = sanitizeNumber(payload.prn_min_gap_hours, 'prn_min_gap_hours');
  if (isCreate || payload.hasOwnProperty('prn_max_per_day')) fields.prn_max_per_day = sanitizeNumber(payload.prn_max_per_day, 'prn_max_per_day');
  // phases: optional free-form JSON for future tapering-schedule UI — stored
  // as-is, not parsed or validated server-side (the engine ignores it today).
  if (isCreate || payload.hasOwnProperty('phases')) fields.phases = sanitizeText(payload.phases, 4000);
  if (isCreate || payload.hasOwnProperty('reason')) fields.reason = sanitizeText(payload.reason, 500);
  if (isCreate || payload.hasOwnProperty('pack_id')) fields.pack_id = sanitizeText(payload.pack_id, 100);
  if (isCreate || payload.hasOwnProperty('source')) fields.source = sanitizeText(payload.source, 200);

  // --- Phase 4 (v3): optional detail fields, all switchable off globally ---
  if (isCreate || payload.hasOwnProperty('photo_front_file_id')) fields.photo_front_file_id = sanitizeText(payload.photo_front_file_id, 100);
  if (isCreate || payload.hasOwnProperty('photo_back_file_id')) fields.photo_back_file_id = sanitizeText(payload.photo_back_file_id, 100);
  if (isCreate || payload.hasOwnProperty('composition')) fields.composition = sanitizeText(payload.composition, 500);
  if (isCreate || payload.hasOwnProperty('brand')) fields.brand = sanitizeText(payload.brand, 200);
  if (isCreate || payload.hasOwnProperty('strength')) fields.strength = sanitizeText(payload.strength, 100);
  if (isCreate || payload.hasOwnProperty('expiry_date')) fields.expiry_date = payload.expiry_date ? sanitizeDate(payload.expiry_date, 'expiry_date') : '';

  // Which Records (prescription that started it, bill for it, etc.) this
  // medicine is linked to — comma-joined Files ids, same shape as Files'
  // own linked_file_ids, but one-directional (Medicines -> Files only).
  // A reverse view ("medicines from this prescription") is computed live by
  // filtering medicines.list for this file's id rather than mirrored back
  // onto the Files row, so the two can never drift out of sync with each
  // other the way a hand-kept two-sided link could.
  if (isCreate || payload.hasOwnProperty('linked_file_ids')) fields.linked_file_ids = sanitizeText(payload.linked_file_ids, 2000);

  if (isCreate) {
    var initialStatus = payload.status || 'active';
    validateEnum(initialStatus, MEDICINE_STATUSES, 'status');
    fields.status = initialStatus;
  } else if (payload.hasOwnProperty('status')) {
    validateEnum(payload.status, MEDICINE_STATUSES, 'status');
    fields.status = payload.status;
  }
  // Keep the older boolean `active` column (read by the existing dashboard
  // "today's pending medicines" logic) in sync with the new `status` field,
  // unless the caller is explicitly setting `active` itself this call.
  if (fields.status && !payload.hasOwnProperty('active')) {
    fields.active = fields.status === 'active';
  }
  if (isCreate || payload.hasOwnProperty('stopped_on')) {
    fields.stopped_on = payload.stopped_on ? sanitizeDate(payload.stopped_on, 'stopped_on') : '';
  }
  if (isCreate || payload.hasOwnProperty('stop_note')) fields.stop_note = sanitizeText(payload.stop_note, 2000);
  if (isCreate || payload.hasOwnProperty('episode_id')) fields.episode_id = sanitizeText(payload.episode_id, 100);
  if (isCreate || payload.hasOwnProperty('shop_name')) fields.shop_name = sanitizeText(payload.shop_name, 200);
  if (isCreate || payload.hasOwnProperty('medic_kind')) {
    if (payload.medic_kind) validateEnum(payload.medic_kind, MEDIC_KINDS, 'medic_kind');
    fields.medic_kind = payload.medic_kind || '';
  }

  return fields;
}

// Moves a medicine to History — never deletes it. Distinct from a plain
// status update so the frontend has one obvious action for "I'm done
// taking this" with its own confirmation copy.
function medicinesStop(payload) {
  requireId(payload);
  return updateRowById('Medicines', payload.id, {
    status: 'stopped',
    active: false,
    stopped_on: payload.stopped_on ? sanitizeDate(payload.stopped_on, 'stopped_on') : formatISODate(new Date()),
    stop_note: sanitizeText(payload.stop_note, 2000)
  });
}

// status (taken|skipped|missed) is the richer v3 shape; plain `taken: true/false`
// (the v1/v2 shape) still works exactly as before — it's just read as
// taken/skipped. `taken_at` is the real-world instant the dose was actually
// logged (defaults to now when status is 'taken'), which is what from_last
// anchor_mode medicines key their next dose off (see js/schedule.js) — it is
// deliberately NOT the same as the nominal scheduled `date`+`time` slot,
// since a dose logged late should shift every later dose, not just this one.
function medicinesLogTaken(payload) {
  requireFields(payload, ['medicine_id', 'date', 'time']);
  var targetDate = sanitizeDate(payload.date, 'date');
  var hasStatus = payload.hasOwnProperty('status');
  if (hasStatus) validateEnum(payload.status, MEDICINE_LOG_STATUSES, 'status');
  var status = hasStatus
    ? payload.status
    : ((payload.taken === undefined ? true : sanitizeBoolean(payload.taken)) ? 'taken' : 'skipped');
  var taken = status === 'taken';
  var hasNote = payload.hasOwnProperty('note');
  var note = hasNote ? sanitizeText(payload.note, 1000) : undefined;
  var takenAt = taken ? (payload.taken_at ? String(payload.taken_at) : new Date().toISOString()) : '';

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheetByName('MedicineLog');
    var headers = getHeaders('MedicineLog');
    var values = sheet.getDataRange().getValues();
    var idCol = headers.indexOf('id');
    var medCol = headers.indexOf('medicine_id');
    var dateCol = headers.indexOf('date');
    var timeCol = headers.indexOf('time');
    var takenCol = headers.indexOf('taken');
    var statusCol = headers.indexOf('status');
    var takenAtCol = headers.indexOf('taken_at');
    var noteCol = headers.indexOf('note');
    var result;
    var wasTaken = false; // no prior row at all counts as "wasn't taken"
    var resultNote = hasNote ? note : '';

    for (var i = 1; i < values.length; i++) {
      if (String(values[i][medCol]) === String(payload.medicine_id) &&
          dateStrOf(values[i][dateCol]) === targetDate &&
          String(values[i][timeCol]) === String(payload.time)) {
        wasTaken = isTruthy(values[i][takenCol]);
        sheet.getRange(i + 1, takenCol + 1).setValue(taken);
        if (statusCol !== -1) sheet.getRange(i + 1, statusCol + 1).setValue(status);
        if (takenAtCol !== -1) sheet.getRange(i + 1, takenAtCol + 1).setValue(takenAt);
        if (noteCol !== -1 && hasNote) sheet.getRange(i + 1, noteCol + 1).setValue(note);
        if (!hasNote && noteCol !== -1) resultNote = values[i][noteCol] || ''; // preserve existing note on a bare taken-toggle
        result = { id: values[i][idCol], medicine_id: payload.medicine_id, date: targetDate, time: payload.time, taken: taken, status: status, taken_at: takenAt, note: resultNote };
        break;
      }
    }
    if (!result) {
      var id = Utilities.getUuid();
      var newRow = headers.map(function (h) {
        if (h === 'id') return id;
        if (h === 'medicine_id') return payload.medicine_id;
        if (h === 'date') return targetDate;
        if (h === 'time') return payload.time;
        if (h === 'taken') return taken;
        if (h === 'status') return status;
        if (h === 'taken_at') return takenAt;
        if (h === 'note') return note || '';
        return '';
      });
      sheet.appendRow(newRow);
      result = { id: id, medicine_id: payload.medicine_id, date: targetDate, time: payload.time, taken: taken, status: status, taken_at: takenAt, note: note || '' };
    }

    // Stock only moves on an actual state transition, so toggling the same
    // dose taken->taken (a duplicate/retried call) never double-decrements,
    // and un-checking a dose correctly gives the stock back.
    if (taken !== wasTaken) {
      adjustMedicineStock(payload.medicine_id, taken ? -1 : 1);
    }

    incrementDataVersion();
    return result;
  } finally {
    lock.releaseLock();
  }
}

// Adjusts a medicine's stock_count by delta (+1/-1), clamped to never go
// negative. No-ops silently if the medicine has no numeric stock_count set
// (stock tracking is opt-in) or doesn't exist. Must be called from inside
// a lock already held by the caller — same reasoning as incrementDataVersion.
function adjustMedicineStock(medicineId, delta) {
  var sheet = getSheetByName('Medicines');
  var headers = getHeaders('Medicines');
  var idCol = headers.indexOf('id');
  var stockCol = headers.indexOf('stock_count');
  if (stockCol === -1) return; // schema not migrated yet on this sheet

  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) !== String(medicineId)) continue;
    var current = values[i][stockCol];
    if (current === '' || current === null || current === undefined || isNaN(Number(current))) return;
    var next = Math.max(0, Number(current) + delta);
    sheet.getRange(i + 1, stockCol + 1).setValue(next);
    return;
  }
}

// Returns raw MedicineLog rows from the last N days (default 14) so the
// frontend can build an adherence history without another round trip.
function medicinesHistory(payload) {
  var days = (payload && Number(payload.days)) || 14;
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  var cutoffStr = formatISODate(cutoff);

  var logs = sheetToObjects('MedicineLog').filter(function (l) {
    return dateStrOf(l.date) >= cutoffStr;
  });
  logs.sort(function (a, b) {
    return dateStrOf(b.date).localeCompare(dateStrOf(a.date)) || String(a.time).localeCompare(String(b.time));
  });
  return { days: days, logs: logs };
}

// Unbounded log fetch (optionally filtered to one medicine) — for the
// "Medicines used" history view's doses-taken counts, which need the whole
// history, not just the last 14 days. Lazy-loaded, not part of bootstrap.
function medicineLogList(payload) {
  var logs = sheetToObjects('MedicineLog');
  if (payload && payload.medicine_id) {
    logs = logs.filter(function (l) { return String(l.medicine_id) === String(payload.medicine_id); });
  }
  logs.sort(function (a, b) {
    return dateStrOf(b.date).localeCompare(dateStrOf(a.date)) || String(a.time).localeCompare(String(b.time));
  });
  return logs;
}

// ---------------------------------------------------------------------------
// Packs — a recurring daily group of medicines usually taken together at
// one time (e.g. "Evening pack"). Each member still has its own MedicineLog
// entries; tickAll is just a convenience that logs all of them at once.
// ---------------------------------------------------------------------------

function packsCreate(payload) {
  requireFields(payload, ['name']);
  return createRow('Packs', packFields(payload, true));
}

function packsUpdate(payload) {
  requireId(payload);
  return updateRowById('Packs', payload.id, packFields(payload, false));
}

function packsDelete(payload) {
  requireId(payload);
  return deleteRowById('Packs', payload.id);
}

function packFields(payload, isCreate) {
  var fields = {};
  if (isCreate || payload.hasOwnProperty('name')) fields.name = sanitizeText(payload.name, 200);
  if (isCreate || payload.hasOwnProperty('times')) fields.times = sanitizeText(payload.times, 200);
  if (isCreate || payload.hasOwnProperty('member_medicine_ids')) {
    var ids = payload.member_medicine_ids;
    fields.member_medicine_ids = sanitizeText(Array.isArray(ids) ? ids.join(',') : ids, 2000);
  }
  if (isCreate) fields.created_at = new Date().toISOString();
  return fields;
}

function packMemberIds(pack) {
  return String(pack.member_medicine_ids || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

// Logs every member medicine at once (defaults to status 'taken'). Each
// member gets its own MedicineLog upsert via medicinesLogTaken, so stock
// and data_version bookkeeping all happen exactly as for a single tap.
function packsTickAll(payload) {
  requireFields(payload, ['id', 'date', 'time']);
  var pack = getRowById('Packs', payload.id);
  if (!pack) throw new Error('Not found: ' + payload.id);
  var status = payload.status || 'taken';
  validateEnum(status, MEDICINE_LOG_STATUSES, 'status');
  var logs = packMemberIds(pack).map(function (medicineId) {
    return medicinesLogTaken({ medicine_id: medicineId, date: payload.date, time: payload.time, status: status });
  });
  return { pack_id: payload.id, logs: logs };
}

// ---------------------------------------------------------------------------
// Checkins — "how are you feeling" (mood + a quick note). Multiple per day
// are expected; each is its own immutable timeline entry (no update
// action — correcting one just means logging a fresh one).
// ---------------------------------------------------------------------------

function checkinsList(payload) {
  var rows = sheetToObjects('Checkins');
  if (payload && payload.date_from) rows = rows.filter(function (r) { return dateStrOf(r.date) >= payload.date_from; });
  if (payload && payload.date_to) rows = rows.filter(function (r) { return dateStrOf(r.date) <= payload.date_to; });
  rows.sort(function (a, b) { return (dateStrOf(b.date) + ' ' + b.time).localeCompare(dateStrOf(a.date) + ' ' + a.time); });
  return rows;
}

function checkinsCreate(payload) {
  requireFields(payload, ['date', 'mood']);
  var mood = sanitizeNumber(payload.mood, 'mood');
  if (mood < 1 || mood > 5) throw new Error('mood must be between 1 and 5');
  return createRow('Checkins', {
    date: sanitizeDate(payload.date, 'date'),
    time: sanitizeText(payload.time || formatCurrentTime(), 10),
    mood: mood,
    note: sanitizeText(payload.note, 2000),
    created_at: new Date().toISOString()
  });
}

function checkinsDelete(payload) {
  requireId(payload);
  return deleteRowById('Checkins', payload.id);
}

// ---------------------------------------------------------------------------
// Symptoms — fixed chips + custom, with severity and (for
// spotting/bleeding) a size-vs-a-pad scale. Safety note: this app only
// RECORDS what she selects; it never diagnoses or suggests a cause — see
// SYMPTOMS_SEVERE_ADVICE below, the one calm, fixed piece of copy this
// ever shows.
// ---------------------------------------------------------------------------

var SYMPTOM_KEYS = [
  'nausea', 'vomiting', 'spotting', 'bleeding', 'headache', 'dizziness', 'tiredness',
  'back_pain', 'cramps', 'heartburn', 'swelling', 'constipation', 'fever', 'other', 'custom'
];
var SYMPTOM_SEVERITIES = ['mild', 'moderate', 'severe'];
var BLEEDING_SCALE_VALUES = ['spotting', 'light', 'one_pad', 'more_than_one_pad'];

function symptomsList(payload) {
  var rows = sheetToObjects('Symptoms');
  if (payload && payload.date_from) rows = rows.filter(function (r) { return dateStrOf(r.date) >= payload.date_from; });
  if (payload && payload.date_to) rows = rows.filter(function (r) { return dateStrOf(r.date) <= payload.date_to; });
  if (payload && payload.symptom_key) rows = rows.filter(function (r) { return r.symptom_key === payload.symptom_key; });
  rows.sort(function (a, b) { return (dateStrOf(b.date) + ' ' + b.time).localeCompare(dateStrOf(a.date) + ' ' + a.time); });
  return rows;
}

function symptomsCreate(payload) {
  requireFields(payload, ['date', 'symptom_key']);
  validateEnum(payload.symptom_key, SYMPTOM_KEYS, 'symptom_key');
  if (payload.symptom_key === 'custom' && !String(payload.custom_name || '').trim()) {
    throw new Error('custom_name is required when symptom_key is "custom"');
  }
  if (payload.severity) validateEnum(payload.severity, SYMPTOM_SEVERITIES, 'severity');
  if (payload.bleeding_scale) validateEnum(payload.bleeding_scale, BLEEDING_SCALE_VALUES, 'bleeding_scale');
  return createRow('Symptoms', {
    date: sanitizeDate(payload.date, 'date'),
    time: sanitizeText(payload.time || formatCurrentTime(), 10),
    symptom_key: payload.symptom_key,
    custom_name: sanitizeText(payload.custom_name, 100),
    severity: payload.severity || '',
    bleeding_scale: payload.bleeding_scale || '',
    note: sanitizeText(payload.note, 2000),
    created_at: new Date().toISOString(),
    notify: sanitizeBoolean(payload.notify)
  });
}

// The only update this supports is attaching/editing a "fix note" after
// the fact (e.g. "Pantop helped, stopped after a week") — never the
// symptom/severity itself, which stays a record of what was actually
// selected at the time.
function symptomsUpdate(payload) {
  requireId(payload);
  var fields = {};
  if (payload.hasOwnProperty('note')) fields.note = sanitizeText(payload.note, 2000);
  return updateRowById('Symptoms', payload.id, fields);
}

function symptomsDelete(payload) {
  requireId(payload);
  return deleteRowById('Symptoms', payload.id);
}

// ---------------------------------------------------------------------------
// Water — one row per "add a glass" tap.
// ---------------------------------------------------------------------------

function waterList(payload) {
  var rows = sheetToObjects('Water');
  if (payload && payload.date_from) rows = rows.filter(function (r) { return dateStrOf(r.date) >= payload.date_from; });
  if (payload && payload.date_to) rows = rows.filter(function (r) { return dateStrOf(r.date) <= payload.date_to; });
  return rows;
}

function waterAdd(payload) {
  requireFields(payload, ['date']);
  return createRow('Water', {
    date: sanitizeDate(payload.date, 'date'),
    time: sanitizeText(payload.time || formatCurrentTime(), 10),
    glasses: payload.glasses === undefined || payload.glasses === '' ? 1 : sanitizeNumber(payload.glasses, 'glasses'),
    created_at: new Date().toISOString()
  });
}

function waterDelete(payload) {
  requireId(payload);
  return deleteRowById('Water', payload.id);
}

// Server clock's current time as "HH:MM" — used as a fallback only; the
// frontend normally sends the device's own local time explicitly (same
// reasoning as medicinesLogTaken's `time` field).
function formatCurrentTime() {
  return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'HH:mm');
}

// ---------------------------------------------------------------------------
// FoodPrefs — a liked / not-interested list, curated over time.
// ---------------------------------------------------------------------------

var FOOD_PREF_STATUSES = ['interested', 'not_interested'];

function foodprefsList(payload) {
  var rows = sheetToObjects('FoodPrefs');
  if (payload && payload.status) rows = rows.filter(function (r) { return r.status === payload.status; });
  return rows;
}

function foodprefsCreate(payload) {
  requireFields(payload, ['name', 'status']);
  validateEnum(payload.status, FOOD_PREF_STATUSES, 'status');
  return createRow('FoodPrefs', {
    name: sanitizeText(payload.name, 200),
    status: payload.status,
    date: formatISODate(new Date()),
    notes: sanitizeText(payload.notes, 500)
  });
}

function foodprefsUpdate(payload) {
  requireId(payload);
  var fields = {};
  if (payload.hasOwnProperty('status')) {
    validateEnum(payload.status, FOOD_PREF_STATUSES, 'status');
    fields.status = payload.status;
    fields.date = formatISODate(new Date()); // status changing is the thing worth re-dating
  }
  if (payload.hasOwnProperty('notes')) fields.notes = sanitizeText(payload.notes, 500);
  return updateRowById('FoodPrefs', payload.id, fields);
}

function foodprefsDelete(payload) {
  requireId(payload);
  return deleteRowById('FoodPrefs', payload.id);
}

// ---------------------------------------------------------------------------
// Notes — Quick Add's "question for the doctor" and plain-note fallback.
// ---------------------------------------------------------------------------

var NOTE_CATEGORIES = ['note', 'question'];
// Opt-in only — see the Notes schema comment. Never set by anything other
// than the person explicitly turning an alert on for one specific note.
var ALERT_LEVELS = ['red', 'orange', 'green'];

function notesList(payload) {
  var rows = sheetToObjects('Notes');
  if (payload && payload.category) rows = rows.filter(function (r) { return r.category === payload.category; });
  if (payload && payload.date_from) rows = rows.filter(function (r) { return dateStrOf(r.date) >= payload.date_from; });
  if (payload && payload.date_to) rows = rows.filter(function (r) { return dateStrOf(r.date) <= payload.date_to; });
  if (payload && payload.episode_id) rows = rows.filter(function (r) { return r.episode_id === payload.episode_id; });
  if (payload && payload.alert_level) rows = rows.filter(function (r) { return r.alert_level === payload.alert_level; });
  rows.sort(function (a, b) { return (dateStrOf(b.date) + ' ' + b.time).localeCompare(dateStrOf(a.date) + ' ' + a.time); });
  return rows;
}

function notesCreate(payload) {
  requireFields(payload, ['date', 'text']);
  var category = payload.category || 'note';
  validateEnum(category, NOTE_CATEGORIES, 'category');
  if (payload.alert_level) validateEnum(payload.alert_level, ALERT_LEVELS, 'alert_level');
  return createRow('Notes', {
    date: sanitizeDate(payload.date, 'date'),
    time: sanitizeText(payload.time || formatCurrentTime(), 10),
    category: category,
    text: sanitizeText(payload.text, 2000),
    photo_file_id: sanitizeText(payload.photo_file_id, 100),
    created_at: new Date().toISOString(),
    episode_id: sanitizeText(payload.episode_id, 100),
    block: sanitizeText(payload.block, 30),
    block_ref_id: sanitizeText(payload.block_ref_id, 100),
    alert_level: payload.alert_level || ''
  });
}

function notesUpdate(payload) {
  requireId(payload);
  var fields = {};
  if (payload.hasOwnProperty('text')) fields.text = sanitizeText(payload.text, 2000);
  if (payload.hasOwnProperty('category')) { validateEnum(payload.category, NOTE_CATEGORIES, 'category'); fields.category = payload.category; }
  if (payload.hasOwnProperty('alert_level')) {
    if (payload.alert_level) validateEnum(payload.alert_level, ALERT_LEVELS, 'alert_level');
    fields.alert_level = payload.alert_level || '';
  }
  if (payload.hasOwnProperty('episode_id')) fields.episode_id = sanitizeText(payload.episode_id, 100);
  if (payload.hasOwnProperty('block')) fields.block = sanitizeText(payload.block, 30);
  if (payload.hasOwnProperty('block_ref_id')) fields.block_ref_id = sanitizeText(payload.block_ref_id, 100);
  return updateRowById('Notes', payload.id, fields);
}

function notesDelete(payload) {
  requireId(payload);
  return deleteRowById('Notes', payload.id);
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

var APPOINTMENT_STATUSES = ['upcoming', 'done', 'missed'];

function appointmentsCreate(payload) {
  requireFields(payload, ['datetime']);
  return createRow('Appointments', appointmentFields(payload, true));
}

function appointmentsUpdate(payload) {
  requireId(payload);
  return updateRowById('Appointments', payload.id, appointmentFields(payload, false));
}

function appointmentsDelete(payload) {
  requireId(payload);
  return deleteRowById('Appointments', payload.id);
}

function appointmentFields(payload, isCreate) {
  var fields = {};
  if (isCreate || payload.hasOwnProperty('datetime')) {
    var dt = toDateTime(payload.datetime);
    if (!dt) throw new Error('Invalid datetime: ' + payload.datetime);
    fields.datetime = dt.toISOString();
  }
  if (isCreate || payload.hasOwnProperty('doctor')) fields.doctor = sanitizeText(payload.doctor, 200);
  if (isCreate || payload.hasOwnProperty('purpose')) fields.purpose = sanitizeText(payload.purpose, 300);
  if (isCreate || payload.hasOwnProperty('location')) fields.location = sanitizeText(payload.location, 300);
  if (isCreate) {
    fields.status = statusOrDefault(payload.status);
  } else if (payload.hasOwnProperty('status')) {
    fields.status = statusOrDefault(payload.status);
  }
  if (isCreate || payload.hasOwnProperty('notes_after_visit')) {
    fields.notes_after_visit = sanitizeText(payload.notes_after_visit, 2000);
  }
  return fields;
}

function statusOrDefault(status) {
  if (!status) return 'upcoming';
  if (APPOINTMENT_STATUSES.indexOf(status) === -1) throw new Error('Invalid status: ' + status);
  return status;
}

// ---------------------------------------------------------------------------
// Health log
// ---------------------------------------------------------------------------

var HEALTHLOG_NUMERIC_FIELDS = ['weight_kg', 'bp_sys', 'bp_dia', 'sugar_fasting', 'sugar_pp', 'kicks'];

function healthlogCreate(payload) {
  requireFields(payload, ['date']);
  return createRow('HealthLog', healthlogFields(payload, true));
}

function healthlogUpdate(payload) {
  requireId(payload);
  return updateRowById('HealthLog', payload.id, healthlogFields(payload, false));
}

function healthlogDelete(payload) {
  requireId(payload);
  return deleteRowById('HealthLog', payload.id);
}

function healthlogFields(payload, isCreate) {
  var fields = {};
  if (isCreate || payload.hasOwnProperty('date')) fields.date = sanitizeDate(payload.date, 'date');
  HEALTHLOG_NUMERIC_FIELDS.forEach(function (key) {
    if (isCreate || payload.hasOwnProperty(key)) {
      var value = payload[key];
      fields[key] = (value === '' || value === undefined || value === null) ? '' : sanitizeNumber(value, key);
    }
  });
  if (isCreate || payload.hasOwnProperty('mood')) fields.mood = sanitizeText(payload.mood, 100);
  if (isCreate || payload.hasOwnProperty('symptoms')) fields.symptoms = sanitizeText(payload.symptoms, 1000);
  if (isCreate || payload.hasOwnProperty('notes')) fields.notes = sanitizeText(payload.notes, 2000);
  return fields;
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

function contactsCreate(payload) {
  requireFields(payload, ['name']);
  return createRow('Contacts', contactFields(payload, true));
}

function contactsUpdate(payload) {
  requireId(payload);
  return updateRowById('Contacts', payload.id, contactFields(payload, false));
}

function contactsDelete(payload) {
  requireId(payload);
  return deleteRowById('Contacts', payload.id);
}

function contactFields(payload, isCreate) {
  var fields = {};
  if (isCreate || payload.hasOwnProperty('name')) fields.name = sanitizeText(payload.name, 200);
  if (isCreate || payload.hasOwnProperty('role')) fields.role = sanitizeText(payload.role, 100);
  if (isCreate || payload.hasOwnProperty('phone')) fields.phone = sanitizeText(payload.phone, 50);
  if (isCreate || payload.hasOwnProperty('address')) fields.address = sanitizeText(payload.address, 300);
  if (isCreate || payload.hasOwnProperty('maps_link')) fields.maps_link = sanitizeText(payload.maps_link, 500);
  if (isCreate) {
    fields.is_emergency = payload.is_emergency === undefined ? false : sanitizeBoolean(payload.is_emergency);
  } else if (payload.hasOwnProperty('is_emergency')) {
    fields.is_emergency = sanitizeBoolean(payload.is_emergency);
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Doctors — managed in Settings, offered as a dropdown when booking a visit.
// ---------------------------------------------------------------------------

function doctorsCreate(payload) {
  requireFields(payload, ['name']);
  return createRow('Doctors', doctorFields(payload, true));
}

function doctorsUpdate(payload) {
  requireId(payload);
  return updateRowById('Doctors', payload.id, doctorFields(payload, false));
}

function doctorsDelete(payload) {
  requireId(payload);
  return deleteRowById('Doctors', payload.id);
}

function doctorFields(payload, isCreate) {
  var fields = {};
  if (isCreate || payload.hasOwnProperty('name')) fields.name = sanitizeText(payload.name, 200);
  if (isCreate || payload.hasOwnProperty('specialty')) fields.specialty = sanitizeText(payload.specialty, 150);
  if (isCreate || payload.hasOwnProperty('phone')) fields.phone = sanitizeText(payload.phone, 50);
  if (isCreate || payload.hasOwnProperty('clinic_hospital')) fields.clinic_hospital = sanitizeText(payload.clinic_hospital, 200);
  if (isCreate || payload.hasOwnProperty('notes')) fields.notes = sanitizeText(payload.notes, 1000);
  if (isCreate) fields.created_at = new Date().toISOString();
  return fields;
}

// ---------------------------------------------------------------------------
// Episodes
// ---------------------------------------------------------------------------

function episodesCreate(payload) {
  requireFields(payload, ['name', 'start_date', 'trimester']);
  return createRow('Episodes', episodeFields(payload, true));
}

function episodesUpdate(payload) {
  requireId(payload);
  return updateRowById('Episodes', payload.id, episodeFields(payload, false));
}

function episodesDelete(payload) {
  requireId(payload);
  return deleteRowById('Episodes', payload.id);
}

function episodeFields(payload, isCreate) {
  var fields = {};
  if (isCreate || payload.hasOwnProperty('name')) fields.name = sanitizeText(payload.name, 200);
  if (isCreate || payload.hasOwnProperty('start_date')) fields.start_date = sanitizeText(payload.start_date, 20);
  if (isCreate || payload.hasOwnProperty('end_date')) fields.end_date = sanitizeText(payload.end_date, 20);
  if (isCreate || payload.hasOwnProperty('trimester')) fields.trimester = sanitizeText(payload.trimester, 5);
  if (isCreate || payload.hasOwnProperty('notes')) fields.notes = sanitizeText(payload.notes, 2000);
  if (isCreate) fields.created_at = new Date().toISOString();
  return fields;
}

// ---------------------------------------------------------------------------
// Food log
// ---------------------------------------------------------------------------

function foodlogCreate(payload) {
  requireFields(payload, ['date', 'meal']);
  return createRow('FoodLog', foodlogFields(payload, true));
}

function foodlogUpdate(payload) {
  requireId(payload);
  return updateRowById('FoodLog', payload.id, foodlogFields(payload, false));
}

function foodlogDelete(payload) {
  requireId(payload);
  return deleteRowById('FoodLog', payload.id);
}

function foodlogFields(payload, isCreate) {
  var fields = {};
  if (isCreate || payload.hasOwnProperty('date')) fields.date = sanitizeDate(payload.date, 'date');
  if (isCreate || payload.hasOwnProperty('meal')) fields.meal = sanitizeText(payload.meal, 100);
  if (isCreate || payload.hasOwnProperty('items')) fields.items = sanitizeText(payload.items, 1000);
  if (isCreate || payload.hasOwnProperty('craving_or_aversion')) {
    fields.craving_or_aversion = sanitizeText(payload.craving_or_aversion, 300);
  }
  if (isCreate || payload.hasOwnProperty('notes')) fields.notes = sanitizeText(payload.notes, 1000);
  return fields;
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

var CHECKLIST_LISTS = ['hospital_bag', 'documents', 'baby_items'];

function checklistList(payload) {
  var rows = listRows('Checklist');
  if (payload && payload.list) rows = rows.filter(function (r) { return r.list === payload.list; });
  return rows;
}

function checklistCreate(payload) {
  requireFields(payload, ['list', 'item']);
  if (CHECKLIST_LISTS.indexOf(payload.list) === -1) throw new Error('Invalid list: ' + payload.list);
  return createRow('Checklist', {
    list: payload.list,
    item: sanitizeText(payload.item, 300),
    done: payload.done === undefined ? false : sanitizeBoolean(payload.done)
  });
}

function checklistUpdate(payload) {
  requireId(payload);
  var fields = {};
  if (payload.hasOwnProperty('item')) fields.item = sanitizeText(payload.item, 300);
  if (payload.hasOwnProperty('done')) fields.done = sanitizeBoolean(payload.done);
  if (payload.hasOwnProperty('list')) {
    if (CHECKLIST_LISTS.indexOf(payload.list) === -1) throw new Error('Invalid list: ' + payload.list);
    fields.list = payload.list;
  }
  return updateRowById('Checklist', payload.id, fields);
}

function checklistDelete(payload) {
  requireId(payload);
  return deleteRowById('Checklist', payload.id);
}

// ---------------------------------------------------------------------------
// Files (Drive-backed records vault)
// ---------------------------------------------------------------------------

var FILE_TYPES = ['report', 'scan', 'prescription', 'document'];
var MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // ~8 MB

var FILE_TYPES_V2 = ['prescription', 'lab_report', 'scan_report', 'bill', 'medicine_photo', 'other'];
var REPORT_TYPES = ['scan', 'blood', 'urine', 'other'];

function filesList(payload) {
  var rows = listRows('Files').map(function (r) {
    return {
      id: r.id, title: r.title, type: r.type, date: dateStrOf(r.date), doctor: r.doctor, notes: r.notes,
      type_v2: r.type_v2 || '', linked_booking_id: r.linked_booking_id || '', linked_file_ids: r.linked_file_ids || '',
      episode_id: r.episode_id || '', report_type: r.report_type || ''
    };
  });
  if (payload) {
    if (payload.type) rows = rows.filter(function (r) { return r.type === payload.type; });
    if (payload.type_v2) rows = rows.filter(function (r) { return r.type_v2 === payload.type_v2; });
    if (payload.needs_sorting) rows = rows.filter(function (r) { return !r.type_v2; });
    if (payload.linked_booking_id) rows = rows.filter(function (r) { return r.linked_booking_id === payload.linked_booking_id; });
    if (payload.episode_id) rows = rows.filter(function (r) { return r.episode_id === payload.episode_id; });
    if (payload.date_from) rows = rows.filter(function (r) { return r.date >= payload.date_from; });
    if (payload.date_to) rows = rows.filter(function (r) { return r.date <= payload.date_to; });
  }
  rows.sort(function (a, b) { return b.date.localeCompare(a.date); });
  return rows;
}

// Metadata-only edit (title/type_v2/linked_booking_id/doctor/notes/date) —
// never touches the underlying Drive file or drive_file_id.
function filesUpdate(payload) {
  requireId(payload);
  var fields = {};
  if (payload.hasOwnProperty('title')) fields.title = sanitizeText(payload.title, 200);
  if (payload.hasOwnProperty('type_v2')) {
    validateEnum(payload.type_v2, FILE_TYPES_V2, 'type_v2');
    fields.type_v2 = payload.type_v2;
  }
  if (payload.hasOwnProperty('linked_booking_id')) fields.linked_booking_id = sanitizeText(payload.linked_booking_id, 100);
  if (payload.hasOwnProperty('episode_id')) fields.episode_id = sanitizeText(payload.episode_id, 100);
  if (payload.hasOwnProperty('doctor')) fields.doctor = sanitizeText(payload.doctor, 200);
  if (payload.hasOwnProperty('notes')) fields.notes = sanitizeText(payload.notes, 1000);
  if (payload.hasOwnProperty('date')) fields.date = payload.date ? sanitizeDate(payload.date, 'date') : '';
  if (payload.hasOwnProperty('report_type')) {
    if (payload.report_type) validateEnum(payload.report_type, REPORT_TYPES, 'report_type');
    fields.report_type = payload.report_type || '';
  }
  return updateRowById('Files', payload.id, fields);
}

function fileLinkedIds(file) {
  return String(file.linked_file_ids || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

// Links two records to each other (a bill to its report, two reports from
// the same scan, anything to anything) — always symmetric: linking A to B
// adds B to A's list and A to B's list in the same call, so it reads the
// same "linked records" either way you open it.
function filesLink(payload) {
  requireFields(payload, ['id', 'link_to_id']);
  if (payload.id === payload.link_to_id) throw new Error('A record cannot be linked to itself.');
  var a = getRowById('Files', payload.id);
  var b = getRowById('Files', payload.link_to_id);
  if (!a || !b) throw new Error('One of these records was not found.');

  var aLinks = fileLinkedIds(a);
  if (aLinks.indexOf(payload.link_to_id) === -1) aLinks.push(payload.link_to_id);
  var bLinks = fileLinkedIds(b);
  if (bLinks.indexOf(payload.id) === -1) bLinks.push(payload.id);

  updateRowById('Files', payload.id, { linked_file_ids: aLinks.join(',') });
  return updateRowById('Files', payload.link_to_id, { linked_file_ids: bLinks.join(',') });
}

function filesUnlink(payload) {
  requireFields(payload, ['id', 'link_to_id']);
  var a = getRowById('Files', payload.id);
  var b = getRowById('Files', payload.link_to_id);
  if (!a || !b) throw new Error('One of these records was not found.');

  var aLinks = fileLinkedIds(a).filter(function (id) { return id !== payload.link_to_id; });
  var bLinks = fileLinkedIds(b).filter(function (id) { return id !== payload.id; });

  updateRowById('Files', payload.id, { linked_file_ids: aLinks.join(',') });
  return updateRowById('Files', payload.link_to_id, { linked_file_ids: bLinks.join(',') });
}

function filesUpload(payload) {
  requireFields(payload, ['title', 'type', 'base64', 'filename']);
  if (FILE_TYPES.indexOf(payload.type) === -1) throw new Error('Invalid file type: ' + payload.type);
  if (payload.type_v2) validateEnum(payload.type_v2, FILE_TYPES_V2, 'type_v2');
  if (payload.report_type) validateEnum(payload.report_type, REPORT_TYPES, 'report_type');

  var bytes;
  try {
    bytes = Utilities.base64Decode(payload.base64);
  } catch (e) {
    throw new Error('Could not decode file data.');
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error('File is too large (max 8 MB). Please choose a smaller file.');
  }

  // type_v2 decides the actual Drive folder when present — `type` is only
  // a fallback for a caller that doesn't send type_v2 at all. Every v3
  // upload sends type: 'document' alongside its real type_v2 (kept only
  // for back-compat with pre-v3 rows), so keying off `type` here used to
  // put every file in the Documents folder regardless of its real category.
  var folder = payload.type_v2 ? driveFolderForTypeV2(payload.type_v2) : driveFolderForType(payload.type);
  var blob = Utilities.newBlob(bytes, payload.mimeType || 'application/octet-stream', sanitizeText(payload.filename, 300));
  var file = folder.createFile(blob);

  // date is deliberately optional — most reports/scans aren't dated until
  // the result actually comes back, so forcing "today" here would record
  // a wrong date more often than a right one. A blank date just means
  // "not dated yet", not an error.
  return createRow('Files', {
    drive_file_id: file.getId(),
    title: sanitizeText(payload.title, 200),
    type: payload.type,
    date: payload.date ? sanitizeDate(payload.date, 'date') : '',
    doctor: sanitizeText(payload.doctor, 200),
    notes: sanitizeText(payload.notes, 1000),
    type_v2: payload.type_v2 || '',
    linked_booking_id: sanitizeText(payload.linked_booking_id, 100),
    episode_id: sanitizeText(payload.episode_id, 100),
    report_type: payload.report_type || ''
  });
}

function filesGet(payload) {
  requireId(payload);
  var row = getRowById('Files', payload.id);
  if (!row) throw new Error('File not found.');
  var file = DriveApp.getFileById(row.drive_file_id);
  var blob = file.getBlob();
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    date: dateStrOf(row.date),
    doctor: row.doctor,
    notes: row.notes,
    filename: file.getName(),
    mimeType: blob.getContentType(),
    base64: Utilities.base64Encode(blob.getBytes())
  };
}

function filesDelete(payload) {
  requireId(payload);
  var row = getRowById('Files', payload.id);
  if (!row) throw new Error('File not found.');
  try {
    DriveApp.getFileById(row.drive_file_id).setTrashed(true);
  } catch (e) {
    // Drive file may already be gone (deleted by hand) — still remove the row.
  }
  return deleteRowById('Files', payload.id);
}

function driveFolderForType(type) {
  var propKeyByType = {
    report: 'DRIVE_FOLDER_REPORT',
    scan: 'DRIVE_FOLDER_SCAN',
    prescription: 'DRIVE_FOLDER_PRESCRIPTION',
    document: 'DRIVE_FOLDER_DOCUMENT'
  };
  var folderId = PropertiesService.getScriptProperties().getProperty(propKeyByType[type]);
  if (!folderId) throw new Error('Drive folder not set up for type: ' + type + '. Run setup() first.');
  return DriveApp.getFolderById(folderId);
}

// type_v2 (the real six-category Records typing) is what actually decides
// the Drive folder for every v3 upload — reuses the original four folders
// where the category is the same thing under a new name (prescription,
// scan_report -> the old Scans folder, other -> the old Documents folder)
// and lazily creates the three genuinely new ones (lab_report/bill/
// medicine_photo) on first use, no manual setup() re-run required. See
// getOrCreateDriveFolder()'s comment for why this is lazy rather than
// requiring that re-run.
var DRIVE_FOLDER_V2_MAP = {
  prescription: ['DRIVE_FOLDER_PRESCRIPTION', 'Prescriptions'],
  lab_report: ['DRIVE_FOLDER_LAB_REPORT', 'Lab reports'],
  scan_report: ['DRIVE_FOLDER_SCAN', 'Scans'],
  bill: ['DRIVE_FOLDER_BILL', 'Bills and receipts'],
  medicine_photo: ['DRIVE_FOLDER_MEDICINE_PHOTO', 'Medicine photos'],
  other: ['DRIVE_FOLDER_DOCUMENT', 'Documents']
};

function driveFolderForTypeV2(typeV2) {
  var pair = DRIVE_FOLDER_V2_MAP[typeV2] || DRIVE_FOLDER_V2_MAP.other;
  return getOrCreateDriveFolder(pair[0], pair[1]);
}

// Same tab I use everywhere else for schema: additive, self-healing, never
// requires a manual step. If the folder's Script Property is already set
// (either from an original setup() run, or from a previous call to this
// function), reuse it; otherwise find-or-create it under the existing
// Drive root and remember its id for next time.
function getOrCreateDriveFolder(propKey, folderName) {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty(propKey);
  if (folderId) return DriveApp.getFolderById(folderId);

  var rootId = props.getProperty('DRIVE_FOLDER_ROOT');
  if (!rootId) throw new Error('Not set up yet. Run setup() from the Apps Script editor first.');
  var root = DriveApp.getFolderById(rootId);
  var existing = root.getFoldersByName(folderName);
  var folder = existing.hasNext() ? existing.next() : root.createFolder(folderName);
  props.setProperty(propKey, folder.getId());
  return folder;
}

// ---------------------------------------------------------------------------
// Bookings — doctor visits, scans, blood tests, vaccines, anything booked.
// Replaces plain Appointments for anything that needs real status
// tracking (Booked -> Done -> Waiting for report -> Report uploaded ->
// Closed). Each stage change stamps its own timestamp.
// ---------------------------------------------------------------------------

var BOOKING_TYPES = ['doctor_visit', 'scan', 'blood_test', 'vaccine', 'other'];
var BOOKING_VIA = ['call', 'online', 'in_person', 'walk_in'];
// 'cancelled' and 'rescheduled' added for the Episodes rebuild (Phase 2) —
// both sit alongside the existing stage lifecycle rather than replacing
// it, since that stage tracking (waiting_for_report etc.) is still real,
// useful information once a booking IS going ahead.
var BOOKING_STATUSES = ['booked', 'done', 'waiting_for_report', 'report_uploaded', 'closed', 'cancelled', 'rescheduled'];
var SUGGESTED_BY_VALUES = ['doctor', 'patient'];
var MEDIC_KINDS = ['vaccine', 'shot', 'other'];
// A stage change stamps this timestamp field, same spelling as the status
// value it corresponds to.
var BOOKING_STAGE_TIMESTAMP_FIELD = {
  done: 'done_at', waiting_for_report: 'waiting_for_report_at', report_uploaded: 'report_uploaded_at', closed: 'closed_at'
};

function bookingsList(payload) {
  var rows = sheetToObjects('Bookings');
  if (payload) {
    if (payload.type) rows = rows.filter(function (r) { return r.type === payload.type; });
    if (payload.status) rows = rows.filter(function (r) { return r.status === payload.status; });
    if (payload.date_from) rows = rows.filter(function (r) { return dateStrOf(r.datetime) >= payload.date_from; });
    if (payload.date_to) rows = rows.filter(function (r) { return dateStrOf(r.datetime) <= payload.date_to; });
    if (payload.episode_id) rows = rows.filter(function (r) { return r.episode_id === payload.episode_id; });
  }
  rows.sort(function (a, b) { return String(b.datetime).localeCompare(String(a.datetime)); });
  return rows;
}

function bookingsCreate(payload) {
  requireFields(payload, ['type', 'title', 'datetime']);
  validateEnum(payload.type, BOOKING_TYPES, 'type');
  if (payload.booked_via) validateEnum(payload.booked_via, BOOKING_VIA, 'booked_via');
  if (payload.suggested_by) validateEnum(payload.suggested_by, SUGGESTED_BY_VALUES, 'suggested_by');
  if (payload.medic_kind) validateEnum(payload.medic_kind, MEDIC_KINDS, 'medic_kind');
  var dt = toDateTime(payload.datetime);
  if (!dt) throw new Error('Invalid datetime: ' + payload.datetime);
  var bookingDt = payload.booking_datetime ? toDateTime(payload.booking_datetime) : null;
  var now = new Date().toISOString();
  return createRow('Bookings', {
    type: payload.type,
    title: sanitizeText(payload.title, 200),
    provider: sanitizeText(payload.provider, 200),
    datetime: dt.toISOString(),
    booked_via: payload.booked_via || '',
    location: sanitizeText(payload.location, 300),
    notes: sanitizeText(payload.notes, 2000),
    approx_report_days: payload.approx_report_days === undefined ? '' : sanitizeNumber(payload.approx_report_days, 'approx_report_days'),
    status: 'booked',
    booked_at: now,
    done_at: '', waiting_for_report_at: '', report_uploaded_at: '', closed_at: '',
    closed_without_prescription: false, no_prescription_note: '',
    questions: '',
    created_at: now,
    episode_id: sanitizeText(payload.episode_id, 100),
    booking_datetime: bookingDt ? bookingDt.toISOString() : now,
    reason: sanitizeText(payload.reason, 500),
    suggested_by: payload.suggested_by || '',
    tentative_date: payload.tentative_date ? sanitizeDate(payload.tentative_date, 'tentative_date') : '',
    lab_center_name: sanitizeText(payload.lab_center_name, 200),
    lab_center_number: sanitizeText(payload.lab_center_number, 50),
    medic_shop_name: sanitizeText(payload.medic_shop_name, 200),
    medic_kind: payload.medic_kind || ''
  });
}

function bookingsUpdate(payload) {
  requireId(payload);
  var fields = {};
  if (payload.hasOwnProperty('type')) { validateEnum(payload.type, BOOKING_TYPES, 'type'); fields.type = payload.type; }
  if (payload.hasOwnProperty('title')) fields.title = sanitizeText(payload.title, 200);
  if (payload.hasOwnProperty('provider')) fields.provider = sanitizeText(payload.provider, 200);
  if (payload.hasOwnProperty('datetime')) {
    var dt = toDateTime(payload.datetime);
    if (!dt) throw new Error('Invalid datetime: ' + payload.datetime);
    fields.datetime = dt.toISOString();
  }
  if (payload.hasOwnProperty('booked_via')) { validateEnum(payload.booked_via, BOOKING_VIA, 'booked_via'); fields.booked_via = payload.booked_via; }
  if (payload.hasOwnProperty('location')) fields.location = sanitizeText(payload.location, 300);
  if (payload.hasOwnProperty('notes')) fields.notes = sanitizeText(payload.notes, 2000);
  if (payload.hasOwnProperty('approx_report_days')) fields.approx_report_days = sanitizeNumber(payload.approx_report_days, 'approx_report_days');
  if (payload.hasOwnProperty('questions')) fields.questions = sanitizeText(payload.questions, 4000);
  if (payload.hasOwnProperty('episode_id')) fields.episode_id = sanitizeText(payload.episode_id, 100);
  if (payload.hasOwnProperty('reason')) fields.reason = sanitizeText(payload.reason, 500);
  if (payload.hasOwnProperty('suggested_by')) {
    if (payload.suggested_by) validateEnum(payload.suggested_by, SUGGESTED_BY_VALUES, 'suggested_by');
    fields.suggested_by = payload.suggested_by || '';
  }
  if (payload.hasOwnProperty('lab_center_name')) fields.lab_center_name = sanitizeText(payload.lab_center_name, 200);
  if (payload.hasOwnProperty('lab_center_number')) fields.lab_center_number = sanitizeText(payload.lab_center_number, 50);
  if (payload.hasOwnProperty('medic_shop_name')) fields.medic_shop_name = sanitizeText(payload.medic_shop_name, 200);
  if (payload.hasOwnProperty('medic_kind')) {
    if (payload.medic_kind) validateEnum(payload.medic_kind, MEDIC_KINDS, 'medic_kind');
    fields.medic_kind = payload.medic_kind || '';
  }
  if (payload.hasOwnProperty('status')) {
    validateEnum(payload.status, BOOKING_STATUSES, 'status');
    if (payload.status === 'rescheduled' && !payload.tentative_date && !fields.tentative_date) {
      throw new Error('Rescheduling needs a tentative_date.');
    }
    fields.status = payload.status;
    var stampField = BOOKING_STAGE_TIMESTAMP_FIELD[payload.status];
    if (stampField) fields[stampField] = new Date().toISOString();
  }
  if (payload.hasOwnProperty('tentative_date')) fields.tentative_date = payload.tentative_date ? sanitizeDate(payload.tentative_date, 'tentative_date') : '';
  return updateRowById('Bookings', payload.id, fields);
}

function bookingsDelete(payload) {
  requireId(payload);
  return deleteRowById('Bookings', payload.id);
}

// Closing requires either an uploaded prescription (doctor_visit) or a
// report (scan/blood_test) already linked via Files.linked_booking_id —
// or, for a doctor_visit, an explicit "no prescription this time" note.
// vaccine/other close freely.
function bookingsClose(payload) {
  requireId(payload);
  var booking = getRowById('Bookings', payload.id);
  if (!booking) throw new Error('Not found: ' + payload.id);

  var linkedFiles = sheetToObjects('Files').filter(function (f) { return f.linked_booking_id === payload.id; });

  if (booking.type === 'doctor_visit') {
    var hasPrescription = linkedFiles.some(function (f) { return f.type_v2 === 'prescription'; });
    var noPrescriptionNote = payload.no_prescription_note !== undefined ? String(payload.no_prescription_note).trim() : String(booking.no_prescription_note || '').trim();
    if (!hasPrescription && !noPrescriptionNote) {
      throw new Error('Closing a doctor visit needs either an uploaded prescription or a "No prescription this time" note.');
    }
    return updateRowById('Bookings', payload.id, {
      status: 'closed', closed_at: new Date().toISOString(),
      closed_without_prescription: !hasPrescription,
      no_prescription_note: hasPrescription ? '' : sanitizeText(noPrescriptionNote, 500)
    });
  }

  if (booking.type === 'scan' || booking.type === 'blood_test') {
    var hasReport = linkedFiles.some(function (f) { return f.type_v2 === 'lab_report' || f.type_v2 === 'scan_report'; });
    if (!hasReport) throw new Error('Closing a scan/blood test needs the report uploaded and linked first.');
  }

  return updateRowById('Bookings', payload.id, { status: 'closed', closed_at: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Suggestions — doctor suggestions recorded after a visit, each with a
// one-tap follow-through action owned by the frontend (add as medicine /
// book a test / set a countdown) and a pending/done/skipped status.
// ---------------------------------------------------------------------------

var SUGGESTION_TYPES = ['medicine', 'scan', 'blood_test', 'diet_lifestyle', 'follow_up'];
var SUGGESTION_STATUSES = ['pending', 'done', 'skipped'];

function suggestionsList(payload) {
  var rows = sheetToObjects('Suggestions');
  if (payload && payload.booking_id) rows = rows.filter(function (r) { return r.booking_id === payload.booking_id; });
  if (payload && payload.status) rows = rows.filter(function (r) { return r.status === payload.status; });
  return rows;
}

function suggestionsCreate(payload) {
  requireFields(payload, ['booking_id', 'type', 'text']);
  validateEnum(payload.type, SUGGESTION_TYPES, 'type');
  return createRow('Suggestions', {
    booking_id: payload.booking_id,
    type: payload.type,
    text: sanitizeText(payload.text, 1000),
    follow_up_date: payload.follow_up_date ? sanitizeDate(payload.follow_up_date, 'follow_up_date') : '',
    status: 'pending',
    created_at: new Date().toISOString()
  });
}

function suggestionsUpdate(payload) {
  requireId(payload);
  var fields = {};
  if (payload.hasOwnProperty('status')) { validateEnum(payload.status, SUGGESTION_STATUSES, 'status'); fields.status = payload.status; }
  if (payload.hasOwnProperty('text')) fields.text = sanitizeText(payload.text, 1000);
  if (payload.hasOwnProperty('follow_up_date')) fields.follow_up_date = payload.follow_up_date ? sanitizeDate(payload.follow_up_date, 'follow_up_date') : '';
  return updateRowById('Suggestions', payload.id, fields);
}

function suggestionsDelete(payload) {
  requireId(payload);
  return deleteRowById('Suggestions', payload.id);
}

// ---------------------------------------------------------------------------
// Bills — at most one per booking in practice; separate from Bookings so
// pay-on-visit/to-collect/paid tracking doesn't clutter the stage fields.
// ---------------------------------------------------------------------------

var BILL_STATUSES = ['not_applicable', 'pay_on_visit', 'to_collect', 'paid', 'unpaid'];

function billsList(payload) {
  var rows = sheetToObjects('Bills');
  if (payload && payload.booking_id) rows = rows.filter(function (r) { return r.booking_id === payload.booking_id; });
  if (payload && payload.episode_id) rows = rows.filter(function (r) { return r.episode_id === payload.episode_id; });
  if (payload && payload.status) rows = rows.filter(function (r) { return r.status === payload.status; });
  return rows;
}

function billsCreate(payload) {
  requireFields(payload, ['status']);
  validateEnum(payload.status, BILL_STATUSES, 'status');
  return createRow('Bills', {
    booking_id: sanitizeText(payload.booking_id, 100),
    episode_id: sanitizeText(payload.episode_id, 100),
    amount: payload.amount === undefined || payload.amount === '' ? '' : sanitizeNumber(payload.amount, 'amount'),
    status: payload.status,
    paid_on: payload.paid_on ? sanitizeDate(payload.paid_on, 'paid_on') : '',
    receipt_file_id: sanitizeText(payload.receipt_file_id, 100),
    notes: sanitizeText(payload.notes, 1000)
  });
}

function billsUpdate(payload) {
  requireId(payload);
  var fields = {};
  if (payload.hasOwnProperty('amount')) fields.amount = payload.amount === '' ? '' : sanitizeNumber(payload.amount, 'amount');
  if (payload.hasOwnProperty('status')) { validateEnum(payload.status, BILL_STATUSES, 'status'); fields.status = payload.status; }
  if (payload.hasOwnProperty('paid_on')) fields.paid_on = payload.paid_on ? sanitizeDate(payload.paid_on, 'paid_on') : '';
  if (payload.hasOwnProperty('receipt_file_id')) fields.receipt_file_id = sanitizeText(payload.receipt_file_id, 100);
  if (payload.hasOwnProperty('notes')) fields.notes = sanitizeText(payload.notes, 1000);
  if (payload.hasOwnProperty('episode_id')) fields.episode_id = sanitizeText(payload.episode_id, 100);
  return updateRowById('Bills', payload.id, fields);
}

function billsDelete(payload) {
  requireId(payload);
  return deleteRowById('Bills', payload.id);
}

// ---------------------------------------------------------------------------
// Countdowns — custom countdown/timer entries (events, medicine courses,
// interval-based doses, recurring occasions, count-up timers). The "how
// many days/hours/minutes left" math is entirely client-side
// (js/countdown.js, computed locally from the device clock) — this backend
// just stores the configuration and does light, kind-aware sanity checks.
// ---------------------------------------------------------------------------

var COUNTDOWN_KINDS = ['event', 'course', 'interval', 'recurring', 'countup'];
var COUNTDOWN_REPEATS = ['none', 'daily', 'weekly', 'monthly'];

function countdownsList(payload) {
  var rows = listRows('Countdowns');
  if (payload && payload.kind) rows = rows.filter(function (r) { return r.kind === payload.kind; });
  if (payload && payload.show_on_home) rows = rows.filter(function (r) { return isTruthy(r.show_on_home); });
  return rows;
}

function countdownsAdd(payload) {
  requireFields(payload, ['title', 'kind']);
  validateCountdownKind(payload.kind);
  var fields = countdownFields(payload, true);
  validateCountdownFieldsForKind(fields, payload.kind, false);
  fields.created_at = new Date().toISOString();
  return createRow('Countdowns', fields);
}

function countdownsUpdate(payload) {
  requireId(payload);
  if (payload.hasOwnProperty('kind')) validateCountdownKind(payload.kind);
  var fields = countdownFields(payload, false);
  // Validate against the kind this row will have after the update (the new
  // kind if one was sent, otherwise whatever is already stored) — but only
  // the fields actually being changed (partial: true).
  var existing = getRowById('Countdowns', payload.id);
  var effectiveKind = payload.kind || (existing && existing.kind);
  validateCountdownFieldsForKind(fields, effectiveKind, true);
  return updateRowById('Countdowns', payload.id, fields);
}

function countdownsDelete(payload) {
  requireId(payload);
  return deleteRowById('Countdowns', payload.id);
}

function countdownsMarkDone(payload) {
  requireId(payload);
  var done = payload.done === undefined ? true : sanitizeBoolean(payload.done);
  return updateRowById('Countdowns', payload.id, { done: done });
}

function validateCountdownKind(kind) {
  if (COUNTDOWN_KINDS.indexOf(kind) === -1) throw new Error('Invalid countdown kind: ' + kind);
}

function countdownFields(payload, isCreate) {
  var fields = {};
  if (isCreate || payload.hasOwnProperty('title')) fields.title = sanitizeText(payload.title, 200);
  if (isCreate || payload.hasOwnProperty('kind')) fields.kind = payload.kind;

  if (isCreate || payload.hasOwnProperty('target_datetime')) {
    if (payload.target_datetime) {
      var dt = toDateTime(payload.target_datetime);
      if (!dt) throw new Error('Invalid target_datetime: ' + payload.target_datetime);
      fields.target_datetime = dt.toISOString();
    } else {
      fields.target_datetime = '';
    }
  }
  if (isCreate || payload.hasOwnProperty('start_date')) {
    fields.start_date = payload.start_date ? sanitizeDate(payload.start_date, 'start_date') : '';
  }
  if (isCreate || payload.hasOwnProperty('repeat')) {
    var repeat = payload.repeat || 'none';
    if (COUNTDOWN_REPEATS.indexOf(repeat) === -1) throw new Error('Invalid repeat: ' + repeat);
    fields.repeat = repeat;
  }
  if (isCreate || payload.hasOwnProperty('interval_hours')) {
    fields.interval_hours = sanitizeNumber(payload.interval_hours, 'interval_hours');
  }
  if (isCreate || payload.hasOwnProperty('linked_medicine_id')) {
    fields.linked_medicine_id = sanitizeText(payload.linked_medicine_id, 100);
  }
  if (isCreate) {
    fields.show_on_home = payload.show_on_home === undefined ? false : sanitizeBoolean(payload.show_on_home);
  } else if (payload.hasOwnProperty('show_on_home')) {
    fields.show_on_home = sanitizeBoolean(payload.show_on_home);
  }
  if (isCreate) {
    var initialOrder = sanitizeNumber(payload.pinned_order, 'pinned_order');
    fields.pinned_order = initialOrder === '' ? 0 : initialOrder;
  } else if (payload.hasOwnProperty('pinned_order')) {
    var order = sanitizeNumber(payload.pinned_order, 'pinned_order');
    fields.pinned_order = order === '' ? 0 : order;
  }
  if (isCreate || payload.hasOwnProperty('notes')) fields.notes = sanitizeText(payload.notes, 2000);
  if (isCreate) {
    fields.done = payload.done === undefined ? false : sanitizeBoolean(payload.done);
  } else if (payload.hasOwnProperty('done')) {
    fields.done = sanitizeBoolean(payload.done);
  }
  return fields;
}

// Light, kind-aware sanity checks — not exhaustive (the real "does this
// make sense" math lives client-side in countdown.js), just enough to stop
// obviously incomplete rows from being saved. On a partial update, a field
// is only checked if this call is actually changing it.
function validateCountdownFieldsForKind(fields, kind, partial) {
  function need(field) {
    if (partial && !fields.hasOwnProperty(field)) return;
    if (!fields[field]) throw new Error('A "' + kind + '" countdown requires ' + field);
  }

  if (kind === 'event') {
    need('target_datetime');
  } else if (kind === 'course') {
    need('start_date');
    need('target_datetime');
  } else if (kind === 'interval') {
    need('linked_medicine_id');
    if (!partial || fields.hasOwnProperty('interval_hours')) {
      if (!fields.interval_hours || fields.interval_hours <= 0) {
        throw new Error('An "interval" countdown requires a positive interval_hours');
      }
    }
    if (fields.linked_medicine_id && !getRowById('Medicines', fields.linked_medicine_id)) {
      throw new Error('linked_medicine_id does not match an existing medicine');
    }
  } else if (kind === 'recurring') {
    need('target_datetime');
    if (!partial || fields.hasOwnProperty('repeat')) {
      if (!fields.repeat || fields.repeat === 'none') {
        throw new Error('A "recurring" countdown requires a repeat value other than "none"');
      }
    }
  } else if (kind === 'countup') {
    need('start_date');
  }
}

// ---------------------------------------------------------------------------
// Generic CRUD helpers — shared by every entity's create/update/delete
// action above. Writes always go through these so every mutation gets a
// generated id, a lock, and only ever touches columns that actually exist
// in the sheet (whatever the caller sends is filtered against the headers).
// ---------------------------------------------------------------------------

function getHeaders(sheetName) {
  var sheet = getSheetByName(sheetName);
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function getRowById(sheetName, id) {
  return sheetToObjects(sheetName).find(function (r) { return String(r.id) === String(id); }) || null;
}

function listRows(sheetName) {
  return sheetToObjects(sheetName);
}

function createRow(sheetName, fields) {
  var id = Utilities.getUuid();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheetByName(sheetName);
    var headers = getHeaders(sheetName);
    var row = headers.map(function (h) {
      if (h === 'id') return id;
      return fields.hasOwnProperty(h) ? fields[h] : '';
    });
    sheet.appendRow(row);
    incrementDataVersion();
  } finally {
    lock.releaseLock();
  }
  return getRowById(sheetName, id);
}

function updateRowById(sheetName, id, fields) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheetByName(sheetName);
    var headers = getHeaders(sheetName);
    var idCol = headers.indexOf('id');
    var values = sheet.getDataRange().getValues();
    var rowNum = -1;
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][idCol]) === String(id)) { rowNum = i + 1; break; }
    }
    if (rowNum === -1) throw new Error('Not found: ' + id);
    headers.forEach(function (h, idx) {
      if (h === 'id') return;
      if (fields.hasOwnProperty(h)) {
        sheet.getRange(rowNum, idx + 1).setValue(fields[h]);
      }
    });
    incrementDataVersion();
  } finally {
    lock.releaseLock();
  }
  return getRowById(sheetName, id);
}

function deleteRowById(sheetName, id) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheetByName(sheetName);
    var headers = getHeaders(sheetName);
    var idCol = headers.indexOf('id');
    var values = sheet.getDataRange().getValues();
    var rowNum = -1;
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][idCol]) === String(id)) { rowNum = i + 1; break; }
    }
    if (rowNum === -1) throw new Error('Not found: ' + id);
    sheet.deleteRow(rowNum);
    incrementDataVersion();
  } finally {
    lock.releaseLock();
  }
  return { id: id };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function requireFields(payload, fields) {
  fields.forEach(function (f) {
    if (payload[f] === undefined || payload[f] === null || String(payload[f]).trim() === '') {
      throw new Error('Missing required field: ' + f);
    }
  });
}

function requireId(payload) {
  requireFields(payload, ['id']);
}

function sanitizeText(value, maxLen) {
  if (value === null || value === undefined) return '';
  return String(value).substring(0, maxLen || 2000);
}

function sanitizeNumber(value, fieldName) {
  if (value === '' || value === undefined || value === null) return '';
  var n = Number(value);
  if (isNaN(n)) throw new Error('Expected a number for ' + (fieldName || 'field') + ', got: ' + value);
  return n;
}

function sanitizeBoolean(value) {
  return value === true || String(value).toUpperCase() === 'TRUE';
}

function sanitizeDate(value, fieldName) {
  if (!value) return '';
  var str = dateStrOf(value) || String(value).substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    throw new Error('Invalid date for ' + (fieldName || 'field') + ': ' + value);
  }
  return str;
}

// ---------------------------------------------------------------------------
// Date/time helpers — all dates are handled in Asia/Kolkata (see
// appsscript.json), and sheet cells may come back as a Date object or as a
// plain "YYYY-MM-DD" string depending on how the row was written.
// ---------------------------------------------------------------------------

function parseISODate(str) {
  if (!str) return null;
  var parts = String(str).substring(0, 10).split('-');
  if (parts.length !== 3) return null;
  var y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function formatISODate(date) {
  return Utilities.formatDate(date, 'Asia/Kolkata', 'yyyy-MM-dd');
}

function dateStrOf(value) {
  if (!value) return '';
  if (value instanceof Date) return formatISODate(value);
  var str = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.substring(0, 10);
  var parsed = new Date(str);
  return isNaN(parsed.getTime()) ? '' : formatISODate(parsed);
}

function toDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  var parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function daysBetween(fromDate, toDate_) {
  var MS_PER_DAY = 24 * 60 * 60 * 1000;
  var from = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  var to = new Date(toDate_.getFullYear(), toDate_.getMonth(), toDate_.getDate());
  return Math.round((to - from) / MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------

function getSpreadsheet() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('Not set up yet. Run setup() from the Apps Script editor first.');
  return SpreadsheetApp.openById(id);
}

function getSheetByName(name) {
  var sheet = getSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Sheet tab not found: ' + name);
  return sheet;
}

// Reads a whole tab into an array of {header: value} objects, using row 1 as
// headers and skipping fully-blank rows. Delegates to
// sheetToObjectsFromSheet() (the actual implementation) so every read goes
// through the same normalization pass below.
function sheetToObjects(sheetName) {
  return sheetToObjectsFromSheet(getSheetByName(sheetName));
}

// ---------------------------------------------------------------------------
// Setup — run this once from the Apps Script editor (select setup from the
// function dropdown and click Run), not from the deployed web app.
// Safe to re-run: it reuses the Sheet/folders already stored in Script
// Properties instead of creating duplicates.
// ---------------------------------------------------------------------------

function setup() {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('SHEET_ID');
  var ss;
  if (sheetId) {
    ss = SpreadsheetApp.openById(sheetId);
  } else {
    ss = SpreadsheetApp.create('Pregnancy Care Tracker');
    props.setProperty('SHEET_ID', ss.getId());
  }

  ensureTabs(ss);

  // Clean up the blank default tab Google creates with every new Sheet.
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }

  setupDriveFolders(props, ss);

  Logger.log('Setup complete.');
  Logger.log('Sheet: ' + ss.getUrl());
  Logger.log('Next: add the APP_PIN script property (Project Settings > Script properties), then deploy as a web app. See the README.');
}

// ---------------------------------------------------------------------------
// Schema migration — single source of truth for every tab + its columns.
// ensureTabs() creates any missing tab (full header row) and APPENDS any
// column an existing tab is missing; it never rewrites or reorders columns
// that already exist, so it's safe to run against a sheet that already has
// real data in it, or one someone hand-edited. Called from setup() (once,
// by hand) and from bootstrap() (every load), so a Code.gs redeploy alone
// upgrades the Sheet automatically — no need to re-run setup() by hand
// after adding a column or a tab.
// ---------------------------------------------------------------------------

var SHEET_SCHEMA = {
  Settings: ['key', 'value'],
  Medicines: [
    'id', 'name', 'dose', 'frequency', 'times', 'start_date', 'end_date', 'prescribed_by', 'notes', 'active',
    'stock_count', 'doses_per_day', 'refill_alert_days',
    // Phase 1 (v3) scheduling model — see "Medicine scheduling" below. Old
    // rows have none of these; the engine (js/schedule.js) treats a blank
    // schedule_type as 'daily' using the existing times/frequency columns,
    // so nothing here needs a backfill.
    'schedule_type', 'anchor_mode', 'weekdays', 'interval_hours', 'interval_days', 'month_day', 'every_n_weeks',
    'total_doses', 'grace_minutes', 'instructions', 'prn_min_gap_hours', 'prn_max_per_day', 'phases',
    'reason', 'pack_id', 'status', 'stopped_on', 'stop_note', 'source',
    // Phase 4 (v3) — all optional, all switchable off globally via
    // Settings. Purpose: identify the same composition when the brand
    // differs. Photos are Files rows (type_v2: medicine_photo); these two
    // columns just point at their ids, same pattern as thumb_file_id.
    'photo_front_file_id', 'photo_back_file_id', 'composition', 'brand', 'strength', 'expiry_date',
    // Phase 5 (v3) — linked Records (prescription/bill this medicine came
    // with). See medicineFields()'s comment for why this is one-directional.
    'linked_file_ids',
    // episode_id (Episodes rebuild, Phase 5): which episode this medicine
    // was prescribed/started in, if any — optional, a long-term prenatal
    // vitamin started outside any particular visit just has ''.
    // shop_name/medic_kind: Episode Detail Block 2's own fields — where it
    // was bought, and whether this is a vaccine/shot rather than a regular
    // medicine (both optional, blank for anything added outside an episode).
    'episode_id', 'shop_name', 'medic_kind'
  ],
  MedicineLog: ['id', 'medicine_id', 'date', 'time', 'taken', 'status', 'taken_at', 'note'],
  Appointments: ['id', 'datetime', 'doctor', 'purpose', 'location', 'status', 'notes_after_visit'],
  HealthLog: ['id', 'date', 'weight_kg', 'bp_sys', 'bp_dia', 'sugar_fasting', 'sugar_pp', 'kicks', 'mood', 'symptoms', 'notes'],
  Contacts: ['id', 'name', 'role', 'phone', 'address', 'maps_link', 'is_emergency'],
  // Doctors: a separate, small entity from Contacts on purpose — this is
  // "who to pick from when booking a visit" (name/specialty/clinic), not
  // "who to call in an emergency" (Contacts' own concern, incl. hospitals/
  // pharmacies/labs). Managed in Settings; bookings.create suggests the
  // most recently used one and otherwise offers this list as a dropdown.
  Doctors: ['id', 'name', 'specialty', 'phone', 'clinic_hospital', 'notes', 'created_at'],
  FoodLog: ['id', 'date', 'meal', 'items', 'craving_or_aversion', 'notes'],
  Checklist: ['id', 'list', 'item', 'done'],
  Files: [
    'id', 'drive_file_id', 'title', 'type', 'date', 'doctor', 'notes', 'mime', 'thumb_file_id',
    // Phase 3 (v3): the new six-category Records view. type_v2 is additive
    // on purpose — the old `type` column (report/scan/prescription/
    // document) is never rewritten, so nothing already uploaded changes.
    // A blank type_v2 (every pre-Phase-3 file) means "needs sorting" —
    // the frontend buckets those separately, nothing is hidden or lost.
    'type_v2', 'linked_booking_id',
    // linked_file_ids: other Files rows this one is connected to (a bill
    // to its report, two reports from the same scan, etc.) — comma-joined
    // ids, always kept symmetric by files.link/files.unlink (linking A to
    // B adds B to A's list AND A to B's list in the same call).
    'linked_file_ids',
    // episode_id (Phase 3): direct episode link, set alongside
    // linked_booking_id when a file is added from inside an episode —
    // kept independent of the booking link since the brief calls for
    // reports/bills to carry their own episode link, not just an implied
    // one through whichever booking they happen to be attached to.
    // report_type (Episode Detail Block 3): scan/blood/urine/other — a
    // finer category than type_v2's own lab_report/scan_report, only
    // meaningful when type_v2 is one of those two.
    'episode_id', 'report_type'
  ],
  Countdowns: [
    'id', 'title', 'kind', 'target_datetime', 'start_date', 'repeat', 'interval_hours',
    'linked_medicine_id', 'show_on_home', 'pinned_order', 'notes', 'done', 'created_at'
  ],
  // A pack is a recurring daily group of medicines usually taken together
  // at one time (e.g. "Evening pack" at 8pm). member_medicine_ids is a
  // comma-joined list of Medicines ids — kept as plain text (not a join
  // table) since packs are small and this sheet is hand-readable.
  Packs: ['id', 'name', 'times', 'member_medicine_ids', 'created_at'],

  // --- Phase 2 (v3): daily check-in, symptoms, water, food ---------------
  // Checkins: "how are you feeling" — mood + a quick note. Multiple per day
  // are expected and each is its own row/timeline entry, never overwritten.
  Checkins: ['id', 'date', 'time', 'mood', 'note', 'created_at'],
  // Symptoms: symptom_key is one of SYMPTOM_KEYS below, or 'custom' (with
  // custom_name filled in) for anything she adds herself. bleeding_scale is
  // only meaningful for the bleeding/spotting symptom keys.
  // notify (dashboard rebuild, fix #4): opt-in per entry, same pattern as
  // Notes.alert_level — '' / false by default, only set when the person
  // explicitly turns it on for this one entry. A true row shows up in the
  // notification bell's list; never computed automatically from severity
  // or any other field.
  Symptoms: ['id', 'date', 'time', 'symptom_key', 'custom_name', 'severity', 'bleeding_scale', 'note', 'created_at', 'notify'],
  // Water: each row is one "add a glass" tap (glasses is usually 1, but
  // left numeric in case a future UI lets her log more than one at once).
  Water: ['id', 'date', 'time', 'glasses', 'created_at'],
  // FoodPrefs: a liked/not-interested list she curates over time — status
  // can change, so `date` is "when this status was last set", not a log.
  FoodPrefs: ['id', 'name', 'status', 'date', 'notes'],

  // Notes: the Quick Add box's fallback for anything that isn't a
  // recognized intent (category 'note') plus "question for the doctor"
  // (category 'question') — both just free text, shown in the Timeline so
  // nothing typed is ever silently lost.
  // photo_file_id: an optional photo attached when the note was saved — a
  // Files row id (type_v2: other), same pattern as every other photo
  // pointer in this schema (medicine photos, etc.).
  Notes: [
    'id', 'date', 'time', 'category', 'text', 'photo_file_id', 'created_at',
    // --- Episodes rebuild (Phase 4) ----------------------------------
    // episode_id: which episode this note belongs to (blank for a plain
    // Quick-Add note with no episode context, which is still allowed).
    // block: which part of the episode this note is attached to —
    // 'booking' | 'report' | 'bill' | 'medicine' | 'episode' (the one
    // final note at the end) | '' (a non-episode Quick-Add note).
    // block_ref_id: the specific booking/report/bill/medicine id, when
    // block isn't 'episode' or ''.
    // alert_level: '' by default (no status at all, per the brief) —
    // only 'red'/'orange'/'green' when the person explicitly turns an
    // alert on for this specific note. An alerted note is what drives an
    // in-app notification and can act as a countdown; this column is the
    // only place alert severity exists anywhere in this schema — it is
    // never computed automatically from any other data.
    'episode_id', 'block', 'block_ref_id', 'alert_level'
  ],

  // --- Phase 3 (v3): bookings, suggestions, bills -----------------------
  // Bookings replaces the plain Appointments flow for anything booked
  // (doctor visit, scan, blood test, vaccine, other) that needs real
  // status tracking. Each stage change stamps its own timestamp so the
  // frontend can show "report took 2 days 4h" etc. without recomputing
  // from scratch. Appointments itself is untouched — simple quick-add
  // appointments (Phase 1) still use it.
  Bookings: [
    'id', 'type', 'title', 'provider', 'datetime', 'booked_via', 'location', 'notes',
    'approx_report_days', 'status', 'booked_at', 'done_at', 'waiting_for_report_at',
    'report_uploaded_at', 'closed_at', 'closed_without_prescription', 'no_prescription_note', 'created_at',
    // questions: her own "questions to ask" checklist for this visit, kept
    // as plain text (one question per line, a leading "[x] " marking it
    // ticked) rather than a separate tab — simple enough not to need one.
    'questions',
    // --- Episodes rebuild (Phase 2) ---------------------------------------
    // episode_id: which Episode this booking belongs to — every new
    // booking has one (the frontend always links-to-existing or
    // creates-new before calling bookings.create); old rows just have ''.
    // booking_datetime: when the booking/call was actually made, distinct
    // from `datetime` (when the visit/test/pickup is scheduled for).
    // reason/suggested_by: the brief's own fields, both optional.
    // tentative_date: only meaningful once status is 'rescheduled' — the
    // new candidate date, kept separate from `datetime` so "what was
    // originally scheduled" isn't lost.
    'episode_id', 'booking_datetime', 'reason', 'suggested_by', 'tentative_date',
    // Type-specific extras — only one group is ever filled in per row,
    // depending on `type`. Flat optional columns rather than a second
    // sheet: there are only 4 of them and every Bookings row already
    // tolerates a long tail of blank columns (see approx_report_days etc.)
    'lab_center_name', 'lab_center_number', 'medic_shop_name', 'medic_kind'
  ],
  // Suggestions: doctor suggestions recorded after a visit (medicine, scan,
  // blood test, diet/lifestyle advice, follow-up date), each actionable
  // from the Visits view (add as medicine / book a test / set a countdown)
  // and tracked to pending/done/skipped.
  Suggestions: ['id', 'booking_id', 'type', 'text', 'follow_up_date', 'status', 'created_at'],
  // Bills: at most one per booking in practice, kept separate (not columns
  // on Bookings) so "pay on visit" / "collect later" / paid-on tracking
  // doesn't clutter the booking's own stage-tracking fields.
  Bills: ['id', 'booking_id', 'amount', 'status', 'paid_on', 'receipt_file_id', 'notes', 'episode_id'],

  // --- Episodes rebuild (Phase 1) -----------------------------------------
  // Episode is the new organizing unit everything else will link to
  // (bookings/reports/bills/medicines/notes all gain an episode_id in
  // later phases — see each sheet's own comment when that lands). Phase 1
  // only builds the Episode entity itself: create/view/edit, nothing links
  // to it yet. trimester is stored (not purely derived) since the spec
  // calls it a mandatory field the person can see/edit, even though it's
  // pre-filled from Settings' due_date/lmp_date at creation time. Status
  // is deliberately NOT a column — like everywhere else in this schema
  // (stock status, dose status), it's derived at render time, here from
  // the episode's linked bookings once Phase 2 wires that up; until then
  // the frontend just shows "no bookings yet".
  Episodes: ['id', 'name', 'start_date', 'end_date', 'trimester', 'notes', 'created_at']
};

// ss is optional — pass it explicitly from setup() (where SHEET_ID may only
// have just been written to Script Properties this same execution); omit it
// elsewhere and it's read the normal way via getSpreadsheet().
function ensureTabs(ss) {
  ss = ss || getSpreadsheet();

  Object.keys(SHEET_SCHEMA).forEach(function (tabName) {
    var targetHeaders = SHEET_SCHEMA[tabName];
    var sheet = ss.getSheetByName(tabName);

    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      sheet.getRange(1, 1, 1, targetHeaders.length).setValues([targetHeaders]);
      sheet.setFrozenRows(1);
      return;
    }

    var lastCol = sheet.getLastColumn();
    var existingHeaders = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    var missingHeaders = targetHeaders.filter(function (h) { return existingHeaders.indexOf(h) === -1; });
    if (missingHeaders.length) {
      sheet.getRange(1, lastCol + 1, 1, missingHeaders.length).setValues([missingHeaders]);
    }
    if (sheet.getFrozenRows() < 1) sheet.setFrozenRows(1);
  });

  ensureSettingsSeeded(ss);
}

// Seeds the user-editable Settings keys (empty string) and the data_version
// counter (0) if they're not already present — additive only, same
// never-touch-existing-values rule as ensureTabs() itself.
function ensureSettingsSeeded(ss) {
  var settingsSheet = ss.getSheetByName('Settings');
  var existingKeys = sheetToObjectsFromSheet(settingsSheet).map(function (r) { return r.key; });
  SETTINGS_KEYS.forEach(function (key) {
    if (existingKeys.indexOf(key) === -1) settingsSheet.appendRow([key, '']);
  });
  if (existingKeys.indexOf('data_version') === -1) {
    settingsSheet.appendRow(['data_version', 0]);
  }
}

// Same as sheetToObjects, but takes a Sheet object directly — needed inside
// setup(), before SHEET_ID is necessarily readable via getSpreadsheet().
//
// This is the single choke point every read (list/get, and create/update's
// "return the saved row" step via getRowById) passes through, which is also
// where every cell gets normalized to a predictable JS type — see
// "Output normalization" below. Google Sheets auto-detects a cell's type
// from how it looks (a column that's ever held something date-shaped comes
// back as a real Date object from getValues(), a lone "08:00" can come back
// as a Date too, "TRUE"/"FALSE" can be a native boolean or literal text
// depending on how the cell was set), independent of what was actually
// written — so without this pass, the exact same data can come back shaped
// differently sheet to sheet, or even cell to cell, purely because of
// Sheets' own auto-formatting. The mock fixtures in js/store.js never have
// this problem (they're plain JS objects to begin with), which is why a bug
// here can be invisible in mock mode and only show up against the real
// Sheet.
function sheetToObjectsFromSheet(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 1) return [];
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row.join('') === '') continue;
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = normalizeFieldValue(headers[j], row[j]);
    }
    rows.push(obj);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Output normalization — every column name below means the same thing on
// every tab it appears on, so this is one global map (by header name, not
// per-tab) rather than one per sheet. Anything not listed here is passed
// through as-is (free text, ids, enums, comma-joined id lists — none of
// which Sheets can silently reshape the way it does dates/times/booleans/
// numbers).
// ---------------------------------------------------------------------------

var FIELD_TYPES = {
  // Dates (calendar day only, no time-of-day)
  start_date: 'date', end_date: 'date', stopped_on: 'date', expiry_date: 'date',
  date: 'date', paid_on: 'date', follow_up_date: 'date',
  // Times (no date component — "08:00", every day)
  time: 'time',
  times: 'time_list', // comma-joined list of times, e.g. Medicines/Packs
  // Full timestamps
  datetime: 'datetime', target_datetime: 'datetime', taken_at: 'datetime',
  created_at: 'datetime', booked_at: 'datetime', done_at: 'datetime',
  waiting_for_report_at: 'datetime', report_uploaded_at: 'datetime', closed_at: 'datetime',
  // Booleans
  active: 'bool', taken: 'bool', done: 'bool', is_emergency: 'bool',
  show_on_home: 'bool', closed_without_prescription: 'bool',
  // Numbers (blank stays blank — a number field with nothing entered isn't 0)
  stock_count: 'number', doses_per_day: 'number', refill_alert_days: 'number',
  interval_hours: 'number', interval_days: 'number', month_day: 'number', every_n_weeks: 'number',
  total_doses: 'number', grace_minutes: 'number', prn_min_gap_hours: 'number', prn_max_per_day: 'number',
  pinned_order: 'number', weight_kg: 'number', bp_sys: 'number', bp_dia: 'number',
  sugar_fasting: 'number', sugar_pp: 'number', kicks: 'number', mood: 'number',
  glasses: 'number', approx_report_days: 'number', amount: 'number'
  // Deliberately NOT typed as number/bool/date despite looking like they
  // could be: phone (keeps leading zeros/+), severity/bleeding_scale
  // (enum strings, not a 1-5 scale), weekdays/phases (their own comma/JSON
  // text format, parsed by the frontend).
};

function normalizeFieldValue(key, value) {
  var type = FIELD_TYPES[key];
  // Booleans normalize even when blank (a legacy row predating the column
  // means "not set", which reads the same as false everywhere it's used).
  if (type === 'bool') return sanitizeBoolean(value);
  if (value === '' || value === null || value === undefined) return '';
  switch (type) {
    case 'date': return dateStrOf(value);
    case 'time': return timeStrOf(value);
    case 'time_list':
      // A lone time with no comma can itself come back as a Date (Sheets
      // auto-detecting a single time-looking cell) — String()-ing it first
      // would turn it into a full Date.toString() dump that the per-piece
      // split below can't parse, so that exact shape must be handled here.
      if (value instanceof Date) return timeStrOf(value);
      return String(value).split(',').map(function (t) { return timeStrOf(t.trim()); }).filter(Boolean).join(',');
    case 'datetime': return dateTimeStrOf(value);
    case 'number': var n = Number(value); return isNaN(n) ? value : n;
    default:
      // No declared type: pass text through untouched, but a stray Date
      // object (an unlisted column Sheets still auto-detected) must never
      // survive to JSON.stringify as-is — it would silently serialize as a
      // UTC instant with no frontend code expecting that shape.
      return value instanceof Date ? dateTimeStrOf(value) : value;
  }
}

// "08:00" from either a Date (Sheets auto-detected a lone time-looking cell)
// or text already in/close to that shape.
function timeStrOf(value) {
  if (!value) return '';
  if (value instanceof Date) return Utilities.formatDate(value, 'Asia/Kolkata', 'HH:mm');
  var str = String(value);
  var match = str.match(/^(\d{1,2}):(\d{2})/);
  if (match) return match[1].length === 1 ? '0' + match[1] + ':' + match[2] : match[1] + ':' + match[2];
  return str;
}

// "yyyy-MM-ddTHH:mm" — matches exactly what an <input type="datetime-local">
// reads/writes, and sorts correctly as a plain string.
function dateTimeStrOf(value) {
  if (!value) return '';
  if (value instanceof Date) return Utilities.formatDate(value, 'Asia/Kolkata', "yyyy-MM-dd'T'HH:mm");
  var str = String(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) return str.substring(0, 16);
  var parsed = new Date(str);
  return isNaN(parsed.getTime()) ? str : Utilities.formatDate(parsed, 'Asia/Kolkata', "yyyy-MM-dd'T'HH:mm");
}

function setupDriveFolders(props, ss) {
  var rootId = props.getProperty('DRIVE_FOLDER_ROOT');
  var root;
  if (rootId) {
    root = DriveApp.getFolderById(rootId);
  } else {
    root = DriveApp.createFolder('Pregnancy Care Tracker Files');
    props.setProperty('DRIVE_FOLDER_ROOT', root.getId());
  }

  var subfolders = {
    DRIVE_FOLDER_REPORT: 'Reports',
    DRIVE_FOLDER_SCAN: 'Scans',
    DRIVE_FOLDER_PRESCRIPTION: 'Prescriptions',
    DRIVE_FOLDER_DOCUMENT: 'Documents',
    DRIVE_FOLDER_THUMB: 'Thumbs'
  };

  Object.keys(subfolders).forEach(function (propKey) {
    if (props.getProperty(propKey)) return;
    var folderName = subfolders[propKey];
    var existing = root.getFoldersByName(folderName);
    var folder = existing.hasNext() ? existing.next() : root.createFolder(folderName);
    props.setProperty(propKey, folder.getId());
  });

  Logger.log('Drive root folder: ' + root.getUrl());
}

// ---------------------------------------------------------------------------
// Telegram reminders (step 10)
//
// One-time setup from the Apps Script editor:
//   1. Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID script properties
//      (see the README for how to get both).
//   2. Run createDailyReminderTrigger() once from the function dropdown.
// After that, sendDailyReminder() runs automatically every morning.
// ---------------------------------------------------------------------------

function createDailyReminderTrigger() {
  removeDailyReminderTriggers();
  ScriptApp.newTrigger('sendDailyReminder')
    .timeBased()
    .atHour(7)
    .nearMinute(0)
    .everyDays(1)
    .inTimezone('Asia/Kolkata')
    .create();
  Logger.log('Daily reminder trigger created for ~7:00 AM Asia/Kolkata.');
}

function removeDailyReminderTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'sendDailyReminder') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function sendDailyReminder() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TELEGRAM_BOT_TOKEN');
  var chatId = props.getProperty('TELEGRAM_CHAT_ID');
  if (!token || !chatId) {
    Logger.log('Telegram not configured — skipping reminder. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID script properties.');
    return;
  }
  sendTelegramMessage(token, chatId, buildDailyReminderMessage());
}

function buildDailyReminderMessage() {
  var dashboard = dashboardGet();
  var lines = ['Good morning! 🌸'];

  if (dashboard.gestational_age) {
    var age = dashboard.gestational_age;
    lines.push('Week ' + age.weeks + ', day ' + age.days + ' (trimester ' + age.trimester + ').');
    if (age.days_left !== null) {
      lines.push(age.days_left >= 0
        ? age.days_left + ' days to go.'
        : Math.abs(age.days_left) + ' days past the due date.');
    }
  }

  var soonAppointment = getAppointmentWithin24Hours();
  if (soonAppointment) {
    lines.push('');
    lines.push('⏰ Appointment coming up: ' + soonAppointment.purpose + ' at ' + soonAppointment.when);
  }

  var todaysBookings = getTodaysBookingsForReminder();
  if (todaysBookings.length) {
    lines.push('');
    lines.push("Today's bookings:");
    todaysBookings.forEach(function (b) { lines.push('• ' + b.when + ' — ' + b.title); });
  }

  var reportFollowUps = getBookingReportFollowUps();
  if (reportFollowUps.length) {
    lines.push('');
    lines.push('📋 Waiting on:');
    reportFollowUps.forEach(function (line) { lines.push('• ' + line); });
  }

  var dueToday = getTodaysDueMedicinesV3();
  if (dueToday.length) {
    lines.push('');
    lines.push("Today's medicines:");
    dueToday.forEach(function (m) {
      lines.push('• ' + m.time + ' — ' + m.name + (m.dose ? ' (' + m.dose + ')' : '') + (m.note ? ' ' + m.note : ''));
    });
  } else if (dashboard.today_medicines && dashboard.today_medicines.length) {
    // Fallback for medicines that still have no schedule_type at all
    // (never migrated through the v3 Add Medicine sheet).
    lines.push('');
    lines.push("Today's medicines:");
    dashboard.today_medicines.forEach(function (m) {
      lines.push('• ' + m.time + ' — ' + m.name + (m.dose ? ' (' + m.dose + ')' : ''));
    });
  }

  var upcomingShots = getUpcomingShotsWithinDays(2);
  if (upcomingShots.length) {
    lines.push('');
    lines.push('💉 Due within 2 days:');
    upcomingShots.forEach(function (line) { lines.push('• ' + line); });
  }

  var waterLine = getWaterBehindNudge();
  if (waterLine) {
    lines.push('');
    lines.push(waterLine);
  }

  var expiring = getExpiringMedicines();
  if (expiring.length) {
    lines.push('');
    lines.push('⚠️ Expiry:');
    expiring.forEach(function (line) { lines.push('• ' + line); });
  }

  return lines.join('\n');
}

// A lean, message-only reimplementation of js/schedule.js's due-today
// logic — not the full interactive engine (no late/missed grading, no
// grace windows), just "is a dose due on the calendar today, and what
// time". Finished/stopped medicines are always excluded. PRN medicines
// have no fixed slot, so they're never included here by design.
function getTodaysDueMedicinesV3() {
  var today = new Date();
  var todayStr = formatISODate(today);
  var weekday = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][today.getDay()];
  var results = [];

  sheetToObjects('Medicines').forEach(function (m) {
    if (!m.schedule_type) return; // no v3 schedule — covered by the dashboard fallback instead
    if (m.status && m.status !== 'active') return;
    if (m.start_date && dateStrOf(m.start_date) > todayStr) return;
    if (m.end_date && dateStrOf(m.end_date) < todayStr) return;

    var packNote = m.pack_id ? packNoteFor(m.pack_id) : '';
    var type = m.schedule_type;

    if (type === 'daily') {
      splitCommaList(m.times).forEach(function (time) { results.push({ name: m.name, dose: m.dose, time: time, note: packNote }); });
    } else if (type === 'weekdays') {
      if (splitCommaList(m.weekdays).indexOf(weekday) === -1) return;
      splitCommaList(m.times).forEach(function (time) { results.push({ name: m.name, dose: m.dose, time: time, note: packNote }); });
    } else if (type === 'every_n_days') {
      var start = parseISODate(m.start_date);
      if (!start) return;
      var n = Number(m.interval_days) || 1;
      var diff = daysBetween(start, today);
      if (diff < 0 || diff % n !== 0) return;
      splitCommaList(m.times).forEach(function (time) { results.push({ name: m.name, dose: m.dose, time: time, note: packNote }); });
    } else if (type === 'interval') {
      var next = nextIntervalDoseV3(m);
      if (next && formatISODate(next) === todayStr) {
        results.push({ name: m.name, dose: m.dose, time: Utilities.formatDate(next, 'Asia/Kolkata', 'HH:mm'), note: packNote });
      }
    }
    // weekly/monthly show up in getUpcomingShotsWithinDays instead, not here.
  });

  results.sort(function (a, b) { return String(a.time).localeCompare(String(b.time)); });
  return results;
}

function packNoteFor(packId) {
  var pack = getRowById('Packs', packId);
  return pack ? '(' + pack.name + ')' : '';
}

function splitCommaList(value) {
  return String(value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

// Mirrors js/schedule.js's nextDose() for an 'interval' medicine, from_last
// anchor only (fixed-grid interval medicines are rare enough in practice
// that the daily summary just skips them rather than re-deriving the grid
// here) — last taken dose + interval_hours.
function nextIntervalDoseV3(m) {
  var intervalHours = Number(m.interval_hours);
  if (!intervalHours) return null;
  if (m.anchor_mode !== 'from_last') return null;
  var lastTakenAt = null;
  sheetToObjects('MedicineLog').forEach(function (log) {
    if (String(log.medicine_id) !== String(m.id)) return;
    var taken = log.status === 'taken' || (log.status === undefined && isTruthy(log.taken));
    if (!taken || !log.taken_at) return;
    var at = new Date(log.taken_at);
    if (!lastTakenAt || at > lastTakenAt) lastTakenAt = at;
  });
  if (!lastTakenAt) return null;
  return new Date(lastTakenAt.getTime() + intervalHours * 60 * 60 * 1000);
}

// Weekly/monthly shots due within N days (including overdue — a missed
// weekly shot doesn't stop mattering just because the day passed).
function getUpcomingShotsWithinDays(withinDays) {
  var today = new Date();
  var lines = [];
  sheetToObjects('Medicines').forEach(function (m) {
    if (m.status && m.status !== 'active') return;
    if (m.schedule_type !== 'weekly' && m.schedule_type !== 'monthly') return;
    for (var i = -30; i <= withinDays; i++) {
      var d = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
      var isScheduled = m.schedule_type === 'weekly'
        ? splitCommaList(m.weekdays).indexOf(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()]) !== -1
        : d.getDate() === Math.min(Number(m.month_day) || 1, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
      if (!isScheduled) continue;
      var wasGiven = sheetToObjects('MedicineLog').some(function (log) {
        return String(log.medicine_id) === String(m.id) && dateStrOf(log.date) === formatISODate(d) && (log.status === 'taken' || isTruthy(log.taken));
      });
      if (wasGiven) continue;
      var daysAway = i;
      lines.push(m.name + (daysAway < 0 ? ' (overdue since ' + Utilities.formatDate(d, 'Asia/Kolkata', 'MMM d') + ')' : daysAway === 0 ? ' (today)' : ' (in ' + daysAway + 'd)'));
      break; // one line per medicine is enough for a daily summary
    }
  });
  return lines;
}

function getTodaysBookingsForReminder() {
  var todayStr = formatISODate(new Date());
  return sheetToObjects('Bookings').filter(function (b) {
    return dateStrOf(b.datetime) === todayStr && b.status !== 'closed';
  }).map(function (b) {
    return { title: b.title, when: Utilities.formatDate(toDateTime(b.datetime), 'Asia/Kolkata', 'h:mm a') };
  });
}

// Bookings waiting on a report that's about due, or a doctor visit that's
// 'done' but still needs its prescription uploaded.
function getBookingReportFollowUps() {
  var now = new Date();
  var lines = [];
  sheetToObjects('Bookings').forEach(function (b) {
    if (b.status === 'waiting_for_report' && b.approx_report_days && b.waiting_for_report_at) {
      var expected = new Date(new Date(b.waiting_for_report_at).getTime() + Number(b.approx_report_days) * 86400000);
      if (expected <= now) lines.push(b.title + ': report should be ready — check/collect it');
    }
    if (b.type === 'doctor_visit' && b.status === 'done') {
      lines.push(b.title + ': upload the prescription (or close with "no prescription")');
    }
  });
  return lines;
}

function getWaterBehindNudge() {
  var settings = settingsGet();
  var goalGlasses = Number(settings.water_goal_glasses) || 8;
  var todayStr = formatISODate(new Date());
  var todayGlasses = sheetToObjects('Water').filter(function (w) { return dateStrOf(w.date) === todayStr; })
    .reduce(function (sum, w) { return sum + (Number(w.glasses) || 1); }, 0);
  if (todayGlasses >= goalGlasses) return null;
  return '💧 ' + todayGlasses + ' of ' + goalGlasses + ' glasses of water so far today.';
}

// Active medicines with an expiry_date within Settings.expiry_alert_days
// (default 30) of expiring, or already expired.
function getExpiringMedicines() {
  var settings = settingsGet();
  var alertDays = Number(settings.expiry_alert_days) || 30;
  var today = new Date();
  var lines = [];
  sheetToObjects('Medicines').forEach(function (m) {
    if (!m.expiry_date) return;
    if (m.status && m.status !== 'active') return;
    var expiry = parseISODate(dateStrOf(m.expiry_date));
    if (!expiry) return;
    var daysLeft = daysBetween(today, expiry);
    if (daysLeft < 0) lines.push(m.name + ': expired ' + Math.abs(daysLeft) + ' day(s) ago');
    else if (daysLeft <= alertDays) lines.push(m.name + ': expires in ' + daysLeft + ' day(s)');
  });
  return lines;
}

function getAppointmentWithin24Hours() {
  var now = new Date();
  var in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  var upcoming = sheetToObjects('Appointments').filter(function (row) {
    var status = String(row.status || '').toLowerCase();
    if (status === 'done' || status === 'missed') return false;
    var dt = toDateTime(row.datetime);
    return dt && dt >= now && dt <= in24h;
  });
  if (!upcoming.length) return null;
  upcoming.sort(function (a, b) { return toDateTime(a.datetime) - toDateTime(b.datetime); });
  var next = upcoming[0];
  return {
    purpose: next.purpose || next.doctor || 'Appointment',
    when: Utilities.formatDate(toDateTime(next.datetime), 'Asia/Kolkata', 'MMM d, h:mm a')
  };
}

function sendTelegramMessage(token, chatId, text) {
  var url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chatId, text: text }),
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    Logger.log('Telegram send failed (' + code + '): ' + response.getContentText());
  }
}
