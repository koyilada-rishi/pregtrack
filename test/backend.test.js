// Fakes just enough of the Apps Script runtime to exercise Code.gs's logic
// in Node. Not a substitute for testing against the real deployment, but
// catches off-by-one row/column bugs, validation gaps, and upsert logic
// before you touch Script Properties for real.
const crypto = require("crypto");
const fs = require("fs");

class FakeSheet {
  constructor(headers) {
    this.rows = [headers.slice()];
  }
  getDataRange() {
    const self = this;
    return { getValues: () => self.rows.map((r) => r.slice()) };
  }
  getRange(r, c, numRows, numCols) {
    const self = this;
    numRows = numRows || 1;
    numCols = numCols || 1;
    return {
      getValues: () => {
        const result = [];
        for (let i = 0; i < numRows; i++) {
          const row = self.rows[r - 1 + i] || [];
          const slice = [];
          for (let j = 0; j < numCols; j++) slice.push(row[c - 1 + j]);
          result.push(slice);
        }
        return result;
      },
      setValues: (vals) => {
        for (let i = 0; i < vals.length; i++) {
          const rowIdx = r - 1 + i;
          while (self.rows.length <= rowIdx) self.rows.push([]);
          for (let j = 0; j < vals[i].length; j++) self.rows[rowIdx][c - 1 + j] = vals[i][j];
        }
      },
      setValue: (v) => {
        const rowIdx = r - 1;
        while (self.rows.length <= rowIdx) self.rows.push([]);
        self.rows[rowIdx][c - 1] = v;
      }
    };
  }
  appendRow(arr) { this.rows.push(arr.slice()); }
  deleteRow(r) { this.rows.splice(r - 1, 1); }
  getLastColumn() { return this.rows[0].length; }
  setFrozenRows(n) { this._frozenRows = n; }
  getFrozenRows() { return this._frozenRows || 0; }
}

class FakeSpreadsheet {
  constructor() { this.sheets = {}; }
  getSheetByName(name) { return this.sheets[name] || null; }
  insertSheet(name) { const s = new FakeSheet([]); this.sheets[name] = s; return s; }
  getSheets() { return Object.values(this.sheets); }
  deleteSheet(s) { for (const k in this.sheets) if (this.sheets[k] === s) delete this.sheets[k]; }
  getUrl() { return "https://fake/sheet"; }
  getId() { return "fake-sheet-id"; }
}

const fakeProps = {};
global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (k) => (k in fakeProps ? fakeProps[k] : null),
    setProperty: (k, v) => { fakeProps[k] = v; }
  })
};
global.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };

// Real in-memory cache now (v2 needs it: data_version is cache-backed for
// fast version.get reads) — TTL is ignored, which is fine for these tests.
const fakeCacheStore = {};
global.CacheService = {
  getScriptCache: () => ({
    get: (k) => (k in fakeCacheStore ? fakeCacheStore[k] : null),
    put: (k, v) => { fakeCacheStore[k] = v; },
    remove: (k) => { delete fakeCacheStore[k]; }
  })
};

let fakeSS;
global.SpreadsheetApp = {
  create: () => { fakeSS = new FakeSpreadsheet(); return fakeSS; },
  openById: () => fakeSS
};

global.Utilities = {
  getUuid: () => "id-" + Math.random().toString(36).slice(2),
  computeDigest: (_algo, bytes) => Array.from(crypto.createHash("sha256").update(Buffer.from(bytes)).digest()),
  newBlob: (bytesOrStr, mime, name) => {
    const bytes = typeof bytesOrStr === "string" ? Array.from(Buffer.from(bytesOrStr)) : bytesOrStr;
    return { getBytes: () => bytes, getContentType: () => mime, getName: () => name };
  },
  base64Decode: (b64) => Array.from(Buffer.from(b64, "base64")),
  base64Encode: (bytes) => Buffer.from(bytes).toString("base64"),
  formatDate: (date) => {
    const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, "0"), d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  },
  DigestAlgorithm: { SHA_256: "SHA_256" }
};

const fakeDriveFiles = {};
let fakeFileCounter = 0;
let fakeFolderCounter = 0;
function makeFakeFolder() {
  const folderId = "folder-" + (++fakeFolderCounter);
  return {
    getId: () => folderId,
    createFile(blob) {
      const id = "file-" + (++fakeFileCounter);
      fakeDriveFiles[id] = { blob, name: blob.getName() };
      return { getId: () => id };
    },
    getFoldersByName() { return { hasNext: () => false, next: () => null }; },
    createFolder() { return makeFakeFolder(); },
    getUrl() { return "https://fake/folder"; }
  };
}
global.DriveApp = {
  createFolder: () => makeFakeFolder(),
  getFolderById: () => makeFakeFolder(),
  getFileById: (id) => {
    const rec = fakeDriveFiles[id];
    if (!rec) throw new Error("No such file: " + id);
    return { getBlob: () => rec.blob, getName: () => rec.name, setTrashed: () => {} };
  }
};

global.ScriptApp = {
  getProjectTriggers: () => [],
  newTrigger: () => ({ timeBased: () => ({ atHour: () => ({ nearMinute: () => ({ everyDays: () => ({ inTimezone: () => ({ create: () => {} }) }) }) }) }) })
};
global.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 200, getContentText: () => "" }) };
global.Logger = { log: () => {} };
global.ContentService = { createTextOutput: (s) => ({ setMimeType: () => ({ _text: s }) }), MimeType: { JSON: "JSON" } };

const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "backend", "Code.gs"), "utf8");
eval(src);

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log("ok   " + label); }
  else { fail++; console.error("FAIL " + label); }
}
function throws(label, fn) {
  try { fn(); check(label, false); }
  catch (e) { check(label + " (" + e.message + ")", true); }
}

// --- setup() ---
setup();
fakeProps.APP_PIN = "246810";
check("setup created all 18 tabs", Object.keys(fakeSS.sheets).sort().join(",") ===
  "Appointments,Checklist,Contacts,FoodLog,HealthLog,MedicineLog,Medicines,Settings,Files,Countdowns,Packs,Checkins,Symptoms,Water,FoodPrefs,Bookings,Suggestions,Bills".split(",").sort().join(","));
