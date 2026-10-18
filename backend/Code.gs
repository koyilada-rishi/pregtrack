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
    case 'files.delete':
      return filesDelete(payload);

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
      var value = sanitizeText(payload[key], 2000);
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
// Medicines + MedicineLog
// ---------------------------------------------------------------------------

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
  return fields;
}

function medicinesLogTaken(payload) {
  requireFields(payload, ['medicine_id', 'date', 'time']);
  var targetDate = sanitizeDate(payload.date, 'date');
  var taken = payload.taken === undefined ? true : sanitizeBoolean(payload.taken);

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

    for (var i = 1; i < values.length; i++) {
      if (String(values[i][medCol]) === String(payload.medicine_id) &&
          dateStrOf(values[i][dateCol]) === targetDate &&
          String(values[i][timeCol]) === String(payload.time)) {
        sheet.getRange(i + 1, takenCol + 1).setValue(taken);
        return { id: values[i][idCol], medicine_id: payload.medicine_id, date: targetDate, time: payload.time, taken: taken };
      }
    }
    var id = Utilities.getUuid();
    sheet.appendRow([id, payload.medicine_id, targetDate, payload.time, taken]);
    return { id: id, medicine_id: payload.medicine_id, date: targetDate, time: payload.time, taken: taken };
  } finally {
    lock.releaseLock();
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

function filesList(payload) {
  var rows = listRows('Files').map(function (r) {
    return { id: r.id, title: r.title, type: r.type, date: dateStrOf(r.date), doctor: r.doctor, notes: r.notes };
  });
  if (payload) {
    if (payload.type) rows = rows.filter(function (r) { return r.type === payload.type; });
    if (payload.date_from) rows = rows.filter(function (r) { return r.date >= payload.date_from; });
    if (payload.date_to) rows = rows.filter(function (r) { return r.date <= payload.date_to; });
  }
  rows.sort(function (a, b) { return b.date.localeCompare(a.date); });
  return rows;
}

function filesUpload(payload) {
  requireFields(payload, ['title', 'type', 'base64', 'filename']);
  if (FILE_TYPES.indexOf(payload.type) === -1) throw new Error('Invalid file type: ' + payload.type);

  var bytes;
  try {
    bytes = Utilities.base64Decode(payload.base64);
  } catch (e) {
    throw new Error('Could not decode file data.');
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error('File is too large (max 8 MB). Please choose a smaller file.');
  }

  var folder = driveFolderForType(payload.type);
  var blob = Utilities.newBlob(bytes, payload.mimeType || 'application/octet-stream', sanitizeText(payload.filename, 300));
  var file = folder.createFile(blob);

  return createRow('Files', {
    drive_file_id: file.getId(),
    title: sanitizeText(payload.title, 200),
    type: payload.type,
    date: sanitizeDate(payload.date || formatISODate(new Date()), 'date'),
    doctor: sanitizeText(payload.doctor, 200),
    notes: sanitizeText(payload.notes, 1000)
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
// headers and skipping fully-blank rows.
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

  if (dashboard.today_medicines && dashboard.today_medicines.length) {
    lines.push('');
    lines.push("Today's medicines:");
    dashboard.today_medicines.forEach(function (m) {
      lines.push('• ' + m.time + ' — ' + m.name + (m.dose ? ' (' + m.dose + ')' : ''));
    });
  }

  return lines.join('\n');
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
