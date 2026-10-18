// Pregnancy Care Tracker — app entry point: router, lock screen, shell, views.
//
// api.js is imported dynamically (not statically) because it in turn
// imports js/config.js, which is gitignored and may not exist yet (e.g. a
// fresh clone before `cp js/config.example.js js/config.js`). A missing
// config.js must not take down the whole module graph — it should show a
// friendly "not set up" screen instead.

import { t, setLanguage } from "./i18n.js";

const appRoot = document.getElementById("app");

let api = null; // assigned once js/api.js (and its config.js) load successfully

const state = {
  locked: true,
  online: navigator.onLine
};

const NAV_ITEMS = [
  { key: "home", hash: "#/dashboard", icon: "🏠", label: () => t("nav.home") },
  { key: "meds", hash: "#/meds", icon: "💊", label: () => t("nav.meds") },
  { key: "visits", hash: "#/visits", icon: "🩺", label: () => t("nav.visits") },
  { key: "records", hash: "#/records", icon: "📁", label: () => t("nav.records") },
  { key: "more", hash: "#/more", icon: "⋯", label: () => t("nav.more") }
];

const ROUTES = {
  "/dashboard": { render: renderDashboardView, navKey: "home", title: () => t("dashboard.title") },
  "/meds": { render: renderMedicinesView, navKey: "meds", title: () => t("nav.meds") },
  "/visits": { render: renderAppointmentsView, navKey: "visits", title: () => t("nav.visits") },
  "/records": { render: (outlet) => renderPlaceholderView(outlet, t("placeholder.records.title"), 7), navKey: "records", title: () => t("nav.records") },
  "/more": { render: renderMoreView, navKey: "more", title: () => t("more.title") },
  "/emergency": { render: renderEmergencyView, navKey: null, title: () => t("emergency.title") },
  "/guide": { render: renderGuideView, navKey: null, title: () => t("guide.title") },
  "/health": { render: (outlet) => renderHealthView(outlet, false), navKey: null, title: () => t("health.title") },
  "/health/new": { render: (outlet) => renderHealthView(outlet, true), navKey: null, title: () => t("health.title") }
};

boot().catch((err) => {
  console.error("Fatal startup error", err);
  appRoot.innerHTML = `<div class="lock-screen"><h1>${t("app.name")}</h1><p>${t("lock.error.generic")}</p></div>`;
});

async function boot() {
  try {
    api = await import("./api.js");
  } catch (err) {
    console.error("Could not load js/config.js", err);
    renderConfigMissing();
    return;
  }

  const config = api.CONFIG;
  if (config && config.LANGUAGE) setLanguage(config.LANGUAGE);

  if (!api.hasPin()) {
    state.locked = true;
    renderLockScreen();
    return;
  }

  try {
    await api.call("auth.check", {});
    state.locked = false;
  } catch (err) {
    if (err.kind === "auth") {
      api.clearPin();
      state.locked = true;
      renderLockScreen(t("lock.error.wrong"));
      return;
    }
    if (err.kind === "lockout") {
      state.locked = true;
      renderLockScreen(t("lock.error.lockout"));
      return;
    }
    // Network/server hiccup: trust the already-stored PIN and let the
    // person read cached data offline rather than locking them out.
    state.locked = false;
  }

  if (!location.hash) location.hash = "#/dashboard";
  window.addEventListener("hashchange", renderRoute);
  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);
  renderRoute();
}

// ---------------------------------------------------------------------------
// Config-missing screen
// ---------------------------------------------------------------------------