check("Settings seeded with 15 editable keys + data_version", fakeSS.sheets.Settings.rows.length === 17); // header + 15 keys + data_version

// --- PIN check ---
check("checkPin correct", checkPin("246810") === true);
check("checkPin wrong", checkPin("000000") === false);
check("checkPin close-but-wrong", checkPin("246811") === false);

// --- settings ---
settingsSet({ due_date: "2027-03-01", wife_name: "Priya" });
const s = settingsGet();
check("settings round-trip", s.due_date === "2027-03-01" && s.wife_name === "Priya");
check("settings unknown keys ignored", (() => { settingsSet({ not_a_real_key: "x" }); return settingsGet().not_a_real_key === undefined; })());

// --- medicines CRUD ---
const med = medicinesCreate({ name: "Folic acid", dose: "5mg", times: "08:00,20:00", start_date: "2026-10-01" });
check("medicine created with id", !!med.id);
check("medicine active defaults true", med.active === true);
const medUpdated = medicinesUpdate({ id: med.id, dose: "10mg" });
check("medicine update changes dose", medUpdated.dose === "10mg");
check("medicine update preserves name", medUpdated.name === "Folic acid");
throws("medicinesCreate requires name", () => medicinesCreate({ dose: "1mg" }));
throws("medicinesUpdate requires id", () => medicinesUpdate({ dose: "1mg" }));

// --- medicinesLogTaken upsert ---
const log1 = medicinesLogTaken({ medicine_id: med.id, date: "2026-10-18", time: "08:00" });
check("logTaken creates entry, taken true by default", log1.taken === true);
const log2 = medicinesLogTaken({ medicine_id: med.id, date: "2026-10-18", time: "08:00", taken: false });
check("logTaken upserts same id (no duplicate row)", log2.id === log1.id);
check("logTaken upsert changes taken value", log2.taken === false);
check("MedicineLog has exactly 1 data row after upsert", fakeSS.sheets.MedicineLog.rows.length === 2); // header + 1

throws("medicinesDelete missing id", () => medicinesDelete({}));
medicinesDelete({ id: med.id });
check("medicine deleted", getRowById("Medicines", med.id) === null);

// --- appointments ---
const appt = appointmentsCreate({ datetime: "2026-11-01T10:00:00+05:30", doctor: "Dr. Rao", purpose: "Checkup" });
check("appointment default status upcoming", appt.status === "upcoming");
throws("appointment invalid datetime rejected", () => appointmentsCreate({ datetime: "not-a-date" }));
throws("appointment invalid status rejected", () => appointmentsUpdate({ id: appt.id, status: "bogus" }));
const apptDone = appointmentsUpdate({ id: appt.id, status: "done", notes_after_visit: "All good" });
check("appointment status update works", apptDone.status === "done");
appointmentsDelete({ id: appt.id });
check("appointment deleted", getRowById("Appointments", appt.id) === null);

// --- health log ---
const hl = healthlogCreate({ date: "2026-10-18", weight_kg: 62.5, bp_sys: 118, bp_dia: 76, kicks: 10 });
check("healthlog numeric fields stored as numbers", typeof hl.weight_kg === "number" && hl.weight_kg === 62.5);
throws("healthlog rejects non-numeric weight", () => healthlogCreate({ date: "2026-10-19", weight_kg: "abc" }));
throws("healthlog requires date", () => healthlogCreate({ weight_kg: 60 }));
healthlogDelete({ id: hl.id });

// --- contacts ---
const contact = contactsCreate({ name: "Dr. Rao", role: "OB-GYN", phone: "+911234567890", is_emergency: true });
check("contact is_emergency boolean true", contact.is_emergency === true);
const contact2 = contactsCreate({ name: "Pharmacy" });
check("contact is_emergency defaults false", contact2.is_emergency === false);
throws("contact requires name", () => contactsCreate({ role: "x" }));

// --- foodlog ---
const fl = foodlogCreate({ date: "2026-10-18", meal: "Breakfast", items: "Idli, sambar" });
check("foodlog created", !!fl.id);
throws("foodlog requires meal", () => foodlogCreate({ date: "2026-10-18" }));

// --- checklist ---
const item = checklistCreate({ list: "hospital_bag", item: "Phone charger" });
check("checklist item created, done defaults false", item.done === false);
throws("checklist rejects invalid list", () => checklistCreate({ list: "not_a_list", item: "x" }));
const itemDone = checklistUpdate({ id: item.id, done: true });
check("checklist toggle done", itemDone.done === true);
check("checklistList filters by list", checklistList({ list: "hospital_bag" }).length === 1);
check("checklistList filters out other lists", checklistList({ list: "documents" }).length === 0);

// --- files ---
const smallBase64 = Buffer.from("x".repeat(1000)).toString("base64");
const uploaded = filesUpload({ title: "Scan 1", type: "scan", filename: "scan1.jpg", mimeType: "image/jpeg", base64: smallBase64, date: "2026-10-18" });
check("file uploaded with drive_file_id", !!uploaded.drive_file_id);
const fetched = filesGet({ id: uploaded.id });
check("file round-trips base64 content", fetched.base64 === smallBase64);
check("filesList returns uploaded file", filesList({}).some((f) => f.id === uploaded.id));
check("filesList filters by type", filesList({ type: "document" }).every((f) => f.type === "document"));
filesDelete({ id: uploaded.id });
check("file deleted from sheet", getRowById("Files", uploaded.id) === null);

throws("filesUpload rejects invalid type", () => filesUpload({ title: "x", type: "bogus", filename: "a", base64: smallBase64 }));

const bigBase64 = Buffer.alloc(9 * 1024 * 1024).toString("base64");
throws("filesUpload rejects file over 8MB", () => filesUpload({ title: "Big", type: "document", filename: "big.pdf", base64: bigBase64 }));

