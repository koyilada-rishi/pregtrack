/**
 * Pregnancy Care Tracker — Apps Script backend.
 *
 * Run setup() once from the Apps Script editor (not via the web app) to
 * create the Sheet, its tabs, and the Drive folder tree, and to store their
 * IDs in Script Properties. Then add the APP_PIN script property by hand
 * (Project Settings > Script properties) before deploying as a web app.
 * See the README for full step-by-step deploy instructions.
 *
 * All real requests come in as doPost({postData:{contents: JSON string}}),
 * body shape: {pin, action, payload}. Every action requires a valid pin.
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
// Action routing — add a case here for every new action as steps 5-10 add
// medicines/appointments/healthlog/contacts/foodlog/checklist/files CRUD.
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
  'hospital_name', 'hospital_phone', 'hospital_address', 'insurance_info', 'language'
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

function settingsSet(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheetByName('Settings');
    var values = sheet.getDataRange().getValues();
    var rowOfKey = {};
    for (var i = 1; i < values.length; i++) {
      rowOfKey[values[i][0]] = i + 1; // 1-based sheet row number
    }
    SETTINGS_KEYS.forEach(function (key) {
      if (!payload.hasOwnProperty(key)) return;
      var value = sanitizeSettingValue(payload[key]);
      if (rowOfKey[key]) {
        sheet.getRange(rowOfKey[key], 2).setValue(value);
      } else {
        sheet.appendRow([key, value]);
      }
    });
  } finally {
    lock.releaseLock();
  }
  return settingsGet();
}

function sanitizeSettingValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).substring(0, 2000);
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

function getNextAppointment(today) {
  var upcoming = sheetToObjects('Appointments').filter(function (row) {
    var status = String(row.status || '').toLowerCase();
    if (status === 'done' || status === 'missed') return false;
    var dt = toDateTime(row.datetime);
    return dt && dt.getTime() >= today.getTime();
  });
  upcoming.sort(function (a, b) { return toDateTime(a.datetime) - toDateTime(b.datetime); });
  if (upcoming.length === 0) return null;

  var next = upcoming[0];
  return {
    id: next.id,
    datetime: toDateTime(next.datetime).toISOString(),
    doctor: next.doctor || '',
    purpose: next.purpose || '',
    location: next.location || ''
  };
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
// headers and skipping fully-blank rows. Used by every read-only action;
// steps 5-8 add the matching create/update/delete helpers alongside their
// own CRUD actions.
function sheetToObjects(sheetName) {
  var values = getSheetByName(sheetName).getDataRange().getValues();
  if (values.length < 1) return [];
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row.join('') === '') continue;
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j];
    }
    rows.push(obj);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Setup — run this once from the Apps Script editor (select setup from the
// function dropdown and click Run), not from the deployed web app.
// Safe to re-run: it reuses the Sheet/folders already stored in Script
// Properties instead of creating duplicates.
// ---------------------------------------------------------------------------

function setup() {
  var props = PropertiesService.getScriptProperties();

  var ss = setupSpreadsheet(props);
  setupDriveFolders(props, ss);

  Logger.log('Setup complete.');
  Logger.log('Sheet: ' + ss.getUrl());
  Logger.log('Next: add the APP_PIN script property (Project Settings > Script properties), then deploy as a web app. See the README.');
}

function setupSpreadsheet(props) {
  var sheetId = props.getProperty('SHEET_ID');
  var ss;
  if (sheetId) {
    ss = SpreadsheetApp.openById(sheetId);
  } else {
    ss = SpreadsheetApp.create('Pregnancy Care Tracker');
    props.setProperty('SHEET_ID', ss.getId());
  }

  var schema = {
    Settings: ['key', 'value'],
    Medicines: ['id', 'name', 'dose', 'frequency', 'times', 'start_date', 'end_date', 'prescribed_by', 'notes', 'active'],
    MedicineLog: ['id', 'medicine_id', 'date', 'time', 'taken'],
    Appointments: ['id', 'datetime', 'doctor', 'purpose', 'location', 'status', 'notes_after_visit'],
    HealthLog: ['id', 'date', 'weight_kg', 'bp_sys', 'bp_dia', 'sugar_fasting', 'sugar_pp', 'kicks', 'mood', 'symptoms', 'notes'],
    Contacts: ['id', 'name', 'role', 'phone', 'address', 'maps_link', 'is_emergency'],
    FoodLog: ['id', 'date', 'meal', 'items', 'craving_or_aversion', 'notes'],
    Checklist: ['id', 'list', 'item', 'done'],
    Files: ['id', 'drive_file_id', 'title', 'type', 'date', 'doctor', 'notes']
  };

  Object.keys(schema).forEach(function (tabName) {
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) sheet = ss.insertSheet(tabName);
    var headers = schema[tabName];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  });

  // Clean up the blank default tab Google creates with every new Sheet.
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }

  // Seed default Settings keys so settings.get always returns a stable shape.
  var settingsSheet = ss.getSheetByName('Settings');
  var existingKeys = sheetToObjectsFromSheet(settingsSheet).map(function (r) { return r.key; });
  SETTINGS_KEYS.forEach(function (key) {
    if (existingKeys.indexOf(key) === -1) settingsSheet.appendRow([key, '']);
  });

  return ss;
}

// Same as sheetToObjects, but takes a Sheet object directly — needed inside
// setup(), before SHEET_ID is necessarily readable via getSpreadsheet().
function sheetToObjectsFromSheet(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 1) return [];
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row.join('') === '') continue;
    var obj = {};
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = row[j];
    rows.push(obj);
  }
  return rows;
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
    DRIVE_FOLDER_DOCUMENT: 'Documents'
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
