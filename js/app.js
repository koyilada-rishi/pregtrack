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
  "/meds": { render: (outlet) => renderPlaceholderView(outlet, t("placeholder.meds.title"), 5), navKey: "meds", title: () => t("nav.meds") },
  "/visits": { render: (outlet) => renderPlaceholderView(outlet, t("placeholder.visits.title"), 5), navKey: "visits", title: () => t("nav.visits") },
  "/records": { render: (outlet) => renderPlaceholderView(outlet, t("placeholder.records.title"), 7), navKey: "records", title: () => t("nav.records") },
  "/more": { render: renderMoreView, navKey: "more", title: () => t("more.title") },
  "/emergency": { render: renderEmergencyView, navKey: null, title: () => t("emergency.title") },
  "/guide": { render: renderGuideView, navKey: null, title: () => t("guide.title") },
  "/log-vitals": { render: (outlet) => renderPlaceholderView(outlet, t("placeholder.logVitals.title"), 6), navKey: null, title: () => t("placeholder.logVitals.title") }
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
      <button class="btn btn-secondary" data-nav="#/log-vitals">${t("dashboard.logVitals")}</button>
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
// More menu
// ---------------------------------------------------------------------------

function renderMoreView(outlet) {
  outlet.innerHTML = `
    <ul class="menu-list">
      <li><button data-nav="#/emergency">${t("more.emergency")}</button></li>
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