// --- dashboard integration (after all the create/delete churn above) ---
const med2 = medicinesCreate({ name: "Iron", times: "09:00", start_date: "2026-10-01" });
const dash = dashboardGet();
check("dashboard shows pending medicine", dash.today_medicines.some((m) => m.medicine_id === med2.id));
check("dashboard gestational_age computed from due_date", dash.gestational_age && dash.gestational_age.weeks >= 0);

// --- routeAction dispatch sanity ---
check("routeAction dispatches medicines.list", Array.isArray(routeAction("medicines.list", {})));
throws("routeAction rejects unknown action", () => routeAction("not.a.real.action", {}));

// --- v2: data_version ---
const versionBefore = getDataVersion();
check("data_version seeded at 0 then incremented by prior writes", versionBefore > 0);

medicinesCreate({ name: "Vitamin D", times: "10:00", start_date: "2026-10-01" });
const versionAfterCreate = getDataVersion();
check("creating a row bumps data_version", versionAfterCreate === versionBefore + 1);

settingsSet({ wife_name: "Changed Name" });
const versionAfterSettings = getDataVersion();
check("settings.set bumps data_version", versionAfterSettings === versionAfterCreate + 1);

const medForLog = medicinesCreate({ name: "Calcium", times: "12:00", start_date: "2026-10-01" });
const versionBeforeLog = getDataVersion(); // captured after the create above, so its +1 is already included
medicinesLogTaken({ medicine_id: medForLog.id, date: "2026-10-18", time: "12:00" });
check("medicinesLogTaken (create path) bumps data_version", getDataVersion() === versionBeforeLog + 1);
const versionBeforeLogUpsert = getDataVersion();
medicinesLogTaken({ medicine_id: medForLog.id, date: "2026-10-18", time: "12:00", taken: false });
check("medicinesLogTaken (upsert path) also bumps data_version", getDataVersion() === versionBeforeLogUpsert + 1);

// Cache-hit path: clear the underlying sheet's data_version row by writing
// a decoy value directly, and confirm getDataVersion() still returns the
// cached number (proving it isn't re-reading the sheet on every call).
const settingsSheetRef = fakeSS.sheets.Settings;
const dvRowIdx = settingsSheetRef.rows.findIndex((r) => r[0] === "data_version");
const sheetValueBeforeTamper = settingsSheetRef.rows[dvRowIdx][1];
settingsSheetRef.rows[dvRowIdx][1] = -9999; // tamper directly, bypassing the cache
check("getDataVersion serves from cache, ignoring the tampered sheet value", getDataVersion() === sheetValueBeforeTamper);
delete fakeCacheStore["data_version"]; // simulate cache expiry/eviction
check("getDataVersion falls back to the sheet on a cold cache", getDataVersion() === -9999);
settingsSheetRef.rows[dvRowIdx][1] = sheetValueBeforeTamper; // restore
delete fakeCacheStore["data_version"];
getDataVersion(); // repopulate cache with the real value

// --- v2: version.get and bootstrap actions ---
const versionAction = routeAction("version.get", {});
check("version.get returns {data_version}", typeof versionAction.data_version === "number");

const boot = routeAction("bootstrap", {});
check("bootstrap includes data_version", typeof boot.data_version === "number");
check("bootstrap includes settings", boot.settings && typeof boot.settings.wife_name === "string");
check("bootstrap includes dashboard", boot.dashboard && "gestational_age" in boot.dashboard);
check("bootstrap includes medicines array", Array.isArray(boot.medicines) && boot.medicines.length > 0);
check("bootstrap includes appointments/healthlog/contacts/foodlog/checklist/files arrays",
  [boot.appointments, boot.healthlog, boot.contacts, boot.foodlog, boot.checklist, boot.files].every(Array.isArray));
check("bootstrap omits raw MedicineLog (by design)", !("medicineLog" in boot) && !("medicinelog" in boot));

// --- v2: Files schema additions ---
check("Files sheet has mime and thumb_file_id columns", (() => {
  const headers = fakeSS.sheets.Files.rows[0];
  return headers.includes("mime") && headers.includes("thumb_file_id");
})());

// --- v2: Thumbs Drive folder created by setup() ---
check("DRIVE_FOLDER_THUMB script property set by setup()", !!fakeProps.DRIVE_FOLDER_THUMB);

// --- Countdowns + schema migration (this session's task) ---

check("Countdowns tab created by setup()", !!fakeSS.sheets.Countdowns);
check("Medicines sheet has stock columns", (() => {
  const headers = fakeSS.sheets.Medicines.rows[0];
  return headers.includes("stock_count") && headers.includes("doses_per_day") && headers.includes("refill_alert_days");
})());

// Simulate an existing sheet from BEFORE this migration: an old-style
// Medicines tab with no stock columns, carrying real data, plus no
// Countdowns tab at all. ensureTabs() must add what's missing without
// disturbing the existing row.
const legacyMedicines = new FakeSheet(["id", "name", "dose", "frequency", "times", "start_date", "end_date", "prescribed_by", "notes", "active"]);
legacyMedicines.appendRow(["legacy-1", "Old Med", "1mg", "daily", "08:00", "2026-01-01", "", "Dr. Legacy", "pre-existing note", true]);
fakeSS.sheets.Medicines = legacyMedicines;
delete fakeSS.sheets.Countdowns;

ensureTabs();

check("ensureTabs() adds missing stock columns to an existing Medicines sheet", (() => {
  const headers = fakeSS.sheets.Medicines.rows[0];
  return headers.includes("stock_count") && headers.includes("doses_per_day") && headers.includes("refill_alert_days");
})());
check("ensureTabs() does not disturb the pre-existing Medicines row", (() => {
  const row = sheetToObjects("Medicines").find((r) => r.id === "legacy-1");
  return row && row.name === "Old Med" && row.notes === "pre-existing note" && row.prescribed_by === "Dr. Legacy";
})());
check("ensureTabs() creates the missing Countdowns tab", !!fakeSS.sheets.Countdowns);
check("ensureTabs() is idempotent (running twice adds nothing extra)", (() => {
  const before = fakeSS.sheets.Medicines.rows[0].length;
  ensureTabs();
  return fakeSS.sheets.Medicines.rows[0].length === before;
})());

