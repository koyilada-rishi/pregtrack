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
    "dashboard.babySize.comingSoon": "Baby size & development notes are coming in step 4.",
    "dashboard.nextAppointment.title": "Next appointment",
    "dashboard.nextAppointment.none": "No upcoming appointment scheduled.",
    "dashboard.medicines.title": "Today's medicines",
    "dashboard.medicines.none": "Nothing pending right now.",
    "dashboard.medicines.hint": "Tap-to-check-off arrives with the Meds tab in step 5.",
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

    "placeholder.meds.title": "Medicines",
    "placeholder.visits.title": "Appointments",
    "placeholder.records.title": "Records",
    "placeholder.logVitals.title": "Log vitals",

    "more.title": "More",
    "more.emergency": "Emergency card",
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
