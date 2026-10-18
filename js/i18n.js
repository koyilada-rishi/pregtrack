// Pregnancy Care Tracker — string table.
// English now; add a "te" object with the same keys to bring in Telugu
// later, then call setLanguage('te'). Every piece of UI text should come
// through t(key, vars) rather than being hard-coded in app.js/views.

const STRINGS = {
  en: {
    "app.name": "Pregnancy Care Tracker",
    "app.disclaimer": "This app is a helper, not medical advice. Always follow your doctor's guidance.",

    "nav.home": "Home",
    "nav.meds": "Meds",
    "nav.visits": "Visits",
    "nav.records": "Records",
    "nav.more": "More",

    "lock.title": "Enter PIN",
    "lock.subtitle": "This PIN protects private medical data.",
    "lock.placeholder": "PIN",
    "lock.submit": "Unlock",
    "lock.checking": "Checking…",
    "lock.error.wrong": "Incorrect PIN. Try again.",
    "lock.error.lockout": "Too many incorrect attempts. Try again in 15 minutes.",
    "lock.error.generic": "Something went wrong. Please try again.",
    "lock.error.needsConfig": "App isn't set up yet — copy js/config.example.js to js/config.js and add your API URL.",

    "common.back": "Back",
    "common.retry": "Retry",
    "common.loading": "Loading…",
    "common.error": "Couldn't load this. Showing saved data if we have it.",
    "common.comingSoon": "Coming in a later step.",
    "common.none": "None yet.",
    "common.call": "Call",
    "common.directions": "Directions",
    "common.notSet": "Not set yet — add it in Settings.",
    "common.edit": "Edit",
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.delete": "Delete",

    "offline.banner": "You're offline. Showing the last saved data.",

    "dashboard.title": "Home",
    "dashboard.dueDate": "Due date",
    "dashboard.dueDateUnset": "Add your due date in Settings to see the countdown.",
    "dashboard.weekDay": "Week {weeks}, day {days}",
    "dashboard.daysLeft": "{n} days to go",
    "dashboard.daysLeft.today": "Due today!",
    "dashboard.daysLeft.overdue": "{n} days past due date",
    "dashboard.trimester": "Trimester {n}",
    "dashboard.babySize.title": "This week",
    "dashboard.babySize.comingSoon": "Add your due date in Settings to see this week's baby size and development.",
    "dashboard.nextAppointment.title": "Next appointment",
    "dashboard.nextAppointment.none": "No upcoming appointment scheduled.",
    "dashboard.medicines.title": "Today's medicines",
    "dashboard.medicines.none": "Nothing pending right now.",
    "dashboard.medicines.hint": "Check doses off from the Meds tab.",
    "dashboard.logVitals": "Log vitals",
    "dashboard.emergency": "Emergency",

    "emergency.title": "Emergency card",
    "emergency.bloodGroup": "Blood group",
    "emergency.allergies": "Allergies",
    "emergency.hospital": "Hospital",
    "emergency.hospitalPhone": "Hospital phone",
    "emergency.hospitalAddress": "Hospital address",
    "emergency.contacts.title": "Doctor contacts",
    "emergency.contacts.comingSoon": "Saved doctor contacts are coming in a later step.",

    "guide.title": "Food & body guide",
    "guide.seeFull": "See the full week-by-week guide →",
    "guide.noDueDate": "Add your due date in Settings to personalize this guide. Showing trimester 1 for now.",
    "guide.thisWeek.title": "What's normal this week",
    "guide.thisWeek.size": "About the size of {comparison} right now.",
    "guide.commonSymptoms": "Common symptoms",
    "guide.tips": "Tips",
    "guide.reviewNote": "Worth confirming with her doctor: {note}",
    "guide.food.title": "Food guide — {label}",
    "guide.food.recommended": "Recommended",
    "guide.food.limit": "Limit",
    "guide.food.alwaysAvoid": "Avoid throughout pregnancy",
    "guide.needsReview": "(confirm with doctor)",
    "guide.warnings.title": "Warning signs needing urgent care",

    "placeholder.records.title": "Records",
    "placeholder.logVitals.title": "Log vitals",

    "meds.today.title": "Today's doses",
    "meds.today.none": "Nothing scheduled for today.",
    "meds.add": "+ Add medicine",
    "meds.all.title": "All medicines",
    "meds.all.none": "No medicines added yet.",
    "meds.inactive": "Inactive",
    "meds.history.title": "History (last 14 days)",
    "meds.history.none": "No doses logged yet.",
    "meds.history.ratio": "{taken} of {total} doses taken",
    "meds.confirmDelete": "Delete this medicine? This can't be undone.",
    "meds.form.titleNew": "Add medicine",
    "meds.form.titleEdit": "Edit medicine",
    "meds.form.name": "Name",
    "meds.form.dose": "Dose",
    "meds.form.frequency": "Frequency",
    "meds.form.times": "Times",
    "meds.form.timesHint": "Comma-separated, 24-hour format (e.g. 08:00, 20:00)",
    "meds.form.startDate": "Start date",
    "meds.form.endDate": "End date (optional)",
    "meds.form.prescribedBy": "Prescribed by",
    "meds.form.notes": "Notes",
    "meds.form.active": "Currently taking this",

    "appt.add": "+ Add appointment",
    "appt.upcoming.title": "Upcoming",
    "appt.upcoming.none": "No upcoming appointments.",
    "appt.past.title": "Past",
    "appt.past.none": "No past appointments yet.",
    "appt.markDone": "Mark done",
    "appt.confirmDelete": "Delete this appointment? This can't be undone.",
    "appt.status.upcoming": "Upcoming",
    "appt.status.done": "Done",
    "appt.status.missed": "Missed",
    "appt.form.titleNew": "Add appointment",
    "appt.form.titleEdit": "Edit appointment",
    "appt.form.datetime": "Date & time",
    "appt.form.doctor": "Doctor",
    "appt.form.purpose": "Purpose",
    "appt.form.location": "Location",
    "appt.form.status": "Status",
    "appt.form.notes": "Notes after visit",
    "appt.form.invalidDate": "Please enter a valid date and time.",

    "health.title": "Health log",
    "health.add": "+ Log vitals",
    "health.disclaimer": "These charts are for your own tracking, not a diagnosis. Always discuss readings with her doctor.",
    "health.chart.weight": "Weight (kg)",
    "health.chart.bp": "Blood pressure",
    "health.chart.bpNote": "Reference only — some doctors look more closely from about {sys}/{dia} mmHg onward.",
    "health.chart.sugar": "Blood sugar (mg/dL)",
    "health.chart.sugarNote": "Reference only — some doctors look more closely above {fasting} mg/dL fasting or {pp} mg/dL post-meal.",
    "health.chart.loadError": "Couldn't load the chart library — showing the history list below instead.",
    "health.notice.bp": "Her latest blood pressure reading is on the higher side.",
    "health.notice.sugar": "Her latest blood sugar reading is on the higher side.",
    "health.notice.suffix": "Worth mentioning at the next doctor's visit.",
    "health.history.title": "History",
    "health.history.none": "No entries logged yet.",
    "health.confirmDelete": "Delete this entry? This can't be undone.",
    "health.field.weight": "{v} kg",
    "health.field.bp": "{sys}/{dia} mmHg",
    "health.field.sugarFasting": "Fasting sugar {v} mg/dL",
    "health.field.sugarPp": "Post-meal sugar {v} mg/dL",
    "health.field.kicks": "{v} kicks",
    "health.field.mood": "Mood: {v}",
    "health.form.titleNew": "Log vitals",
    "health.form.titleEdit": "Edit entry",
    "health.form.date": "Date",
    "health.form.weight": "Weight (kg)",
    "health.form.bpSys": "BP systolic",
    "health.form.bpDia": "BP diastolic",
    "health.form.sugarFasting": "Sugar (fasting)",
    "health.form.sugarPp": "Sugar (post-meal)",
    "health.form.kicks": "Kick count",
    "health.form.mood": "Mood",
    "health.form.symptoms": "Symptoms",
    "health.form.notes": "Notes",

    "records.add": "+ Add record",
    "records.none": "No records yet.",
    "records.confirmDelete": "Delete this record? This can't be undone.",
    "records.filter.type": "Type",
    "records.filter.allTypes": "All types",
    "records.filter.from": "From",
    "records.filter.to": "To",
    "records.view.list": "List",
    "records.view.grid": "Grid",
    "records.type.report": "Report",
    "records.type.scan": "Scan",
    "records.type.prescription": "Prescription",
    "records.type.document": "Document",
    "records.upload.title": "Add a record",
    "records.upload.takePhoto": "📷 Take photo",
    "records.upload.chooseFile": "📁 Choose file",
    "records.upload.recordTitle": "Title",
    "records.upload.type": "Type",
    "records.upload.date": "Date",
    "records.upload.doctor": "Doctor",
    "records.upload.notes": "Notes",
    "records.upload.tooLarge": "This file is larger than 8 MB. Please choose a smaller file or compress it first.",
    "records.upload.readError": "Couldn't read that file. Please try again.",
    "records.viewer.openExternally": "This file type can't be previewed here.",
    "records.viewer.open": "Open",

    "more.title": "More",
    "more.emergency": "Emergency card",
    "more.health": "Health log",
    "more.guide": "Food & body guide",
    "more.checklists": "Checklists",
    "more.settings": "Settings",
    "more.lockNow": "Lock app now",
    "more.comingSoon": "Added in a later step"
  }
};

let currentLang = "en";

export function setLanguage(lang) {
  currentLang = STRINGS[lang] ? lang : "en";
}

export function getLanguage() {
  return currentLang;
}

export function t(key, vars) {
  const table = STRINGS[currentLang] || STRINGS.en;
  let str = table[key] || STRINGS.en[key] || key;
  if (vars) {
    Object.keys(vars).forEach((k) => {
      str = str.replace(new RegExp("\\{" + k + "\\}", "g"), vars[k]);
    });
  }
  return str;
}