// --- Countdowns CRUD ---

throws("countdownsAdd requires title+kind", () => countdownsAdd({}));
throws("countdownsAdd rejects an invalid kind", () => countdownsAdd({ title: "x", kind: "bogus" }));
throws("event countdown requires target_datetime", () => countdownsAdd({ title: "Baby shower", kind: "event" }));

const eventCd = countdownsAdd({ title: "Baby shower", kind: "event", target_datetime: "2026-12-01T10:00:00+05:30" });
check("event countdown created", !!eventCd.id && eventCd.kind === "event");
check("event countdown got created_at", typeof eventCd.created_at === "string" && eventCd.created_at.length > 0);
check("event countdown show_on_home defaults false", eventCd.show_on_home === false);

throws("course countdown requires start_date and target_datetime", () => countdownsAdd({ title: "Antibiotics", kind: "course", start_date: "2026-10-18" }));
const courseCd = countdownsAdd({ title: "Antibiotics", kind: "course", start_date: "2026-10-18", target_datetime: "2026-10-25T00:00:00+05:30" });
check("course countdown created", courseCd.kind === "course");

const medForInterval = medicinesCreate({ name: "Pain reliever", times: "08:00,20:00", start_date: "2026-10-01" });
throws("interval countdown requires linked_medicine_id", () => countdownsAdd({ title: "Dose", kind: "interval", interval_hours: 6 }));
throws("interval countdown requires positive interval_hours", () => countdownsAdd({ title: "Dose", kind: "interval", linked_medicine_id: medForInterval.id, interval_hours: 0 }));
throws("interval countdown rejects a non-existent linked medicine", () => countdownsAdd({ title: "Dose", kind: "interval", linked_medicine_id: "no-such-id", interval_hours: 6 }));
const intervalCd = countdownsAdd({ title: "Dose", kind: "interval", linked_medicine_id: medForInterval.id, interval_hours: 6 });
check("interval countdown created", intervalCd.kind === "interval" && intervalCd.linked_medicine_id === medForInterval.id);

throws("recurring countdown requires repeat != none", () => countdownsAdd({ title: "Weekly checkin", kind: "recurring", target_datetime: "2026-10-20T09:00:00+05:30", repeat: "none" }));
const recurringCd = countdownsAdd({ title: "Weekly checkin", kind: "recurring", target_datetime: "2026-10-20T09:00:00+05:30", repeat: "weekly" });
check("recurring countdown created", recurringCd.repeat === "weekly");

throws("countup countdown requires start_date", () => countdownsAdd({ title: "Bump watch", kind: "countup" }));
const countupCd = countdownsAdd({ title: "Bump watch", kind: "countup", start_date: "2026-06-01" });
check("countup countdown created", countupCd.kind === "countup");

check("countdownsList returns all", countdownsList({}).length >= 5);
check("countdownsList filters by kind", countdownsList({ kind: "event" }).every((c) => c.kind === "event"));

const pinned = countdownsUpdate({ id: eventCd.id, show_on_home: true, pinned_order: 1 });
check("countdownsUpdate pins to Home", pinned.show_on_home === true && pinned.pinned_order === 1);
check("countdownsList show_on_home filter", countdownsList({ show_on_home: true }).some((c) => c.id === eventCd.id));

throws("partial update still enforces the kind's requirements when touched", () => countdownsUpdate({ id: eventCd.id, target_datetime: "" }));

const doneCd = countdownsMarkDone({ id: courseCd.id });
check("countdownsMarkDone sets done", doneCd.done === true);

countdownsDelete({ id: countupCd.id });
check("countdownsDelete removes the row", getRowById("Countdowns", countupCd.id) === null);

// --- Stock adjustment on medicines.logTaken ---

const stockMed = medicinesCreate({ name: "Iron", times: "09:00", start_date: "2026-10-01", stock_count: 10, doses_per_day: 1 });
const takenOnce = medicinesLogTaken({ medicine_id: stockMed.id, date: "2026-10-18", time: "09:00", taken: true });
check("stock decrements by 1 on a new taken dose", getRowById("Medicines", stockMed.id).stock_count === 9);
medicinesLogTaken({ medicine_id: stockMed.id, date: "2026-10-18", time: "09:00", taken: true }); // duplicate call, same state
check("stock does not double-decrement on a redundant taken->taken call", getRowById("Medicines", stockMed.id).stock_count === 9);
medicinesLogTaken({ medicine_id: stockMed.id, date: "2026-10-18", time: "09:00", taken: false }); // undo
check("stock increments back when a dose is un-marked", getRowById("Medicines", stockMed.id).stock_count === 10);

const noStockMed = medicinesCreate({ name: "No stock tracking", times: "09:00", start_date: "2026-10-01" });
medicinesLogTaken({ medicine_id: noStockMed.id, date: "2026-10-18", time: "09:00", taken: true });
check("medicine with no stock_count is left untouched (not forced to a number)", getRowById("Medicines", noStockMed.id).stock_count === "");

// Clamp at zero, never negative.
const lowStockMed = medicinesCreate({ name: "Almost out", times: "09:00,21:00", start_date: "2026-10-01", stock_count: 1 });
medicinesLogTaken({ medicine_id: lowStockMed.id, date: "2026-10-18", time: "09:00", taken: true });
medicinesLogTaken({ medicine_id: lowStockMed.id, date: "2026-10-18", time: "21:00", taken: true });
check("stock clamps at 0, never goes negative", getRowById("Medicines", lowStockMed.id).stock_count === 0);

// --- Bootstrap includes the new fields ---

const bootWithCountdowns = routeAction("bootstrap", {});
check("bootstrap includes countdowns array", Array.isArray(bootWithCountdowns.countdowns) && bootWithCountdowns.countdowns.length > 0);
check("bootstrap includes latest_medicine_doses", Array.isArray(bootWithCountdowns.latest_medicine_doses));
// stockMed's only dose was un-marked (taken: false) as the last step above,
// so it correctly should NOT appear — lowStockMed still has taken:true doses.
check("latest_medicine_doses excludes a dose that was un-marked", !bootWithCountdowns.latest_medicine_doses.some((d) => d.medicine_id === stockMed.id));
check("latest_medicine_doses has an entry for the medicine with taken doses", bootWithCountdowns.latest_medicine_doses.some((d) => d.medicine_id === lowStockMed.id));
check("latest_medicine_doses picks the later of two taken doses the same day", bootWithCountdowns.latest_medicine_doses.find((d) => d.medicine_id === lowStockMed.id).time === "21:00");

