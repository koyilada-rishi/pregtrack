// Pregnancy Care Tracker — app entry point: router, first-run screen, shell, views.
//
// Every data call goes through js/store.js (never js/api.js directly) —
// store.js transparently routes to mock fixtures or the real backend, adds
// response caching, the bootstrap batch load, and data_version polling.
// See DEVELOPMENT.md for the full architecture.

import { t, setLanguage } from "./i18n.js";
import * as store from "./store.js";
import { computeCountdown, formatDuration, msUntil, isTimePastToday } from "./countdown.js";

const appRoot = document.getElementById("app");

const state = {
  locked: true,
  online: navigator.onLine
};

const NAV_ITEMS = [
  { key: "home", hash: "#/home", icon: "🏠", label: () => t("nav.home") },
  { key: "meds", hash: "#/meds", icon: "💊", label: () => t("nav.meds") },
  { key: "visits", hash: "#/visits", icon: "🩺", label: () => t("nav.visits") },
  { key: "records", hash: "#/records", icon: "📁", label: () => t("nav.records") },
  { key: "more", hash: "#/more", icon: "⋯", label: () => t("nav.more") }
];

const ROUTES = {
  "/home": { render: renderHomeView, navKey: "home", title: () => t("home.title") },
  "/meds": { render: renderMedicinesView, navKey: "meds", title: () => t("nav.meds") },
  "/visits": { render: renderAppointmentsView, navKey: "visits", title: () => t("nav.visits") },
  "/records": { render: renderRecordsView, navKey: "records", title: () => t("nav.records") },
  "/more": { render: renderMoreView, navKey: "more", title: () => t("more.title") },
  "/emergency": { render: renderEmergencyView, navKey: null, title: () => t("emergency.title") },
  "/guide": { render: renderGuideView, navKey: null, title: () => t("guide.title") },
  "/health": { render: (outlet) => renderHealthView(outlet, false), navKey: null, title: () => t("health.title") },
  "/health/new": { render: (outlet) => renderHealthView(outlet, true), navKey: null, title: () => t("health.title") },
  "/checklist": { render: renderChecklistView, navKey: null, title: () => t("checklist.title") },
  "/settings": { render: renderSettingsView, navKey: null, title: () => t("settings.title") }
};

// boot() and registerServiceWorker() are invoked at the very bottom of this
// file, not here — renderShell() (called synchronously inside boot()'s
// mock-mode path) reaches into homeState, which is a `const` declared much
// further down. Module-level `const`s are in their temporal dead zone until
// their own declaration line actually runs, so calling boot() before the
// whole file has been parsed throws a ReferenceError. Calling it last,
// after every const/function below has been declared, sidesteps that for
// good rather than just for homeState specifically.

// Caches the app shell for offline reading and installing to the home
// screen. Registration failures (unsupported browser, non-secure context
// during local dev over plain HTTP on a non-localhost host, etc.) are
// logged but never block the app itself.
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}

// Mock mode needs zero setup — that's the point. Auto-provisions dummy
// credentials so downstream code (Settings' connection display, etc.) has
// something to read. Called both from boot() and from renderRoute() (so
// e.g. signing out while in mock mode self-heals straight back into the
// app instead of getting stuck on a first-run form that mock mode doesn't
// actually need filled in).
function ensureMockCredentials() {
  if (!store.hasApiUrl()) store.setApiUrl("mock://local");
  if (!store.hasPin()) store.setPin("mock");
}

async function boot() {
  if (store.isMockMode()) {
    ensureMockCredentials();
    state.locked = false;
    await enterApp();
    return;
  }

  if (!store.hasApiUrl() || !store.hasPin()) {
    renderFirstRunScreen();
    return;
  }

  try {
    await store.call("auth.check", {});
    state.locked = false;
    await enterApp();
  } catch (err) {
    if (err.kind === "auth") {
      store.clearPin();
      renderFirstRunScreen(t("firstRun.error.wrongPin"));
      return;
    }
    if (err.kind === "lockout") {
      renderFirstRunScreen(t("firstRun.error.lockout"));
      return;
    }
    // Network/server hiccup on an already-trusted device: keep the stored
    // credentials and let the person read cached data offline instead of
    // kicking them back to first-run just because there's no signal.
    state.locked = false;
    await enterApp();
  }
}

async function enterApp() {
  if (!location.hash) location.hash = "#/home";
  window.addEventListener("hashchange", renderRoute);
  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);
  store.startVersionPolling(handleVersionChanged);
  renderRoute();
}

// The backend reported a new data_version (something changed — most likely
// from the other phone). Force a real bootstrap refetch, then silently
// re-render if Home or Emergency is the view currently open; other views
// just pick up the fresh cache next time they're (re)opened.
function handleVersionChanged() {
  store.loadBootstrap(null, true).catch(() => {});
  const path = currentPath();
  if (path === "/home" || path === "/emergency") renderRoute();
}

// ---------------------------------------------------------------------------
// First-run screen (API URL + PIN together, once per device)
// ---------------------------------------------------------------------------

function renderFirstRunScreen(message) {
  appRoot.innerHTML = `
    <div class="lock-screen">
      <h1>${t("firstRun.title")}</h1>
      <p>${t("firstRun.subtitle")}</p>
      <form id="firstrun-form">
        <input id="firstrun-url-input" class="field" type="url" inputmode="url" autocomplete="off"
               placeholder="${t("firstRun.urlPlaceholder")}" value="${escapeHtml(store.getApiUrl())}" />
        <input id="firstrun-pin-input" class="field field-pin" type="password" inputmode="numeric" autocomplete="off"
               placeholder="${t("firstRun.pinPlaceholder")}" />
        <button type="submit" class="btn btn-primary" id="firstrun-submit">${t("firstRun.submit")}</button>
        <p class="error-text" id="firstrun-error" ${message ? "" : "hidden"}>${escapeHtml(message || "")}</p>
      </form>
      <p class="disclaimer">${t("firstRun.hint")}</p>
    </div>
  `;

  const form = document.getElementById("firstrun-form");
  const urlInput = document.getElementById("firstrun-url-input");
  const pinInput = document.getElementById("firstrun-pin-input");
  (urlInput.value ? pinInput : urlInput).focus();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const url = urlInput.value.trim();
    const pin = pinInput.value.trim();
    if (!/^https:\/\/.+/.test(url)) {
      renderFirstRunScreen(t("firstRun.error.invalidUrl"));
      return;
    }
    if (!pin) return;
    await attemptFirstRun(url, pin);
  });
}

