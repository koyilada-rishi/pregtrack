// Pregnancy Care Tracker — mock backend.
// Used when js/config.js has MOCK: true, so the UI can be built and tested
// with no Apps Script deployment. Shapes match the real backend's actions
// in backend/Code.gs — keep the two in sync as new actions are added.
// This is an in-memory store: it resets on every page reload.

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

export async function mockCall(action, payload) {
  // Simulate real network latency so loading states are visible in dev.
  await new Promise((resolve) => setTimeout(resolve, 250));
  payload = payload || {};

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

    case "medicines.list":
      return clone(db.medicines);
    case "medicines.create": {
      requireFields(payload, ["name"]);
      const row = { id: uid(), name: "", dose: "", frequency: "", times: "", start_date: todayStr(), end_date: "", prescribed_by: "", notes: "", active: true, ...payload };
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
      const row = { id: uid(), medicine_id: payload.medicine_id, date: payload.date, time: payload.time, taken };
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
      const row = { id: uid(), doctor: "", purpose: "", location: "", status: "upcoming", notes_after_visit: "", ...payload };
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
      const row = { id: uid(), weight_kg: "", bp_sys: "", bp_dia: "", sugar_fasting: "", sugar_pp: "", kicks: "", mood: "", symptoms: "", notes: "", ...payload };
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
      const row = { id: uid(), role: "", phone: "", address: "", maps_link: "", is_emergency: false, ...payload };
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
      const row = { id: uid(), items: "", craving_or_aversion: "", notes: "", ...payload };
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
      const row = { id: uid(), done: false, ...payload };
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
        id: uid(),
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