// --- Phase 1 (v3): medicine scheduling model ---

check("ensureTabs() adds the new Medicines scheduling columns", (() => {
  const headers = fakeSS.sheets.Medicines.rows[0];
  return ["schedule_type", "anchor_mode", "weekdays", "interval_hours", "interval_days", "month_day",
    "every_n_weeks", "total_doses", "grace_minutes", "instructions", "prn_min_gap_hours", "prn_max_per_day",
    "phases", "reason", "pack_id", "status", "stopped_on", "stop_note", "source"].every((h) => headers.includes(h));
})());
check("ensureTabs() adds the new MedicineLog columns", (() => {
  const headers = fakeSS.sheets.MedicineLog.rows[0];
  return headers.includes("status") && headers.includes("taken_at") && headers.includes("note");
})());
check("ensureTabs() creates the Packs tab", !!fakeSS.sheets.Packs);

const scheduled = medicinesCreate({
  name: "Amoxicillin", schedule_type: "interval", anchor_mode: "from_last", interval_hours: 8,
  grace_minutes: 90, instructions: "after_food", total_doses: 15, reason: "Doctor suggested"
});
check("medicine created with v3 scheduling fields", scheduled.schedule_type === "interval" &&
  scheduled.anchor_mode === "from_last" && scheduled.interval_hours === 8 && scheduled.grace_minutes === 90 &&
  scheduled.instructions === "after_food" && scheduled.total_doses === 15);
check("medicine status defaults to active", scheduled.status === "active");
throws("medicinesCreate rejects an invalid schedule_type", () => medicinesCreate({ name: "x", schedule_type: "bogus" }));
throws("medicinesCreate rejects an invalid instructions value", () => medicinesCreate({ name: "x", instructions: "bogus" }));
throws("medicinesCreate rejects an invalid anchor_mode", () => medicinesCreate({ name: "x", anchor_mode: "bogus" }));

const weeklyShot = medicinesCreate({ name: "Iron shot", schedule_type: "weekly", weekdays: "sun" });
check("weekly-shot medicine created", weeklyShot.schedule_type === "weekly" && weeklyShot.weekdays === "sun");

const prnMed = medicinesCreate({ name: "Paracetamol", schedule_type: "prn", prn_min_gap_hours: 6, prn_max_per_day: 3 });
check("PRN medicine created", prnMed.schedule_type === "prn" && prnMed.prn_min_gap_hours === 6 && prnMed.prn_max_per_day === 3);

// --- medicines.stop ---

const stopped = medicinesStop({ id: weeklyShot.id, stop_note: "Course complete" });
check("medicines.stop sets status to stopped", stopped.status === "stopped");
check("medicines.stop clears the old `active` flag too (dashboard compat)", stopped.active === false);
check("medicines.stop records a stop_note", stopped.stop_note === "Course complete");
check("medicines.stop defaults stopped_on to today", !!stopped.stopped_on);
throws("medicines.stop requires an id", () => medicinesStop({}));

// Setting status via a plain update also flips `active`, unless the caller
// sets `active` itself in the same call.
const resumed = medicinesUpdate({ id: weeklyShot.id, status: "active" });
check("medicines.update: setting status back to active flips `active` back on", resumed.active === true);
const overridden = medicinesUpdate({ id: weeklyShot.id, status: "finished", active: true });
check("medicines.update: an explicit `active` in the same call wins over the status-sync default", overridden.active === true);

// --- medicinesLogTaken: richer status/note/taken_at shape ---

const richMed = medicinesCreate({ name: "Rich log test", schedule_type: "daily" });
const takenLog = medicinesLogTaken({ medicine_id: richMed.id, date: "2026-10-19", time: "08:00", status: "taken", note: "with breakfast" });
check("logTaken (status shape) creates a taken entry with a note", takenLog.status === "taken" && takenLog.taken === true && takenLog.note === "with breakfast");
check("logTaken (status shape) sets taken_at", typeof takenLog.taken_at === "string" && takenLog.taken_at.length > 0);

const skippedLog = medicinesLogTaken({ medicine_id: richMed.id, date: "2026-10-19", time: "20:00", status: "skipped" });
check("logTaken can record a skipped dose", skippedLog.status === "skipped" && skippedLog.taken === false);

const missedLog = medicinesLogTaken({ medicine_id: richMed.id, date: "2026-10-19", time: "12:00", status: "missed" });
check("logTaken can record a missed dose", missedLog.status === "missed" && missedLog.taken === false);
throws("logTaken rejects an invalid status", () => medicinesLogTaken({ medicine_id: richMed.id, date: "2026-10-19", time: "12:00", status: "bogus" }));

// Old-style boolean calls still work exactly as before (back-compat).
const boolLog = medicinesLogTaken({ medicine_id: richMed.id, date: "2026-10-19", time: "14:00", taken: true });
check("logTaken still accepts the old boolean `taken` shape", boolLog.status === "taken" && boolLog.taken === true);

// A bare re-toggle (no note in the payload) preserves whatever note was
// already stored, rather than wiping it out.
const noteKept = medicinesLogTaken({ medicine_id: richMed.id, date: "2026-10-19", time: "08:00", taken: false });
check("logTaken: toggling taken without sending `note` preserves the existing note", noteKept.note === "with breakfast");

// --- medicinelog.list (unbounded, for the Medicines history view) ---

const fullLog = routeAction("medicinelog.list", { medicine_id: richMed.id });
check("medicinelog.list returns every log row for a medicine, no day cutoff", fullLog.length === 4);
// Same sort convention as medicinesHistory: most recent date first, then
// chronological (not reverse-chronological) within a single day.
check("medicinelog.list sorts same-day entries chronologically", fullLog[0].time === "08:00" && fullLog[fullLog.length - 1].time === "20:00");