async function attemptFirstRun(url, pin) {
  const submitBtn = document.getElementById("firstrun-submit");
  submitBtn.disabled = true;
  submitBtn.textContent = t("firstRun.checking");

  store.setApiUrl(url);
  store.setPin(pin);
  try {
    await store.call("auth.check", {});
    state.locked = false;
    await enterApp();
  } catch (err) {
    if (err.kind === "auth") {
      store.clearPin(); // keep the URL — no need to retype a value that worked
      renderFirstRunScreen(t("firstRun.error.wrongPin"));
    } else if (err.kind === "lockout") {
      renderFirstRunScreen(t("firstRun.error.lockout"));
    } else if (err.kind === "network") {
      // Nothing proven to work yet on this device — clear both rather than
      // leave a possibly-wrong URL silently stored.
      store.clearApiUrl();
      store.clearPin();
      renderFirstRunScreen(t("firstRun.error.network"));
    } else {
      renderFirstRunScreen(t("firstRun.error.generic"));
    }
  }
}

// ---------------------------------------------------------------------------
// Router + shell
// ---------------------------------------------------------------------------

function currentPath() {
  return (location.hash || "#/home").replace(/^#/, "") || "/home";
}

function renderRoute() {
  if (state.locked) {
    if (store.isMockMode()) {
      ensureMockCredentials();
      state.locked = false;
    } else {
      renderFirstRunScreen();
      return;
    }
  }
  const route = ROUTES[currentPath()] || ROUTES["/home"];
  renderShell(route);
}

function renderShell(route) {
  stopHomeTimers(); // harmless no-op unless Home was the previous view
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
// Home view — live countdown (local, no network), next appointment, today's
// medicines. Backed by store.js's bootstrap cache: instant after the first
// load, refreshed only when startVersionPolling() detects a real change.
// ---------------------------------------------------------------------------

const homeState = {
  bootstrap: null,
  weekEntry: null,
  tickIntervalId: null,
  refreshIntervalId: null
};

async function renderHomeView(outlet) {
  outlet.innerHTML = genericSkeleton(6);

  const paint = async (boot) => {
    homeState.bootstrap = boot;
    homeState.weekEntry = await weekEntryFor(computeCountdown(boot.settings || {}, new Date())).catch(() => null);
    outlet.innerHTML = homeMarkup(boot, homeState.weekEntry);
    attachNavButtons(outlet);
    startHomeTimers(outlet);
  };

  try {
    const boot = await store.loadBootstrap(paint);
    await paint(boot);
  } catch (err) {
    const cached = store.getCachedBootstrap();
    if (cached) {
      await paint(cached);
    } else {
      outlet.innerHTML = errorMarkup(err);
      attachRetryHandler(outlet, () => renderHomeView(outlet));
    }
  }
}

// Looks up the matching data/weeks.json entry for the current gestational
// age (computed locally via countdown.js), clamped to the 4-40 range the
// content file covers.
async function weekEntryFor(age) {
  if (!age) return null;
  const weeksData = await loadJson("./data/weeks.json");
  const weekNum = Math.min(40, Math.max(4, age.weeks));
  return weeksData.weeks.find((w) => w.week === weekNum) || null;
}

function homeMarkup(boot, weekEntry) {
  const settings = boot.settings || {};
  const dashboard = boot.dashboard || {};
  const nextAppt = dashboard.next_appointment;
  const meds = dashboard.today_medicines || [];
  const hasCountdown = !!computeCountdown(settings, new Date());

  return `
    <div class="card countdown-card">
      <h2>${t("home.dueDate")}</h2>
      ${
        hasCountdown
          ? `
        <div class="countdown-days" id="countdown-main"></div>
        <div class="countdown-ticker" id="countdown-ticker"></div>
        <div class="countdown-meta"><span id="countdown-sub"></span></div>
      `
          : `<p class="empty">${t("home.dueDateUnset")}</p>`
      }
    </div>

    <div class="dashboard-actions">
      <button class="btn btn-secondary" data-nav="#/health/new">${t("home.logVitals")}</button>
      <button class="btn btn-emergency" data-nav="#/emergency">${t("home.emergency")}</button>
    </div>

    <div class="card">
      <h2>${t("home.babySize.title")}</h2>
      ${
        weekEntry
          ? `
        <p>${t("guide.thisWeek.size", { comparison: escapeHtml(weekEntry.size_comparison) })}</p>
        <p class="empty">${escapeHtml(weekEntry.development)}</p>
        <a class="card-link" data-nav="#/guide">${t("guide.seeFull")}</a>
      `
          : `<p class="empty">${t("home.babySize.comingSoon")}</p>`
      }
    </div>

    <div class="card">
      <h2>${t("home.nextAppointment.title")}</h2>
      ${
        nextAppt
          ? `
        <ul class="appt-list">
          <li>
            <span>${escapeHtml(nextAppt.purpose || nextAppt.doctor || "")}</span>
            <span class="med-time">${formatApptDateTime(nextAppt.datetime)}</span>
          </li>
        </ul>
        <p class="muted" id="appt-ticker"></p>
      `
          : `<p class="empty">${t("home.nextAppointment.none")}</p>`
      }
    </div>

    <div class="card">
      <h2>${t("home.medicines.title")}</h2>
      ${
        meds.length
          ? `
        <ul class="med-list" id="home-med-list">
          ${meds
            .map(
              (m) => `
            <li data-med-time="${escapeHtml(m.time)}">
              <span>${escapeHtml(m.name)}${m.dose ? " · " + escapeHtml(m.dose) : ""}</span>
              <span class="med-time">${escapeHtml(m.time)}</span>
            </li>
          `
            )
            .join("")}
        </ul>
        <p class="empty">${t("home.medicines.hint")}</p>
      `
          : `<p class="empty">${t("home.medicines.none")}</p>`
      }
    </div>
  `;
}

// 1s ticker: cheap textContent updates only, no DOM rebuild — keeps the
// seconds-resolution countdown smooth without disrupting scroll/focus.
function tickHomeCountdown(outlet) {
  if (!homeState.bootstrap) return;
  const mainEl = document.getElementById("countdown-main");
  if (!mainEl) { stopHomeTimers(); return; } // view no longer mounted — safety net

  const now = new Date();
  const settings = homeState.bootstrap.settings || {};
  const countdown = computeCountdown(settings, now);

  if (countdown && countdown.msToDueDate !== null) {
    const dur = formatDuration(countdown.msToDueDate);
    mainEl.textContent = countdown.isOverdue
      ? t("home.daysOverdue", { n: dur.days })
      : dur.days === 0
        ? t("home.dueToday")
        : t("home.daysToGo", { n: dur.days });

    const tickerEl = document.getElementById("countdown-ticker");
    if (tickerEl) {
      tickerEl.textContent = t("home.ticker", {
        h: String(dur.hours).padStart(2, "0"),
        m: String(dur.minutes).padStart(2, "0"),
        s: String(dur.seconds).padStart(2, "0")
      });
    }

    const subEl = document.getElementById("countdown-sub");
    if (subEl) {
      subEl.textContent =
        t("home.weekDay", { weeks: countdown.weeks, days: countdown.days }) + " · " + t("home.trimester", { n: countdown.trimester });
    }
  }

  const nextAppt = homeState.bootstrap.dashboard && homeState.bootstrap.dashboard.next_appointment;
  const apptTickerEl = document.getElementById("appt-ticker");
  if (apptTickerEl && nextAppt) {
    const msLeft = msUntil(nextAppt.datetime, now);
    apptTickerEl.textContent = msLeft !== null && msLeft > 0 ? t("home.apptIn", formatDuration(msLeft)) : "";
  }

  outlet.querySelectorAll("#home-med-list li[data-med-time]").forEach((li) => {
    li.classList.toggle("med-overdue", isTimePastToday(li.dataset.medTime, now));
  });
}

function startHomeTimers(outlet) {
  tickHomeCountdown(outlet);
  homeState.tickIntervalId = setInterval(() => tickHomeCountdown(outlet), 1000);
  homeState.refreshIntervalId = setInterval(() => {
    if (!homeState.bootstrap) return;
    outlet.innerHTML = homeMarkup(homeState.bootstrap, homeState.weekEntry);
    attachNavButtons(outlet);
    tickHomeCountdown(outlet);
  }, 30000);
}

function stopHomeTimers() {
  if (homeState.tickIntervalId) { clearInterval(homeState.tickIntervalId); homeState.tickIntervalId = null; }
  if (homeState.refreshIntervalId) { clearInterval(homeState.refreshIntervalId); homeState.refreshIntervalId = null; }
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
// Emergency card — shares Home's bootstrap cache (settings + contacts come
// from the same batch load), so it's instant whenever Home has already
// loaded, and still offline-cacheable on its own otherwise.
// ---------------------------------------------------------------------------

async function renderEmergencyView(outlet) {
  outlet.classList.add("emergency-view");
  outlet.innerHTML = genericSkeleton(5);

  const paint = (boot) => { outlet.innerHTML = emergencyMarkup(boot.settings || {}, boot.contacts || []); };

  try {
    const boot = await store.loadBootstrap(paint);
    paint(boot);
  } catch (err) {
    const cached = store.getCachedBootstrap();
    if (cached) {
      paint(cached);
    } else {
      outlet.innerHTML = errorMarkup(err);
      attachRetryHandler(outlet, () => renderEmergencyView(outlet));
    }
  }
}

function emergencyMarkup(settings, contacts) {
  const emergencyContacts = (contacts || []).filter((c) => isTruthy(c.is_emergency));
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
      ${
        emergencyContacts.length
          ? `<ul class="entity-list">${emergencyContacts.map((c) => emergencyContactRowMarkup(c)).join("")}</ul>`
          : `<p class="empty">${t("emergency.contacts.none")}</p>`
      }
    </div>

    <p class="disclaimer">${t("app.disclaimer")}</p>
  `;
}

function emergencyContactRowMarkup(c) {
  const phoneDigits = String(c.phone || "").replace(/[^+\d]/g, "");
  return `
    <li class="entity-row">
      <div class="entity-main">
        <strong>${escapeHtml(c.name)}</strong>
        <span class="muted">${escapeHtml(c.role || "")}</span>
      </div>
      ${phoneDigits ? `<a class="btn-link" href="tel:${phoneDigits}">${t("common.call")}</a>` : ""}
    </li>
  `;
}
// ---------------------------------------------------------------------------
// Food & body guide
// ---------------------------------------------------------------------------

const guideState = { foodlog: [] };

async function renderGuideView(outlet) {
  outlet.innerHTML = genericSkeleton(8);

  try {
    const [boot, weeksData, foodData, warningsData, foodlog] = await Promise.all([
      store.loadBootstrap(),
      loadJson("./data/weeks.json"),
      loadJson("./data/food.json"),
      loadJson("./data/warnings.json"),
      store.call("foodlog.list", {}).catch(() => [])
    ]);
    guideState.foodlog = foodlog;
    // Computed locally (same as Home's countdown) rather than from the
    // backend, so the week shown here always matches Home exactly.
    const age = computeCountdown(boot.settings || {}, new Date());
    outlet.innerHTML = guideMarkup(age, weeksData, foodData, warningsData);
    attachNavButtons(outlet);
    attachFoodlogHandlers(outlet);
  } catch (err) {
    const cachedBoot = store.getCachedBootstrap();
    if (cachedBoot) {
      const age = computeCountdown(cachedBoot.settings || {}, new Date());
      try {
        const [weeksData, foodData, warningsData] = await Promise.all([
          loadJson("./data/weeks.json"),
          loadJson("./data/food.json"),
          loadJson("./data/warnings.json")
        ]);
        guideState.foodlog = [];
        outlet.innerHTML = guideMarkup(age, weeksData, foodData, warningsData);
        attachNavButtons(outlet);
        attachFoodlogHandlers(outlet);
        return;
      } catch {
        // fall through to the error state below
      }
    }
    outlet.innerHTML = errorMarkup(err);
    attachRetryHandler(outlet, () => renderGuideView(outlet));
  }
}

function attachFoodlogHandlers(outlet) {
  const form = outlet.querySelector("#foodlog-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    const payload = {
      date: formatDateInput(new Date()),
      meal: fd.get("meal"),
      items: fd.get("items").trim(),
      craving_or_aversion: fd.get("craving_or_aversion").trim(),
      notes: ""
    };
    if (!payload.items && !payload.craving_or_aversion) return;
    const saveBtn = form.querySelector('button[type="submit"]');
    saveBtn.disabled = true;
    try {
      await store.call("foodlog.create", payload);
      await renderGuideView(outlet);
    } catch (err) {
      saveBtn.disabled = false;
      alert(err.message || t("common.error"));
    }
  });
}

function guideMarkup(age, weeksData, foodData, warningsData) {
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
      <button class="btn btn-emergency" data-nav="#/emergency">${t("home.emergency")}</button>
    </div>

    <div class="card">
      <h2>${t("foodlog.title")}</h2>
      <form id="foodlog-form">
        ${formField(
          t("foodlog.meal"),
          `<select class="field" name="meal">
            ${["Breakfast", "Lunch", "Dinner", "Snack"].map((m) => `<option value="${m}">${m}</option>`).join("")}
          </select>`
        )}
        ${formField(t("foodlog.items"), `<input class="field" name="items" />`)}
        ${formField(t("foodlog.craving"), `<input class="field" name="craving_or_aversion" />`)}
        <button type="submit" class="btn btn-secondary">${t("foodlog.add")}</button>
      </form>
      <h3>${t("foodlog.recent.title")}</h3>
      ${
        guideState.foodlog.length
          ? `<ul class="entity-list">${[...guideState.foodlog]
              .sort((a, b) => dateStrOf(b.date).localeCompare(dateStrOf(a.date)))
              .slice(0, 10)
              .map((f) => foodlogRowMarkup(f))
              .join("")}</ul>`
          : `<p class="empty">${t("foodlog.recent.none")}</p>`
      }
    </div>

    <p class="disclaimer">${escapeHtml(warningsData.disclaimer || t("app.disclaimer"))}</p>
  `;
}

function foodlogRowMarkup(f) {
  const parts = [f.meal, f.items].filter(Boolean);
  return `
    <li class="entity-row">
      <div class="entity-main">
        <strong>${escapeHtml(formatDisplayDate(dateStrOf(f.date)))} · ${escapeHtml(parts.join(" — "))}</strong>
        ${f.craving_or_aversion ? `<span class="muted">${escapeHtml(f.craving_or_aversion)}</span>` : ""}
      </div>
    </li>
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
      store.call("medicines.list", {}),
      store.call("medicines.history", { days: 14 })
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
        await store.call("medicines.delete", { id: btn.dataset.deleteMed });
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
        await store.call("medicines.logTaken", { medicine_id: medicineId, date: formatDateInput(new Date()), time, taken });
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
          await store.call("medicines.create", payload);
        } else {
          await store.call("medicines.update", { id: medsState.formItem.id, ...payload });
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
    apptState.appointments = await store.call("appointments.list", {});
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
        await store.call("appointments.delete", { id: btn.dataset.deleteAppt });
        await renderAppointmentsView(outlet);
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  });

  outlet.querySelectorAll("[data-mark-done]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await store.call("appointments.update", { id: btn.dataset.markDone, status: "done" });
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
          await store.call("appointments.create", payload);
        } else {
          await store.call("appointments.update", { id: apptState.formItem.id, ...payload });
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
    healthState.entries = await store.call("healthlog.list", {});
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
        await store.call("healthlog.delete", { id: btn.dataset.deleteHealth });
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
        await store.call("healthlog.update", { id: healthState.editItem.id, ...payload });
      } else {
        await store.call("healthlog.create", payload);
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
// Records vault
// ---------------------------------------------------------------------------

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const RECORD_TYPE_ICONS = { report: "📄", scan: "🩻", prescription: "💊", document: "🗂️" };

const recordsState = {
  files: [],
  loading: true,
  filterType: "",
  filterFrom: "",
  filterTo: "",
  viewMode: "list",
  uploadOpen: false,
  pendingFile: null, // { base64, mimeType, filename, size }
  viewingFile: null // result of files.get, shown inline
};

async function renderRecordsView(outlet) {
  recordsState.loading = true;
  recordsState.uploadOpen = false;
  recordsState.pendingFile = null;
  recordsState.viewingFile = null;
  outlet.innerHTML = genericSkeleton(6);

  try {
    await reloadRecords();
    recordsState.loading = false;
    renderRecordsBody(outlet);
  } catch (err) {
    recordsState.loading = false;
    outlet.innerHTML = errorMarkup(err);
    attachRetryHandler(outlet, () => renderRecordsView(outlet));
  }
}

async function reloadRecords() {
  const payload = {};
  if (recordsState.filterType) payload.type = recordsState.filterType;
  if (recordsState.filterFrom) payload.date_from = recordsState.filterFrom;
  if (recordsState.filterTo) payload.date_to = recordsState.filterTo;
  recordsState.files = await store.call("files.list", payload);
}

function renderRecordsBody(outlet) {
  if (recordsState.viewingFile) {
    outlet.innerHTML = fileViewerMarkup(recordsState.viewingFile);
    attachFileViewerHandlers(outlet);
    return;
  }
  if (recordsState.uploadOpen) {
    outlet.innerHTML = uploadFormMarkup();
    attachUploadHandlers(outlet);
    return;
  }
  outlet.innerHTML = recordsListMarkup();
  attachRecordsListHandlers(outlet);
}

function recordsListMarkup() {
  return `
    <button class="btn btn-primary" id="add-record-btn">${t("records.add")}</button>

    <div class="card">
      <div class="records-filter-bar">
        ${formField(
          t("records.filter.type"),
          `<select class="field" id="filter-type">
            <option value="">${t("records.filter.allTypes")}</option>
            ${["report", "scan", "prescription", "document"].map((ty) => `<option value="${ty}" ${recordsState.filterType === ty ? "selected" : ""}>${t("records.type." + ty)}</option>`).join("")}
          </select>`
        )}
        <div class="records-date-range">
          ${formField(t("records.filter.from"), `<input class="field" type="date" id="filter-from" value="${escapeHtml(recordsState.filterFrom)}" />`)}
          ${formField(t("records.filter.to"), `<input class="field" type="date" id="filter-to" value="${escapeHtml(recordsState.filterTo)}" />`)}
        </div>
      </div>
      <div class="view-toggle">
        <button class="btn-link ${recordsState.viewMode === "list" ? "view-toggle-active" : ""}" id="view-list-btn">${t("records.view.list")}</button>
        <button class="btn-link ${recordsState.viewMode === "grid" ? "view-toggle-active" : ""}" id="view-grid-btn">${t("records.view.grid")}</button>
      </div>
    </div>

    ${
      recordsState.files.length
        ? recordsState.viewMode === "grid"
          ? `<div class="records-grid">${recordsState.files.map((f) => recordCardMarkup(f)).join("")}</div>`
          : `<div class="card"><ul class="entity-list">${recordsState.files.map((f) => recordRowMarkup(f)).join("")}</ul></div>`
        : `<div class="card"><p class="empty">${t("records.none")}</p></div>`
    }
  `;
}

function recordCardMarkup(f) {
  return `
    <button class="record-card" data-view-file="${escapeHtml(f.id)}">
      <span class="record-type-icon">${RECORD_TYPE_ICONS[f.type] || "🗂️"}</span>
      <span class="record-card-title">${escapeHtml(f.title)}</span>
      <span class="muted">${escapeHtml(formatDisplayDate(f.date))}</span>
    </button>
  `;
}

function recordRowMarkup(f) {
  return `
    <li class="entity-row">
      <button class="entity-main record-row-main" data-view-file="${escapeHtml(f.id)}">
        <strong>${RECORD_TYPE_ICONS[f.type] || "🗂️"} ${escapeHtml(f.title)}</strong>
        <span class="muted">${escapeHtml(t("records.type." + f.type))} · ${escapeHtml(formatDisplayDate(f.date))}${f.doctor ? " · " + escapeHtml(f.doctor) : ""}</span>
      </button>
      <div class="entity-actions">
        <button class="btn-link btn-link--danger" data-delete-file="${escapeHtml(f.id)}">${t("common.delete")}</button>
      </div>
    </li>
  `;
}

function attachRecordsListHandlers(outlet) {
  outlet.querySelector("#add-record-btn").addEventListener("click", () => {
    recordsState.uploadOpen = true;
    renderRecordsBody(outlet);
  });

  const refilter = async () => {
    recordsState.filterType = outlet.querySelector("#filter-type").value;
    recordsState.filterFrom = outlet.querySelector("#filter-from").value;
    recordsState.filterTo = outlet.querySelector("#filter-to").value;
    await reloadRecords();
    renderRecordsBody(outlet);
  };
  outlet.querySelector("#filter-type").addEventListener("change", refilter);
  outlet.querySelector("#filter-from").addEventListener("change", refilter);
  outlet.querySelector("#filter-to").addEventListener("change", refilter);

  outlet.querySelector("#view-list-btn").addEventListener("click", () => { recordsState.viewMode = "list"; renderRecordsBody(outlet); });
  outlet.querySelector("#view-grid-btn").addEventListener("click", () => { recordsState.viewMode = "grid"; renderRecordsBody(outlet); });

  outlet.querySelectorAll("[data-view-file]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.viewFile;
      outlet.innerHTML = genericSkeleton(4);
      try {
        recordsState.viewingFile = await store.call("files.get", { id });
        renderRecordsBody(outlet);
      } catch (err) {
        outlet.innerHTML = errorMarkup(err);
        attachRetryHandler(outlet, () => renderRecordsView(outlet));
      }
    });
  });

  outlet.querySelectorAll("[data-delete-file]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("records.confirmDelete"))) return;
      try {
        await store.call("files.delete", { id: btn.dataset.deleteFile });
        await renderRecordsView(outlet);
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  });
}

function uploadFormMarkup() {
  const pending = recordsState.pendingFile;
  return `
    <div class="card">
      <h2>${t("records.upload.title")}</h2>
      ${
        pending
          ? `<div class="selected-file-chip">${escapeHtml(pending.filename)} (${formatFileSize(pending.size)})</div>`
          : `
        <div class="upload-picker-buttons">
          <label class="btn btn-secondary">
            ${t("records.upload.takePhoto")}
            <input type="file" accept="image/*" capture="environment" id="camera-input" hidden />
          </label>
          <label class="btn btn-secondary">
            ${t("records.upload.chooseFile")}
            <input type="file" accept="image/*,application/pdf,.doc,.docx" id="file-input" hidden />
          </label>
        </div>
      `
      }
      <p class="error-text" id="upload-error" hidden></p>
      ${
        pending
          ? `
        <form id="upload-form">
          ${formField(t("records.upload.recordTitle"), `<input class="field" name="title" required value="${escapeHtml(pending.filename.replace(/\.[^.]+$/, ""))}" />`)}
          ${formField(
            t("records.upload.type"),
            `<select class="field" name="type" required>
              ${["report", "scan", "prescription", "document"].map((ty) => `<option value="${ty}">${t("records.type." + ty)}</option>`).join("")}
            </select>`
          )}
          ${formField(t("records.upload.date"), `<input class="field" type="date" name="date" value="${escapeHtml(formatDateInput(new Date()))}" />`)}
          ${formField(t("records.upload.doctor"), `<input class="field" name="doctor" />`)}
          ${formField(t("records.upload.notes"), `<textarea class="field" name="notes" rows="2"></textarea>`)}
          <div class="form-actions">
            <button type="button" class="btn btn-secondary" id="upload-cancel">${t("common.cancel")}</button>
            <button type="submit" class="btn btn-primary" id="upload-save">${t("common.save")}</button>
          </div>
        </form>
      `
          : `<button class="btn btn-secondary" id="upload-cancel-initial">${t("common.cancel")}</button>`
      }
    </div>
  `;
}

function attachUploadHandlers(outlet) {
  const cancelBtn = outlet.querySelector("#upload-cancel") || outlet.querySelector("#upload-cancel-initial");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      recordsState.uploadOpen = false;
      recordsState.pendingFile = null;
      renderRecordsBody(outlet);
    });
  }

  const errEl = outlet.querySelector("#upload-error");
  const handleFile = async (file) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      errEl.textContent = t("records.upload.tooLarge");
      errEl.hidden = false;
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const match = /^data:(.*?);base64,(.*)$/.exec(dataUrl);
      recordsState.pendingFile = {
        base64: match ? match[2] : "",
        mimeType: (match && match[1]) || file.type || "application/octet-stream",
        filename: file.name,
        size: file.size
      };
      renderRecordsBody(outlet);
    } catch {
      errEl.textContent = t("records.upload.readError");
      errEl.hidden = false;
    }
  };

  const cameraInput = outlet.querySelector("#camera-input");
  if (cameraInput) cameraInput.addEventListener("change", (e) => handleFile(e.target.files[0]));
  const fileInput = outlet.querySelector("#file-input");
  if (fileInput) fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));

  const form = outlet.querySelector("#upload-form");
  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(form);
      const saveBtn = outlet.querySelector("#upload-save");
      saveBtn.disabled = true;
      try {
        await store.call("files.upload", {
          title: fd.get("title").trim(),
          type: fd.get("type"),
          date: fd.get("date"),
          doctor: fd.get("doctor").trim(),
          notes: fd.get("notes").trim(),
          filename: recordsState.pendingFile.filename,
          mimeType: recordsState.pendingFile.mimeType,
          base64: recordsState.pendingFile.base64
        });
        recordsState.uploadOpen = false;
        recordsState.pendingFile = null;
        await renderRecordsView(outlet);
      } catch (err) {
        saveBtn.disabled = false;
        errEl.textContent = err.message || t("common.error");
        errEl.hidden = false;
      }
    });
  }
}

function fileViewerMarkup(file) {
  const dataUrl = `data:${file.mimeType};base64,${file.base64}`;
  const isImage = file.mimeType.startsWith("image/");
  return `
    <button class="btn-link" id="viewer-back">${t("common.back")}</button>
    <div class="card">
      <h2>${escapeHtml(file.title)}</h2>
      <p class="muted">${escapeHtml(t("records.type." + file.type))} · ${escapeHtml(formatDisplayDate(file.date))}${file.doctor ? " · " + escapeHtml(file.doctor) : ""}</p>
      ${file.notes ? `<p class="muted">${escapeHtml(file.notes)}</p>` : ""}
      ${
        isImage
          ? `<img src="${dataUrl}" alt="${escapeHtml(file.title)}" class="file-preview-image" />`
          : `<p>${t("records.viewer.openExternally")}</p><a class="btn btn-secondary" href="${dataUrl}" target="_blank" rel="noopener">${t("records.viewer.open")}</a>`
      }
    </div>
  `;
}

function attachFileViewerHandlers(outlet) {
  outlet.querySelector("#viewer-back").addEventListener("click", () => {
    recordsState.viewingFile = null;
    renderRecordsBody(outlet);
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// ---------------------------------------------------------------------------
// Checklists
// ---------------------------------------------------------------------------

const CHECKLIST_TABS = ["hospital_bag", "documents", "baby_items"];
const checklistState = { items: [], loading: true, activeList: "hospital_bag" };

async function renderChecklistView(outlet) {
  checklistState.loading = true;
  outlet.innerHTML = genericSkeleton(5);
  try {
    checklistState.items = await store.call("checklist.list", {});
    checklistState.loading = false;
    renderChecklistBody(outlet);
  } catch (err) {
    checklistState.loading = false;
    outlet.innerHTML = errorMarkup(err);
    attachRetryHandler(outlet, () => renderChecklistView(outlet));
  }
}

function renderChecklistBody(outlet) {
  const items = checklistState.items.filter((i) => i.list === checklistState.activeList);
  const doneCount = items.filter((i) => isTruthy(i.done)).length;

  outlet.innerHTML = `
    <div class="tab-bar">
      ${CHECKLIST_TABS.map((tab) => `<button class="tab-btn ${checklistState.activeList === tab ? "tab-btn-active" : ""}" data-tab="${tab}">${t("checklist.tab." + tab)}</button>`).join("")}
    </div>

    <div class="card">
      <h2>${t("checklist.progress", { done: doneCount, total: items.length })}</h2>
      ${
        items.length
          ? `<ul class="checklist-items">${items.map((i) => checklistItemMarkup(i)).join("")}</ul>`
          : `<p class="empty">${t("checklist.none")}</p>`
      }
      <form id="checklist-add-form" class="checklist-add-form">
        <input class="field" name="item" placeholder="${t("checklist.addPlaceholder")}" required />
        <button type="submit" class="btn btn-primary">${t("common.add")}</button>
      </form>
    </div>
  `;

  outlet.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      checklistState.activeList = btn.dataset.tab;
      renderChecklistBody(outlet);
    });
  });

  outlet.querySelectorAll('input[type="checkbox"][data-checklist-id]').forEach((cb) => {
    cb.addEventListener("change", async () => {
      const id = cb.dataset.checklistId;
      const done = cb.checked;
      cb.disabled = true;
      try {
        await store.call("checklist.update", { id, done });
        const item = checklistState.items.find((i) => i.id === id);
        if (item) item.done = done;
        renderChecklistBody(outlet);
      } catch (err) {
        cb.checked = !done;
        cb.disabled = false;
        alert(err.message || t("common.error"));
      }
    });
  });

  outlet.querySelectorAll("[data-delete-checklist]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("checklist.confirmDelete"))) return;
      try {
        await store.call("checklist.delete", { id: btn.dataset.deleteChecklist });
        await renderChecklistView(outlet);
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  });

  const addForm = outlet.querySelector("#checklist-add-form");
  addForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = addForm.querySelector('input[name="item"]');
    const text = input.value.trim();
    if (!text) return;
    try {
      await store.call("checklist.create", { list: checklistState.activeList, item: text });
      await renderChecklistView(outlet);
    } catch (err) {
      alert(err.message || t("common.error"));
    }
  });
}

function checklistItemMarkup(item) {
  const done = isTruthy(item.done);
  return `
    <li class="checklist-item">
      <label class="checklist-check">
        <input type="checkbox" data-checklist-id="${escapeHtml(item.id)}" ${done ? "checked" : ""} />
        <span class="${done ? "med-check-done" : ""}">${escapeHtml(item.item)}</span>
      </label>
      <button class="btn-link btn-link--danger" data-delete-checklist="${escapeHtml(item.id)}">${t("common.delete")}</button>
    </li>
  `;
}

// ---------------------------------------------------------------------------
// Settings (+ Contacts)
// ---------------------------------------------------------------------------

const settingsState = { settings: {}, contacts: [], loading: true, contactFormItem: null };

async function renderSettingsView(outlet) {
  settingsState.loading = true;
  settingsState.contactFormItem = null;
  outlet.innerHTML = genericSkeleton(8);
  try {
    const [settings, contacts] = await Promise.all([store.call("settings.get", {}), store.call("contacts.list", {})]);
    settingsState.settings = settings;
    settingsState.contacts = contacts;
    settingsState.loading = false;
    renderSettingsBody(outlet);
  } catch (err) {
    settingsState.loading = false;
    outlet.innerHTML = errorMarkup(err);
    attachRetryHandler(outlet, () => renderSettingsView(outlet));
  }
}

function renderSettingsBody(outlet) {
  const s = settingsState.settings;
  outlet.innerHTML = `
    <div class="card">
      <h2>${t("settings.pregnancy.title")}</h2>
      <form id="settings-form">
        ${formField(t("settings.dueDate"), `<input class="field" type="date" name="due_date" value="${escapeHtml(s.due_date)}" />`)}
        ${formField(t("settings.lmpDate"), `<input class="field" type="date" name="lmp_date" value="${escapeHtml(s.lmp_date)}" />`, t("settings.lmpHint"))}
        ${formField(t("settings.wifeName"), `<input class="field" name="wife_name" value="${escapeHtml(s.wife_name)}" />`)}
        ${formField(t("settings.bloodGroup"), `<input class="field" name="blood_group" value="${escapeHtml(s.blood_group)}" />`)}
        ${formField(t("settings.allergies"), `<textarea class="field" name="allergies" rows="2">${escapeHtml(s.allergies)}</textarea>`)}
        ${formField(t("settings.hospitalName"), `<input class="field" name="hospital_name" value="${escapeHtml(s.hospital_name)}" />`)}
        ${formField(t("settings.hospitalPhone"), `<input class="field" type="tel" name="hospital_phone" value="${escapeHtml(s.hospital_phone)}" />`)}
        ${formField(t("settings.hospitalAddress"), `<input class="field" name="hospital_address" value="${escapeHtml(s.hospital_address)}" />`)}
        ${formField(t("settings.insurance"), `<textarea class="field" name="insurance_info" rows="2">${escapeHtml(s.insurance_info)}</textarea>`)}
        ${formField(t("settings.language"), `<select class="field" name="language"><option value="en" selected>English</option></select>`, t("settings.languageHint"))}
        <p class="error-text" id="settings-form-error" hidden></p>
        <p class="success-text" id="settings-form-success" hidden>${t("settings.saved")}</p>
        <button type="submit" class="btn btn-primary">${t("common.save")}</button>
      </form>
    </div>

    <div class="card">
      <h2>${t("settings.contacts.title")}</h2>
      ${
        settingsState.contacts.length
          ? `<ul class="entity-list">${settingsState.contacts.map((c) => contactRowMarkup(c)).join("")}</ul>`
          : `<p class="empty">${t("settings.contacts.none")}</p>`
      }
      ${settingsState.contactFormItem ? contactFormMarkup(settingsState.contactFormItem) : `<button class="btn btn-secondary" id="add-contact-btn">${t("settings.contacts.add")}</button>`}
    </div>

    <div class="card">
      <h2>${t("settings.account.title")}</h2>
      ${
        store.isMockMode()
          ? `<p class="muted">${t("settings.account.mockMode")}</p>`
          : `<p class="muted">${escapeHtml(store.getApiUrl())}</p>`
      }
      <p class="muted">${t("settings.account.pinInstructions")}</p>
      <button class="btn btn-secondary" id="settings-signout-btn">${t("settings.account.signOut")}</button>
    </div>
  `;

  attachSettingsHandlers(outlet);
}

function contactRowMarkup(c) {
  return `
    <li class="entity-row">
      <div class="entity-main">
        <strong>${escapeHtml(c.name)}</strong>
        <span class="muted">${escapeHtml([c.role, c.phone].filter(Boolean).join(" · "))}</span>
        ${isTruthy(c.is_emergency) ? `<span class="badge">${t("settings.contacts.emergency")}</span>` : ""}
      </div>
      <div class="entity-actions">
        <button class="btn-link" data-edit-contact="${escapeHtml(c.id)}">${t("common.edit")}</button>
        <button class="btn-link btn-link--danger" data-delete-contact="${escapeHtml(c.id)}">${t("common.delete")}</button>
      </div>
    </li>
  `;
}

function contactFormMarkup(item) {
  const isNew = item === "new";
  const c = isNew ? {} : item;
  return `
    <form id="contact-form">
      ${formField(t("settings.contacts.name"), `<input class="field" name="name" required value="${escapeHtml(c.name)}" />`)}
      ${formField(t("settings.contacts.role"), `<input class="field" name="role" value="${escapeHtml(c.role)}" />`)}
      ${formField(t("settings.contacts.phone"), `<input class="field" type="tel" name="phone" value="${escapeHtml(c.phone)}" />`)}
      ${formField(t("settings.contacts.address"), `<input class="field" name="address" value="${escapeHtml(c.address)}" />`)}
      ${formField(t("settings.contacts.mapsLink"), `<input class="field" name="maps_link" value="${escapeHtml(c.maps_link)}" />`)}
      <label class="checkbox-field">
        <input type="checkbox" name="is_emergency" ${isTruthy(c.is_emergency) ? "checked" : ""} />
        <span>${t("settings.contacts.isEmergency")}</span>
      </label>
      <p class="error-text" id="contact-form-error" hidden></p>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="contact-form-cancel">${t("common.cancel")}</button>
        <button type="submit" class="btn btn-primary">${t("common.save")}</button>
      </div>
    </form>
  `;
}

function attachSettingsHandlers(outlet) {
  const form = outlet.querySelector("#settings-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    const payload = {};
    ["due_date", "lmp_date", "wife_name", "blood_group", "allergies", "hospital_name", "hospital_phone", "hospital_address", "insurance_info", "language"].forEach((key) => {
      payload[key] = (fd.get(key) || "").toString().trim();
    });
    const errEl = outlet.querySelector("#settings-form-error");
    const okEl = outlet.querySelector("#settings-form-success");
    errEl.hidden = true;
    okEl.hidden = true;
    try {
      settingsState.settings = await store.call("settings.set", payload);
      okEl.hidden = false;
    } catch (err) {
      errEl.textContent = err.message || t("common.error");
      errEl.hidden = false;
    }
  });

  outlet.querySelector("#settings-signout-btn").addEventListener("click", () => {
    if (!confirm(t("settings.account.confirmSignOut"))) return;
    store.stopVersionPolling();
    store.clearPin();
    store.clearApiUrl();
    state.locked = true;
    renderRoute();
  });

  const addContactBtn = outlet.querySelector("#add-contact-btn");
  if (addContactBtn) {
    addContactBtn.addEventListener("click", () => {
      settingsState.contactFormItem = "new";
      renderSettingsBody(outlet);
    });
  }

  outlet.querySelectorAll("[data-edit-contact]").forEach((btn) => {
    btn.addEventListener("click", () => {
      settingsState.contactFormItem = settingsState.contacts.find((c) => c.id === btn.dataset.editContact) || "new";
      renderSettingsBody(outlet);
    });
  });

  outlet.querySelectorAll("[data-delete-contact]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("settings.contacts.confirmDelete"))) return;
      try {
        await store.call("contacts.delete", { id: btn.dataset.deleteContact });
        await renderSettingsView(outlet);
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  });

  const contactForm = outlet.querySelector("#contact-form");
  if (contactForm) {
    outlet.querySelector("#contact-form-cancel").addEventListener("click", () => {
      settingsState.contactFormItem = null;
      renderSettingsBody(outlet);
    });
    contactForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(contactForm);
      const payload = {
        name: fd.get("name").trim(),
        role: fd.get("role").trim(),
        phone: fd.get("phone").trim(),
        address: fd.get("address").trim(),
        maps_link: fd.get("maps_link").trim(),
        is_emergency: fd.get("is_emergency") === "on"
      };
      try {
        if (settingsState.contactFormItem === "new") {
          await store.call("contacts.create", payload);
        } else {
          await store.call("contacts.update", { id: settingsState.contactFormItem.id, ...payload });
        }
        await renderSettingsView(outlet);
      } catch (err) {
        const errEl = outlet.querySelector("#contact-form-error");
        errEl.textContent = err.message || t("common.error");
        errEl.hidden = false;
      }
    });
  }
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
      <li><button data-nav="#/checklist">${t("more.checklists")}</button></li>
      <li><button data-nav="#/settings">${t("more.settings")}</button></li>
    </ul>
  `;
  attachNavButtons(outlet);
}

// ---------------------------------------------------------------------------
// Shared view helpers
// ---------------------------------------------------------------------------

// Static content files (data/*.json) are fetched directly, not through
// store.js — they ship with the app and don't need the PIN. Cached in memory
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

// ---------------------------------------------------------------------------
// Start the app — deliberately last in the file (see the comment near the
// top where ROUTES is defined).
// ---------------------------------------------------------------------------

boot().catch((err) => {
  console.error("Fatal startup error", err);
  appRoot.innerHTML = `<div class="lock-screen"><h1>${t("app.name")}</h1><p>${t("firstRun.error.generic")}</p></div>`;
});

registerServiceWorker();