function renderConfigMissing() {
  appRoot.innerHTML = `
    <div class="lock-screen">
      <h1>${t("app.name")}</h1>
      <p>${t("lock.error.needsConfig")}</p>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Lock screen
// ---------------------------------------------------------------------------

function renderLockScreen(message) {
  appRoot.innerHTML = `
    <div class="lock-screen">
      <h1>${t("lock.title")}</h1>
      <p>${t("lock.subtitle")}</p>
      <form id="lock-form">
        <input id="pin-input" class="field" type="password" inputmode="numeric"
               autocomplete="off" placeholder="${t("lock.placeholder")}" />
        <button type="submit" class="btn btn-primary" id="lock-submit">${t("lock.submit")}</button>
        <p class="error-text" id="lock-error" ${message ? "" : "hidden"}>${escapeHtml(message || "")}</p>
      </form>
      <p class="disclaimer">${t("app.disclaimer")}</p>
    </div>
  `;

  const form = document.getElementById("lock-form");
  const input = document.getElementById("pin-input");
  input.focus();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const pin = input.value.trim();
    if (!pin) return;
    await attemptUnlock(pin);
  });
}

async function attemptUnlock(pin) {
  const submitBtn = document.getElementById("lock-submit");
  submitBtn.disabled = true;
  submitBtn.textContent = t("lock.checking");

  api.setPin(pin);
  try {
    await api.call("auth.check", {});
    state.locked = false;
    if (!location.hash) location.hash = "#/dashboard";
    window.addEventListener("hashchange", renderRoute);
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    renderRoute();
  } catch (err) {
    if (err.kind === "auth") {
      api.clearPin();
      renderLockScreen(t("lock.error.wrong"));
    } else if (err.kind === "lockout") {
      renderLockScreen(t("lock.error.lockout"));
    } else {
      renderLockScreen(t("lock.error.generic"));
    }
  }
}

// ---------------------------------------------------------------------------
// Router + shell
// ---------------------------------------------------------------------------

function currentPath() {
  return (location.hash || "#/dashboard").replace(/^#/, "") || "/dashboard";
}

function renderRoute() {
  if (state.locked) {
    renderLockScreen();
    return;
  }
  const route = ROUTES[currentPath()] || ROUTES["/dashboard"];
  renderShell(route);
}

function renderShell(route) {
  appRoot.innerHTML = `
    <div id="offline-banner" class="offline-banner" ${state.online ? "hidden" : ""}>${t("offline.banner")}</div>
    <header class="topbar">
      <h1>${route.title()}</h1>
    </header>
    <main class="view" id="view-outlet"></main>
    <nav class="bottom-nav" id="bottom-nav"></nav>
  `;
  renderBottomNav(route.navKey);
  const outlet = document.getElementById("view-outlet");
  route.render(outlet);
}

function renderBottomNav(activeKey) {
  const nav = document.getElementById("bottom-nav");
  nav.innerHTML = NAV_ITEMS.map(
    (item) => `
      <button data-hash="${item.hash}" aria-current="${item.key === activeKey}">
        <span class="nav-icon" aria-hidden="true">${item.icon}</span>
        <span>${item.label()}</span>
      </button>
    `
  ).join("");
  nav.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => { location.hash = btn.dataset.hash; });
  });
}

function updateOnlineStatus() {
  state.online = navigator.onLine;
  const banner = document.getElementById("offline-banner");
  if (banner) banner.hidden = state.online;
}

// ---------------------------------------------------------------------------
// Dashboard view
// ---------------------------------------------------------------------------

async function renderDashboardView(outlet) {
  outlet.innerHTML = genericSkeleton(6);

  const paint = async (data) => {
    const weekEntry = await weekEntryFor(data.gestational_age).catch(() => null);
    outlet.innerHTML = dashboardMarkup(data, weekEntry);
    attachNavButtons(outlet);
  };

  try {
    const data = await api.fetchWithCache("dashboard.get", {}, paint);
    await paint(data);
    // Warm the Emergency card's offline cache in the background.
    api.call("settings.get", {}).catch(() => {});
  } catch (err) {
    const cached = api.getCached("dashboard.get", {});
    if (cached) {
      await paint(cached);
    } else {
      outlet.innerHTML = errorMarkup(err);
      attachRetryHandler(outlet, () => renderDashboardView(outlet));
    }
  }
}

// Looks up the matching data/weeks.json entry for the current gestational
// age, clamped to the 4-40 range the content file covers.
async function weekEntryFor(age) {
  if (!age) return null;
  const weeksData = await loadJson("./data/weeks.json");
  const weekNum = Math.min(40, Math.max(4, age.weeks));
  return weeksData.weeks.find((w) => w.week === weekNum) || null;
}

function dashboardMarkup(data, weekEntry) {
  const countdown = formatCountdown(data.gestational_age);
  const nextAppt = data.next_appointment;
  const meds = data.today_medicines || [];

  return `
    <div class="card countdown-card">
      <h2>${t("dashboard.dueDate")}</h2>
      ${
        countdown
          ? `
        <div class="countdown-days">${countdown.daysLeftText}</div>
        <div class="countdown-sub">${countdown.weekDay}</div>
        <div class="countdown-meta"><span>${countdown.trimesterText}</span></div>
      `
          : `<p class="empty">${t("dashboard.dueDateUnset")}</p>`
      }
    </div>

    <div class="dashboard-actions">
      <button class="btn btn-secondary" data-nav="#/health/new">${t("dashboard.logVitals")}</button>
      <button class="btn btn-emergency" data-nav="#/emergency">${t("dashboard.emergency")}</button>
    </div>

    <div class="card">
      <h2>${t("dashboard.babySize.title")}</h2>
      ${
        weekEntry
          ? `
        <p>${t("guide.thisWeek.size", { comparison: escapeHtml(weekEntry.size_comparison) })}</p>
        <p class="empty">${escapeHtml(weekEntry.development)}</p>
        <a class="card-link" data-nav="#/guide">${t("guide.seeFull")}</a>
      `
          : `<p class="empty">${t("dashboard.babySize.comingSoon")}</p>`
      }
    </div>

    <div class="card">
      <h2>${t("dashboard.nextAppointment.title")}</h2>
      ${
        nextAppt
          ? `
        <ul class="appt-list">
          <li>
            <span>${escapeHtml(nextAppt.purpose || nextAppt.doctor || "")}</span>
            <span class="med-time">${formatApptDateTime(nextAppt.datetime)}</span>
          </li>
        </ul>
      `
          : `<p class="empty">${t("dashboard.nextAppointment.none")}</p>`
      }
    </div>

    <div class="card">
      <h2>${t("dashboard.medicines.title")}</h2>
      ${
        meds.length
          ? `
        <ul class="med-list">
          ${meds
            .map(
              (m) => `
            <li>
              <span>${escapeHtml(m.name)}${m.dose ? " · " + escapeHtml(m.dose) : ""}</span>
              <span class="med-time">${escapeHtml(m.time)}</span>
            </li>
          `
            )
            .join("")}
        </ul>
        <p class="empty">${t("dashboard.medicines.hint")}</p>
      `
          : `<p class="empty">${t("dashboard.medicines.none")}</p>`
      }
    </div>
  `;
}

function formatCountdown(age) {
  if (!age) return null;
  const daysLeft = age.days_left;
  let daysLeftText = "";
  if (daysLeft === null || daysLeft === undefined) {
    daysLeftText = "";
  } else if (daysLeft > 0) {
    daysLeftText = t("dashboard.daysLeft", { n: daysLeft });
  } else if (daysLeft === 0) {
    daysLeftText = t("dashboard.daysLeft.today");
  } else {
    daysLeftText = t("dashboard.daysLeft.overdue", { n: Math.abs(daysLeft) });
  }
  return {
    daysLeftText,
    weekDay: t("dashboard.weekDay", { weeks: age.weeks, days: age.days }),
    trimesterText: t("dashboard.trimester", { n: age.trimester })
  };
}

function formatApptDateTime(iso) {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Kolkata"
    }).format(new Date(iso));
  } catch {
    return iso || "";
  }
}

// ---------------------------------------------------------------------------
// Emergency card
// ---------------------------------------------------------------------------

async function renderEmergencyView(outlet) {
  outlet.classList.add("emergency-view");
  outlet.innerHTML = genericSkeleton(5);

  const paint = (settings) => { outlet.innerHTML = emergencyMarkup(settings); };

  try {
    const settings = await api.fetchWithCache("settings.get", {}, paint);
    paint(settings);
  } catch (err) {
    const cached = api.getCached("settings.get", {});
    if (cached) {
      paint(cached);
    } else {
      outlet.innerHTML = errorMarkup(err);
      attachRetryHandler(outlet, () => renderEmergencyView(outlet));
    }
  }
}

function emergencyMarkup(settings) {
  const phoneDigits = String(settings.hospital_phone || "").replace(/[^+\d]/g, "");
  const address = settings.hospital_address || "";

  return `
    <div class="card">
      <div class="emergency-row">
        <span class="label">${t("emergency.bloodGroup")}</span>
        <span class="value">${escapeHtml(settings.blood_group) || t("common.notSet")}</span>
      </div>
      <div class="emergency-row">
        <span class="label">${t("emergency.allergies")}</span>
        <span class="value">${escapeHtml(settings.allergies) || t("common.notSet")}</span>
      </div>
      <div class="emergency-row">
        <span class="label">${t("emergency.hospital")}</span>
        <span class="value">${escapeHtml(settings.hospital_name) || t("common.notSet")}</span>
      </div>
      <div class="emergency-row">
        <span class="label">${t("emergency.hospitalAddress")}</span>
        <span class="value">${escapeHtml(address) || t("common.notSet")}</span>
      </div>
    </div>

    <div class="emergency-actions">
      ${phoneDigits ? `<a class="btn btn-emergency" href="tel:${phoneDigits}">${t("common.call")}</a>` : ""}
      ${address ? `<a class="btn btn-secondary" target="_blank" rel="noopener" href="https://maps.google.com/?q=${encodeURIComponent(address)}">${t("common.directions")}</a>` : ""}
    </div>

    <div class="card">
      <h2>${t("emergency.contacts.title")}</h2>
      <p class="empty">${t("emergency.contacts.comingSoon")}</p>
    </div>

    <p class="disclaimer">${t("app.disclaimer")}</p>
  `;
}

// ---------------------------------------------------------------------------
// Food & body guide
// ---------------------------------------------------------------------------

async function renderGuideView(outlet) {
  outlet.innerHTML = genericSkeleton(8);

  try {
    const [dash, weeksData, foodData, warningsData] = await Promise.all([
      api.call("dashboard.get", {}).catch(() => api.getCached("dashboard.get", {})),
      loadJson("./data/weeks.json"),
      loadJson("./data/food.json"),
      loadJson("./data/warnings.json")
    ]);
    outlet.innerHTML = guideMarkup(dash, weeksData, foodData, warningsData);
    attachNavButtons(outlet);
  } catch (err) {
    outlet.innerHTML = errorMarkup(err);
    attachRetryHandler(outlet, () => renderGuideView(outlet));
  }
}

function guideMarkup(dash, weeksData, foodData, warningsData) {
  const age = dash && dash.gestational_age;
  const weekNum = age ? Math.min(40, Math.max(4, age.weeks)) : null;
  const weekEntry = weekNum ? weeksData.weeks.find((w) => w.week === weekNum) : null;
  const trimester = weekEntry ? weekEntry.trimester : 1;
  const foodTrimester = foodData.trimesters.find((ft) => ft.trimester === trimester) || foodData.trimesters[0];

  return `
    ${!age ? `<div class="card"><p class="empty">${t("guide.noDueDate")}</p></div>` : ""}

    <div class="card">
      <h2>${t("guide.thisWeek.title")}</h2>
      ${
        weekEntry
          ? `
        <p>${t("guide.thisWeek.size", { comparison: escapeHtml(weekEntry.size_comparison) })}</p>
        <p>${escapeHtml(weekEntry.development)}</p>
        <h3>${t("guide.commonSymptoms")}</h3>
        <ul>${weekEntry.common_symptoms.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
        <h3>${t("guide.tips")}</h3>
        <ul>${weekEntry.tips.map((tip) => `<li>${escapeHtml(tip)}</li>`).join("")}</ul>
        ${weekEntry.review ? `<p class="review-note">${t("guide.reviewNote", { note: escapeHtml(weekEntry.review_note) })}</p>` : ""}
      `
          : `<p class="empty">${t("common.none")}</p>`
      }
    </div>

    <div class="card">
      <h2>${t("guide.food.title", { label: escapeHtml(foodTrimester.label) })}</h2>
      ${foodSectionMarkup(t("guide.food.recommended"), foodTrimester.recommended)}
      ${foodSectionMarkup(t("guide.food.limit"), foodTrimester.limit)}
      ${foodSectionMarkup(null, foodTrimester.avoid)}
      <h3>${t("guide.food.alwaysAvoid")}</h3>
      <ul>${foodData.always_avoid.items.map((item) => foodItemMarkup(item)).join("")}</ul>
    </div>

    <div class="card warnings-card">
      <h2>${t("guide.warnings.title")}</h2>
      <ul class="warning-list">
        ${warningsData.warnings
          .map(
            (w) => `
          <li>
            <strong>${escapeHtml(w.symptom)}</strong><br />
            <span class="muted">${escapeHtml(w.action)}</span>
          </li>
        `
          )
          .join("")}
      </ul>
      <button class="btn btn-emergency" data-nav="#/emergency">${t("dashboard.emergency")}</button>
    </div>

    <p class="disclaimer">${escapeHtml(warningsData.disclaimer || t("app.disclaimer"))}</p>
  `;
}

function foodSectionMarkup(title, items) {
  if (!items || !items.length) return "";
  return `${title ? `<h3>${title}</h3>` : ""}<ul>${items.map((item) => foodItemMarkup(item)).join("")}</ul>`;
}

function foodItemMarkup(item) {
  return `<li><strong>${escapeHtml(item.item)}</strong> — ${escapeHtml(item.reason)}${
    item.review ? ` <span class="review-flag">${t("guide.needsReview")}</span>` : ""
  }</li>`;
}

// ---------------------------------------------------------------------------
// Medicines
// ---------------------------------------------------------------------------

const medsState = { medicines: [], logs: [], loading: true, error: null, formItem: null };

async function renderMedicinesView(outlet) {
  medsState.loading = true;
  medsState.error = null;
  medsState.formItem = null;
  outlet.innerHTML = genericSkeleton(6);

  try {
    const [medicines, history] = await Promise.all([
      api.call("medicines.list", {}),
      api.call("medicines.history", { days: 14 })
    ]);
    medsState.medicines = medicines;
    medsState.logs = history.logs;
    medsState.loading = false;
    renderMedsBody(outlet);
  } catch (err) {
    medsState.loading = false;
    medsState.error = err;
    outlet.innerHTML = errorMarkup(err);
    attachRetryHandler(outlet, () => renderMedicinesView(outlet));
  }
}

function renderMedsBody(outlet) {
  outlet.innerHTML = medsState.formItem !== null ? medicineFormMarkup(medsState.formItem) : medsListMarkup();
  attachMedsHandlers(outlet);
}

function medsListMarkup() {
  const todayStr = formatDateInput(new Date());
  const takenToday = new Set(
    medsState.logs.filter((l) => dateStrEq(l.date, todayStr) && isTruthy(l.taken)).map((l) => l.medicine_id + "|" + l.time)
  );

  const todayDoses = [];
  medsState.medicines.filter((m) => isMedicineActiveOn(m, todayStr)).forEach((m) => {
    splitTimes(m.times).forEach((time) => {
      todayDoses.push({ medicine: m, time, taken: takenToday.has(m.id + "|" + time) });
    });
  });
  todayDoses.sort((a, b) => a.time.localeCompare(b.time));

  const historyByDate = {};
  medsState.logs.forEach((l) => {
    const d = dateStrOf(l.date);
    if (!historyByDate[d]) historyByDate[d] = [];
    historyByDate[d].push(l);
  });
  const historyDates = Object.keys(historyByDate).sort((a, b) => b.localeCompare(a));

  return `
    <div class="card">
      <h2>${t("meds.today.title")}</h2>
      ${
        todayDoses.length
          ? `
        <ul class="med-list med-list--checkable">
          ${todayDoses
            .map(
              (d) => `
            <li>
              <label class="med-check">
                <input type="checkbox" data-med-id="${escapeHtml(d.medicine.id)}" data-med-time="${escapeHtml(d.time)}" ${d.taken ? "checked" : ""} />
                <span class="${d.taken ? "med-check-done" : ""}">${escapeHtml(d.medicine.name)}${d.medicine.dose ? " · " + escapeHtml(d.medicine.dose) : ""}</span>
              </label>
              <span class="med-time">${escapeHtml(d.time)}</span>
            </li>
          `
            )
            .join("")}
        </ul>
      `
          : `<p class="empty">${t("meds.today.none")}</p>`
      }
    </div>

    <button class="btn btn-primary" id="add-med-btn">${t("meds.add")}</button>

    <div class="card">
      <h2>${t("meds.all.title")}</h2>
      ${
        medsState.medicines.length
          ? `<ul class="entity-list">${medsState.medicines.map((m) => medicineRowMarkup(m)).join("")}</ul>`
          : `<p class="empty">${t("meds.all.none")}</p>`
      }
    </div>

    <div class="card">
      <h2>${t("meds.history.title")}</h2>
      ${
        historyDates.length
          ? historyDates
              .slice(0, 14)
              .map((d) => historyDayMarkup(d, historyByDate[d]))
              .join("")
          : `<p class="empty">${t("meds.history.none")}</p>`
      }
    </div>
  `;
}

function medicineRowMarkup(m) {
  return `
    <li class="entity-row">
      <div class="entity-main">
        <strong>${escapeHtml(m.name)}</strong>
        <span class="muted">${escapeHtml([m.dose, m.frequency].filter(Boolean).join(" · "))}</span>
        <span class="muted">${escapeHtml(m.times || "")}</span>
        ${!isTruthy(m.active) ? `<span class="badge">${t("meds.inactive")}</span>` : ""}
      </div>
      <div class="entity-actions">
        <button class="btn-link" data-edit-med="${escapeHtml(m.id)}">${t("common.edit")}</button>
        <button class="btn-link btn-link--danger" data-delete-med="${escapeHtml(m.id)}">${t("common.delete")}</button>
      </div>
    </li>
  `;
}

function historyDayMarkup(dateStr, logs) {
  const takenCount = logs.filter((l) => isTruthy(l.taken)).length;
  return `
    <div class="history-day">
      <div class="history-date">${escapeHtml(formatDisplayDate(dateStr))}</div>
      <div class="muted">${t("meds.history.ratio", { taken: takenCount, total: logs.length })}</div>
    </div>
  `;
}

function medicineFormMarkup(item) {
  const isNew = item === "new";
  const m = isNew ? {} : item;
  return `
    <div class="card">
      <h2>${isNew ? t("meds.form.titleNew") : t("meds.form.titleEdit")}</h2>
      <form id="med-form">
        ${formField(t("meds.form.name"), `<input class="field" name="name" required value="${escapeHtml(m.name)}" />`)}
        ${formField(t("meds.form.dose"), `<input class="field" name="dose" value="${escapeHtml(m.dose)}" />`)}
        ${formField(t("meds.form.frequency"), `<input class="field" name="frequency" value="${escapeHtml(m.frequency)}" />`)}
        ${formField(t("meds.form.times"), `<input class="field" name="times" placeholder="08:00, 20:00" value="${escapeHtml(m.times)}" />`, t("meds.form.timesHint"))}
        ${formField(t("meds.form.startDate"), `<input class="field" type="date" name="start_date" value="${escapeHtml(dateStrOf(m.start_date) || formatDateInput(new Date()))}" />`)}
        ${formField(t("meds.form.endDate"), `<input class="field" type="date" name="end_date" value="${escapeHtml(dateStrOf(m.end_date))}" />`)}
        ${formField(t("meds.form.prescribedBy"), `<input class="field" name="prescribed_by" value="${escapeHtml(m.prescribed_by)}" />`)}
        ${formField(t("meds.form.notes"), `<textarea class="field" name="notes" rows="3">${escapeHtml(m.notes)}</textarea>`)}
        <label class="checkbox-field">
          <input type="checkbox" name="active" ${isNew || isTruthy(m.active) ? "checked" : ""} />
          <span>${t("meds.form.active")}</span>
        </label>
        <p class="error-text" id="med-form-error" hidden></p>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" id="med-form-cancel">${t("common.cancel")}</button>
          <button type="submit" class="btn btn-primary" id="med-form-save">${t("common.save")}</button>
        </div>
      </form>
    </div>
  `;
}

function attachMedsHandlers(outlet) {
  const addBtn = outlet.querySelector("#add-med-btn");
  if (addBtn) addBtn.addEventListener("click", () => { medsState.formItem = "new"; renderMedsBody(outlet); });

  outlet.querySelectorAll("[data-edit-med]").forEach((btn) => {
    btn.addEventListener("click", () => {
      medsState.formItem = medsState.medicines.find((m) => m.id === btn.dataset.editMed) || "new";
      renderMedsBody(outlet);
    });
  });

  outlet.querySelectorAll("[data-delete-med]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("meds.confirmDelete"))) return;
      try {
        await api.call("medicines.delete", { id: btn.dataset.deleteMed });
        await renderMedicinesView(outlet);
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  });

  outlet.querySelectorAll('input[type="checkbox"][data-med-id]').forEach((checkbox) => {
    checkbox.addEventListener("change", async () => {
      const medicineId = checkbox.dataset.medId;
      const time = checkbox.dataset.medTime;
      const taken = checkbox.checked;
      checkbox.disabled = true;
      try {
        await api.call("medicines.logTaken", { medicine_id: medicineId, date: formatDateInput(new Date()), time, taken });
        await renderMedicinesView(outlet);
      } catch (err) {
        checkbox.checked = !taken;
        checkbox.disabled = false;
        alert(err.message || t("common.error"));
      }
    });
  });

  const form = outlet.querySelector("#med-form");
  if (form) {
    outlet.querySelector("#med-form-cancel").addEventListener("click", () => {
      medsState.formItem = null;
      renderMedsBody(outlet);
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(form);
      const payload = {
        name: fd.get("name").trim(),
        dose: fd.get("dose").trim(),
        frequency: fd.get("frequency").trim(),
        times: fd.get("times").trim(),
        start_date: fd.get("start_date"),
        end_date: fd.get("end_date"),
        prescribed_by: fd.get("prescribed_by").trim(),
        notes: fd.get("notes").trim(),
        active: fd.get("active") === "on"
      };
      const saveBtn = outlet.querySelector("#med-form-save");
      saveBtn.disabled = true;
      try {
        if (medsState.formItem === "new") {
          await api.call("medicines.create", payload);
        } else {
          await api.call("medicines.update", { id: medsState.formItem.id, ...payload });
        }
        await renderMedicinesView(outlet);
      } catch (err) {
        saveBtn.disabled = false;
        const errEl = outlet.querySelector("#med-form-error");
        errEl.textContent = err.message || t("common.error");
        errEl.hidden = false;
      }
    });
  }
}

function isMedicineActiveOn(m, dateStr) {
  if (!isTruthy(m.active)) return false;
  const start = dateStrOf(m.start_date);
  const end = dateStrOf(m.end_date);
  if (start && start > dateStr) return false;
  if (end && end < dateStr) return false;
  return true;
}

function splitTimes(times) {
  return String(times || "").split(",").map((t) => t.trim()).filter(Boolean);
}

function isTruthy(value) {
  return value === true || String(value).toUpperCase() === "TRUE";
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

const apptState = { appointments: [], loading: true, formItem: null };

async function renderAppointmentsView(outlet) {
  apptState.loading = true;
  apptState.formItem = null;
  outlet.innerHTML = genericSkeleton(5);

  try {
    apptState.appointments = await api.call("appointments.list", {});
    apptState.loading = false;
    renderApptBody(outlet);
  } catch (err) {
    apptState.loading = false;
    outlet.innerHTML = errorMarkup(err);
    attachRetryHandler(outlet, () => renderAppointmentsView(outlet));
  }
}

function renderApptBody(outlet) {
  outlet.innerHTML = apptState.formItem !== null ? appointmentFormMarkup(apptState.formItem) : apptListMarkup();
  attachApptHandlers(outlet);
}

function apptListMarkup() {
  const upcoming = apptState.appointments
    .filter((a) => a.status === "upcoming")
    .sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  const past = apptState.appointments
    .filter((a) => a.status !== "upcoming")
    .sort((a, b) => new Date(b.datetime) - new Date(a.datetime));

  return `
    <button class="btn btn-primary" id="add-appt-btn">${t("appt.add")}</button>

    <div class="card">
      <h2>${t("appt.upcoming.title")}</h2>
      ${
        upcoming.length
          ? `<ul class="entity-list">${upcoming.map((a) => appointmentRowMarkup(a, true)).join("")}</ul>`
          : `<p class="empty">${t("appt.upcoming.none")}</p>`
      }
    </div>

    <div class="card">
      <h2>${t("appt.past.title")}</h2>
      ${
        past.length
          ? `<ul class="entity-list">${past.map((a) => appointmentRowMarkup(a, false)).join("")}</ul>`
          : `<p class="empty">${t("appt.past.none")}</p>`
      }
    </div>
  `;
}

function appointmentRowMarkup(a, isUpcoming) {
  return `
    <li class="entity-row">
      <div class="entity-main">
        <strong>${escapeHtml(a.purpose || a.doctor || t("appt.form.titleNew"))}</strong>
        <span class="muted">${formatApptDateTime(a.datetime)}${a.doctor ? " · " + escapeHtml(a.doctor) : ""}</span>
        ${a.location ? `<span class="muted">${escapeHtml(a.location)}</span>` : ""}
        ${!isUpcoming ? `<span class="badge">${escapeHtml(t("appt.status." + a.status))}</span>` : ""}
        ${a.notes_after_visit ? `<span class="muted">${escapeHtml(a.notes_after_visit)}</span>` : ""}
      </div>
      <div class="entity-actions">
        ${isUpcoming ? `<button class="btn-link" data-mark-done="${escapeHtml(a.id)}">${t("appt.markDone")}</button>` : ""}
        <button class="btn-link" data-edit-appt="${escapeHtml(a.id)}">${t("common.edit")}</button>
        <button class="btn-link btn-link--danger" data-delete-appt="${escapeHtml(a.id)}">${t("common.delete")}</button>
      </div>
    </li>
  `;
}

function appointmentFormMarkup(item) {
  const isNew = item === "new";
  const a = isNew ? {} : item;
  return `
    <div class="card">
      <h2>${isNew ? t("appt.form.titleNew") : t("appt.form.titleEdit")}</h2>
      <form id="appt-form">
        ${formField(t("appt.form.datetime"), `<input class="field" type="datetime-local" name="datetime" required value="${escapeHtml(toDatetimeLocalValue(a.datetime))}" />`)}
        ${formField(t("appt.form.doctor"), `<input class="field" name="doctor" value="${escapeHtml(a.doctor)}" />`)}
        ${formField(t("appt.form.purpose"), `<input class="field" name="purpose" value="${escapeHtml(a.purpose)}" />`)}
        ${formField(t("appt.form.location"), `<input class="field" name="location" value="${escapeHtml(a.location)}" />`)}
        ${formField(
          t("appt.form.status"),
          `<select class="field" name="status">
            ${["upcoming", "done", "missed"].map((s) => `<option value="${s}" ${(a.status || "upcoming") === s ? "selected" : ""}>${escapeHtml(t("appt.status." + s))}</option>`).join("")}
          </select>`
        )}
        ${formField(t("appt.form.notes"), `<textarea class="field" name="notes_after_visit" rows="3">${escapeHtml(a.notes_after_visit)}</textarea>`)}
        <p class="error-text" id="appt-form-error" hidden></p>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" id="appt-form-cancel">${t("common.cancel")}</button>
          <button type="submit" class="btn btn-primary" id="appt-form-save">${t("common.save")}</button>
        </div>
      </form>
    </div>
  `;
}

function attachApptHandlers(outlet) {
  const addBtn = outlet.querySelector("#add-appt-btn");
  if (addBtn) addBtn.addEventListener("click", () => { apptState.formItem = "new"; renderApptBody(outlet); });

  outlet.querySelectorAll("[data-edit-appt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      apptState.formItem = apptState.appointments.find((a) => a.id === btn.dataset.editAppt) || "new";
      renderApptBody(outlet);
    });
  });

  outlet.querySelectorAll("[data-delete-appt]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("appt.confirmDelete"))) return;
      try {
        await api.call("appointments.delete", { id: btn.dataset.deleteAppt });
        await renderAppointmentsView(outlet);
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  });

  outlet.querySelectorAll("[data-mark-done]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api.call("appointments.update", { id: btn.dataset.markDone, status: "done" });
        await renderAppointmentsView(outlet);
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  });

  const form = outlet.querySelector("#appt-form");
  if (form) {
    outlet.querySelector("#appt-form-cancel").addEventListener("click", () => {
      apptState.formItem = null;
      renderApptBody(outlet);
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(form);
      const localDatetime = fd.get("datetime");
      const parsed = new Date(localDatetime);
      const saveBtn = outlet.querySelector("#appt-form-save");
      const errEl = outlet.querySelector("#appt-form-error");
      if (isNaN(parsed.getTime())) {
        errEl.textContent = t("appt.form.invalidDate");
        errEl.hidden = false;
        return;
      }
      const payload = {
        datetime: parsed.toISOString(),
        doctor: fd.get("doctor").trim(),
        purpose: fd.get("purpose").trim(),
        location: fd.get("location").trim(),
        status: fd.get("status"),
        notes_after_visit: fd.get("notes_after_visit").trim()
      };
      saveBtn.disabled = true;
      try {
        if (apptState.formItem === "new") {
          await api.call("appointments.create", payload);
        } else {
          await api.call("appointments.update", { id: apptState.formItem.id, ...payload });
        }
        await renderAppointmentsView(outlet);
      } catch (err) {
        saveBtn.disabled = false;
        errEl.textContent = err.message || t("common.error");
        errEl.hidden = false;
      }
    });
  }
}

function toDatetimeLocalValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Health log + charts
// ---------------------------------------------------------------------------

// Gentle reference thresholds for the "discuss with your doctor" notice —
// not a diagnosis, just a nudge to mention a reading at the next visit.
// Flagged in the README as general guidance that can vary by doctor.
const HEALTH_THRESHOLDS = {
  bp_sys: 140,
  bp_dia: 90,
  sugar_fasting: 95,
  sugar_pp: 140
};

const healthState = { entries: [], loading: true, formOpen: false, editItem: null, charts: {} };

async function renderHealthView(outlet, openFormInitially) {
  healthState.loading = true;
  healthState.formOpen = !!openFormInitially;
  healthState.editItem = null;
  outlet.innerHTML = genericSkeleton(6);

  try {
    healthState.entries = await api.call("healthlog.list", {});
    healthState.loading = false;
    await renderHealthBody(outlet);
  } catch (err) {
    healthState.loading = false;
    outlet.innerHTML = errorMarkup(err);
    attachRetryHandler(outlet, () => renderHealthView(outlet, false));
  }
}

async function renderHealthBody(outlet) {
  destroyHealthCharts();
  if (healthState.formOpen) {
    outlet.innerHTML = healthFormMarkup(healthState.editItem);
    attachHealthFormHandlers(outlet);
    return;
  }

  const sorted = [...healthState.entries].sort((a, b) => dateStrOf(a.date).localeCompare(dateStrOf(b.date)));
  outlet.innerHTML = healthListMarkup(sorted);
  attachHealthListHandlers(outlet);

  try {
    await loadChartJs();
    renderHealthCharts(sorted);
  } catch {
    const note = outlet.querySelector("#chart-load-error");
    if (note) note.hidden = false;
  }
}

function healthListMarkup(sortedAsc) {
  const latest = sortedAsc[sortedAsc.length - 1];
  const descending = [...sortedAsc].reverse();

  return `
    <button class="btn btn-primary" id="add-health-btn">${t("health.add")}</button>

    ${latest ? healthNoticeMarkup(latest) : ""}

    <div class="card">
      <h2>${t("health.chart.weight")}</h2>
      <div class="chart-container"><canvas id="chart-weight"></canvas></div>
      <p class="error-text" id="chart-load-error" hidden>${t("health.chart.loadError")}</p>
    </div>

    <div class="card">
      <h2>${t("health.chart.bp")}</h2>
      <div class="chart-container"><canvas id="chart-bp"></canvas></div>
      <p class="muted">${t("health.chart.bpNote", { sys: HEALTH_THRESHOLDS.bp_sys, dia: HEALTH_THRESHOLDS.bp_dia })}</p>
    </div>

    <div class="card">
      <h2>${t("health.chart.sugar")}</h2>
      <div class="chart-container"><canvas id="chart-sugar"></canvas></div>
      <p class="muted">${t("health.chart.sugarNote", { fasting: HEALTH_THRESHOLDS.sugar_fasting, pp: HEALTH_THRESHOLDS.sugar_pp })}</p>
    </div>

    <div class="card">
      <h2>${t("health.history.title")}</h2>
      ${
        descending.length
          ? `<ul class="entity-list">${descending.map((e) => healthRowMarkup(e)).join("")}</ul>`
          : `<p class="empty">${t("health.history.none")}</p>`
      }
    </div>

    <p class="disclaimer">${t("health.disclaimer")}</p>
  `;
}

function healthNoticeMarkup(latest) {
  const flags = [];
  if (isAboveThreshold(latest.bp_sys, HEALTH_THRESHOLDS.bp_sys) || isAboveThreshold(latest.bp_dia, HEALTH_THRESHOLDS.bp_dia)) {
    flags.push(t("health.notice.bp"));
  }
  if (isAboveThreshold(latest.sugar_fasting, HEALTH_THRESHOLDS.sugar_fasting) || isAboveThreshold(latest.sugar_pp, HEALTH_THRESHOLDS.sugar_pp)) {
    flags.push(t("health.notice.sugar"));
  }
  if (!flags.length) return "";
  return `<div class="review-note">${flags.join(" ")} ${t("health.notice.suffix")}</div>`;
}

function isAboveThreshold(value, threshold) {
  return value !== "" && value !== null && value !== undefined && Number(value) >= threshold;
}

function healthRowMarkup(e) {
  const parts = [];
  if (e.weight_kg !== "" && e.weight_kg !== undefined) parts.push(t("health.field.weight", { v: e.weight_kg }));
  if (e.bp_sys !== "" && e.bp_sys !== undefined && e.bp_dia !== "" && e.bp_dia !== undefined) {
    parts.push(t("health.field.bp", { sys: e.bp_sys, dia: e.bp_dia }));
  }
  if (e.sugar_fasting !== "" && e.sugar_fasting !== undefined) parts.push(t("health.field.sugarFasting", { v: e.sugar_fasting }));
  if (e.sugar_pp !== "" && e.sugar_pp !== undefined) parts.push(t("health.field.sugarPp", { v: e.sugar_pp }));
  if (e.kicks !== "" && e.kicks !== undefined) parts.push(t("health.field.kicks", { v: e.kicks }));

  return `
    <li class="entity-row">
      <div class="entity-main">
        <strong>${escapeHtml(formatDisplayDate(dateStrOf(e.date)))}</strong>
        <span class="muted">${escapeHtml(parts.join(" · "))}</span>
        ${e.mood ? `<span class="muted">${t("health.field.mood", { v: escapeHtml(e.mood) })}</span>` : ""}
        ${e.symptoms ? `<span class="muted">${escapeHtml(e.symptoms)}</span>` : ""}
      </div>
      <div class="entity-actions">
        <button class="btn-link" data-edit-health="${escapeHtml(e.id)}">${t("common.edit")}</button>
        <button class="btn-link btn-link--danger" data-delete-health="${escapeHtml(e.id)}">${t("common.delete")}</button>
      </div>
    </li>
  `;
}

function healthFormMarkup(item) {
  const isNew = !item;
  const e = isNew ? {} : item;
  return `
    <div class="card">
      <h2>${isNew ? t("health.form.titleNew") : t("health.form.titleEdit")}</h2>
      <form id="health-form">
        ${formField(t("health.form.date"), `<input class="field" type="date" name="date" required value="${escapeHtml(dateStrOf(e.date) || formatDateInput(new Date()))}" />`)}
        ${formField(t("health.form.weight"), `<input class="field" type="number" step="0.1" name="weight_kg" value="${escapeHtml(e.weight_kg)}" />`)}
        ${formField(t("health.form.bpSys"), `<input class="field" type="number" name="bp_sys" value="${escapeHtml(e.bp_sys)}" />`)}
        ${formField(t("health.form.bpDia"), `<input class="field" type="number" name="bp_dia" value="${escapeHtml(e.bp_dia)}" />`)}
        ${formField(t("health.form.sugarFasting"), `<input class="field" type="number" name="sugar_fasting" value="${escapeHtml(e.sugar_fasting)}" />`)}
        ${formField(t("health.form.sugarPp"), `<input class="field" type="number" name="sugar_pp" value="${escapeHtml(e.sugar_pp)}" />`)}
        ${formField(t("health.form.kicks"), `<input class="field" type="number" name="kicks" value="${escapeHtml(e.kicks)}" />`)}
        ${formField(t("health.form.mood"), `<input class="field" name="mood" value="${escapeHtml(e.mood)}" />`)}
        ${formField(t("health.form.symptoms"), `<input class="field" name="symptoms" value="${escapeHtml(e.symptoms)}" />`)}
        ${formField(t("health.form.notes"), `<textarea class="field" name="notes" rows="3">${escapeHtml(e.notes)}</textarea>`)}
        <p class="error-text" id="health-form-error" hidden></p>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" id="health-form-cancel">${t("common.cancel")}</button>
          <button type="submit" class="btn btn-primary" id="health-form-save">${t("common.save")}</button>
        </div>
      </form>
    </div>
  `;
}

function attachHealthListHandlers(outlet) {
  const addBtn = outlet.querySelector("#add-health-btn");
  if (addBtn) {
    addBtn.addEventListener("click", async () => {
      healthState.formOpen = true;
      healthState.editItem = null;
      await renderHealthBody(outlet);
    });
  }

  outlet.querySelectorAll("[data-edit-health]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      healthState.formOpen = true;
      healthState.editItem = healthState.entries.find((e) => e.id === btn.dataset.editHealth) || null;
      await renderHealthBody(outlet);
    });
  });

  outlet.querySelectorAll("[data-delete-health]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("health.confirmDelete"))) return;
      try {
        await api.call("healthlog.delete", { id: btn.dataset.deleteHealth });
        await renderHealthView(outlet, false);
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  });
}

function attachHealthFormHandlers(outlet) {
  outlet.querySelector("#health-form-cancel").addEventListener("click", async () => {
    healthState.formOpen = false;
    healthState.editItem = null;
    await renderHealthBody(outlet);
  });

  const form = outlet.querySelector("#health-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    const payload = {
      date: fd.get("date"),
      weight_kg: fd.get("weight_kg"),
      bp_sys: fd.get("bp_sys"),
      bp_dia: fd.get("bp_dia"),
      sugar_fasting: fd.get("sugar_fasting"),
      sugar_pp: fd.get("sugar_pp"),
      kicks: fd.get("kicks"),
      mood: fd.get("mood").trim(),
      symptoms: fd.get("symptoms").trim(),
      notes: fd.get("notes").trim()
    };
    const saveBtn = outlet.querySelector("#health-form-save");
    const errEl = outlet.querySelector("#health-form-error");
    saveBtn.disabled = true;
    try {
      if (healthState.editItem) {
        await api.call("healthlog.update", { id: healthState.editItem.id, ...payload });
      } else {
        await api.call("healthlog.create", payload);
      }
      await renderHealthView(outlet, false);
    } catch (err) {
      saveBtn.disabled = false;
      errEl.textContent = err.message || t("common.error");
      errEl.hidden = false;
    }
  });
}

let chartJsLoadPromise = null;
function loadChartJs() {
  if (window.Chart) return Promise.resolve();
  if (chartJsLoadPromise) return chartJsLoadPromise;
  chartJsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js";
    script.onload = () => resolve();
    script.onerror = () => { chartJsLoadPromise = null; reject(new Error("Could not load chart library.")); };
    document.head.appendChild(script);
  });
  return chartJsLoadPromise;
}

function destroyHealthCharts() {
  Object.values(healthState.charts).forEach((chart) => { if (chart) chart.destroy(); });
  healthState.charts = {};
}

function renderHealthCharts(sortedAsc) {
  if (!window.Chart || !sortedAsc.length) return;
  const labels = sortedAsc.map((e) => formatDisplayDate(dateStrOf(e.date)));
  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    scales: { y: { beginAtZero: false } },
    plugins: { legend: { position: "bottom" } }
  };

  const weightCanvas = document.getElementById("chart-weight");
  if (weightCanvas) {
    healthState.charts.weight = new Chart(weightCanvas, {
      type: "line",
      data: { labels, datasets: [{ label: t("health.chart.weight"), data: sortedAsc.map((e) => numOrNull(e.weight_kg)), borderColor: "#d97a7a", backgroundColor: "#d97a7a", spanGaps: true, tension: 0.3 }] },
      options: baseOptions
    });
  }

  const bpCanvas = document.getElementById("chart-bp");
  if (bpCanvas) {
    healthState.charts.bp = new Chart(bpCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: t("health.form.bpSys"), data: sortedAsc.map((e) => numOrNull(e.bp_sys)), borderColor: "#b85f5f", backgroundColor: "#b85f5f", spanGaps: true, tension: 0.3 },
          { label: t("health.form.bpDia"), data: sortedAsc.map((e) => numOrNull(e.bp_dia)), borderColor: "#8fae8b", backgroundColor: "#8fae8b", spanGaps: true, tension: 0.3 }
        ]
      },
      options: baseOptions
    });
  }

  const sugarCanvas = document.getElementById("chart-sugar");
  if (sugarCanvas) {
    healthState.charts.sugar = new Chart(sugarCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: t("health.form.sugarFasting"), data: sortedAsc.map((e) => numOrNull(e.sugar_fasting)), borderColor: "#d97a7a", backgroundColor: "#d97a7a", spanGaps: true, tension: 0.3 },
          { label: t("health.form.sugarPp"), data: sortedAsc.map((e) => numOrNull(e.sugar_pp)), borderColor: "#8fae8b", backgroundColor: "#8fae8b", spanGaps: true, tension: 0.3 }
        ]
      },
      options: baseOptions
    });
  }
}

function numOrNull(value) {
  return value === "" || value === undefined || value === null ? null : Number(value);
}

// ---------------------------------------------------------------------------
// More menu
// ---------------------------------------------------------------------------

function renderMoreView(outlet) {
  outlet.innerHTML = `
    <ul class="menu-list">
      <li><button data-nav="#/emergency">${t("more.emergency")}</button></li>
      <li><button data-nav="#/health">${t("more.health")}</button></li>
      <li><button data-nav="#/guide">${t("more.guide")}</button></li>
      <li><button disabled>${t("more.checklists")} <span class="badge">${t("more.comingSoon")}</span></button></li>
      <li><button disabled>${t("more.settings")} <span class="badge">${t("more.comingSoon")}</span></button></li>
      <li><button id="lock-now-btn">${t("more.lockNow")}</button></li>
    </ul>
  `;
  attachNavButtons(outlet);
  outlet.querySelector("#lock-now-btn").addEventListener("click", () => {
    api.clearPin();
    state.locked = true;
    renderRoute();
  });
}

// ---------------------------------------------------------------------------
// Placeholder view (for tabs not built yet)
// ---------------------------------------------------------------------------

function renderPlaceholderView(outlet, title, step) {
  outlet.innerHTML = `
    <div class="card">
      <h2>${escapeHtml(title)}</h2>
      <p class="empty">${t("common.comingSoon")} (step ${step})</p>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Shared view helpers
// ---------------------------------------------------------------------------

// Static content files (data/*.json) are fetched directly, not through
// api.js — they ship with the app and don't need the PIN. Cached in memory
// for the life of the page since they rarely change between reloads.
const jsonCache = {};

async function loadJson(path) {
  if (jsonCache[path]) return jsonCache[path];
  const res = await fetch(path);
  if (!res.ok) throw new Error("Could not load " + path);
  const json = await res.json();
  jsonCache[path] = json;
  return json;
}

function genericSkeleton(lines) {
  return `
    <div class="card">
      ${Array.from({ length: lines })
        .map((_, i) => `<div class="skeleton skeleton-line ${i % 3 === 2 ? "skeleton-line--short" : i % 2 ? "skeleton-line--wide" : "skeleton-line--full"}"></div>`)
        .join("")}
    </div>
  `;
}

function errorMarkup(err) {
  return `
    <div class="card">
      <p class="error-text">${escapeHtml((err && err.message) || t("common.error"))}</p>
      <button class="btn btn-secondary" id="retry-btn">${t("common.retry")}</button>
    </div>
  `;
}

function attachRetryHandler(outlet, retryFn) {
  const btn = outlet.querySelector("#retry-btn");
  if (btn) btn.addEventListener("click", retryFn);
}

function attachNavButtons(outlet) {
  outlet.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => { location.hash = btn.dataset.nav; });
  });
}

// Renders a labeled form field, with an optional small hint line underneath.
function formField(label, inputHtml, hint) {
  return `
    <label class="form-field">
      <span>${label}</span>
      ${inputHtml}
      ${hint ? `<small class="field-hint">${hint}</small>` : ""}
    </label>
  `;
}

// "YYYY-MM-DD" for the given Date, in the browser's local time — used for
// <input type="date"> values and for comparing against sheet date strings.
function formatDateInput(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Normalizes a date-ish value (Date, ISO string, or "YYYY-MM-DD") from the
// API into a plain "YYYY-MM-DD" string for display and comparison.
function dateStrOf(value) {
  if (!value) return "";
  if (value instanceof Date) return formatDateInput(value);
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.substring(0, 10);
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? "" : formatDateInput(parsed);
}

function dateStrEq(a, b) {
  return dateStrOf(a) === dateStrOf(b);
}

function formatDisplayDate(dateStr) {
  try {
    return new Intl.DateTimeFormat("en-IN", { month: "short", day: "numeric", year: "numeric" }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}