// --- Packs ---

const packMemberA = medicinesCreate({ name: "Pack member A", schedule_type: "daily" });
const packMemberB = medicinesCreate({ name: "Pack member B", schedule_type: "daily" });
throws("packsCreate requires a name", () => packsCreate({}));
const pack = packsCreate({ name: "Evening pack", times: "20:00", member_medicine_ids: [packMemberA.id, packMemberB.id] });
check("pack created with a comma-joined member list", pack.member_medicine_ids === `${packMemberA.id},${packMemberB.id}`);
check("packs.list returns the pack", routeAction("packs.list", {}).some((p) => p.id === pack.id));

const packTick = packsTickAll({ id: pack.id, date: "2026-10-19", time: "20:00" });
check("packsTickAll logs every member", packTick.logs.length === 2);
check("packsTickAll's logs are all marked taken", packTick.logs.every((l) => l.status === "taken"));
check("packsTickAll actually wrote MedicineLog rows for member A", medicineLogList({ medicine_id: packMemberA.id }).some((l) => l.time === "20:00" && l.status === "taken"));

const packUpdated = packsUpdate({ id: pack.id, member_medicine_ids: [packMemberA.id] });
check("packsUpdate can shrink the member list", packUpdated.member_medicine_ids === packMemberA.id);
throws("packsUpdate requires an id", () => packsUpdate({ name: "x" }));

packsDelete({ id: pack.id });
check("packsDelete removes the pack", getRowById("Packs", pack.id) === null);
throws("packsTickAll rejects an unknown pack id", () => packsTickAll({ id: "no-such-pack", date: "2026-10-19", time: "20:00" }));

// --- Bootstrap includes packs ---

const bootWithPacks = routeAction("bootstrap", {});
check("bootstrap includes a packs array", Array.isArray(bootWithPacks.packs));

// --- Phase 2 (v3): Checkins ---

throws("checkinsCreate requires date+mood", () => checkinsCreate({}));
throws("checkinsCreate rejects mood out of range", () => checkinsCreate({ date: "2026-10-19", mood: 6 }));
const checkin = checkinsCreate({ date: "2026-10-19", time: "09:00", mood: 4, note: "Feeling okay" });
check("checkin created with mood+note", checkin.mood === 4 && checkin.note === "Feeling okay");
checkinsCreate({ date: "2026-10-19", time: "20:00", mood: 2, note: "Tired" });
check("checkinsList returns both entries for the day, newest first", checkinsList({}).length === 2 && checkinsList({})[0].time === "20:00");
check("checkinsList respects date_from/date_to", checkinsList({ date_from: "2026-10-20" }).length === 0);
checkinsDelete({ id: checkin.id });
check("checkinsDelete removes the entry", checkinsList({}).length === 1);

// --- Phase 2: Symptoms ---

throws("symptomsCreate requires date+symptom_key", () => symptomsCreate({ date: "2026-10-19" }));
throws("symptomsCreate rejects an invalid symptom_key", () => symptomsCreate({ date: "2026-10-19", symptom_key: "bogus" }));
throws("symptomsCreate requires custom_name when symptom_key is custom", () => symptomsCreate({ date: "2026-10-19", symptom_key: "custom" }));
throws("symptomsCreate rejects an invalid severity", () => symptomsCreate({ date: "2026-10-19", symptom_key: "nausea", severity: "bogus" }));
throws("symptomsCreate rejects an invalid bleeding_scale", () => symptomsCreate({ date: "2026-10-19", symptom_key: "bleeding", bleeding_scale: "bogus" }));

const symptom = symptomsCreate({ date: "2026-10-19", symptom_key: "headache", severity: "mild", note: "After lunch" });
check("symptom created", symptom.symptom_key === "headache" && symptom.severity === "mild");
const customSymptom = symptomsCreate({ date: "2026-10-19", symptom_key: "custom", custom_name: "Weird taste", severity: "mild" });
check("custom symptom created with custom_name", customSymptom.custom_name === "Weird taste");
const bleedingSymptom = symptomsCreate({ date: "2026-10-19", symptom_key: "bleeding", severity: "severe", bleeding_scale: "more_than_one_pad" });
check("bleeding symptom created with a bleeding_scale", bleedingSymptom.bleeding_scale === "more_than_one_pad");

const fixedNote = symptomsUpdate({ id: symptom.id, note: "Pantop helped, stopped after a week" });
check("symptomsUpdate can attach a fix note", fixedNote.note === "Pantop helped, stopped after a week");
check("symptomsUpdate never touches severity even if sent", (() => {
  const updated = symptomsUpdate({ id: symptom.id, severity: "severe", note: "still mild really" });
  return updated.severity === "mild"; // severity silently ignored by symptomsUpdate — it only ever writes `note`
})());
throws("symptomsUpdate requires an id", () => symptomsUpdate({ note: "x" }));

check("symptomsList filters by symptom_key", symptomsList({ symptom_key: "headache" }).every((s) => s.symptom_key === "headache"));
symptomsDelete({ id: customSymptom.id });
check("symptomsDelete removes the entry", getRowById("Symptoms", customSymptom.id) === null);

// --- Phase 2: Water ---

throws("waterAdd requires a date", () => waterAdd({}));
const glass1 = waterAdd({ date: "2026-10-19", time: "09:00" });
check("waterAdd defaults glasses to 1", glass1.glasses === 1);
waterAdd({ date: "2026-10-19", time: "11:00" });
waterAdd({ date: "2026-10-20", time: "09:00" });
check("waterList returns everything with no filter", waterList({}).length === 3);
check("waterList filters by date_from", waterList({ date_from: "2026-10-20" }).length === 1);
waterDelete({ id: glass1.id });
check("waterDelete removes one glass (undo-a-tap)", waterList({ date_from: "2026-10-19", date_to: "2026-10-19" }).length === 1);
throws("waterDelete requires an id", () => waterDelete({}));

// --- Phase 2: FoodPrefs ---

throws("foodprefsCreate requires name+status", () => foodprefsCreate({ name: "Eggs" }));
throws("foodprefsCreate rejects an invalid status", () => foodprefsCreate({ name: "Eggs", status: "bogus" }));
const eggsPref = foodprefsCreate({ name: "Eggs", status: "not_interested", notes: "Off them this trimester" });
check("food pref created", eggsPref.name === "Eggs" && eggsPref.status === "not_interested");
check("food pref got today's date stamped", !!eggsPref.date);
const eggsChanged = foodprefsUpdate({ id: eggsPref.id, status: "interested" });
check("foodprefsUpdate can flip status back", eggsChanged.status === "interested");
check("foodprefsList filters by status", foodprefsList({ status: "interested" }).some((f) => f.id === eggsPref.id));
foodprefsDelete({ id: eggsPref.id });
check("foodprefsDelete removes the entry", getRowById("FoodPrefs", eggsPref.id) === null);
throws("foodprefsUpdate requires an id", () => foodprefsUpdate({ status: "interested" }));

// --- Phase 2: Settings gains water_goal_glasses ---

check("settingsGet includes water_goal_glasses (blank by default)", settingsGet().water_goal_glasses === "");
// Settings values are always stored as text (same as every other
// Settings key, e.g. hospital_phone) — the frontend Numbers() it on read.
settingsSet({ water_goal_glasses: 10 });
check("water_goal_glasses round-trips through settings.set/get", settingsGet().water_goal_glasses === "10");

// --- Phase 3 (v3): Bookings ---

throws("bookingsCreate requires type+title+datetime", () => bookingsCreate({ type: "scan" }));
throws("bookingsCreate rejects an invalid type", () => bookingsCreate({ type: "bogus", title: "x", datetime: "2026-11-01T10:00:00+05:30" }));
throws("bookingsCreate rejects an invalid booked_via", () => bookingsCreate({ type: "scan", title: "x", datetime: "2026-11-01T10:00:00+05:30", booked_via: "bogus" }));

const visit = bookingsCreate({ type: "doctor_visit", title: "Routine checkup", provider: "Dr. Rao", datetime: "2026-11-01T10:00:00+05:30", booked_via: "call" });
check("booking created with status booked + booked_at stamped", visit.status === "booked" && !!visit.booked_at);

const visitDone = bookingsUpdate({ id: visit.id, status: "done" });
check("bookingsUpdate stamps done_at on status -> done", visitDone.status === "done" && !!visitDone.done_at);

const visitWithQuestions = bookingsUpdate({ id: visit.id, questions: "[ ] Ask about iron levels\n[x] Ask about kicks" });
check("bookingsUpdate can save a questions checklist as plain text", visitWithQuestions.questions === "[ ] Ask about iron levels\n[x] Ask about kicks");

throws("bookingsClose a doctor_visit with no prescription and no note fails", () => bookingsClose({ id: visit.id }));
const visitClosedNoRx = bookingsClose({ id: visit.id, no_prescription_note: "Nothing needed this time" });
check("bookingsClose succeeds with a no-prescription note", visitClosedNoRx.status === "closed" && visitClosedNoRx.closed_without_prescription === true);
check("bookingsClose stamps closed_at", !!visitClosedNoRx.closed_at);

const scanBooking = bookingsCreate({ type: "scan", title: "Anomaly scan", datetime: "2026-11-05T09:00:00+05:30" });
throws("bookingsClose a scan with no linked report fails", () => bookingsClose({ id: scanBooking.id }));
const scanReportFile = filesUpload({ title: "Scan report", type: "scan", filename: "report.pdf", base64: smallBase64, date: "2026-11-05", type_v2: "scan_report", linked_booking_id: scanBooking.id });
check("file uploaded with type_v2 + linked_booking_id", scanReportFile.type_v2 === "scan_report" && scanReportFile.linked_booking_id === scanBooking.id);
const scanClosed = bookingsClose({ id: scanBooking.id });
check("bookingsClose succeeds once the report is linked", scanClosed.status === "closed");

const vaccineBooking = bookingsCreate({ type: "vaccine", title: "Tetanus shot", datetime: "2026-11-10T09:00:00+05:30" });
check("bookingsClose: vaccine/other close freely, no report/prescription needed", bookingsClose({ id: vaccineBooking.id }).status === "closed");

check("bookingsList filters by type", bookingsList({ type: "scan" }).every((b) => b.type === "scan"));
check("bookingsList filters by date range", bookingsList({ date_from: "2026-11-06" }).every((b) => dateStrOf(b.datetime) >= "2026-11-06"));
bookingsDelete({ id: vaccineBooking.id });
check("bookingsDelete removes the row", getRowById("Bookings", vaccineBooking.id) === null);
throws("bookingsDelete requires an id", () => bookingsDelete({}));

// --- files.update (metadata-only, Drive file untouched) ---

throws("filesUpdate rejects an invalid type_v2", () => filesUpdate({ id: scanReportFile.id, type_v2: "bogus" }));
const fileRenamed = filesUpdate({ id: scanReportFile.id, title: "Anomaly scan report", type_v2: "lab_report" });
check("filesUpdate changes title+type_v2", fileRenamed.title === "Anomaly scan report" && fileRenamed.type_v2 === "lab_report");
check("filesUpdate never touches drive_file_id", getRowById("Files", scanReportFile.id).drive_file_id === scanReportFile.drive_file_id);
check("filesList needs_sorting excludes files with a type_v2 set", !filesList({ needs_sorting: true }).some((f) => f.id === scanReportFile.id));
const needsSortingFile = filesUpload({ title: "Old upload", type: "document", filename: "old.pdf", base64: smallBase64, date: "2026-10-01" });
check("a file uploaded without type_v2 shows up in needs_sorting", filesList({ needs_sorting: true }).some((f) => f.id === needsSortingFile.id));
check("filesList filters by linked_booking_id", filesList({ linked_booking_id: scanBooking.id }).every((f) => f.linked_booking_id === scanBooking.id));

// --- Suggestions ---

throws("suggestionsCreate requires booking_id+type+text", () => suggestionsCreate({ booking_id: visit.id }));
throws("suggestionsCreate rejects an invalid type", () => suggestionsCreate({ booking_id: visit.id, type: "bogus", text: "x" }));
const suggestion = suggestionsCreate({ booking_id: visit.id, type: "medicine", text: "Start folic acid" });
check("suggestion created pending", suggestion.status === "pending");
const suggestionDone = suggestionsUpdate({ id: suggestion.id, status: "done" });
check("suggestionsUpdate flips status to done", suggestionDone.status === "done");
check("suggestionsList filters by booking_id", suggestionsList({ booking_id: visit.id }).every((s) => s.booking_id === visit.id));
suggestionsDelete({ id: suggestion.id });
check("suggestionsDelete removes the row", getRowById("Suggestions", suggestion.id) === null);
throws("suggestionsUpdate requires an id", () => suggestionsUpdate({ status: "done" }));

// --- Bills ---

throws("billsCreate requires booking_id+status", () => billsCreate({ booking_id: visit.id }));
throws("billsCreate rejects an invalid status", () => billsCreate({ booking_id: visit.id, status: "bogus" }));
const bill = billsCreate({ booking_id: visit.id, status: "unpaid", amount: 800 });
check("bill created", bill.status === "unpaid" && bill.amount === 800);
const billPaid = billsUpdate({ id: bill.id, status: "paid", paid_on: "2026-11-02" });
check("billsUpdate marks paid with a paid_on date", billPaid.status === "paid" && billPaid.paid_on === "2026-11-02");
check("billsList filters by booking_id", billsList({ booking_id: visit.id }).every((b) => b.booking_id === visit.id));
billsDelete({ id: bill.id });
check("billsDelete removes the row", getRowById("Bills", bill.id) === null);
throws("billsUpdate requires an id", () => billsUpdate({ status: "paid" }));

// --- Phase 4 (v3): medicine photos/details/expiry ---

const detailedMed = medicinesCreate({
  name: "Thyronorm", composition: "Levothyroxine Sodium", brand: "Thyronorm", strength: "50mcg",
  expiry_date: "2027-06-30", photo_front_file_id: "file-abc", photo_back_file_id: "file-def"
});
check("medicine created with Phase 4 detail fields", detailedMed.composition === "Levothyroxine Sodium" &&
  detailedMed.brand === "Thyronorm" && detailedMed.strength === "50mcg" && detailedMed.expiry_date === "2027-06-30" &&
  detailedMed.photo_front_file_id === "file-abc" && detailedMed.photo_back_file_id === "file-def");

const detailedMedUpdated = medicinesUpdate({ id: detailedMed.id, expiry_date: "" });
check("medicines.update can clear expiry_date", detailedMedUpdated.expiry_date === "");

check("ensureTabs() adds the Phase 4 Medicines columns", (() => {
  const headers = fakeSS.sheets.Medicines.rows[0];
  return ["photo_front_file_id", "photo_back_file_id", "composition", "brand", "strength", "expiry_date"].every((h) => headers.includes(h));
})());

settingsSet({ photos_enabled: false, ingredients_enabled: true, expiry_tracking_enabled: true, expiry_alert_days: 45 });
const settingsAfterPhase4 = settingsGet();
check("Phase 4 settings toggles round-trip", settingsAfterPhase4.photos_enabled === "false" &&
  settingsAfterPhase4.ingredients_enabled === "true" && settingsAfterPhase4.expiry_alert_days === "45");

// --- Phase 4 reminder helpers ---

// From-last interval medicine due today, via the reminder's own GAS-side
// nextIntervalDoseV3 (a leaner twin of js/schedule.js's nextDose).
const reminderMed = medicinesCreate({ name: "Amoxicillin (reminder test)", schedule_type: "interval", anchor_mode: "from_last", interval_hours: 8, times: "08:00", start_date: formatISODate(new Date()) });
medicinesLogTaken({ medicine_id: reminderMed.id, date: formatISODate(new Date()), time: "08:00", status: "taken", taken_at: new Date().toISOString() });
const dueTodayV3 = getTodaysDueMedicinesV3();
check("getTodaysDueMedicinesV3 includes an interval medicine due later today", dueTodayV3.some((m) => m.name === "Amoxicillin (reminder test)"));

const dailyReminderMed = medicinesCreate({ name: "Reminder daily med", schedule_type: "daily", times: "09:00", start_date: formatISODate(new Date()) });
check("getTodaysDueMedicinesV3 includes a daily medicine", getTodaysDueMedicinesV3().some((m) => m.name === "Reminder daily med"));

const stoppedReminderMed = medicinesCreate({ name: "Stopped reminder med", schedule_type: "daily", times: "09:00", start_date: formatISODate(new Date()), status: "stopped" });
check("getTodaysDueMedicinesV3 excludes a stopped medicine", !getTodaysDueMedicinesV3().some((m) => m.name === "Stopped reminder med"));

const expiringMed = medicinesCreate({ name: "Expiring soon med", expiry_date: formatISODate(new Date(Date.now() + 5 * 86400000)) });
settingsSet({ expiry_alert_days: 30 });
check("getExpiringMedicines flags a medicine expiring within the alert window", getExpiringMedicines().some((line) => line.indexOf("Expiring soon med") === 0));
const expiredMed = medicinesCreate({ name: "Already expired med", expiry_date: formatISODate(new Date(Date.now() - 5 * 86400000)) });
check("getExpiringMedicines flags an already-expired medicine", getExpiringMedicines().some((line) => line.indexOf("Already expired med") === 0 && line.indexOf("expired") !== -1));

const todaysBookingsForReminder = bookingsCreate({ type: "doctor_visit", title: "Reminder test visit", datetime: new Date().toISOString() });
check("getTodaysBookingsForReminder includes a booking scheduled today", getTodaysBookingsForReminder().some((b) => b.title === "Reminder test visit"));

const reminderMessage = buildDailyReminderMessage();
check("buildDailyReminderMessage runs end-to-end without throwing", typeof reminderMessage === "string" && reminderMessage.length > 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
