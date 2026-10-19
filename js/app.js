// Pregnancy Care Tracker — app entry point: router, first-run screen, shell, views.
//
// Every data call goes through js/store.js (never js/api.js directly) —
// store.js transparently routes to mock fixtures or the real backend, adds
// response caching, the bootstrap batch load, and data_version polling.
// See DEVELOPMENT.md for the full architecture.

import { t, setLanguage } from "./i18n.js";
import * as store from "./store.js";
import {
  computeCountdown, formatDuration, msUntil, isTimePastToday,
  computeCustomCountdown, computeStockCountdown, classifyCountdownState
} from "./countdown.js";
import * as schedule from "./schedule.js";
import { parseQuickAdd } from "./quickadd.js";

const appRoot = document.getElementById("app");

const state = {
  locked: true,
  online: navigator.onLine
};

// ---------------------------------------------------------------------------
// Shared UI: bottom sheets + 6-second undo toasts.
//
// Both are appended to document.body (not the router outlet) so they work
// identically whether opened from Home, the Meds page, or anywhere else,
// and survive a route change underneath them (closed explicitly on
// navigation — see attachNavButtons/renderRoute). Only one of each at a
// time; opening a new one replaces whatever's already showing.
//
// The undo pattern used everywhere a delete/stop happens: apply the change
// to local state and re-render immediately (optimistic), show a toast with
// Undo, and only fire the real network call once the toast's 6s expire
// without Undo being pressed. Pressing Undo this restores local state and
// never touches the network at all — there's nothing to roll back server-
// side because nothing was ever sent. This is what "no scary confirm
// dialogs" means in practice: the action already happened, reversibly.
// ---------------------------------------------------------------------------

function closeSheet() {
  const el = document.getElementById("active-sheet-overlay");
  if (el) el.remove();
}

// innerHtml is the sheet's own content (its own heading + body + actions);
// onMount(sheetEl) runs right after it's in the DOM, for attaching handlers.
function openSheet(innerHtml, onMount) {
  closeSheet();
  const overlay = document.createElement("div");
  overlay.className = "sheet-overlay";
  overlay.id = "active-sheet-overlay";
  overlay.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${innerHtml}</div>`;
  overlay.addEventListener("click", (event) => { if (event.target === overlay) closeSheet(); });
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("sheet-open"));
  if (onMount) onMount(overlay.querySelector(".sheet"));
  return overlay;
}

let undoToastTimeoutId = null;
function closeUndoToast() {
  if (undoToastTimeoutId) { clearTimeout(undoToastTimeoutId); undoToastTimeoutId = null; }
  const el = document.getElementById("active-undo-toast");
  if (el) el.remove();
}

// message: shown plain text. onUndo(): called if the person taps Undo
// within the window — nothing else happens. onCommit(): called once the
// toast expires untouched — this is where the real store.call() actually
// fires.
function showUndoToast(message, { onUndo, onCommit }, seconds) {
  closeUndoToast();
  const toast = document.createElement("div");
  toast.className = "undo-toast";
  toast.id = "active-undo-toast";
  toast.innerHTML = `<span>${escapeHtml(message)}</span><button type="button" class="btn-link undo-toast-btn">${t("common.undo")}</button>`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("undo-toast-open"));

  undoToastTimeoutId = setTimeout(async () => {
    undoToastTimeoutId = null;
    toast.remove();
    await onCommit();
  }, (seconds || 6) * 1000);

  toast.querySelector(".undo-toast-btn").addEventListener("click", () => {
    if (undoToastTimeoutId) { clearTimeout(undoToastTimeoutId); undoToastTimeoutId = null; }
    toast.remove();
    onUndo();
  });
}

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
  "/meds/history": { render: renderMedicinesHistoryView, navKey: "meds", title: () => t("meds.history.title") },
  "/visits": { render: renderAppointmentsView, navKey: "visits", title: () => t("nav.visits") },
  "/records": { render: renderRecordsView, navKey: "records", title: () => t("nav.records") },
  "/more": { render: renderMoreView, navKey: "more", title: () => t("more.title") },
  "/emergency": { render: renderEmergencyView, navKey: null, title: () => t("emergency.title") },
  "/guide": { render: renderGuideView, navKey: null, title: () => t("guide.title") },
  "/health": { render: (outlet) => renderHealthView(outlet, false), navKey: null, title: () => t("health.title") },
  "/health/new": { render: (outlet) => renderHealthView(outlet, true), navKey: null, title: () => t("health.title") },
  "/checklist": { render: renderChecklistView, navKey: null, title: () => t("checklist.title") },
  "/countdowns": { render: renderCountdownsView, navKey: null, title: () => t("countdowns.title") },
  "/water": { render: renderWaterView, navKey: null, title: () => t("water.title") },
  "/food": { render: renderFoodView, navKey: null, title: () => t("food.title") },
  "/timeline": { render: renderTimelineView, navKey: null, title: () => t("timeline.title") },
  "/bookings": { render: renderBookingsView, navKey: null, title: () => t("bookings.title") },
  "/reimbursement": { render: renderReimbursementView, navKey: null, title: () => t("reimbursement.title") },
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

// Mock mode needs zero setup — that's the point. Auto-provisions a dummy
// PIN so downstream code has something to read (the URL is irrelevant in
// mock mode — store.call() never reaches api.js's real call() at all).
// Called both from boot() and from renderRoute() (so e.g. signing out
// while in mock mode self-heals straight back into the app instead of
// getting stuck on a first-run form that mock mode doesn't need filled in).
function ensureMockCredentials() {
  if (!store.hasPin()) store.setPin("mock");
}

async function boot() {
  if (store.isMockMode()) {
    ensureMockCredentials();
    state.locked = false;
    await enterApp();
    return;
  }

  // The committed default (js/defaults.js) is still its placeholder and no
  // per-device override has been set either — nothing to even try calling.
  if (!store.hasApiUrl()) {
    renderConfigMissing();
    return;
  }

  if (!store.hasPin()) {
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
    // PIN and let the person read cached data offline instead of kicking
    // them back to first-run just because there's no signal.
    state.locked = false;
    await enterApp();
  }
}

// ---------------------------------------------------------------------------
// Config-missing screen — js/defaults.js hasn't been edited past its
// placeholder, and no per-device override is set in Settings → Advanced.
// ---------------------------------------------------------------------------

function renderConfigMissing() {
  appRoot.innerHTML = `
    <div class="lock-screen">
      <h1>${t("app.name")}</h1>
      <p>${t("configMissing.message")}</p>
    </div>
  `;
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
// First-run screen — PIN only. The server URL is already resolved (the
// committed default, or a per-device override from Settings → Advanced) —
// see js/defaults.js and js/api.js's getApiUrl().
// ---------------------------------------------------------------------------

function renderFirstRunScreen(message) {
  appRoot.innerHTML = `
    <div class="lock-screen">
      <h1>${t("firstRun.title")}</h1>
      <p>${t("firstRun.subtitle")}</p>
      <form id="firstrun-form">
        <input id="firstrun-pin-input" class="field field-pin" type="password" inputmode="numeric" autocomplete="off"
               placeholder="${t("firstRun.pinPlaceholder")}" />
        <button type="submit" class="btn btn-primary" id="firstrun-submit">${t("firstRun.submit")}</button>
        <p class="error-text" id="firstrun-error" ${message ? "" : "hidden"}>${escapeHtml(message || "")}</p>
      </form>
      <p class="disclaimer">${t("firstRun.hint")}</p>
    </div>
  `;

  const form = document.getElementById("firstrun-form");
  const pinInput = document.getElementById("firstrun-pin-input");
  pinInput.focus();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const pin = pinInput.value.trim();
    if (!pin) return;
    await attemptFirstRun(pin);
  });
}

async function attemptFirstRun(pin) {
  const submitBtn = document.getElementById("firstrun-submit");
  submitBtn.disabled = true;
  submitBtn.textContent = t("firstRun.checking");

  store.setPin(pin);
  try {
    await store.call("auth.check", {});
    state.locked = false;
    await enterApp();
  } catch (err) {
    if (err.kind === "auth") {
      store.clearPin();
      renderFirstRunScreen(t("firstRun.error.wrongPin"));
    } else if (err.kind === "lockout") {
      renderFirstRunScreen(t("firstRun.error.lockout"));
    } else if (err.kind === "network") {
      // Don't clear the PIN they just typed — it's very likely fine, the
      // URL (committed default or an override) is the more probable
      // culprit, and that's fixed in Settings → Advanced, not by retyping
      // a PIN that was never the problem.
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
  stopCountdownsTimers(); // ditto for the Countdowns view's 30s refresh
  stopMedsTimers(); // ditto for the Medicines view's 30s refresh
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
  outlet: null,
  bootstrap: null,
  logs: [], // ~40 days of MedicineLog — enough history for weekly/monthly due-state and PRN averages
  weekEntry: null,
  countdownExpanded: false,
  refreshIntervalId: null,
  midnightTimeoutId: null,
  // Phase 2: daily check-in, water, food — all "today only" on Home (the
  // dedicated Timeline/Water/Food views pull their own wider history).
  todaysCheckins: [],
  todaysWater: [],
  customSymptomNames: [],
  recentFoods: [],
  selectedMood: null,
  selectedMeal: null
};

async function renderHomeView(outlet) {
  outlet.innerHTML = genericSkeleton(6);
  homeState.outlet = outlet;

  const paint = async (boot) => {
    homeState.bootstrap = boot;
    homeState.weekEntry = await weekEntryFor(computeCountdown(boot.settings || {}, new Date())).catch(() => null);
    const todayStr = schedule.formatLocalDate(new Date());
    try {
      homeState.logs = await store.call("medicines.history", { days: 40 }).then((h) => h.logs);
    } catch {
      homeState.logs = homeState.logs || [];
    }
    await Promise.all([
      store.call("checkins.list", { date_from: todayStr, date_to: todayStr }).then((r) => { homeState.todaysCheckins = r; }).catch(() => {}),
      store.call("water.list", { date_from: todayStr, date_to: todayStr }).then((r) => { homeState.todaysWater = r; }).catch(() => {}),
      store.call("symptoms.list", {}).then((rows) => {
        homeState.customSymptomNames = [...new Set(rows.filter((r) => r.symptom_key === "custom" && r.custom_name).map((r) => r.custom_name))];
      }).catch(() => {}),
      store.call("foodlog.list", {}).then((rows) => {
        homeState.recentFoods = [...new Set(rows.slice().sort((a, b) => dateStrOf(b.date).localeCompare(dateStrOf(a.date))).map((r) => r.items).filter(Boolean))].slice(0, 6);
      }).catch(() => {})
    ]);
    renderHomeBody(outlet);
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

function renderHomeBody(outlet) {
  outlet.innerHTML = homeMarkup(homeState.bootstrap, homeState.logs, homeState.weekEntry, new Date());
  attachNavButtons(outlet);
  attachHomeHandlers(outlet);
  startHomeTimers(outlet);
}

async function refreshHome() {
  if (!homeState.outlet) return;
  const todayStr = schedule.formatLocalDate(new Date());
  try {
    const boot = await store.call("bootstrap", {});
    homeState.bootstrap = boot;
    homeState.logs = await store.call("medicines.history", { days: 40 }).then((h) => h.logs).catch(() => homeState.logs);
    homeState.todaysCheckins = await store.call("checkins.list", { date_from: todayStr, date_to: todayStr }).catch(() => homeState.todaysCheckins);
    homeState.todaysWater = await store.call("water.list", { date_from: todayStr, date_to: todayStr }).catch(() => homeState.todaysWater);
  } catch {
    // Keep showing the last-known state rather than erroring the whole page.
  }
  renderHomeBody(homeState.outlet);
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

function greetingKey(now) {
  const h = now.getHours();
  if (h < 5) return "home.greeting.night";
  if (h < 12) return "home.greeting.morning";
  if (h < 17) return "home.greeting.afternoon";
  if (h < 21) return "home.greeting.evening";
  return "home.greeting.night";
}

function activeMedicines(boot) {
  return (boot.medicines || []).filter((m) => (m.status ? m.status === "active" : isTruthy(m.active)));
}

function logsForMedicine(logs, medicineId) {
  return (logs || []).filter((l) => l.medicine_id === medicineId);
}

// Every calendar-dated dose slot (daily/weekdays/every_n_days) due today,
// grouped into Morning/Afternoon/Evening/Night. Weekly/monthly medicines are
// handled by the separate "Coming up" section; interval/PRN medicines don't
// have fixed slots at all (handled in their own section below).
function todaysMedicineSlots(boot, logs, now) {
  const todayStr = schedule.formatLocalDate(now);
  const buckets = { morning: [], afternoon: [], evening: [], night: [] };
  activeMedicines(boot).forEach((m) => {
    const type = schedule.effectiveScheduleType(m);
    if (type === "interval" || type === "prn" || type === "weekly" || type === "monthly") return;
    schedule.slotsForDay(m, todayStr, logsForMedicine(logs, m.id), now).forEach((slot) => {
      buckets[schedule.timeOfDayBucket(slot.time)].push({ medicine: m, slot });
    });
  });
  Object.keys(buckets).forEach((k) => buckets[k].sort((a, b) => a.slot.time.localeCompare(b.slot.time)));
  return buckets;
}

function intervalAndPrnMedicines(boot) {
  return activeMedicines(boot).filter((m) => ["interval", "prn"].includes(schedule.effectiveScheduleType(m)));
}

// Weekly/monthly medicines that are overdue, due today, or due within 2
// days — the "Coming up" card. Medicines further out than that just don't
// show, so the card stays short and relevant.
function upcomingShots(boot, logs, now) {
  return activeMedicines(boot)
    .filter((m) => ["weekly", "monthly"].includes(schedule.effectiveScheduleType(m)))
    .map((m) => ({ medicine: m, due: schedule.weeklyMonthlyDueState(m, logsForMedicine(logs, m.id), now) }))
    .filter((row) => ["overdue", "due_today", "due_soon"].includes(row.due.state));
}

function pinnedCountdownsOf(boot) {
  return (boot.countdowns || [])
    .filter((c) => isTruthy(c.show_on_home) && !isTruthy(c.done))
    .sort((a, b) => Number(a.pinned_order || 0) - Number(b.pinned_order || 0));
}

function homeMarkup(boot, logs, weekEntry, now) {
  const settings = boot.settings || {};
  const dashboard = boot.dashboard || {};
  const countdown = computeCountdown(settings, now);
  const buckets = todaysMedicineSlots(boot, logs, now);
  const bucketOrder = [
    ["morning", "home.bucket.morning"], ["afternoon", "home.bucket.afternoon"],
    ["evening", "home.bucket.evening"], ["night", "home.bucket.night"]
  ];
  const hasAnyDose = Object.values(buckets).some((b) => b.length);

  return `
    ${quickAddCardMarkup()}

    ${heroCountdownCardMarkup(countdown, settings, weekEntry, now)}

    ${checkinCardMarkup()}

    ${waterCardMarkup(settings)}

    ${foodCardMarkup()}

    <div class="card">
      <div class="card-head">
        <h2>${t("home.medicines.title")}</h2>
        <button type="button" class="btn-add" data-add-medicine aria-label="${t("meds.add")}">+</button>
      </div>
      ${
        hasAnyDose
          ? bucketOrder.map(([key, labelKey]) => bucketOf(buckets[key], key, labelKey)).filter(Boolean).join("")
          : `<p class="empty">${t("home.medicines.none")}</p>`
      }
      ${intervalAndPrnMedicines(boot).map((m) => intervalOrPrnRowMarkup(m, logsForMedicine(logs, m.id), now)).join("")}
    </div>

    ${packsCardMarkup(boot, logs, now)}

    ${comingUpCardMarkup(boot, logs, now)}

    <div class="card">
      <div class="card-head"><h2>${t("home.nextAppointment.title")}</h2></div>
      ${
        dashboard.next_appointment
          ? `
        <button type="button" class="tap-row" data-open-appointment="${escapeHtml(dashboard.next_appointment.id || "")}">
          <span>${escapeHtml(dashboard.next_appointment.purpose || dashboard.next_appointment.doctor || "")}</span>
          <span class="med-time">${formatApptDateTime(dashboard.next_appointment.datetime)}</span>
        </button>
      `
          : `<p class="empty">${t("home.nextAppointment.none")}</p>`
      }
    </div>

    <div class="card">
      <div class="card-head">
        <h2>${t("home.pinnedCountdowns.title")}</h2>
        <button type="button" class="btn-add" data-add-countdown aria-label="${t("countdowns.add")}">+</button>
      </div>
      ${
        pinnedCountdownsOf(boot).length
          ? `
        <ul class="pinned-countdown-list" id="pinned-countdown-list">
          ${pinnedCountdownsOf(boot)
            .map(
              (cd) => `
            <li data-countdown-id="${escapeHtml(cd.id)}">
              <button type="button" class="tap-row" data-open-countdown="${escapeHtml(cd.id)}">
                <span>${escapeHtml(cd.title)}</span>
                <span class="countdown-ticker" id="pinned-cd-${escapeHtml(cd.id)}"></span>
              </button>
            </li>
          `
            )
            .join("")}
        </ul>
      `
          : `<p class="empty">${t("home.pinnedCountdowns.none")}</p>`
      }
      <a class="card-link" data-nav="#/countdowns">${t("countdowns.seeAll")}</a>
    </div>

    <div class="dashboard-actions">
      <button class="btn btn-secondary" data-nav="#/health/new">${t("home.logVitals")}</button>
      <button class="btn btn-emergency" data-nav="#/emergency">${t("home.emergency")}</button>
    </div>
  `;
}

function bucketOf(items, key, labelKey) {
  if (!items.length) return "";
  return `
    <div class="med-bucket" data-bucket="${key}">
      <h3 class="med-bucket-label">${t(labelKey)}</h3>
      <ul class="med-slot-list">
        ${items.map((it) => medicineSlotRowMarkup(it.medicine, it.slot)).join("")}
      </ul>
    </div>
  `;
}

const SLOT_STATUS_LABEL_KEYS = {
  taken: "home.doseStatus.taken", due_now: "home.doseStatus.dueNow", late: "home.doseStatus.late",
  missed: "home.doseStatus.missed", skipped: "home.doseStatus.skipped", upcoming: "home.doseStatus.upcoming"
};
const SLOT_STATUS_STATE_CLASS = {
  taken: "dose-state-sage", due_now: "dose-state-calm", late: "dose-state-amber",
  missed: "dose-state-rose", skipped: "dose-state-amber", upcoming: "dose-state-calm"
};

// The tick circle's actual stored status, independent of how it's
// displayed — a 'pending' log row still *shows* as the natural due_now/
// late/upcoming status (dueStatus() falls through to the time-based
// calculation for it), but the tap cycle needs to know it's there.
function effectiveLogStatus(log) {
  if (!log) return null;
  if (log.status) return log.status;
  return isTruthy(log.taken) ? "taken" : null; // old boolean-only rows with taken=false predate `status` entirely
}

// One tap = one step. taken -> pending (cleared, NOT skipped — untapping
// a dose should never silently record it as skipped) -> skipped (the
// deliberate "I missed/won't take this one" record, now one tap further
// away) -> back to taken. A dose that's never been touched always goes to
// taken first, regardless of how it displays (due_now/late/upcoming/
// missed are all "nothing decided yet" for this purpose).
function nextTickStatus(currentLogStatus) {
  if (currentLogStatus === "taken") return "pending";
  if (currentLogStatus === "pending") return "skipped";
  return "taken";
}

function medicineSlotRowMarkup(m, slot) {
  const taken = slot.status === "taken";
  const skipped = slot.status === "skipped";
  const next = nextTickStatus(effectiveLogStatus(slot.log));
  const takenAtLabel = taken && slot.log && slot.log.taken_at
    ? t("home.doseStatus.takenAt", { time: formatTimeOfDay(new Date(slot.log.taken_at)) })
    : t(SLOT_STATUS_LABEL_KEYS[slot.status] || "home.doseStatus.upcoming");

  return `
    <li class="med-slot-row">
      <button type="button" class="tick-circle ${taken ? "tick-circle-done" : ""} ${skipped ? "tick-circle-skipped" : ""}"
        data-tick-med="${escapeHtml(m.id)}" data-tick-time="${escapeHtml(slot.time)}" data-tick-next-status="${next}"
        aria-label="${escapeHtml(m.name)} ${escapeHtml(slot.time)}">${taken ? "✓" : skipped ? "✕" : ""}</button>
      <button type="button" class="tap-row med-slot-info" data-edit-medicine="${escapeHtml(m.id)}">
        <span class="med-slot-name">${escapeHtml(m.name)}${m.dose ? " · " + escapeHtml(m.dose) : ""}</span>
        <span class="muted">${escapeHtml(slot.time)} · <span class="${SLOT_STATUS_STATE_CLASS[slot.status] || ""}">${takenAtLabel}</span></span>
      </button>
    </li>
  `;
}

function intervalOrPrnRowMarkup(m, logs, now) {
  const type = schedule.effectiveScheduleType(m);
  if (type === "interval") {
    const next = schedule.nextDose(m, logs, now);
    const msLeft = next ? next.getTime() - now.getTime() : null;
    return `
      <div class="med-bucket" data-interval-medicine="${escapeHtml(m.id)}">
        <ul class="med-slot-list">
          <li class="med-slot-row">
            <button type="button" class="tap-row med-slot-info" data-edit-medicine="${escapeHtml(m.id)}">
              <span class="med-slot-name">${escapeHtml(m.name)}${m.dose ? " · " + escapeHtml(m.dose) : ""}</span>
              <span class="muted ${msLeft !== null && msLeft <= 0 ? "dose-state-amber" : "dose-state-calm"}">
                ${msLeft === null ? t("home.doseStatus.noDoseYet") : msLeft <= 0 ? t("home.doseStatus.dueNow") : t("meds.nextDoseIn", formatDuration(msLeft))}
              </span>
            </button>
            <button type="button" class="btn btn-secondary btn-small" data-take-now="${escapeHtml(m.id)}">${t("home.takeNow")}</button>
          </li>
        </ul>
      </div>
    `;
  }
  // PRN
  const gate = schedule.canTakeNow(m, logs, now);
  return `
    <div class="med-bucket" data-prn-medicine="${escapeHtml(m.id)}">
      <ul class="med-slot-list">
        <li class="med-slot-row">
          <button type="button" class="tap-row med-slot-info" data-edit-medicine="${escapeHtml(m.id)}">
            <span class="med-slot-name">${escapeHtml(m.name)}${m.dose ? " · " + escapeHtml(m.dose) : ""}</span>
            <span class="muted">${t("home.prnTakenToday", { n: gate.takenToday })}</span>
          </button>
          <button type="button" class="btn btn-secondary btn-small" data-take-prn="${escapeHtml(m.id)}" data-prn-confirm="0">${t("home.takeOne")}</button>
        </li>
        <li class="prn-confirm-row" data-prn-confirm-row="${escapeHtml(m.id)}" hidden>
          <span class="muted dose-state-amber">${t("home.prnConfirm", { n: gate.takenToday })}</span>
          <button type="button" class="btn-link" data-take-prn="${escapeHtml(m.id)}" data-prn-confirm="1">${t("home.logAnyway")}</button>
        </li>
      </ul>
    </div>
  `;
}

function packsCardMarkup(boot, logs, now) {
  const packs = boot.packs || [];
  if (!packs.length) return "";
  const medicinesById = indexById(boot.medicines || []);
  const todayStr = schedule.formatLocalDate(now);

  return `
    <div class="card">
      <div class="card-head">
        <h2>${t("home.packs.title")}</h2>
        <button type="button" class="btn-add" data-add-pack aria-label="${t("packs.add")}">+</button>
      </div>
      ${packs.map((pack) => packRowMarkup(pack, medicinesById, logs, todayStr)).join("")}
    </div>
  `;
}

function packRowMarkup(pack, medicinesById, logs, todayStr) {
  const memberIds = String(pack.member_medicine_ids || "").split(",").map((s) => s.trim()).filter(Boolean);
  const time = (pack.times || "").split(",")[0] || "";
  const logsByMedicineId = {};
  memberIds.forEach((id) => { logsByMedicineId[id] = logsForMedicine(logs, id); });
  const status = schedule.packStatus(memberIds, logsByMedicineId, todayStr, time);

  return `
    <div class="pack-row" data-pack-id="${escapeHtml(pack.id)}">
      <button type="button" class="tap-row pack-head" data-edit-pack="${escapeHtml(pack.id)}">
        <strong>${escapeHtml(pack.name)}</strong>
        <span class="muted">${escapeHtml(time)}</span>
      </button>
      <ul class="med-slot-list">
        ${memberIds.map((id) => {
          const m = medicinesById[id];
          if (!m) return "";
          const taken = status.memberStatuses[id] === "taken";
          const skipped = status.memberStatuses[id] === "skipped";
          const memberLog = logsByMedicineId[id].find((l) => dateStrOf(l.date) === todayStr && String(l.time) === String(time));
          const next = nextTickStatus(effectiveLogStatus(memberLog));
          return `
            <li class="med-slot-row">
              <button type="button" class="tick-circle ${taken ? "tick-circle-done" : ""} ${skipped ? "tick-circle-skipped" : ""}"
                data-tick-med="${escapeHtml(id)}" data-tick-time="${escapeHtml(time)}" data-tick-next-status="${next}"
                aria-label="${escapeHtml(m.name)}">${taken ? "✓" : skipped ? "✕" : ""}</button>
              <span class="med-slot-name">${escapeHtml(m.name)}</span>
            </li>
          `;
        }).join("")}
      </ul>
      <button type="button" class="btn btn-secondary btn-small" data-tick-all-pack="${escapeHtml(pack.id)}" data-pack-time="${escapeHtml(time)}" ${status.allTaken ? "disabled" : ""}>
        ${status.allTaken ? t("home.packs.allDone") : t("home.packs.tickAll")}
      </button>
    </div>
  `;
}

function comingUpCardMarkup(boot, logs, now) {
  const rows = upcomingShots(boot, logs, now);
  if (!rows.length) return "";
  return `
    <div class="card">
      <div class="card-head"><h2>${t("home.comingUp.title")}</h2></div>
      <ul class="med-slot-list">
        ${rows.map(({ medicine, due }) => `
          <li class="med-slot-row">
            <button type="button" class="tap-row med-slot-info" data-edit-medicine="${escapeHtml(medicine.id)}">
              <span class="med-slot-name">${escapeHtml(medicine.name)}</span>
              <span class="muted ${due.state === "overdue" ? "dose-state-rose" : due.state === "due_today" ? "dose-state-amber" : "dose-state-calm"}">
                ${due.state === "overdue" ? t("home.comingUp.overdue") : due.state === "due_today" ? t("home.comingUp.dueToday") : t("home.comingUp.dueIn", { n: due.daysUntil })}
              </span>
            </button>
            <button type="button" class="btn btn-secondary btn-small" data-mark-given="${escapeHtml(medicine.id)}" data-given-date="${escapeHtml(schedule.formatLocalDate(due.date))}">${t("home.markGiven")}</button>
          </li>
        `).join("")}
      </ul>
    </div>
  `;
}

function heroCountdownCardMarkup(countdown, settings, weekEntry, now) {
  const greeting = t(greetingKey(now));
  if (!countdown) {
    return `
      <div class="card hero-countdown-card">
        <p class="hero-greeting">${escapeHtml(greeting)}</p>
        <p class="empty">${t("home.dueDateUnset")}</p>
      </div>
    `;
  }

  const daysText = countdown.isOverdue
    ? t("home.daysOverdue", { n: Math.abs(Math.ceil(countdown.msToDueDate / 86400000)) })
    : Math.ceil(countdown.msToDueDate / 86400000) === 0
      ? t("home.dueToday")
      : t("home.daysToGo", { n: Math.ceil(countdown.msToDueDate / 86400000) });

  const weekPct = Math.min(100, Math.max(0, (countdown.weeks / 40) * 100));
  const dueDateLabel = countdown.dueDate ? formatDisplayDate(formatDateInput(countdown.dueDate)) : "";

  return `
    <button type="button" class="card hero-countdown-card" id="hero-countdown-card" data-expanded="${homeState.countdownExpanded ? "1" : "0"}">
      <p class="hero-greeting">${escapeHtml(greeting)}</p>
      <div class="hero-days" id="hero-days">${daysText}</div>
      <p class="hero-week-line">${t("home.weekTrimester", { weeks: countdown.weeks, days: countdown.days, trimester: t(`home.trimester.${countdown.trimester}`) })}</p>
      <div class="hero-progress"><div class="hero-progress-fill" style="width:${weekPct}%"></div></div>
      ${dueDateLabel ? `<p class="hero-due-date">${t("home.dueDateSentence", { date: dueDateLabel })}</p>` : ""}
      ${weekEntry ? `<p class="hero-baby-size">${t("guide.thisWeek.size", { comparison: escapeHtml(weekEntry.size_comparison) })}</p>` : ""}
      <div class="hero-detail" id="hero-detail" ${homeState.countdownExpanded ? "" : "hidden"}></div>
    </button>
  `;
}

function tickHeroDetail(now) {
  if (!homeState.countdownExpanded) return;
  const settings = (homeState.bootstrap && homeState.bootstrap.settings) || {};
  const countdown = computeCountdown(settings, now);
  const el = document.getElementById("hero-detail");
  if (!el || !countdown || countdown.msToDueDate === null) return;
  const dur = formatDuration(countdown.msToDueDate);
  el.textContent = countdown.isOverdue
    ? t("home.ticker", { h: String(dur.hours).padStart(2, "0"), m: String(dur.minutes).padStart(2, "0"), s: "" }).replace(/\s*0?s$/, "")
    : t("home.hoursMinutesToGo", { h: dur.hours, m: dur.minutes });
}

function tickPinnedCountdowns(outlet, now) {
  const boot = homeState.bootstrap;
  if (!boot) return;
  const medicinesById = indexById(boot.medicines || []);
  const lastDoseByMedicine = indexById(boot.latest_medicine_doses || [], "medicine_id");

  pinnedCountdownsOf(boot).forEach((cd) => {
    const el = document.getElementById("pinned-cd-" + cd.id);
    if (!el) return;
    const computed = computeCustomCountdown(cd, countdownContext(cd, medicinesById, lastDoseByMedicine), now);
    el.textContent = countdownDetailLine(cd, computed);
    const li = outlet.querySelector('[data-countdown-id="' + cssEscape(cd.id) + '"]');
    if (li) {
      li.classList.remove("countdown-state-upcoming", "countdown-state-dueSoon", "countdown-state-overdue", "countdown-state-done");
      li.classList.add("countdown-state-" + computed.state);
    }
  });
}

// Minimal CSS.escape fallback (not guaranteed available in every target
// browser) — ids here are UUIDs, so this only ever needs to handle the
// characters a UUID can contain, not arbitrary user text.
function cssEscape(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

// Deliberately no 1-second ticker any more (problem #1 — a ticking seconds
// display read as confusing, not reassuring). The day count only needs to
// change once a day; a 30s refresh plus an explicit midnight rollover and
// an on-focus refresh are what the spec actually asked for. The expanded
// hours/minutes detail (tap-to-toggle) still updates every 30s while shown.
function startHomeTimers(outlet) {
  tickPinnedCountdowns(outlet, new Date());
  tickHeroDetail(new Date());
  homeState.refreshIntervalId = setInterval(() => {
    tickPinnedCountdowns(outlet, new Date());
    tickHeroDetail(new Date());
  }, 30000);
  scheduleMidnightRefresh();
  document.addEventListener("visibilitychange", onHomeVisibilityChange);
}

function stopHomeTimers() {
  if (homeState.refreshIntervalId) { clearInterval(homeState.refreshIntervalId); homeState.refreshIntervalId = null; }
  if (homeState.midnightTimeoutId) { clearTimeout(homeState.midnightTimeoutId); homeState.midnightTimeoutId = null; }
  document.removeEventListener("visibilitychange", onHomeVisibilityChange);
}

function onHomeVisibilityChange() {
  if (document.visibilityState === "visible" && homeState.outlet && currentPath() === "/home") {
    renderHomeBody(homeState.outlet);
  }
}

function scheduleMidnightRefresh() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  homeState.midnightTimeoutId = setTimeout(() => {
    if (homeState.outlet && currentPath() === "/home") renderHomeBody(homeState.outlet);
  }, midnight.getTime() - now.getTime());
}

function formatTimeOfDay(date) {
  try {
    return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(date);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Daily check-in + symptoms + water + food — Home cards (Phase 2).
// ---------------------------------------------------------------------------

const MOOD_FACES = ["😢", "😕", "😐", "🙂", "😄"];
const SYMPTOM_FIXED_KEYS = [
  "nausea", "vomiting", "spotting", "bleeding", "headache", "dizziness", "tiredness",
  "back_pain", "cramps", "heartburn", "swelling", "constipation", "fever", "other"
];
const BLEEDING_TYPE_SYMPTOMS = ["spotting", "bleeding"];
const SYMPTOM_SEVERITY_CHIPS = ["mild", "moderate", "severe"];
const BLEEDING_SCALE_CHIPS = ["spotting", "light", "one_pad", "more_than_one_pad"];
const MEAL_CHIPS = ["Breakfast", "Lunch", "Snack", "Dinner"];

function checkinCardMarkup() {
  const todaysCheckins = homeState.todaysCheckins || [];
  return `
    <div class="card checkin-card">
      <h2>${t("checkin.title")}</h2>
      <div class="mood-face-row">
        ${MOOD_FACES.map((face, i) => `<button type="button" class="mood-face ${homeState.selectedMood === i + 1 ? "mood-face-selected" : ""}" data-mood="${i + 1}" aria-label="${t("checkin.mood." + (i + 1))}">${face}</button>`).join("")}
      </div>
      <textarea class="field" id="checkin-note-input" placeholder="${t("checkin.notePlaceholder")}" rows="2">${escapeHtml(homeState.checkinNoteDraft || "")}</textarea>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary btn-small" id="save-checkin-btn" ${homeState.selectedMood ? "" : "disabled"}>${t("checkin.save")}</button>
      </div>

      <p class="field-label">${t("checkin.symptomsLabel")}</p>
      <div class="chip-row">
        ${SYMPTOM_FIXED_KEYS.map((k) => `<button type="button" class="chip" data-symptom-key="${k}">${t("symptom." + k)}</button>`).join("")}
        ${(homeState.customSymptomNames || []).map((name) => `<button type="button" class="chip" data-symptom-key="custom" data-symptom-custom-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}
        <button type="button" class="chip" id="add-custom-symptom-btn">+ ${t("checkin.addCustomSymptom")}</button>
      </div>

      ${todaysCheckins.length ? `
        <ul class="med-slot-list">
          ${todaysCheckins.map((c) => `
            <li class="med-slot-row">
              <span>${MOOD_FACES[c.mood - 1] || ""}${c.note ? " " + escapeHtml(c.note) : ""}</span>
              <span class="muted">${escapeHtml(c.time)}</span>
            </li>
          `).join("")}
        </ul>
      ` : ""}
    </div>
  `;
}

function waterCardMarkup(settings) {
  const goal = Number(settings.water_goal_glasses) || 8;
  const todayGlasses = (homeState.todaysWater || []).reduce((sum, w) => sum + Number(w.glasses || 1), 0);
  return `
    <div class="card">
      <div class="card-head"><h2>${t("water.title")}</h2></div>
      <div class="water-row">
        ${Array.from({ length: goal }, (_, i) => `<span class="water-glass ${i < todayGlasses ? "water-glass-filled" : ""}">💧</span>`).join("")}
      </div>
      <p class="muted">${t("water.progress", { n: todayGlasses, goal })}</p>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="add-water-btn">${t("water.addGlass")}</button>
      </div>
      <a class="card-link" data-nav="#/water">${t("water.seeHistory")}</a>
    </div>
  `;
}

function mealChipForTime(now) {
  const h = now.getHours();
  if (h < 11) return "Breakfast";
  if (h < 16) return "Lunch";
  if (h < 19) return "Snack";
  return "Dinner";
}

function foodCardMarkup() {
  const selectedMeal = homeState.selectedMeal || mealChipForTime(new Date());
  return `
    <div class="card">
      <div class="card-head"><h2>${t("food.title")}</h2></div>
      <div class="chip-row" id="home-meal-chips">
        ${MEAL_CHIPS.map((m) => `<button type="button" class="chip ${selectedMeal === m ? "chip-selected" : ""}" data-meal-chip="${m}">${t("food.meal." + m.toLowerCase())}</button>`).join("")}
      </div>
      <input class="field" id="home-food-input" placeholder="${t("food.whatDidYouEat")}" />
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="home-food-save-btn">${t("food.save")}</button>
      </div>
      ${(homeState.recentFoods || []).length ? `
        <p class="field-label">${t("food.recent")}</p>
        <div class="chip-row">${homeState.recentFoods.map((item) => `<button type="button" class="chip" data-recent-food="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("")}</div>
      ` : ""}
      <a class="card-link" data-nav="#/food">${t("food.seeAll")}</a>
    </div>
  `;
}

// A symptom tap always opens a sheet asking severity (+ bleeding scale for
// spotting/bleeding) + an optional note. A brand-new custom symptom asks
// for its name first, then opens straight into the same detail sheet —
// the name is remembered for reuse via homeState.customSymptomNames
// (derived from past Symptoms rows, no separate catalog to manage).
function openSymptomSheet(symptomKey, customName) {
  if (symptomKey === "custom" && !customName) {
    openSheet(customSymptomNameSheetMarkup(), (sheetEl) => attachCustomSymptomNameHandlers(sheetEl));
    return;
  }
  openSheet(symptomDetailSheetMarkup(symptomKey, customName), (sheetEl) => attachSymptomDetailHandlers(sheetEl, symptomKey, customName));
}

function customSymptomNameSheetMarkup() {
  return `
    <div class="sheet-handle" aria-hidden="true"></div>
    <h2>${t("checkin.addCustomSymptom")}</h2>
    <input class="field" id="custom-symptom-name-input" placeholder="${t("checkin.customSymptomPlaceholder")}" />
    <div class="form-actions">
      <button type="button" class="btn btn-secondary" id="custom-symptom-cancel">${t("common.cancel")}</button>
      <button type="button" class="btn btn-primary" id="custom-symptom-next">${t("common.add")}</button>
    </div>
  `;
}

function attachCustomSymptomNameHandlers(sheetEl) {
  sheetEl.querySelector("#custom-symptom-cancel").addEventListener("click", closeSheet);
  sheetEl.querySelector("#custom-symptom-next").addEventListener("click", () => {
    const name = sheetEl.querySelector("#custom-symptom-name-input").value.trim();
    if (!name) return;
    openSymptomSheet("custom", name);
  });
}

function symptomDetailSheetMarkup(symptomKey, customName) {
  const isBleedingType = BLEEDING_TYPE_SYMPTOMS.includes(symptomKey);
  const label = symptomKey === "custom" ? customName : t("symptom." + symptomKey);
  return `
    <div class="sheet-handle" aria-hidden="true"></div>
    <h2>${escapeHtml(label)}</h2>
    <p class="field-label">${t("checkin.severity")}</p>
    <div class="chip-row">
      ${SYMPTOM_SEVERITY_CHIPS.map((s) => `<button type="button" class="chip" data-chip-group="severity" data-chip-value="${s}">${t("severity." + s)}</button>`).join("")}
    </div>
    ${isBleedingType ? `
      <p class="field-label">${t("checkin.bleedingScale")}</p>
      <div class="chip-row">
        ${BLEEDING_SCALE_CHIPS.map((s) => `<button type="button" class="chip" data-chip-group="bleeding" data-chip-value="${s}">${t("bleedingScale." + s)}</button>`).join("")}
      </div>
    ` : ""}
    <textarea class="field" id="symptom-note-input" placeholder="${t("checkin.notePlaceholder")}" rows="2"></textarea>
    <div id="severe-safety-box" hidden></div>
    <div class="form-actions">
      <button type="button" class="btn btn-secondary" id="symptom-cancel">${t("common.cancel")}</button>
      <button type="button" class="btn btn-primary" id="symptom-save">${t("checkin.logSymptom")}</button>
    </div>
  `;
}

function attachSymptomDetailHandlers(sheetEl, symptomKey, customName) {
  let severity = "";
  let bleedingScale = "";

  function updateSafetyBox() {
    const box = sheetEl.querySelector("#severe-safety-box");
    const severe = severity === "severe" || bleedingScale === "more_than_one_pad";
    box.hidden = !severe;
    if (severe) {
      box.innerHTML = `
        <div class="safety-box">
          <p>${t("checkin.contactDoctorNow")}</p>
          <button type="button" class="btn btn-emergency" data-nav="#/emergency">${t("home.emergency")}</button>
        </div>
      `;
      attachNavButtons(sheetEl);
    }
  }

  sheetEl.querySelectorAll('[data-chip-group="severity"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      sheetEl.querySelectorAll('[data-chip-group="severity"]').forEach((b) => b.classList.remove("chip-selected"));
      btn.classList.add("chip-selected");
      severity = btn.dataset.chipValue;
      updateSafetyBox();
    });
  });
  sheetEl.querySelectorAll('[data-chip-group="bleeding"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      sheetEl.querySelectorAll('[data-chip-group="bleeding"]').forEach((b) => b.classList.remove("chip-selected"));
      btn.classList.add("chip-selected");
      bleedingScale = btn.dataset.chipValue;
      updateSafetyBox();
    });
  });

  sheetEl.querySelector("#symptom-cancel").addEventListener("click", closeSheet);
  sheetEl.querySelector("#symptom-save").addEventListener("click", async () => {
    const note = sheetEl.querySelector("#symptom-note-input").value.trim();
    const saveBtn = sheetEl.querySelector("#symptom-save");
    saveBtn.disabled = true;
    try {
      await store.call("symptoms.create", {
        date: schedule.formatLocalDate(new Date()),
        symptom_key: symptomKey,
        custom_name: symptomKey === "custom" ? customName : "",
        severity, bleeding_scale: bleedingScale, note
      });
      closeSheet();
      await refreshHome();
    } catch (err) {
      saveBtn.disabled = false;
      alert(err.message || t("common.error"));
    }
  });
}

// ---------------------------------------------------------------------------
// Quick Add — a single natural-language text box on Home. Parsed by the
// pure rule engine in js/quickadd.js (no network, fully unit-tested — see
// test/quickadd.test.mjs); this file only ever renders an editable
// confirmation card from the parsed draft and saves through the exact
// same store actions every other form on Home already uses. Nothing is
// ever auto-saved — every path here ends at openSheet() first.
// ---------------------------------------------------------------------------

function quickAddCardMarkup() {
  return `
    <div class="card quickadd-card">
      <h2>${t("quickadd.title")}</h2>
      <div class="quickadd-input-row">
        <input class="field" id="quickadd-input" placeholder="${t("quickadd.placeholder")}" />
        <button type="button" class="btn-add quickadd-mic-btn" id="quickadd-mic-btn" aria-label="${t("quickadd.mic")}" hidden>🎤</button>
      </div>
      <button type="button" class="btn btn-primary" id="quickadd-submit-btn">${t("quickadd.add")}</button>
    </div>
  `;
}

function openQuickAddConfirmSheet(outlet, rawText) {
  const draft = parseQuickAdd(rawText, new Date());
  if (draft.intent === "ambiguous") {
    openSheet(quickAddAmbiguousMarkup(draft), (sheetEl) => attachQuickAddAmbiguousHandlers(sheetEl, draft, outlet));
  } else {
    openSheet(quickAddConfirmMarkup(draft), (sheetEl) => attachQuickAddConfirmHandlers(sheetEl, draft, outlet));
  }
}

const QUICKADD_AMBIGUOUS_BUTTONS = [
  { intent: "booking", labelKey: "quickadd.intent.booking" },
  { intent: "medicine", labelKey: "quickadd.intent.medicine" },
  { intent: "question", labelKey: "quickadd.intent.question" },
  { intent: "symptom", labelKey: "quickadd.intent.symptom" },
  { intent: "note", labelKey: "quickadd.intent.note" }
];

function quickAddAmbiguousMarkup(draft) {
  return `
    <div class="sheet-handle" aria-hidden="true"></div>
    <h2>${t("quickadd.ambiguous.title")}</h2>
    <p class="muted">"${escapeHtml(draft.rawText)}"</p>
    <p>${t("quickadd.ambiguous.hint")}</p>
    <div class="quickadd-ambiguous-buttons">
      ${QUICKADD_AMBIGUOUS_BUTTONS.map((b) => `<button type="button" class="btn btn-secondary" data-force-intent="${b.intent}">${t(b.labelKey)}</button>`).join("")}
    </div>
    <button type="button" class="btn-link" id="quickadd-ambiguous-cancel">${t("common.cancel")}</button>
  `;
}

function attachQuickAddAmbiguousHandlers(sheetEl, draft, outlet) {
  sheetEl.querySelector("#quickadd-ambiguous-cancel").addEventListener("click", closeSheet);
  sheetEl.querySelectorAll("[data-force-intent]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const forced = parseQuickAdd(draft.rawText, new Date(), btn.dataset.forceIntent);
      openSheet(quickAddConfirmMarkup(forced), (sheetEl2) => attachQuickAddConfirmHandlers(sheetEl2, forced, outlet));
    });
  });
}

function needsInputClass(value) {
  return value ? "field" : "field field-needs-input";
}

function quickAddBookingFieldsMarkup(draft) {
  const f = draft.fields;
  return `
    ${formField(t("bookings.form.type"), `<select class="field" name="type">${BOOKING_TYPES_LIST.map((ty) => `<option value="${ty}" ${f.type === ty ? "selected" : ""}>${t("bookings.type." + ty)}</option>`).join("")}</select>`)}
    ${formField(t("bookings.form.title"), `<input class="${needsInputClass(f.title)}" name="title" value="${escapeHtml(f.title || "")}" required />`)}
    ${formField(t("quickadd.form.date"), `<input class="${needsInputClass(draft.date)}" type="date" name="date" value="${escapeHtml(draft.date || "")}" required />`)}
    ${formField(t("quickadd.form.time"), `<input class="${needsInputClass(draft.time)}" type="time" name="time" value="${escapeHtml(draft.time || "")}" required />`, draft.timeIsVague ? t("quickadd.form.timeVagueHint") : "")}
  `;
}

function quickAddMedicineFieldsMarkup(draft) {
  const f = draft.fields;
  return `
    ${formField(t("meds.form.name"), `<input class="${needsInputClass(f.name)}" name="name" value="${escapeHtml(f.name || "")}" required />`)}
    ${formField(t("quickadd.form.startDate"), `<input class="field" type="date" name="start_date" value="${escapeHtml(f.startDate || "")}" />`)}
    ${formField(t("quickadd.form.endDate"), `<input class="field" type="date" name="end_date" value="${escapeHtml(f.endDate || "")}" />`, t("quickadd.form.endDateHint"))}
    ${formField(t("quickadd.form.times"), `<input class="field" name="times" value="${escapeHtml(f.times || "")}" placeholder="08:00, 20:00" />`, draft.timeIsVague ? t("quickadd.form.timeVagueHint") : t("quickadd.form.timesHint"))}
    <p class="safety-note">${t("meds.form.safetyNote")}</p>
  `;
}

function quickAddQuestionFieldsMarkup(draft) {
  return formField(t("quickadd.form.questionText"), `<textarea class="${needsInputClass(draft.fields.text)}" name="text" rows="2" required>${escapeHtml(draft.fields.text || "")}</textarea>`);
}

function quickAddSymptomFieldsMarkup(draft) {
  const f = draft.fields;
  return `
    ${formField(t("checkin.symptomsLabel"), `<select class="field" name="symptom_key">${SYMPTOM_FIXED_KEYS.map((k) => `<option value="${k}" ${f.symptomKey === k ? "selected" : ""}>${t("symptom." + k)}</option>`).join("")}</select>`)}
    ${formField(t("checkin.severity"), `<select class="field" name="severity"><option value="">—</option>${SYMPTOM_SEVERITY_CHIPS.map((s) => `<option value="${s}">${t("severity." + s)}</option>`).join("")}</select>`)}
    ${formField(t("checkin.notePlaceholder"), `<textarea class="field" name="note" rows="2">${escapeHtml(f.note || "")}</textarea>`)}
  `;
}

function quickAddCheckinFieldsMarkup(draft) {
  const f = draft.fields;
  return `
    <p class="field-label">${t("checkin.title")}</p>
    <div class="mood-face-row">
      ${MOOD_FACES.map((face, i) => `<button type="button" class="mood-face ${f.mood === i + 1 ? "mood-face-selected" : ""}" data-quickadd-mood="${i + 1}">${face}</button>`).join("")}
    </div>
    <input type="hidden" name="mood" value="${f.mood || ""}" />
    ${formField(t("checkin.notePlaceholder"), `<textarea class="field" name="note" rows="2">${escapeHtml(f.note || "")}</textarea>`)}
  `;
}

function quickAddFoodFieldsMarkup(draft) {
  const f = draft.fields;
  return `
    ${formField(t("food.title"), `<select class="field" name="meal"><option value="">—</option>${MEAL_CHIPS.map((m) => `<option value="${m}" ${f.meal === m ? "selected" : ""}>${t("food.meal." + m.toLowerCase())}</option>`).join("")}</select>`)}
    ${formField(t("food.whatDidYouEat"), `<input class="${needsInputClass(f.items)}" name="items" value="${escapeHtml(f.items || "")}" required />`)}
  `;
}

function quickAddWaterFieldsMarkup() {
  return `<p class="muted">${t("quickadd.confirm.waterHint")}</p>`;
}

function quickAddNoteFieldsMarkup(draft) {
  return formField(t("quickadd.form.noteText"), `<textarea class="field" name="text" rows="3" required>${escapeHtml(draft.fields.text || "")}</textarea>`);
}

const QUICKADD_FIELD_MARKUP_BY_INTENT = {
  booking: quickAddBookingFieldsMarkup, medicine: quickAddMedicineFieldsMarkup, question: quickAddQuestionFieldsMarkup,
  symptom: quickAddSymptomFieldsMarkup, checkin: quickAddCheckinFieldsMarkup, food: quickAddFoodFieldsMarkup,
  water: quickAddWaterFieldsMarkup, note: quickAddNoteFieldsMarkup
};

function quickAddConfirmMarkup(draft) {
  const bodyFn = QUICKADD_FIELD_MARKUP_BY_INTENT[draft.intent] || quickAddNoteFieldsMarkup;
  return `
    <div class="sheet-handle" aria-hidden="true"></div>
    <h2>${t("quickadd.confirm.title." + draft.intent)}</h2>
    <p class="muted">${t("quickadd.confirm.youTyped", { text: escapeHtml(draft.rawText) })}</p>
    <form id="quickadd-confirm-form">
      ${bodyFn(draft)}
      <p class="error-text" id="quickadd-confirm-error" hidden></p>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="quickadd-confirm-cancel">${t("common.cancel")}</button>
        <button type="submit" class="btn btn-primary">${t("common.save")}</button>
      </div>
    </form>
  `;
}

function attachQuickAddConfirmHandlers(sheetEl, draft, outlet) {
  sheetEl.querySelector("#quickadd-confirm-cancel").addEventListener("click", closeSheet);

  sheetEl.querySelectorAll("[data-quickadd-mood]").forEach((btn) => {
    btn.addEventListener("click", () => {
      sheetEl.querySelectorAll("[data-quickadd-mood]").forEach((b) => b.classList.remove("mood-face-selected"));
      btn.classList.add("mood-face-selected");
      sheetEl.querySelector('input[name="mood"]').value = btn.dataset.quickaddMood;
    });
  });

  sheetEl.querySelector("#quickadd-confirm-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const errEl = sheetEl.querySelector("#quickadd-confirm-error");
    errEl.hidden = true;

    const todayStr = schedule.formatLocalDate(new Date());
    const nowTime = formatTimeHHMM(new Date());
    const fail = (key) => { errEl.textContent = t(key); errEl.hidden = false; };

    let action, payload, undoMessage;

    if (draft.intent === "booking") {
      const dateVal = fd.get("date"), timeVal = fd.get("time");
      const title = fd.get("title").trim();
      if (!dateVal || !timeVal) return fail("quickadd.error.needDateTime");
      if (!title) return fail("quickadd.error.needTitle");
      action = "bookings.create";
      payload = { type: fd.get("type"), title, datetime: new Date(`${dateVal}T${timeVal}`).toISOString() };
      undoMessage = t("quickadd.savedToast.booking", { title });
    } else if (draft.intent === "medicine") {
      const name = fd.get("name").trim();
      if (!name) return fail("quickadd.error.needName");
      action = "medicines.create";
      payload = {
        name, schedule_type: "daily", anchor_mode: "fixed", status: "active",
        start_date: fd.get("start_date") || todayStr, end_date: fd.get("end_date") || "",
        times: fd.get("times").trim(), source: "quickadd"
      };
      undoMessage = t("quickadd.savedToast.medicine", { name });
    } else if (draft.intent === "question") {
      const text = fd.get("text").trim();
      if (!text) return fail("quickadd.error.needText");
      action = "notes.create";
      payload = { date: draft.date || todayStr, time: draft.time || nowTime, category: "question", text };
      undoMessage = t("quickadd.savedToast.question");
    } else if (draft.intent === "symptom") {
      action = "symptoms.create";
      payload = { date: draft.date || todayStr, time: draft.time || nowTime, symptom_key: fd.get("symptom_key"), severity: fd.get("severity") || "", note: fd.get("note").trim() };
      undoMessage = t("quickadd.savedToast.symptom");
    } else if (draft.intent === "checkin") {
      const mood = Number(fd.get("mood"));
      if (!mood) return fail("quickadd.error.needMood");
      action = "checkins.create";
      payload = { date: draft.date || todayStr, time: draft.time || nowTime, mood, note: fd.get("note").trim() };
      undoMessage = t("quickadd.savedToast.checkin");
    } else if (draft.intent === "food") {
      const items = fd.get("items").trim();
      if (!items) return fail("quickadd.error.needItems");
      action = "foodlog.create";
      payload = { date: draft.date || todayStr, meal: fd.get("meal") || "", items, craving_or_aversion: "", notes: "" };
      undoMessage = t("quickadd.savedToast.food");
    } else if (draft.intent === "water") {
      action = "water.add";
      payload = { date: draft.date || todayStr, time: draft.time || nowTime, glasses: 1 };
      undoMessage = t("quickadd.savedToast.water");
    } else {
      const text = fd.get("text").trim();
      if (!text) return fail("quickadd.error.needText");
      action = "notes.create";
      payload = { date: draft.date || todayStr, time: draft.time || nowTime, category: "note", text };
      undoMessage = t("quickadd.savedToast.note");
    }

    closeSheet();
    const quickAddInput = outlet.querySelector("#quickadd-input");
    if (quickAddInput) quickAddInput.value = "";
    showUndoToast(undoMessage, {
      onUndo: () => { /* nothing was ever sent — closing the toast is enough */ },
      onCommit: async () => {
        try {
          await store.call(action, payload);
          await refreshHome();
        } catch (err) {
          alert(err.message || t("common.error"));
        }
      }
    });
  });
}

function attachHomeHandlers(outlet) {
  const quickAddInput = outlet.querySelector("#quickadd-input");
  const quickAddSubmitBtn = outlet.querySelector("#quickadd-submit-btn");
  const quickAddMicBtn = outlet.querySelector("#quickadd-mic-btn");

  const submitQuickAdd = () => {
    const text = quickAddInput.value.trim();
    if (!text) return;
    openQuickAddConfirmSheet(outlet, text);
  };
  if (quickAddSubmitBtn) quickAddSubmitBtn.addEventListener("click", submitQuickAdd);
  if (quickAddInput) {
    quickAddInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); submitQuickAdd(); }
    });
  }

  // Mic is entirely optional — only shown where the browser actually
  // supports speech recognition, feature-detected here rather than assumed.
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (quickAddMicBtn && SpeechRecognitionCtor) {
    quickAddMicBtn.hidden = false;
    quickAddMicBtn.addEventListener("click", () => {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = "en-IN";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      quickAddMicBtn.classList.add("quickadd-mic-listening");
      recognition.onresult = (event) => { quickAddInput.value = event.results[0][0].transcript; };
      recognition.onerror = () => { quickAddMicBtn.classList.remove("quickadd-mic-listening"); };
      recognition.onend = () => { quickAddMicBtn.classList.remove("quickadd-mic-listening"); };
      recognition.start();
    });
  }


  const heroCard = outlet.querySelector("#hero-countdown-card");
  if (heroCard) {
    heroCard.addEventListener("click", () => {
      homeState.countdownExpanded = !homeState.countdownExpanded;
      renderHomeBody(outlet);
    });
  }

  outlet.querySelectorAll("[data-tick-med]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleDoseTaken(btn.dataset.tickMed, btn.dataset.tickTime, btn.dataset.tickNextStatus);
    });
  });

  outlet.querySelectorAll("[data-take-now]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const now = new Date();
      toggleDoseTaken(btn.dataset.takeNow, formatTimeHHMM(now), "taken");
    });
  });

  outlet.querySelectorAll("[data-take-prn]").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const medicineId = btn.dataset.takePrn;
      const confirmed = btn.dataset.prnConfirm === "1";
      const medicine = (homeState.bootstrap.medicines || []).find((m) => m.id === medicineId);
      const gate = schedule.canTakeNow(medicine, logsForMedicine(homeState.logs, medicineId), new Date());
      if (gate.needsConfirm && !confirmed) {
        const row = outlet.querySelector(`[data-prn-confirm-row="${cssEscape(medicineId)}"]`);
        if (row) row.hidden = false;
        return;
      }
      const now = new Date();
      try {
        await store.call("medicines.logTaken", { medicine_id: medicineId, date: schedule.formatLocalDate(now), time: formatTimeHHMM(now), status: "taken" });
        await refreshHome();
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  });

  outlet.querySelectorAll("[data-tick-all-pack]").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        await store.call("packs.tickAll", { id: btn.dataset.tickAllPack, date: schedule.formatLocalDate(new Date()), time: btn.dataset.packTime || formatTimeHHMM(new Date()) });
        await refreshHome();
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  });

  outlet.querySelectorAll("[data-mark-given]").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const medicineId = btn.dataset.markGiven;
      const medicine = (homeState.bootstrap.medicines || []).find((m) => m.id === medicineId);
      const time = schedule.parseTimesList(medicine)[0] || formatTimeHHMM(new Date());
      try {
        await store.call("medicines.logTaken", { medicine_id: medicineId, date: btn.dataset.givenDate, time, status: "taken" });
        await refreshHome();
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  });

  outlet.querySelectorAll("[data-edit-medicine]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const medicine = (homeState.bootstrap.medicines || []).find((m) => m.id === btn.dataset.editMedicine);
      openMedicineSheet(medicine || "new", refreshHome);
    });
  });
  const addMedicineBtn = outlet.querySelector("[data-add-medicine]");
  if (addMedicineBtn) addMedicineBtn.addEventListener("click", () => openMedicineSheet("new", refreshHome));

  outlet.querySelectorAll("[data-edit-pack]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const pack = (homeState.bootstrap.packs || []).find((p) => p.id === btn.dataset.editPack);
      openPackSheet(pack || "new", homeState.bootstrap.medicines || [], refreshHome);
    });
  });
  const addPackBtn = outlet.querySelector("[data-add-pack]");
  if (addPackBtn) addPackBtn.addEventListener("click", () => openPackSheet("new", homeState.bootstrap.medicines || [], refreshHome));

  outlet.querySelectorAll("[data-open-countdown]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const cd = (homeState.bootstrap.countdowns || []).find((c) => c.id === btn.dataset.openCountdown);
      openCountdownSheet(cd || "new", homeState.bootstrap.medicines || [], refreshHome);
    });
  });
  const addCountdownBtn = outlet.querySelector("[data-add-countdown]");
  if (addCountdownBtn) addCountdownBtn.addEventListener("click", () => openCountdownSheet("new", homeState.bootstrap.medicines || [], refreshHome));

  outlet.querySelectorAll("[data-open-appointment]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const appt = homeState.bootstrap.dashboard && homeState.bootstrap.dashboard.next_appointment;
      openAppointmentSheet(appt || "new", refreshHome);
    });
  });

  // --- Daily check-in ---
  outlet.querySelectorAll("[data-mood]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const noteInput = outlet.querySelector("#checkin-note-input");
      homeState.checkinNoteDraft = noteInput ? noteInput.value : "";
      homeState.selectedMood = Number(btn.dataset.mood);
      renderHomeBody(outlet);
    });
  });
  const saveCheckinBtn = outlet.querySelector("#save-checkin-btn");
  if (saveCheckinBtn) {
    saveCheckinBtn.addEventListener("click", async () => {
      if (!homeState.selectedMood) return;
      const note = outlet.querySelector("#checkin-note-input").value.trim();
      saveCheckinBtn.disabled = true;
      try {
        await store.call("checkins.create", { date: schedule.formatLocalDate(new Date()), mood: homeState.selectedMood, note });
        homeState.selectedMood = null;
        homeState.checkinNoteDraft = "";
        await refreshHome();
      } catch (err) {
        saveCheckinBtn.disabled = false;
        alert(err.message || t("common.error"));
      }
    });
  }
  outlet.querySelectorAll("[data-symptom-key]").forEach((btn) => {
    btn.addEventListener("click", () => openSymptomSheet(btn.dataset.symptomKey, btn.dataset.symptomCustomName));
  });
  const addCustomSymptomBtn = outlet.querySelector("#add-custom-symptom-btn");
  if (addCustomSymptomBtn) addCustomSymptomBtn.addEventListener("click", () => openSymptomSheet("custom", null));

  // --- Water: optimistic add with a 6s undo, same pattern as delete/stop ---
  const addWaterBtn = outlet.querySelector("#add-water-btn");
  if (addWaterBtn) {
    addWaterBtn.addEventListener("click", () => {
      const todayStr = schedule.formatLocalDate(new Date());
      const time = formatTimeHHMM(new Date());
      const tempRow = { id: "optimistic-" + Date.now(), date: todayStr, time, glasses: 1 };
      homeState.todaysWater = [...(homeState.todaysWater || []), tempRow];
      renderHomeBody(outlet);
      showUndoToast(t("water.addedToast"), {
        onUndo: () => {
          homeState.todaysWater = homeState.todaysWater.filter((w) => w.id !== tempRow.id);
          renderHomeBody(outlet);
        },
        onCommit: async () => {
          try {
            await store.call("water.add", { date: todayStr, time, glasses: 1 });
          } catch (err) {
            homeState.todaysWater = homeState.todaysWater.filter((w) => w.id !== tempRow.id);
            renderHomeBody(outlet);
            alert(err.message || t("common.error"));
          }
        }
      });
    });
  }

  // --- Food quick-add ---
  outlet.querySelectorAll("[data-meal-chip]").forEach((btn) => {
    btn.addEventListener("click", () => {
      homeState.selectedMeal = btn.dataset.mealChip;
      renderHomeBody(outlet);
    });
  });
  const saveFoodBtn = outlet.querySelector("#home-food-save-btn");
  if (saveFoodBtn) {
    saveFoodBtn.addEventListener("click", async () => {
      const input = outlet.querySelector("#home-food-input");
      const items = input.value.trim();
      if (!items) return;
      saveFoodBtn.disabled = true;
      try {
        await store.call("foodlog.create", { date: schedule.formatLocalDate(new Date()), meal: homeState.selectedMeal || mealChipForTime(new Date()), items, craving_or_aversion: "", notes: "" });
        input.value = "";
        await refreshHome();
      } catch (err) {
        saveFoodBtn.disabled = false;
        alert(err.message || t("common.error"));
      }
    });
  }
  outlet.querySelectorAll("[data-recent-food]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await store.call("foodlog.create", { date: schedule.formatLocalDate(new Date()), meal: homeState.selectedMeal || mealChipForTime(new Date()), items: btn.dataset.recentFood, craving_or_aversion: "", notes: "" });
        await refreshHome();
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  });
}

function formatTimeHHMM(date) {
  return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
}

// Optimistic dose tick: flips local state + re-renders immediately, fires
// the real call in the background, reverts on failure. Re-tapping cycles
// through the next status in nextTickStatus()'s order, so this doesn't
// need the undo-toast treatment that delete/stop get — tapping again
// already moves it on, deliberately, one step at a time (taken -> pending
// -> skipped -> taken), never straight from taken to skipped in one tap.
async function toggleDoseTaken(medicineId, time, status) {
  const outlet = homeState.outlet;
  if (!outlet) return;
  const todayStr = schedule.formatLocalDate(new Date());
  const snapshot = JSON.parse(JSON.stringify(homeState.logs));
  const existing = homeState.logs.find((l) => l.medicine_id === medicineId && dateStrOf(l.date) === todayStr && String(l.time) === String(time));
  if (existing) {
    existing.taken = status === "taken";
    existing.status = status;
  } else {
    homeState.logs.push({ id: "optimistic-" + Date.now(), medicine_id: medicineId, date: todayStr, time, taken: status === "taken", status });
  }
  renderHomeBody(outlet);

  try {
    await store.call("medicines.logTaken", { medicine_id: medicineId, date: todayStr, time, status });
    await refreshHome();
  } catch (err) {
    homeState.logs = snapshot;
    renderHomeBody(outlet);
    alert(err.message || t("common.error"));
  }
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

const medsState = { medicines: [], logs: [], countdowns: [], loading: true, error: null, refreshIntervalId: null, expiryAlertDays: 30 };

async function renderMedicinesView(outlet) {
  medsState.loading = true;
  medsState.error = null;
  outlet.innerHTML = genericSkeleton(6);

  try {
    const [medicines, history, countdowns, settings] = await Promise.all([
      store.call("medicines.list", {}),
      store.call("medicines.history", { days: 40 }),
      store.call("countdowns.list", {}).catch(() => []),
      store.call("settings.get", {}).catch(() => ({}))
    ]);
    medsState.medicines = medicines;
    medsState.logs = history.logs;
    medsState.countdowns = countdowns;
    medsState.expiryAlertDays = Number(settings.expiry_alert_days) || 30;
    medsState.loading = false;
    renderMedsBody(outlet);
  } catch (err) {
    medsState.loading = false;
    medsState.error = err;
    outlet.innerHTML = errorMarkup(err);
    attachRetryHandler(outlet, () => renderMedicinesView(outlet));
  }
}

function stopMedsTimers() {
  if (medsState.refreshIntervalId) {
    clearInterval(medsState.refreshIntervalId);
    medsState.refreshIntervalId = null;
  }
}

function renderMedsBody(outlet) {
  stopMedsTimers();
  outlet.innerHTML = medsListMarkup();
  attachMedsHandlers(outlet);
  medsState.refreshIntervalId = setInterval(() => {
    outlet.innerHTML = medsListMarkup();
    attachMedsHandlers(outlet);
  }, 30000);
}

function activeMedicinesOf(medicines) {
  return (medicines || []).filter((m) => (m.status ? m.status === "active" : isTruthy(m.active)));
}

function medsListMarkup() {
  const now = new Date();
  const todayStr = schedule.formatLocalDate(now);
  const active = activeMedicinesOf(medsState.medicines);

  const todaySlotItems = [];
  active.forEach((m) => {
    const type = schedule.effectiveScheduleType(m);
    if (["interval", "prn", "weekly", "monthly"].includes(type)) return;
    schedule.slotsForDay(m, todayStr, logsForMedicine(medsState.logs, m.id), now).forEach((slot) => {
      todaySlotItems.push({ medicine: m, slot });
    });
  });
  todaySlotItems.sort((a, b) => a.slot.time.localeCompare(b.slot.time));

  const intervalPrn = active.filter((m) => ["interval", "prn"].includes(schedule.effectiveScheduleType(m)));

  const finishedOrStopped = (medsState.medicines || []).filter((m) => m.status === "finished" || m.status === "stopped");

  return `
    <div class="card">
      <h2>${t("meds.today.title")}</h2>
      ${
        todaySlotItems.length
          ? `<ul class="med-slot-list">${todaySlotItems.map((it) => medicineSlotRowMarkup(it.medicine, it.slot)).join("")}</ul>`
          : `<p class="empty">${t("meds.today.none")}</p>`
      }
      ${intervalPrn.map((m) => intervalOrPrnRowMarkup(m, logsForMedicine(medsState.logs, m.id), now)).join("")}
    </div>

    <button class="btn btn-primary" id="add-med-btn">${t("meds.add")}</button>

    <div class="card">
      <div class="card-head">
        <h2>${t("meds.all.title")}</h2>
      </div>
      ${
        active.length
          ? `<ul class="entity-list">${active.map((m) => medicineRowMarkup(m, medsState.countdowns, medsState.logs)).join("")}</ul>`
          : `<p class="empty">${t("meds.all.none")}</p>`
      }
    </div>

    <div class="card">
      <h2>${t("meds.history.title")}</h2>
      <p class="muted">${t("meds.history.usedCount", { n: finishedOrStopped.length })}</p>
      <a class="card-link" data-nav="#/meds/history">${t("meds.history.seeAll")}</a>
    </div>
  `;
}

// "" when the medicine has no expiry_date set at all — "not tracked" is
// not the same as "fine", so this never shows a false-calm state.
function expiryBadgeMarkup(m) {
  if (!m.expiry_date) return "";
  const expiry = new Date(dateStrOf(m.expiry_date));
  if (isNaN(expiry.getTime())) return "";
  const daysLeft = Math.round((expiry.getTime() - new Date(formatDateInput(new Date())).getTime()) / 86400000);
  if (daysLeft < 0) return `<span class="muted dose-state-rose">${t("meds.expiry.expired", { n: Math.abs(daysLeft) })}</span>`;
  const alertDays = medsState.expiryAlertDays || 30;
  if (daysLeft <= alertDays) return `<span class="muted dose-state-amber">${t("meds.expiry.expiresIn", { n: daysLeft })}</span>`;
  return "";
}

function medicineRowMarkup(m, countdowns, logs) {
  const now = new Date();
  const extraLines = [];

  if (m.schedule_type) {
    // v3 medicine — schedule.js is the single source of truth, no need to
    // look for a separately-managed linked Countdown row at all.
    const type = schedule.effectiveScheduleType(m);
    if (type === "interval") {
      const next = schedule.nextDose(m, logsForMedicine(logs, m.id), now);
      const msLeft = next ? next.getTime() - now.getTime() : null;
      extraLines.push(`<span class="muted ${msLeft !== null && msLeft <= 0 ? "dose-state-amber" : "dose-state-calm"}">${msLeft === null ? t("home.doseStatus.noDoseYet") : t("meds.nextDoseIn", formatDuration(Math.max(0, msLeft)))}</span>`);
    } else if (["weekly", "monthly"].includes(type)) {
      const due = schedule.weeklyMonthlyDueState(m, logsForMedicine(logs, m.id), now);
      extraLines.push(`<span class="muted ${due.state === "overdue" ? "dose-state-rose" : due.state === "due_today" ? "dose-state-amber" : "dose-state-calm"}">${due.state === "overdue" ? t("home.comingUp.overdue") : due.state === "due_today" ? t("home.comingUp.dueToday") : t("home.comingUp.dueIn", { n: due.daysUntil })}</span>`);
    }
    const progress = schedule.courseProgress(m, now);
    if (progress && progress.totalDays !== null) {
      extraLines.push(`<span class="muted">${t("meds.dayOfCourse", { day: progress.dayOfCourse, total: progress.totalDays })}</span>`);
    }
    const daysLeft = schedule.stockDaysLeft(m, logsForMedicine(logs, m.id), now);
    if (daysLeft !== null) {
      extraLines.push(`<span class="muted ${daysLeft <= 0 ? "dose-state-rose" : daysLeft <= (m.refill_alert_days || 3) ? "dose-state-amber" : "dose-state-calm"}">${daysLeft <= 0 ? t("medicines.stock.outOfStock") : t("medicines.stock.daysLeft", { n: Math.floor(daysLeft) })}</span>`);
    }
  } else {
    // Pre-v3 row — fall back to the old linked-Countdown-row display.
    const linked = (countdowns || []).filter((c) => c.linked_medicine_id === m.id && !isTruthy(c.done));
    const intervalCd = linked.find((c) => c.kind === "interval");
    const courseCd = linked.find((c) => c.kind === "course");
    const stock = computeStockCountdown(m);
    const lastDoseByMedicine = lastDoseByMedicineFrom(logs);
    if (intervalCd) {
      const computed = computeCustomCountdown(intervalCd, { lastDose: lastDoseByMedicine[m.id] }, now);
      extraLines.push(`<span class="muted countdown-state-${computed.state}">${t("meds.nextDose", { text: computed.msRemaining === null ? t("countdowns.display.noDoseYet") : formatRemainingLabel(computed.msRemaining) })}</span>`);
    }
    if (courseCd) {
      const computed = computeCustomCountdown(courseCd, { dosesPerDay: numOrEmpty(m.doses_per_day) }, now);
      if (computed.daysLeft !== null) extraLines.push(`<span class="muted countdown-state-${computed.state}">${t("meds.courseEnds", { n: computed.daysLeft })}</span>`);
    }
    if (stock) {
      const stateClass = stock.outOfStock ? "dose-state-rose" : stock.needsRefill ? "dose-state-amber" : "dose-state-calm";
      extraLines.push(`<span class="muted ${stateClass}">${stock.outOfStock ? t("medicines.stock.outOfStock") : t("medicines.stock.daysLeft", { n: Math.floor(stock.daysLeft) })}</span>`);
    }
  }

  const expiryLine = expiryBadgeMarkup(m);
  if (expiryLine) extraLines.push(expiryLine);

  return `
    <li class="entity-row tap-row" data-edit-medicine="${escapeHtml(m.id)}">
      <div class="entity-main">
        <strong>${escapeHtml(m.name)}</strong>
        <span class="muted">${escapeHtml([m.dose, m.frequency].filter(Boolean).join(" · "))}</span>
        ${extraLines.join("")}
      </div>
      <div class="entity-actions">
        <button class="btn-link btn-link--danger" data-delete-med="${escapeHtml(m.id)}">${t("common.delete")}</button>
      </div>
    </li>
  `;
}

// Most recent *taken* MedicineLog entry per medicine — used only by the
// pre-v3 linked-Countdown fallback display above (v3 rows use schedule.js's
// own log lookups instead).
function lastDoseByMedicineFrom(logs) {
  const latest = {};
  logs.forEach((l) => {
    if (!isTruthy(l.taken)) return;
    const sortKey = dateStrOf(l.date) + " " + String(l.time || "");
    const current = latest[l.medicine_id];
    if (!current || sortKey > current._sortKey) {
      latest[l.medicine_id] = { medicine_id: l.medicine_id, date: dateStrOf(l.date), time: l.time, _sortKey: sortKey };
    }
  });
  return latest;
}

async function toggleMedsPageDoseTaken(outlet, medicineId, time, status) {
  const todayStr = schedule.formatLocalDate(new Date());
  const snapshot = JSON.parse(JSON.stringify(medsState.logs));
  const existing = medsState.logs.find((l) => l.medicine_id === medicineId && dateStrOf(l.date) === todayStr && String(l.time) === String(time));
  if (existing) {
    existing.taken = status === "taken";
    existing.status = status;
  } else {
    medsState.logs.push({ id: "optimistic-" + Date.now(), medicine_id: medicineId, date: todayStr, time, taken: status === "taken", status });
  }
  renderMedsBody(outlet);

  try {
    await store.call("medicines.logTaken", { medicine_id: medicineId, date: todayStr, time, status });
    await renderMedicinesView(outlet);
  } catch (err) {
    medsState.logs = snapshot;
    renderMedsBody(outlet);
    alert(err.message || t("common.error"));
  }
}

function attachMedsHandlers(outlet) {
  const addBtn = outlet.querySelector("#add-med-btn");
  if (addBtn) addBtn.addEventListener("click", () => openMedicineSheet("new", () => renderMedicinesView(outlet)));

  outlet.querySelectorAll("[data-edit-medicine]").forEach((el) => {
    el.addEventListener("click", (event) => {
      if (event.target.closest("[data-delete-med]")) return;
      const medicine = medsState.medicines.find((m) => m.id === el.dataset.editMedicine);
      openMedicineSheet(medicine || "new", () => renderMedicinesView(outlet));
    });
  });

  outlet.querySelectorAll("[data-delete-med]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteMedicineWithUndo(btn.dataset.deleteMed, () => renderMedicinesView(outlet));
    });
  });

  outlet.querySelectorAll("[data-tick-med]").forEach((btn) => {
    btn.addEventListener("click", () => toggleMedsPageDoseTaken(outlet, btn.dataset.tickMed, btn.dataset.tickTime, btn.dataset.tickNextStatus));
  });

  outlet.querySelectorAll("[data-take-now]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const now = new Date();
      toggleMedsPageDoseTaken(outlet, btn.dataset.takeNow, formatTimeHHMM(now), "taken");
    });
  });

  outlet.querySelectorAll("[data-take-prn]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const medicineId = btn.dataset.takePrn;
      const confirmed = btn.dataset.prnConfirm === "1";
      const medicine = medsState.medicines.find((m) => m.id === medicineId);
      const gate = schedule.canTakeNow(medicine, logsForMedicine(medsState.logs, medicineId), new Date());
      if (gate.needsConfirm && !confirmed) {
        const row = outlet.querySelector(`[data-prn-confirm-row="${cssEscape(medicineId)}"]`);
        if (row) row.hidden = false;
        return;
      }
      const now = new Date();
      try {
        await store.call("medicines.logTaken", { medicine_id: medicineId, date: schedule.formatLocalDate(now), time: formatTimeHHMM(now), status: "taken" });
        await renderMedicinesView(outlet);
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  });
}

// Optimistic delete-with-undo: removes the medicine from view immediately
// and shows a 6s Undo toast; the real medicines.delete call only fires if
// the toast expires untouched. This is for correcting an accidental add —
// the everyday "I'm done with this" action is Stop (see openMedicineSheet),
// which keeps the medicine in history instead of removing it.
function deleteMedicineWithUndo(medicineId, refresh) {
  const idx = medsState.medicines.findIndex((m) => m.id === medicineId);
  if (idx === -1) return;
  const removed = medsState.medicines[idx];
  medsState.medicines.splice(idx, 1);
  refresh();
  showUndoToast(t("meds.deletedToast", { name: removed.name }), {
    onUndo: () => { medsState.medicines.splice(idx, 0, removed); refresh(); },
    onCommit: async () => {
      try {
        await store.call("medicines.delete", { id: medicineId });
      } catch (err) {
        medsState.medicines.splice(idx, 0, removed);
        refresh();
        alert(err.message || t("common.error"));
      }
    }
  });
}

function isTruthy(value) {
  return value === true || String(value).toUpperCase() === "TRUE";
}

// ---------------------------------------------------------------------------
// Medicines used — full history (active + finished + stopped), searchable.
// ---------------------------------------------------------------------------

const medsHistoryState = { medicines: [], logsByMedicine: {}, loading: true, search: "", statusFilter: "all" };

async function renderMedicinesHistoryView(outlet) {
  medsHistoryState.loading = true;
  outlet.innerHTML = genericSkeleton(4);
  try {
    const medicines = await store.call("medicines.list", {});
    medsHistoryState.medicines = medicines;
    const logs = await Promise.all(medicines.map((m) => store.call("medicinelog.list", { medicine_id: m.id }).catch(() => [])));
    medsHistoryState.logsByMedicine = {};
    medicines.forEach((m, i) => { medsHistoryState.logsByMedicine[m.id] = logs[i]; });
    medsHistoryState.loading = false;
    renderMedsHistoryBody(outlet);
  } catch (err) {
    medsHistoryState.loading = false;
    outlet.innerHTML = errorMarkup(err);
    attachRetryHandler(outlet, () => renderMedicinesHistoryView(outlet));
  }
}

function renderMedsHistoryBody(outlet) {
  const search = medsHistoryState.search.trim().toLowerCase();
  const rows = medsHistoryState.medicines.filter((m) => {
    if (medsHistoryState.statusFilter !== "all" && (m.status || "active") !== medsHistoryState.statusFilter) return false;
    if (search) {
      const haystack = [m.name, m.composition, m.brand].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
  rows.sort((a, b) => dateStrOf(b.start_date).localeCompare(dateStrOf(a.start_date)));

  outlet.innerHTML = `
    <div class="card">
      <h2>${t("meds.history.title")}</h2>
      <input class="field" id="meds-history-search" placeholder="${t("meds.history.searchPlaceholder")}" value="${escapeHtml(medsHistoryState.search)}" />
      <div class="chip-row" id="meds-history-filters">
        ${["all", "active", "finished", "stopped"].map((s) => `<button type="button" class="chip ${medsHistoryState.statusFilter === s ? "chip-selected" : ""}" data-history-filter="${s}">${t("meds.history.filter." + s)}</button>`).join("")}
      </div>
      ${
        rows.length
          ? `<ul class="entity-list">${rows.map((m) => medsHistoryRowMarkup(m)).join("")}</ul>`
          : `<p class="empty">${t("meds.history.none")}</p>`
      }
    </div>
  `;

  outlet.querySelector("#meds-history-search").addEventListener("input", (event) => {
    medsHistoryState.search = event.target.value;
    renderMedsHistoryBody(outlet);
  });
  outlet.querySelectorAll("[data-history-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      medsHistoryState.statusFilter = btn.dataset.historyFilter;
      renderMedsHistoryBody(outlet);
    });
  });
  outlet.querySelectorAll("[data-history-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const m = medsHistoryState.medicines.find((x) => x.id === btn.dataset.historyEdit);
      openMedicineSheet(m || "new", () => renderMedicinesHistoryView(outlet));
    });
  });
}

function medsHistoryRowMarkup(m) {
  const logs = medsHistoryState.logsByMedicine[m.id] || [];
  const takenCount = logs.filter((l) => isTruthy(l.taken) || l.status === "taken").length;
  const statusLabel = t("meds.history.filter." + (m.status || "active"));
  const period = [formatDisplayDate(dateStrOf(m.start_date)), m.end_date ? formatDisplayDate(dateStrOf(m.end_date)) : (m.stopped_on ? formatDisplayDate(dateStrOf(m.stopped_on)) : "")]
    .filter(Boolean).join(" – ");

  return `
    <li class="entity-row tap-row" data-history-edit="${escapeHtml(m.id)}">
      <div class="entity-main">
        <strong>${escapeHtml(m.name)}</strong>
        <span class="badge">${escapeHtml(statusLabel)}</span>
        <span class="muted">${escapeHtml(period)}</span>
        <span class="muted">${t("meds.history.dosesTaken", { n: takenCount })}</span>
        ${m.composition ? `<span class="muted">${escapeHtml([m.brand, m.composition].filter(Boolean).join(" · "))}</span>` : ""}
        ${m.reason ? `<span class="muted">${escapeHtml(m.reason)}</span>` : ""}
        ${m.stop_note ? `<span class="muted">${escapeHtml(m.stop_note)}</span>` : ""}
        ${expiryBadgeMarkup(m)}
      </div>
    </li>
  `;
}

// ---------------------------------------------------------------------------
// Add/Edit Medicine sheet — progressive disclosure, far fewer questions than
// a plain long form. Used from both Home's "+" and the Meds page's "+"/row
// taps, so it lives here rather than duplicated in each caller.
//
// Design note: every "how often"/"how long" sub-field group is rendered up
// front (all of them, for every schedule_type at once) and just shown/hidden
// via a hidden input + [hidden] toggling — the same pattern the existing
// Countdowns form already uses for its per-kind fields (see
// applyCountdownKindVisibility). This means switching chips never re-renders
// the form, so nothing already typed into an unrelated field is ever lost.
// ---------------------------------------------------------------------------

const HOW_OFTEN_CHIPS = [
  { value: "daily", labelKey: "meds.howOften.daily" },
  { value: "interval", labelKey: "meds.howOften.interval" },
  { value: "weekdays", labelKey: "meds.howOften.weekdays" },
  { value: "every_n_days", labelKey: "meds.howOften.everyNDays" },
  { value: "weekly", labelKey: "meds.howOften.weekly" },
  { value: "monthly", labelKey: "meds.howOften.monthly" },
  { value: "prn", labelKey: "meds.howOften.prn" }
];
const HOW_LONG_CHIPS = [
  { value: "3", labelKey: "meds.howLong.days3" }, { value: "5", labelKey: "meds.howLong.days5" },
  { value: "7", labelKey: "meds.howLong.days7" }, { value: "10", labelKey: "meds.howLong.days10" },
  { value: "14", labelKey: "meds.howLong.days14" }, { value: "1month", labelKey: "meds.howLong.month1" },
  { value: "until", labelKey: "meds.howLong.until" }, { value: "doses", labelKey: "meds.howLong.doses" },
  { value: "ongoing", labelKey: "meds.howLong.ongoing" }
];
const FOOD_CHIPS = [
  { value: "before_food", labelKey: "meds.food.before_food" }, { value: "after_food", labelKey: "meds.food.after_food" },
  { value: "with_food", labelKey: "meds.food.with_food" }, { value: "empty_stomach", labelKey: "meds.food.empty_stomach" },
  { value: "bedtime", labelKey: "meds.food.bedtime" }, { value: "none", labelKey: "meds.food.none" }
];
const WEEKDAY_CHIPS = [
  { value: "mon", labelKey: "meds.weekday.mon" }, { value: "tue", labelKey: "meds.weekday.tue" },
  { value: "wed", labelKey: "meds.weekday.wed" }, { value: "thu", labelKey: "meds.weekday.thu" },
  { value: "fri", labelKey: "meds.weekday.fri" }, { value: "sat", labelKey: "meds.weekday.sat" },
  { value: "sun", labelKey: "meds.weekday.sun" }
];
const DEFAULT_TIME_CHIPS = [
  { time: "08:00", labelKey: "home.bucket.morning" }, { time: "13:00", labelKey: "home.bucket.afternoon" },
  { time: "18:00", labelKey: "home.bucket.evening" }, { time: "21:00", labelKey: "home.bucket.night" }
];

function chipButtonHtml(group, value, label, selected) {
  return `<button type="button" class="chip ${selected ? "chip-selected" : ""}" data-chip-group="${escapeHtml(group)}" data-chip-value="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
}

function medicinePhotoPickerMarkup(side, fileId, label) {
  return `
    <div class="medicine-photo-picker" data-photo-side="${side}">
      <input type="hidden" name="photo_${side}_file_id" value="${escapeHtml(fileId || "")}" />
      <label class="btn btn-secondary btn-small">
        ${escapeHtml(label)}
        <input type="file" accept="image/*" capture="environment" class="medicine-photo-input" hidden />
      </label>
      <span class="muted medicine-photo-status">${fileId ? t("meds.form.photoSaved") : t("meds.form.photoNone")}</span>
    </div>
  `;
}

// Resizes to at most maxDim on the long edge and re-encodes as JPEG at the
// given quality, client-side, before anything is uploaded — keeps medicine
// photos well within the Apps Script upload limit without asking her to
// pick a smaller file herself.
function compressImageToBase64(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Could not read that image."));
      img.src = reader.result;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function openMedicineSheet(item, onSaved) {
  let packs = [];
  let settings = {};
  try { packs = await store.call("packs.list", {}); } catch { /* packs are optional; sheet works without them */ }
  try { settings = await store.call("settings.get", {}); } catch { /* detail-field toggles just default to off */ }
  openSheet(medicineSheetMarkup(item, packs, settings), (sheetEl) => attachMedicineSheetHandlers(sheetEl, item, onSaved));
}

function medicineSheetMarkup(item, packs, settings) {
  settings = settings || {};
  const isNew = item === "new" || !item.id;
  const m = item === "new" ? {} : item; // a prefilled object (e.g. from a doctor suggestion) keeps its fields even though it's still "new"
  const type = schedule.effectiveScheduleType(m);
  const times = schedule.parseTimesList(m);
  const weekdaysList = schedule.parseWeekdaysList(m);
  const instructions = m.instructions || "none";
  const howLong = m.total_doses ? "doses" : m.end_date ? "until" : "ongoing";

  return `
    <div class="sheet-handle" aria-hidden="true"></div>
    <h2>${isNew ? t("meds.form.titleNew") : t("meds.form.titleEdit")}</h2>
    <form id="med-sheet-form">
      ${formField(t("meds.form.name"), `<input class="field" name="name" required value="${escapeHtml(m.name)}" />`)}
      ${formField(`${t("meds.form.reason")} (${t("common.optional")})`, `<input class="field" name="reason" value="${escapeHtml(m.reason)}" />`)}
      ${formField(t("meds.form.dose"), `<input class="field" name="dose" value="${escapeHtml(m.dose)}" />`)}

      <p class="field-label">${t("meds.form.howOften")}</p>
      <input type="hidden" name="schedule_type" value="${escapeHtml(type)}" />
      <div class="chip-row">${HOW_OFTEN_CHIPS.map((c) => chipButtonHtml("how-often", c.value, t(c.labelKey), type === c.value)).join("")}</div>

      <div data-how-often-fields="daily" ${type === "daily" ? "" : "hidden"}>
        <input type="hidden" name="times" value="${escapeHtml(times.join(","))}" />
        <div class="chip-row" id="daily-time-chips">
          ${DEFAULT_TIME_CHIPS.map((c) => chipButtonHtml("daily-time", c.time, `${t(c.labelKey)} ${c.time}`, times.includes(c.time))).join("")}
          ${times.filter((tm) => !DEFAULT_TIME_CHIPS.some((c) => c.time === tm)).map((tm) => chipButtonHtml("daily-time", tm, tm, true)).join("")}
        </div>
        <div class="custom-time-row">
          <input class="field" type="time" id="custom-time-input" />
          <button type="button" class="btn-link" id="add-custom-time-btn">${t("meds.form.addCustomTime")}</button>
        </div>
      </div>

      <div data-how-often-fields="interval" ${type === "interval" ? "" : "hidden"}>
        ${formField(t("meds.form.everyNHours"), `<input class="field" type="number" min="1" step="1" name="interval_hours" value="${escapeHtml(m.interval_hours || 8)}" />`)}
        <label class="checkbox-field">
          <input type="checkbox" name="anchor_from_last" ${type !== "interval" || m.anchor_mode === "from_last" || isNew ? "checked" : ""} />
          <span>${t("meds.form.countFromLastDose")}</span>
        </label>
        ${formField(t("meds.form.startingAround"), `<input class="field" type="time" name="interval_first_time" value="${escapeHtml(times[0] || "08:00")}" />`)}
      </div>

      <div data-how-often-fields="weekdays" ${type === "weekdays" ? "" : "hidden"}>
        <input type="hidden" name="weekdays" value="${escapeHtml(weekdaysList.join(","))}" />
        <div class="chip-row">${WEEKDAY_CHIPS.map((w) => chipButtonHtml("weekday-multi", w.value, t(w.labelKey), weekdaysList.includes(w.value))).join("")}</div>
        ${formField(t("meds.form.atTime"), `<input class="field" type="time" name="weekdays_first_time" value="${escapeHtml(times[0] || "08:00")}" />`)}
      </div>

      <div data-how-often-fields="every_n_days" ${type === "every_n_days" ? "" : "hidden"}>
        ${formField(t("meds.form.everyNDaysN"), `<input class="field" type="number" min="1" step="1" name="interval_days" value="${escapeHtml(m.interval_days || 2)}" />`)}
        ${formField(t("meds.form.atTime"), `<input class="field" type="time" name="every_n_days_first_time" value="${escapeHtml(times[0] || "08:00")}" />`)}
      </div>

      <div data-how-often-fields="weekly" ${type === "weekly" ? "" : "hidden"}>
        <input type="hidden" name="weekday_single" value="${escapeHtml(weekdaysList[0] || "")}" />
        <div class="chip-row">${WEEKDAY_CHIPS.map((w) => chipButtonHtml("weekday-single", w.value, t(w.labelKey), weekdaysList[0] === w.value)).join("")}</div>
        ${formField(t("meds.form.atTime"), `<input class="field" type="time" name="weekly_first_time" value="${escapeHtml(times[0] || "10:00")}" />`)}
      </div>

      <div data-how-often-fields="monthly" ${type === "monthly" ? "" : "hidden"}>
        ${formField(t("meds.form.dayOfMonth"), `<input class="field" type="number" min="1" max="31" step="1" name="month_day" value="${escapeHtml(m.month_day || 1)}" />`)}
        ${formField(t("meds.form.atTime"), `<input class="field" type="time" name="monthly_first_time" value="${escapeHtml(times[0] || "09:00")}" />`)}
      </div>

      <div data-how-often-fields="prn" ${type === "prn" ? "" : "hidden"}>
        ${formField(t("meds.form.prnMinGap"), `<input class="field" type="number" min="0" step="1" name="prn_min_gap_hours" value="${escapeHtml(m.prn_min_gap_hours || 6)}" />`)}
        ${formField(t("meds.form.prnMaxPerDay"), `<input class="field" type="number" min="0" step="1" name="prn_max_per_day" value="${escapeHtml(m.prn_max_per_day || 4)}" />`)}
      </div>

      <p class="field-label">${t("meds.form.howLong")}</p>
      <input type="hidden" name="how_long" value="${escapeHtml(howLong)}" />
      <div class="chip-row">${HOW_LONG_CHIPS.map((c) => chipButtonHtml("how-long", c.value, t(c.labelKey), howLong === c.value)).join("")}</div>
      <div data-how-long-fields="until" ${howLong === "until" ? "" : "hidden"}>
        ${formField(t("meds.form.endDate"), `<input class="field" type="date" name="end_date" value="${escapeHtml(dateStrOf(m.end_date))}" />`)}
      </div>
      <div data-how-long-fields="doses" ${howLong === "doses" ? "" : "hidden"}>
        ${formField(t("meds.form.totalDoses"), `<input class="field" type="number" min="1" step="1" name="total_doses" value="${escapeHtml(m.total_doses || 10)}" />`)}
      </div>

      <p class="field-label">${t("meds.form.withFood")}</p>
      <input type="hidden" name="instructions" value="${escapeHtml(instructions)}" />
      <div class="chip-row">${FOOD_CHIPS.map((c) => chipButtonHtml("food", c.value, t(c.labelKey), instructions === c.value)).join("")}</div>

      ${formField(t("meds.form.addToPack"), `
        <select class="field" name="pack_id">
          <option value="">${t("meds.form.noPack")}</option>
          ${(packs || []).map((p) => `<option value="${escapeHtml(p.id)}" ${m.pack_id === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
        </select>
      `)}

      <details class="more-details">
        <summary>${t("common.more")}</summary>
        ${formField(t("meds.form.stockCount"), `<input class="field" type="number" min="0" step="1" name="stock_count" value="${escapeHtml(m.stock_count)}" />`, t("meds.form.stockHint"))}
        ${formField(t("meds.form.refillAlertDays"), `<input class="field" type="number" min="0" step="1" name="refill_alert_days" value="${escapeHtml(isNew ? 3 : (m.refill_alert_days === undefined ? "" : m.refill_alert_days))}" />`)}
        ${formField(t("meds.form.graceMinutes"), `<input class="field" type="number" min="0" step="5" name="grace_minutes" value="${escapeHtml(isNew || m.grace_minutes === undefined || m.grace_minutes === "" ? 60 : m.grace_minutes)}" />`, t("meds.form.graceMinutesHint"))}
        ${formField(t("meds.form.prescribedBy"), `<input class="field" name="prescribed_by" value="${escapeHtml(m.prescribed_by)}" />`)}
        ${formField(t("meds.form.notes"), `<textarea class="field" name="notes" rows="2">${escapeHtml(m.notes)}</textarea>`)}
        ${isTruthy(settings.ingredients_enabled) ? `
          ${formField(t("meds.form.brand"), `<input class="field" name="brand" value="${escapeHtml(m.brand)}" />`)}
          ${formField(t("meds.form.strength"), `<input class="field" name="strength" value="${escapeHtml(m.strength)}" />`)}
          ${formField(t("meds.form.composition"), `<input class="field" name="composition" value="${escapeHtml(m.composition)}" />`, t("meds.form.compositionHint"))}
        ` : ""}
        ${isTruthy(settings.expiry_tracking_enabled) ? `
          ${formField(t("meds.form.expiryDate"), `<input class="field" type="date" name="expiry_date" value="${escapeHtml(dateStrOf(m.expiry_date))}" />`)}
        ` : ""}
        ${isTruthy(settings.photos_enabled) ? `
          <p class="field-label">${t("meds.form.photos")}</p>
          <div class="medicine-photo-row">
            ${medicinePhotoPickerMarkup("front", m.photo_front_file_id, t("meds.form.photoFront"))}
            ${medicinePhotoPickerMarkup("back", m.photo_back_file_id, t("meds.form.photoBack"))}
          </div>
        ` : ""}
      </details>

      <p class="safety-note">${t("meds.form.safetyNote")}</p>
      <p class="sheet-summary" id="med-sheet-summary"></p>
      <p class="error-text" id="med-sheet-error" hidden></p>

      <div class="form-actions">
        ${!isNew ? `<button type="button" class="btn-link btn-link--danger" id="med-sheet-stop">${t("meds.form.stop")}</button>` : ""}
        <button type="button" class="btn btn-secondary" id="med-sheet-cancel">${t("common.cancel")}</button>
        <button type="submit" class="btn btn-primary" id="med-sheet-save">${t("common.save")}</button>
      </div>
    </form>
  `;
}

// Reads the sheet's current form state into one plain object — the single
// source of truth for both the live plain-language summary and the actual
// save payload, so they can never drift apart from each other.
function readMedicineSheetForm(form) {
  const fd = new FormData(form);
  const scheduleType = fd.get("schedule_type") || "daily";
  const howLong = fd.get("how_long") || "ongoing";

  const result = {
    name: String(fd.get("name") || "").trim(),
    reason: String(fd.get("reason") || "").trim(),
    dose: String(fd.get("dose") || "").trim(),
    schedule_type: scheduleType,
    instructions: fd.get("instructions") || "none",
    pack_id: fd.get("pack_id") || "",
    stock_count: fd.get("stock_count"),
    refill_alert_days: fd.get("refill_alert_days"),
    grace_minutes: fd.get("grace_minutes"),
    prescribed_by: String(fd.get("prescribed_by") || "").trim(),
    notes: String(fd.get("notes") || "").trim(),
    brand: String(fd.get("brand") || "").trim(),
    strength: String(fd.get("strength") || "").trim(),
    composition: String(fd.get("composition") || "").trim(),
    expiry_date: fd.get("expiry_date") || "",
    photo_front_file_id: fd.get("photo_front_file_id") || "",
    photo_back_file_id: fd.get("photo_back_file_id") || "",
    times: "", weekdays: "", interval_hours: "", interval_days: "", month_day: "",
    anchor_mode: "fixed", prn_min_gap_hours: "", prn_max_per_day: ""
  };

  if (scheduleType === "daily") {
    result.times = fd.get("times") || "";
  } else if (scheduleType === "interval") {
    result.interval_hours = fd.get("interval_hours");
    result.anchor_mode = fd.get("anchor_from_last") === "on" ? "from_last" : "fixed";
    result.times = fd.get("interval_first_time") || "";
  } else if (scheduleType === "weekdays") {
    result.weekdays = fd.get("weekdays") || "";
    result.times = fd.get("weekdays_first_time") || "";
  } else if (scheduleType === "every_n_days") {
    result.interval_days = fd.get("interval_days");
    result.times = fd.get("every_n_days_first_time") || "";
  } else if (scheduleType === "weekly") {
    result.weekdays = fd.get("weekday_single") || "";
    result.times = fd.get("weekly_first_time") || "";
  } else if (scheduleType === "monthly") {
    result.month_day = fd.get("month_day");
    result.times = fd.get("monthly_first_time") || "";
  } else if (scheduleType === "prn") {
    result.prn_min_gap_hours = fd.get("prn_min_gap_hours");
    result.prn_max_per_day = fd.get("prn_max_per_day");
  }

  result.how_long = howLong;
  if (howLong === "until") result.end_date = fd.get("end_date") || "";
  else if (howLong === "doses") result.total_doses = fd.get("total_doses");

  return result;
}

function summarizeMedicineForm(form) {
  const parts = [];
  switch (form.schedule_type) {
    case "daily": {
      const n = String(form.times || "").split(",").filter(Boolean).length;
      parts.push(n ? t("meds.summary.daily", { n }) : t("meds.summary.dailyNoTimes"));
      break;
    }
    case "interval":
      parts.push(t("meds.summary.interval", { n: form.interval_hours || "?" }));
      if (form.anchor_mode === "from_last") parts.push(t("meds.summary.fromLast"));
      break;
    case "weekdays":
      parts.push(t("meds.summary.weekdays", { days: String(form.weekdays || "").split(",").filter(Boolean).map((d) => t("meds.weekday." + d)).join(", ") || "?" }));
      break;
    case "every_n_days":
      parts.push(t("meds.summary.everyNDays", { n: form.interval_days || "?" }));
      break;
    case "weekly":
      parts.push(t("meds.summary.weekly", { day: form.weekdays ? t("meds.weekday." + form.weekdays) : "?" }));
      break;
    case "monthly":
      parts.push(t("meds.summary.monthly", { day: form.month_day || "?" }));
      break;
    case "prn":
      parts.push(t("meds.summary.prn"));
      break;
  }

  if (form.how_long === "doses" && form.total_doses) parts.push(t("meds.summary.forDoses", { n: form.total_doses }));
  else if (form.how_long === "until" && form.end_date) parts.push(t("meds.summary.untilDate", { date: formatDisplayDate(form.end_date) }));
  else if (form.how_long === "ongoing") parts.push(t("meds.summary.ongoing"));
  else if (form.how_long) parts.push(form.how_long === "1month" ? t("meds.summary.forMonth") : t("meds.summary.forDays", { n: form.how_long }));

  if (form.instructions && form.instructions !== "none") parts.push(t("meds.food." + form.instructions).toLowerCase());

  return parts.filter(Boolean).join(", ") + ".";
}

function updateMedicineSheetSummary(sheetEl) {
  const summaryEl = sheetEl.querySelector("#med-sheet-summary");
  if (!summaryEl) return;
  summaryEl.textContent = summarizeMedicineForm(readMedicineSheetForm(sheetEl.querySelector("#med-sheet-form")));
}

// Converts a preset duration chip ("3".."14" days, "1month") plus a
// start date into a concrete end_date. 'until'/'doses'/'ongoing' are
// resolved directly from their own fields instead, before this is called.
function resolvePresetEndDate(startDateStr, preset) {
  const start = dateStrOf(startDateStr) ? new Date(dateStrOf(startDateStr)) : new Date();
  if (preset === "1month") {
    start.setMonth(start.getMonth() + 1);
    start.setDate(start.getDate() - 1);
  } else {
    start.setDate(start.getDate() + Number(preset) - 1);
  }
  return formatDateInput(start);
}

function attachChipHandler(sheetEl, btn) {
  btn.addEventListener("click", () => {
    const group = btn.dataset.chipGroup;
    const value = btn.dataset.chipValue;
    const singleSelectHiddenInput = { "how-often": "schedule_type", "how-long": "how_long", food: "instructions", "weekday-single": "weekday_single" };

    if (singleSelectHiddenInput[group]) {
      sheetEl.querySelectorAll(`[data-chip-group="${group}"]`).forEach((b) => b.classList.remove("chip-selected"));
      btn.classList.add("chip-selected");
      sheetEl.querySelector(`input[name="${singleSelectHiddenInput[group]}"]`).value = value;
      if (group === "how-often") {
        sheetEl.querySelectorAll("[data-how-often-fields]").forEach((el) => { el.hidden = el.dataset.howOftenFields !== value; });
      }
      if (group === "how-long") {
        sheetEl.querySelectorAll("[data-how-long-fields]").forEach((el) => { el.hidden = el.dataset.howLongFields !== value; });
      }
    } else {
      // Multi-select: weekday-multi, daily-time.
      btn.classList.toggle("chip-selected");
      const hiddenInputName = group === "weekday-multi" ? "weekdays" : "times";
      const selected = Array.from(sheetEl.querySelectorAll(`[data-chip-group="${group}"].chip-selected`)).map((b) => b.dataset.chipValue);
      sheetEl.querySelector(`input[name="${hiddenInputName}"]`).value = selected.join(",");
    }
    updateMedicineSheetSummary(sheetEl);
  });
}

function attachMedicineSheetHandlers(sheetEl, item, onSaved) {
  const isNew = item === "new" || !item.id;
  const form = sheetEl.querySelector("#med-sheet-form");

  sheetEl.querySelectorAll("[data-chip-group]").forEach((btn) => attachChipHandler(sheetEl, btn));

  sheetEl.querySelectorAll(".medicine-photo-input").forEach((input) => {
    input.addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const picker = input.closest(".medicine-photo-picker");
      const statusEl = picker.querySelector(".medicine-photo-status");
      const side = picker.dataset.photoSide;
      statusEl.textContent = t("meds.form.photoUploading");
      try {
        const dataUrl = await compressImageToBase64(file, 1600, 0.8);
        const match = /^data:(.*?);base64,(.*)$/.exec(dataUrl);
        const nameForTitle = (item && item.name) || sheetEl.querySelector('input[name="name"]').value || "Medicine";
        const uploaded = await store.call("files.upload", {
          title: nameForTitle + " — " + side, type: "document", type_v2: "medicine_photo",
          date: formatDateInput(new Date()), filename: side + ".jpg", mimeType: "image/jpeg", base64: match[2]
        });
        picker.querySelector(`input[name="photo_${side}_file_id"]`).value = uploaded.id;
        statusEl.textContent = t("meds.form.photoSaved");
      } catch (err) {
        statusEl.textContent = t("meds.form.photoError");
      }
    });
  });

  const addCustomTimeBtn = sheetEl.querySelector("#add-custom-time-btn");
  if (addCustomTimeBtn) {
    addCustomTimeBtn.addEventListener("click", () => {
      const input = sheetEl.querySelector("#custom-time-input");
      const value = input.value;
      if (!value) return;
      const container = sheetEl.querySelector("#daily-time-chips");
      if (container.querySelector(`[data-chip-value="${cssEscape(value)}"]`)) return;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip chip-selected";
      chip.dataset.chipGroup = "daily-time";
      chip.dataset.chipValue = value;
      chip.textContent = value;
      container.appendChild(chip);
      attachChipHandler(sheetEl, chip);
      const hiddenTimes = sheetEl.querySelector('input[name="times"]');
      const selected = Array.from(container.querySelectorAll(".chip-selected")).map((b) => b.dataset.chipValue);
      hiddenTimes.value = selected.join(",");
      input.value = "";
      updateMedicineSheetSummary(sheetEl);
    });
  }

  form.addEventListener("input", () => updateMedicineSheetSummary(sheetEl));
  form.addEventListener("change", () => updateMedicineSheetSummary(sheetEl));
  updateMedicineSheetSummary(sheetEl);

  sheetEl.querySelector("#med-sheet-cancel").addEventListener("click", closeSheet);

  const stopBtn = sheetEl.querySelector("#med-sheet-stop");
  if (stopBtn) {
    stopBtn.addEventListener("click", () => {
      closeSheet();
      showUndoToast(t("meds.stoppedToast", { name: item.name }), {
        onUndo: () => { /* nothing was sent yet — closing the toast is enough */ },
        onCommit: async () => {
          try {
            await store.call("medicines.stop", { id: item.id, stopped_on: formatDateInput(new Date()) });
          } catch (err) {
            alert(err.message || t("common.error"));
          } finally {
            onSaved();
          }
        }
      });
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const parsed = readMedicineSheetForm(form);
    const errEl = sheetEl.querySelector("#med-sheet-error");
    errEl.hidden = true;
    if (!parsed.name) {
      errEl.textContent = t("meds.form.nameRequired");
      errEl.hidden = false;
      return;
    }

    const startDate = isNew ? formatDateInput(new Date()) : (dateStrOf(item.start_date) || formatDateInput(new Date()));
    const payload = {
      name: parsed.name, reason: parsed.reason, dose: parsed.dose,
      schedule_type: parsed.schedule_type, anchor_mode: parsed.anchor_mode,
      times: parsed.times, weekdays: parsed.weekdays,
      interval_hours: parsed.interval_hours, interval_days: parsed.interval_days, month_day: parsed.month_day,
      prn_min_gap_hours: parsed.prn_min_gap_hours, prn_max_per_day: parsed.prn_max_per_day,
      instructions: parsed.instructions, pack_id: parsed.pack_id,
      stock_count: parsed.stock_count, refill_alert_days: parsed.refill_alert_days, grace_minutes: parsed.grace_minutes,
      prescribed_by: parsed.prescribed_by, notes: parsed.notes,
      brand: parsed.brand, strength: parsed.strength, composition: parsed.composition,
      expiry_date: parsed.expiry_date, photo_front_file_id: parsed.photo_front_file_id, photo_back_file_id: parsed.photo_back_file_id,
      start_date: startDate
    };
    if (parsed.how_long === "until") payload.end_date = parsed.end_date || "";
    else if (parsed.how_long === "doses") { payload.total_doses = parsed.total_doses; payload.end_date = ""; }
    else if (parsed.how_long === "ongoing") { payload.end_date = ""; payload.total_doses = ""; }
    else { payload.end_date = resolvePresetEndDate(startDate, parsed.how_long); payload.total_doses = ""; }

    const saveBtn = sheetEl.querySelector("#med-sheet-save");
    saveBtn.disabled = true;
    try {
      if (isNew) await store.call("medicines.create", payload);
      else await store.call("medicines.update", { id: item.id, ...payload });
      closeSheet();
      onSaved();
    } catch (err) {
      saveBtn.disabled = false;
      errEl.textContent = err.message || t("common.error");
      errEl.hidden = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Pack sheet — a simple name + usual time + member-medicine checklist.
// ---------------------------------------------------------------------------

function openPackSheet(item, medicines, onSaved) {
  openSheet(packSheetMarkup(item, medicines), (sheetEl) => attachPackSheetHandlers(sheetEl, item, onSaved));
}

function packSheetMarkup(item, medicines) {
  const isNew = item === "new";
  const p = isNew ? {} : item;
  const memberIds = String(p.member_medicine_ids || "").split(",").map((s) => s.trim()).filter(Boolean);
  const activeMeds = activeMedicinesOf(medicines);

  return `
    <div class="sheet-handle" aria-hidden="true"></div>
    <h2>${isNew ? t("packs.form.titleNew") : t("packs.form.titleEdit")}</h2>
    <form id="pack-sheet-form">
      ${formField(t("packs.form.name"), `<input class="field" name="name" required value="${escapeHtml(p.name)}" placeholder="${t("packs.form.namePlaceholder")}" />`)}
      ${formField(t("packs.form.time"), `<input class="field" type="time" name="time" value="${escapeHtml((p.times || "").split(",")[0] || "20:00")}" />`)}
      <p class="field-label">${t("packs.form.members")}</p>
      ${
        activeMeds.length
          ? `<div class="checklist-field">${activeMeds.map((m) => `
            <label class="checkbox-field">
              <input type="checkbox" name="member" value="${escapeHtml(m.id)}" ${memberIds.includes(m.id) ? "checked" : ""} />
              <span>${escapeHtml(m.name)}</span>
            </label>
          `).join("")}</div>`
          : `<p class="empty">${t("packs.form.noMedicines")}</p>`
      }
      <p class="error-text" id="pack-sheet-error" hidden></p>
      <div class="form-actions">
        ${!isNew ? `<button type="button" class="btn-link btn-link--danger" id="pack-sheet-delete">${t("common.delete")}</button>` : ""}
        <button type="button" class="btn btn-secondary" id="pack-sheet-cancel">${t("common.cancel")}</button>
        <button type="submit" class="btn btn-primary" id="pack-sheet-save">${t("common.save")}</button>
      </div>
    </form>
  `;
}

function attachPackSheetHandlers(sheetEl, item, onSaved) {
  const isNew = item === "new";
  const form = sheetEl.querySelector("#pack-sheet-form");
  sheetEl.querySelector("#pack-sheet-cancel").addEventListener("click", closeSheet);

  const deleteBtn = sheetEl.querySelector("#pack-sheet-delete");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      closeSheet();
      showUndoToast(t("packs.deletedToast", { name: item.name }), {
        onUndo: () => {},
        onCommit: async () => {
          try { await store.call("packs.delete", { id: item.id }); } catch (err) { alert(err.message || t("common.error")); }
          finally { onSaved(); }
        }
      });
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get("name") || "").trim();
    const members = fd.getAll("member");
    const errEl = sheetEl.querySelector("#pack-sheet-error");
    if (!name) { errEl.textContent = t("packs.form.nameRequired"); errEl.hidden = false; return; }

    const payload = { name, times: fd.get("time") || "", member_medicine_ids: members };
    const saveBtn = sheetEl.querySelector("#pack-sheet-save");
    saveBtn.disabled = true;
    try {
      if (isNew) await store.call("packs.create", payload);
      else await store.call("packs.update", { id: item.id, ...payload });
      closeSheet();
      onSaved();
    } catch (err) {
      saveBtn.disabled = false;
      errEl.textContent = err.message || t("common.error");
      errEl.hidden = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Countdown + Appointment sheets — thin wrappers around the Countdowns/
// Appointments views' own markup+validation (countdownFields/
// appointmentFields, countdownFormMarkup, appointmentFormMarkup), so Home
// can edit either without duplicating that logic. Save/delete here always
// go through the full bootstrap-refetching onSaved() callback rather than
// patching local state, since Home's bootstrap cache needs to reflect the
// change regardless of which screen made it.
// ---------------------------------------------------------------------------

function openCountdownSheet(item, medicines, onSaved) {
  openSheet(countdownFormMarkup(item, medicines), (sheetEl) => attachCountdownSheetHandlers(sheetEl, item, onSaved));
}

function attachCountdownSheetHandlers(sheetEl, item, onSaved) {
  const isNew = item === "new" || !item.id;
  const form = sheetEl.querySelector("#countdown-form");
  if (!form) return; // defensive — countdownFormMarkup always renders one, but don't crash if that ever changes

  const kindSelect = form.querySelector('[name="kind"]');
  if (kindSelect) {
    applyCountdownKindVisibility(sheetEl, kindSelect.value);
    kindSelect.addEventListener("change", () => applyCountdownKindVisibility(sheetEl, kindSelect.value));
  }

  const cancelBtn = sheetEl.querySelector("#countdown-form-cancel");
  if (cancelBtn) cancelBtn.addEventListener("click", closeSheet);

  // countdownFormMarkup (shared with the full Countdowns page) has no
  // delete button of its own — that page deletes from its row actions
  // instead. Add one here so the sheet still offers Save/Delete.
  let deleteBtn = sheetEl.querySelector("#countdown-form-delete");
  if (!deleteBtn && !isNew) {
    deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.id = "countdown-form-delete";
    deleteBtn.className = "btn-link btn-link--danger";
    deleteBtn.textContent = t("common.delete");
    const actions = form.querySelector(".form-actions");
    if (actions) actions.insertBefore(deleteBtn, actions.firstChild);
  }
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      closeSheet();
      showUndoToast(t("countdowns.deletedToast", { title: item.title }), {
        onUndo: () => {},
        onCommit: async () => {
          try { await store.call("countdowns.delete", { id: item.id }); } catch (err) { alert(err.message || t("common.error")); }
          finally { onSaved(); }
        }
      });
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    const payload = {
      title: String(fd.get("title") || "").trim(), kind: fd.get("kind"),
      target_datetime: fd.get("target_datetime") ? new Date(fd.get("target_datetime")).toISOString() : "",
      start_date: fd.get("start_date") || "", repeat: fd.get("repeat") || "none",
      interval_hours: fd.get("interval_hours") || "", linked_medicine_id: fd.get("linked_medicine_id") || "",
      show_on_home: fd.get("show_on_home") === "on", notes: String(fd.get("notes") || "").trim()
    };
    const saveBtn = sheetEl.querySelector("#countdown-form-save");
    if (saveBtn) saveBtn.disabled = true;
    try {
      if (isNew) await store.call("countdowns.add", payload);
      else await store.call("countdowns.update", { id: item.id, ...payload });
      closeSheet();
      onSaved();
    } catch (err) {
      showCountdownFormError(sheetEl, err.message || t("common.error"));
      if (saveBtn) saveBtn.disabled = false;
    }
  });
}

function openAppointmentSheet(item, onSaved) {
  openSheet(appointmentFormMarkup(item), (sheetEl) => attachAppointmentSheetHandlers(sheetEl, item, onSaved));
}

function attachAppointmentSheetHandlers(sheetEl, item, onSaved) {
  const isNew = item === "new";
  const form = sheetEl.querySelector("#appt-form");
  if (!form) return;

  const cancelBtn = sheetEl.querySelector("#appt-form-cancel");
  if (cancelBtn) cancelBtn.addEventListener("click", closeSheet);

  // appointmentFormMarkup (shared with the full Visits page) has no delete
  // button of its own — Visits deletes from its row actions instead. Add
  // one here so the sheet still offers Save/Delete per the Home spec.
  let deleteBtn = sheetEl.querySelector("#appt-form-delete");
  if (!deleteBtn && !isNew) {
    deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.id = "appt-form-delete";
    deleteBtn.className = "btn-link btn-link--danger";
    deleteBtn.textContent = t("common.delete");
    const actions = form.querySelector(".form-actions");
    if (actions) actions.insertBefore(deleteBtn, actions.firstChild);
  }
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      closeSheet();
      showUndoToast(t("appt.deletedToast"), {
        onUndo: () => {},
        onCommit: async () => {
          try { await store.call("appointments.delete", { id: item.id }); } catch (err) { alert(err.message || t("common.error")); }
          finally { onSaved(); }
        }
      });
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    const payload = {
      datetime: fd.get("datetime") ? new Date(fd.get("datetime")).toISOString() : "",
      doctor: String(fd.get("doctor") || "").trim(), purpose: String(fd.get("purpose") || "").trim(),
      location: String(fd.get("location") || "").trim(), status: fd.get("status") || "upcoming",
      notes_after_visit: String(fd.get("notes_after_visit") || "").trim()
    };
    const saveBtn = sheetEl.querySelector("#appt-form-save");
    if (saveBtn) saveBtn.disabled = true;
    try {
      if (isNew) await store.call("appointments.create", payload);
      else await store.call("appointments.update", { id: item.id, ...payload });
      closeSheet();
      onSaved();
    } catch (err) {
      if (saveBtn) saveBtn.disabled = false;
      alert(err.message || t("common.error"));
    }
  });
}

// ---------------------------------------------------------------------------
// Water — today/week/month/all-time totals, a 14-day bar chart, goal streak.
// ---------------------------------------------------------------------------

const waterState = { rows: [], goal: 8, loading: true, chart: null };

async function renderWaterView(outlet) {
  waterState.loading = true;
  outlet.innerHTML = genericSkeleton(4);
  try {
    const [rows, settings] = await Promise.all([store.call("water.list", {}), store.call("settings.get", {})]);
    waterState.rows = rows;
    waterState.goal = Number(settings.water_goal_glasses) || 8;
    waterState.loading = false;
    renderWaterBody(outlet);
  } catch (err) {
    waterState.loading = false;
    outlet.innerHTML = errorMarkup(err);
    attachRetryHandler(outlet, () => renderWaterView(outlet));
  }
}

function glassesOn(rows, dateStr) {
  return rows.filter((r) => dateStrOf(r.date) === dateStr).reduce((sum, r) => sum + Number(r.glasses || 1), 0);
}

function waterStreak(rows, goal, now) {
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(now.getTime() - i * 86400000);
    if (glassesOn(rows, formatDateInput(d)) < goal) break;
    streak++;
  }
  return streak;
}

function renderWaterBody(outlet) {
  const now = new Date();
  const todayStr = formatDateInput(now);
  const weekStart = formatDateInput(new Date(now.getTime() - 6 * 86400000));
  const monthStart = formatDateInput(new Date(now.getFullYear(), now.getMonth(), 1));

  const sumSince = (fromStr) => waterState.rows.filter((r) => dateStrOf(r.date) >= fromStr).reduce((sum, r) => sum + Number(r.glasses || 1), 0);

  outlet.innerHTML = `
    <div class="card">
      <h2>${t("water.title")}</h2>
      <div class="water-row">
        ${Array.from({ length: waterState.goal }, (_, i) => `<span class="water-glass ${i < glassesOn(waterState.rows, todayStr) ? "water-glass-filled" : ""}">💧</span>`).join("")}
      </div>
      <p class="muted">${t("water.progress", { n: glassesOn(waterState.rows, todayStr), goal: waterState.goal })}</p>
      <button type="button" class="btn btn-secondary" id="water-add-btn">${t("water.addGlass")}</button>
    </div>

    <div class="card">
      <h2>${t("water.totals.title")}</h2>
      <ul class="entity-list">
        <li class="entity-row"><div class="entity-main"><strong>${t("water.totals.today")}</strong></div><span>${glassesOn(waterState.rows, todayStr)}</span></li>
        <li class="entity-row"><div class="entity-main"><strong>${t("water.totals.week")}</strong></div><span>${sumSince(weekStart)}</span></li>
        <li class="entity-row"><div class="entity-main"><strong>${t("water.totals.month")}</strong></div><span>${sumSince(monthStart)}</span></li>
        <li class="entity-row"><div class="entity-main"><strong>${t("water.totals.allTime")}</strong></div><span>${sumSince("0000-01-01")}</span></li>
      </ul>
      <p class="muted">${t("water.streak", { n: waterStreak(waterState.rows, waterState.goal, now) })}</p>
    </div>

    <div class="card">
      <h2>${t("water.chart.title")}</h2>
      <div class="chart-container"><canvas id="water-chart"></canvas></div>
    </div>

    <div class="card">
      <h2>${t("water.goal.title")}</h2>
      <div class="form-actions">
        <input class="field" type="number" min="1" step="1" id="water-goal-input" value="${escapeHtml(waterState.goal)}" />
        <button type="button" class="btn btn-secondary" id="water-goal-save">${t("common.save")}</button>
      </div>
    </div>
  `;

  outlet.querySelector("#water-add-btn").addEventListener("click", async () => {
    const dateStr = formatDateInput(new Date());
    const time = formatTimeHHMM(new Date());
    try {
      await store.call("water.add", { date: dateStr, time, glasses: 1 });
      await renderWaterView(outlet);
    } catch (err) {
      alert(err.message || t("common.error"));
    }
  });

  outlet.querySelector("#water-goal-save").addEventListener("click", async () => {
    const value = Number(outlet.querySelector("#water-goal-input").value) || 8;
    try {
      await store.call("settings.set", { water_goal_glasses: value });
      waterState.goal = value;
      renderWaterBody(outlet);
    } catch (err) {
      alert(err.message || t("common.error"));
    }
  });

  renderWaterChart(outlet, now);
}

function renderWaterChart(outlet, now) {
  loadChartJs().then(() => {
    const canvas = outlet.querySelector("#water-chart");
    if (!canvas) return;
    if (waterState.chart) { waterState.chart.destroy(); waterState.chart = null; }
    const labels = [];
    const data = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      labels.push(new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(d));
      data.push(glassesOn(waterState.rows, formatDateInput(d)));
    }
    waterState.chart = new window.Chart(canvas, {
      type: "bar",
      data: { labels, datasets: [{ label: t("water.chart.title"), data, backgroundColor: "#8fae8b" }] },
      options: { scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }, plugins: { legend: { display: false } } }
    });
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Food — quick history, liked/not-interested management, search & filters.
// ---------------------------------------------------------------------------

const foodState = { log: [], prefs: [], loading: true, search: "", mealFilter: "all" };

async function renderFoodView(outlet) {
  foodState.loading = true;
  outlet.innerHTML = genericSkeleton(5);
  try {
    const [log, prefs] = await Promise.all([store.call("foodlog.list", {}), store.call("foodprefs.list", {})]);
    foodState.log = log;
    foodState.prefs = prefs;
    foodState.loading = false;
    renderFoodBody(outlet);
  } catch (err) {
    foodState.loading = false;
    outlet.innerHTML = errorMarkup(err);
    attachRetryHandler(outlet, () => renderFoodView(outlet));
  }
}

function renderFoodBody(outlet) {
  const search = foodState.search.trim().toLowerCase();
  const rows = foodState.log.filter((f) => {
    if (foodState.mealFilter !== "all" && f.meal !== foodState.mealFilter) return false;
    if (search && !String(f.items || "").toLowerCase().includes(search)) return false;
    return true;
  }).sort((a, b) => dateStrOf(b.date).localeCompare(dateStrOf(a.date)));

  const interested = foodState.prefs.filter((p) => p.status === "interested");
  const notInterested = foodState.prefs.filter((p) => p.status === "not_interested");

  outlet.innerHTML = `
    <div class="card">
      <h2>${t("food.title")}</h2>
      <div class="chip-row" id="food-meal-chips">
        ${MEAL_CHIPS.map((m) => `<button type="button" class="chip" data-meal-chip="${m}">${t("food.meal." + m.toLowerCase())}</button>`).join("")}
      </div>
      <input class="field" id="food-page-input" placeholder="${t("food.whatDidYouEat")}" />
      <div class="form-actions"><button type="button" class="btn btn-secondary" id="food-page-save-btn">${t("food.save")}</button></div>
    </div>

    <div class="card">
      <h2>${t("food.prefs.title")}</h2>
      <div class="food-pref-columns">
        <div>
          <p class="field-label">${t("food.prefs.interested")}</p>
          ${interested.length ? interested.map((p) => foodPrefRowMarkup(p)).join("") : `<p class="empty">${t("common.none")}</p>`}
        </div>
        <div>
          <p class="field-label">${t("food.prefs.notInterested")}</p>
          ${notInterested.length ? notInterested.map((p) => foodPrefRowMarkup(p)).join("") : `<p class="empty">${t("common.none")}</p>`}
        </div>
      </div>
      <div class="form-actions">
        <input class="field" id="food-pref-name-input" placeholder="${t("food.prefs.addPlaceholder")}" />
        <button type="button" class="btn btn-secondary" id="food-pref-add-interested">${t("food.prefs.interested")}</button>
        <button type="button" class="btn btn-secondary" id="food-pref-add-not-interested">${t("food.prefs.notInterested")}</button>
      </div>
    </div>

    <div class="card">
      <h2>${t("food.history.title")}</h2>
      <input class="field" id="food-search-input" placeholder="${t("food.history.searchPlaceholder")}" value="${escapeHtml(foodState.search)}" />
      <div class="chip-row">
        ${["all", ...MEAL_CHIPS].map((m) => `<button type="button" class="chip ${foodState.mealFilter === m ? "chip-selected" : ""}" data-meal-filter="${m}">${m === "all" ? t("food.history.allMeals") : t("food.meal." + m.toLowerCase())}</button>`).join("")}
      </div>
      ${rows.length ? `<ul class="entity-list">${rows.map((f) => foodlogRowMarkup(f)).join("")}</ul>` : `<p class="empty">${t("food.history.none")}</p>`}
    </div>
  `;

  attachFoodBodyHandlers(outlet);
}

function foodPrefRowMarkup(p) {
  const toggleTo = p.status === "interested" ? "not_interested" : "interested";
  const toggleLabel = p.status === "interested" ? t("food.prefs.moveToNotInterested") : t("food.prefs.moveToInterested");
  return `
    <div class="food-pref-chip">
      <span>${escapeHtml(p.name)}</span>
      <button type="button" class="btn-link" data-toggle-pref="${escapeHtml(p.id)}" data-toggle-to="${toggleTo}">${toggleLabel}</button>
    </div>
  `;
}

function attachFoodBodyHandlers(outlet) {
  outlet.querySelectorAll("[data-meal-chip]").forEach((btn) => {
    btn.addEventListener("click", () => {
      outlet.querySelectorAll("[data-meal-chip]").forEach((b) => b.classList.remove("chip-selected"));
      btn.classList.add("chip-selected");
      outlet.querySelector("#food-page-input").dataset.selectedMeal = btn.dataset.mealChip;
    });
  });
  outlet.querySelector("#food-page-save-btn").addEventListener("click", async () => {
    const input = outlet.querySelector("#food-page-input");
    const items = input.value.trim();
    if (!items) return;
    const meal = input.dataset.selectedMeal || mealChipForTime(new Date());
    try {
      await store.call("foodlog.create", { date: formatDateInput(new Date()), meal, items, craving_or_aversion: "", notes: "" });
      await renderFoodView(outlet);
    } catch (err) {
      alert(err.message || t("common.error"));
    }
  });

  outlet.querySelector("#food-pref-add-interested").addEventListener("click", () => addFoodPref(outlet, "interested"));
  outlet.querySelector("#food-pref-add-not-interested").addEventListener("click", () => addFoodPref(outlet, "not_interested"));
  outlet.querySelectorAll("[data-toggle-pref]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await store.call("foodprefs.update", { id: btn.dataset.togglePref, status: btn.dataset.toggleTo });
        await renderFoodView(outlet);
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  });

  outlet.querySelector("#food-search-input").addEventListener("input", (event) => {
    foodState.search = event.target.value;
    renderFoodBody(outlet);
  });
  outlet.querySelectorAll("[data-meal-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      foodState.mealFilter = btn.dataset.mealFilter;
      renderFoodBody(outlet);
    });
  });
}

async function addFoodPref(outlet, status) {
  const input = outlet.querySelector("#food-pref-name-input");
  const name = input.value.trim();
  if (!name) return;
  try {
    await store.call("foodprefs.create", { name, status });
    await renderFoodView(outlet);
  } catch (err) {
    alert(err.message || t("common.error"));
  }
}

// ---------------------------------------------------------------------------
// Timeline — one chronological, filterable feed combining check-ins,
// symptoms, water, medicines started/stopped/doses skipped-or-missed,
// appointments, vitals and food. Everything here is read-only and derived
// client-side from a handful of lazy fetches, never its own stored tab —
// NEVER states or implies one entry caused another; entries are just laid
// side by side in time order.
// ---------------------------------------------------------------------------

const TIMELINE_TYPES = ["checkin", "symptom", "water", "medicine", "appointment", "vitals", "food", "note"];
const timelineState = { entries: [], loading: true, dateFrom: "", dateTo: "", activeTypes: new Set(TIMELINE_TYPES), doctorSummary: false };

async function renderTimelineView(outlet) {
  timelineState.loading = true;
  outlet.innerHTML = genericSkeleton(5);
  const now = new Date();
  if (!timelineState.dateFrom) timelineState.dateFrom = formatDateInput(new Date(now.getTime() - 29 * 86400000));
  if (!timelineState.dateTo) timelineState.dateTo = formatDateInput(now);

  try {
    const days = Math.max(1, Math.round((new Date(timelineState.dateTo) - new Date(timelineState.dateFrom)) / 86400000) + 1);
    const [checkins, symptoms, water, medHistory, medicines, appointments, healthlog, foodlog, notes] = await Promise.all([
      store.call("checkins.list", { date_from: timelineState.dateFrom, date_to: timelineState.dateTo }).catch(() => []),
      store.call("symptoms.list", { date_from: timelineState.dateFrom, date_to: timelineState.dateTo }).catch(() => []),
      store.call("water.list", { date_from: timelineState.dateFrom, date_to: timelineState.dateTo }).catch(() => []),
      store.call("medicines.history", { days: days + 1 }).catch(() => ({ logs: [] })),
      store.call("medicines.list", {}).catch(() => []),
      store.call("appointments.list", {}).catch(() => []),
      store.call("healthlog.list", {}).catch(() => []),
      store.call("foodlog.list", {}).catch(() => []),
      store.call("notes.list", { date_from: timelineState.dateFrom, date_to: timelineState.dateTo }).catch(() => [])
    ]);
    timelineState.entries = buildTimelineEntries({ checkins, symptoms, water, medLogs: medHistory.logs || [], medicines, appointments, healthlog, foodlog, notes });
    timelineState.loading = false;
    renderTimelineBody(outlet);
  } catch (err) {
    timelineState.loading = false;
    outlet.innerHTML = errorMarkup(err);
    attachRetryHandler(outlet, () => renderTimelineView(outlet));
  }
}

function buildTimelineEntries(data) {
  const { dateFrom, dateTo } = timelineState;
  const inRange = (d) => d >= dateFrom && d <= dateTo;
  const entries = [];

  data.checkins.forEach((c) => entries.push({ date: dateStrOf(c.date), time: c.time, type: "checkin", summary: `${MOOD_FACES[c.mood - 1] || ""} ${c.note || ""}`.trim() || t("timeline.checkinPlain") }));
  data.symptoms.forEach((s) => {
    const label = s.symptom_key === "custom" ? s.custom_name : t("symptom." + s.symptom_key);
    const bits = [label, s.severity ? t("severity." + s.severity) : "", s.bleeding_scale ? t("bleedingScale." + s.bleeding_scale) : "", s.note || ""].filter(Boolean);
    entries.push({ date: dateStrOf(s.date), time: s.time, type: "symptom", summary: bits.join(" · ") });
  });

  const waterByDate = {};
  data.water.forEach((w) => { const d = dateStrOf(w.date); waterByDate[d] = (waterByDate[d] || 0) + Number(w.glasses || 1); });
  Object.keys(waterByDate).forEach((d) => { if (inRange(d)) entries.push({ date: d, time: "23:59", type: "water", summary: t("timeline.waterSummary", { n: waterByDate[d] }) }); });

  (data.notes || []).forEach((n) => entries.push({
    date: dateStrOf(n.date), time: n.time, type: "note",
    summary: (n.category === "question" ? t("timeline.noteQuestion") + " " : "") + n.text
  }));

  data.foodlog.forEach((f) => { if (inRange(dateStrOf(f.date))) entries.push({ date: dateStrOf(f.date), time: "12:00", type: "food", summary: `${f.meal}: ${f.items || ""}`.trim() }); });

  data.medicines.forEach((m) => {
    const start = dateStrOf(m.start_date);
    if (start && inRange(start)) entries.push({ date: start, time: "00:00", type: "medicine", summary: t("timeline.medicineStarted", { name: m.name }) });
    const stopped = dateStrOf(m.stopped_on);
    if (stopped && inRange(stopped)) entries.push({ date: stopped, time: "00:01", type: "medicine", summary: t("timeline.medicineStopped", { name: m.name }) + (m.stop_note ? " — " + m.stop_note : "") });
  });
  const medById = indexById(data.medicines);
  const skippedOrMissedByDay = {};
  data.medLogs.forEach((l) => {
    const status = l.status || (isTruthy(l.taken) ? "taken" : "skipped");
    if (status === "taken") return;
    const d = dateStrOf(l.date);
    if (!inRange(d)) return;
    const med = medById[l.medicine_id];
    const key = d + "|" + (med ? med.name : l.medicine_id);
    skippedOrMissedByDay[key] = (skippedOrMissedByDay[key] || 0) + 1;
  });
  Object.keys(skippedOrMissedByDay).forEach((key) => {
    const [d, name] = key.split("|");
    entries.push({ date: d, time: "00:02", type: "medicine", summary: t("timeline.doseMissedCount", { n: skippedOrMissedByDay[key], name }) });
  });

  data.appointments.forEach((a) => {
    const d = dateStrOf(a.datetime);
    if (inRange(d)) entries.push({ date: d, time: formatTimeHHMM(new Date(a.datetime)), type: "appointment", summary: `${a.purpose || a.doctor || t("appt.form.titleNew")}${a.notes_after_visit ? " — " + a.notes_after_visit : ""}` });
  });

  data.healthlog.forEach((h) => {
    if (!inRange(dateStrOf(h.date))) return;
    const bits = [];
    if (h.weight_kg) bits.push(t("timeline.vitalsWeight", { n: h.weight_kg }));
    if (h.bp_sys && h.bp_dia) bits.push(t("timeline.vitalsBp", { sys: h.bp_sys, dia: h.bp_dia }));
    if (h.symptoms) bits.push(h.symptoms);
    if (bits.length) entries.push({ date: dateStrOf(h.date), time: "08:00", type: "vitals", summary: bits.join(" · ") });
  });

  entries.sort((a, b) => (b.date + " " + b.time).localeCompare(a.date + " " + a.time));
  return entries;
}

const TIMELINE_TYPE_ICON = { checkin: "🙂", symptom: "⚠️", water: "💧", medicine: "💊", appointment: "🩺", vitals: "📈", food: "🍽️", note: "📝" };

function renderTimelineBody(outlet) {
  const filtered = timelineState.entries.filter((e) => timelineState.activeTypes.has(e.type));

  outlet.innerHTML = `
    <div class="card">
      <h2>${t("timeline.title")}</h2>
      <div class="form-actions">
        <input class="field" type="date" id="timeline-from" value="${escapeHtml(timelineState.dateFrom)}" />
        <input class="field" type="date" id="timeline-to" value="${escapeHtml(timelineState.dateTo)}" />
      </div>
      <div class="chip-row">
        ${TIMELINE_TYPES.map((ty) => `<button type="button" class="chip ${timelineState.activeTypes.has(ty) ? "chip-selected" : ""}" data-timeline-type="${ty}">${TIMELINE_TYPE_ICON[ty]} ${t("timeline.type." + ty)}</button>`).join("")}
      </div>
      <label class="checkbox-field">
        <input type="checkbox" id="doctor-summary-toggle" ${timelineState.doctorSummary ? "checked" : ""} />
        <span>${t("timeline.doctorSummary")}</span>
      </label>
    </div>

    ${timelineState.doctorSummary ? doctorSummaryMarkup(filtered) : timelineListMarkup(filtered)}
  `;

  outlet.querySelector("#timeline-from").addEventListener("change", (event) => { timelineState.dateFrom = event.target.value; renderTimelineView(outlet); });
  outlet.querySelector("#timeline-to").addEventListener("change", (event) => { timelineState.dateTo = event.target.value; renderTimelineView(outlet); });
  outlet.querySelectorAll("[data-timeline-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ty = btn.dataset.timelineType;
      if (timelineState.activeTypes.has(ty)) timelineState.activeTypes.delete(ty);
      else timelineState.activeTypes.add(ty);
      renderTimelineBody(outlet);
    });
  });
  outlet.querySelector("#doctor-summary-toggle").addEventListener("change", (event) => {
    timelineState.doctorSummary = event.target.checked;
    renderTimelineBody(outlet);
  });
}

function timelineListMarkup(entries) {
  if (!entries.length) return `<div class="card"><p class="empty">${t("timeline.none")}</p></div>`;
  return `
    <div class="card">
      <ul class="entity-list">
        ${entries.map((e) => `
          <li class="entity-row">
            <div class="entity-main">
              <strong>${TIMELINE_TYPE_ICON[e.type]} ${escapeHtml(formatDisplayDate(e.date))} · ${escapeHtml(e.time)}</strong>
              <span class="muted">${escapeHtml(e.summary)}</span>
            </div>
          </li>
        `).join("")}
      </ul>
    </div>
  `;
}

// Groups the same filtered entries by type instead of strictly
// chronologically — "what the doctor needs to see for this range" without
// the tick-by-tick noise. Still just lists entries side by side; never
// states or implies one caused another.
function doctorSummaryMarkup(entries) {
  if (!entries.length) return `<div class="card"><p class="empty">${t("timeline.none")}</p></div>`;
  return TIMELINE_TYPES.map((ty) => {
    const rows = entries.filter((e) => e.type === ty);
    if (!rows.length) return "";
    return `
      <div class="card">
        <h2>${TIMELINE_TYPE_ICON[ty]} ${t("timeline.type." + ty)}</h2>
        <ul>
          ${rows.map((e) => `<li>${escapeHtml(formatDisplayDate(e.date))} · ${escapeHtml(e.time)} — ${escapeHtml(e.summary)}</li>`).join("")}
        </ul>
      </div>
    `;
  }).join("");
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
// Records vault (rebuilt for Phase 3) — organised by type_v2 into folder
// tiles (Prescriptions/Lab reports/Scan reports/Bills & receipts/Medicine
// photos/Other), plus a "Needs sorting" bucket for anything uploaded before
// this categorization existed. List/grid, search, date range, linked-
// booking filter, sort by date, edit metadata, delete-with-undo. Upload/
// thumbnails/viewer all carried over unchanged from before.
// ---------------------------------------------------------------------------

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const RECORD_TYPE_V2_ORDER = ["prescription", "lab_report", "scan_report", "bill", "medicine_photo", "other"];
const RECORD_TYPE_V2_ICONS = { prescription: "💊", lab_report: "📄", scan_report: "🩻", bill: "🧾", medicine_photo: "📷", other: "🗂️" };
// Old v1/v2 type values, kept only for display on rows that still have no
// type_v2 (the "needs sorting" bucket) — never written to new uploads.
const RECORD_TYPE_ICONS = { report: "📄", scan: "🩻", prescription: "💊", document: "🗂️" };

const recordsState = {
  files: [],
  loading: true,
  folderFilter: "", // "" = folder-tile view; a type_v2 or "needs_sorting" = list filtered to it
  search: "",
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
    recordsState.files = await store.call("files.list", {});
    recordsState.loading = false;
    renderRecordsBody(outlet);
  } catch (err) {
    recordsState.loading = false;
    outlet.innerHTML = errorMarkup(err);
    attachRetryHandler(outlet, () => renderRecordsView(outlet));
  }
}

function recordsFiltered() {
  const search = recordsState.search.trim().toLowerCase();
  return recordsState.files.filter((f) => {
    if (recordsState.folderFilter === "needs_sorting" && f.type_v2) return false;
    if (recordsState.folderFilter && recordsState.folderFilter !== "needs_sorting" && f.type_v2 !== recordsState.folderFilter) return false;
    if (recordsState.filterFrom && f.date < recordsState.filterFrom) return false;
    if (recordsState.filterTo && f.date > recordsState.filterTo) return false;
    if (search) {
      const haystack = [f.title, f.doctor, f.notes].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  }).sort((a, b) => dateStrOf(b.date).localeCompare(dateStrOf(a.date)));
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
  outlet.innerHTML = recordsState.folderFilter ? recordsListMarkup() : recordsFolderTilesMarkup();
  attachRecordsListHandlers(outlet);
}

function recordsFolderTilesMarkup() {
  const countOf = (ty) => recordsState.files.filter((f) => ty === "needs_sorting" ? !f.type_v2 : f.type_v2 === ty).length;
  return `
    <button class="btn btn-primary" id="add-record-btn">${t("records.add")}</button>
    <div class="records-grid">
      ${[...RECORD_TYPE_V2_ORDER, "needs_sorting"].map((ty) => `
        <button class="record-card" data-open-folder="${ty}">
          <span class="record-type-icon">${ty === "needs_sorting" ? "📥" : RECORD_TYPE_V2_ICONS[ty]}</span>
          <span class="record-card-title">${t(ty === "needs_sorting" ? "records.needsSorting" : "records.type." + ty)}</span>
          <span class="muted">${t("records.folderCount", { n: countOf(ty) })}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function recordsListMarkup() {
  const rows = recordsFiltered();
  return `
    <button class="btn-link" id="records-back-to-folders">${t("common.back")}</button>
    <button class="btn btn-primary" id="add-record-btn">${t("records.add")}</button>

    <div class="card">
      <h2>${t(recordsState.folderFilter === "needs_sorting" ? "records.needsSorting" : "records.type." + recordsState.folderFilter)}</h2>
      <input class="field" id="records-search" placeholder="${t("records.filter.search")}" value="${escapeHtml(recordsState.search)}" />
      <div class="records-date-range">
        ${formField(t("records.filter.from"), `<input class="field" type="date" id="filter-from" value="${escapeHtml(recordsState.filterFrom)}" />`)}
        ${formField(t("records.filter.to"), `<input class="field" type="date" id="filter-to" value="${escapeHtml(recordsState.filterTo)}" />`)}
      </div>
      <div class="view-toggle">
        <button class="btn-link ${recordsState.viewMode === "list" ? "view-toggle-active" : ""}" id="view-list-btn">${t("records.view.list")}</button>
        <button class="btn-link ${recordsState.viewMode === "grid" ? "view-toggle-active" : ""}" id="view-grid-btn">${t("records.view.grid")}</button>
      </div>
    </div>

    ${
      rows.length
        ? recordsState.viewMode === "grid"
          ? `<div class="records-grid">${rows.map((f) => recordCardMarkup(f)).join("")}</div>`
          : `<div class="card"><ul class="entity-list">${rows.map((f) => recordRowMarkup(f)).join("")}</ul></div>`
        : `<div class="card"><p class="empty">${t("records.none")}</p></div>`
    }
  `;
}

function recordIcon(f) {
  return f.type_v2 ? RECORD_TYPE_V2_ICONS[f.type_v2] : (RECORD_TYPE_ICONS[f.type] || "🗂️");
}

function recordCardMarkup(f) {
  return `
    <button class="record-card" data-view-file="${escapeHtml(f.id)}">
      <span class="record-type-icon">${recordIcon(f)}</span>
      <span class="record-card-title">${escapeHtml(f.title)}</span>
      <span class="muted">${escapeHtml(formatDisplayDate(f.date))}</span>
    </button>
  `;
}

function recordRowMarkup(f) {
  return `
    <li class="entity-row">
      <button class="entity-main record-row-main" data-view-file="${escapeHtml(f.id)}">
        <strong>${recordIcon(f)} ${escapeHtml(f.title)}</strong>
        <span class="muted">${escapeHtml(formatDisplayDate(f.date))}${f.doctor ? " · " + escapeHtml(f.doctor) : ""}${!f.type_v2 ? " · " + escapeHtml(t("records.needsSorting")) : ""}</span>
      </button>
      <div class="entity-actions">
        <button class="btn-link" data-edit-file="${escapeHtml(f.id)}">${t("common.edit")}</button>
        <button class="btn-link btn-link--danger" data-delete-file="${escapeHtml(f.id)}">${t("common.delete")}</button>
      </div>
    </li>
  `;
}

function attachRecordsListHandlers(outlet) {
  const addBtn = outlet.querySelector("#add-record-btn");
  if (addBtn) addBtn.addEventListener("click", () => { recordsState.uploadOpen = true; renderRecordsBody(outlet); });

  outlet.querySelectorAll("[data-open-folder]").forEach((btn) => {
    btn.addEventListener("click", () => { recordsState.folderFilter = btn.dataset.openFolder; renderRecordsBody(outlet); });
  });
  const backBtn = outlet.querySelector("#records-back-to-folders");
  if (backBtn) backBtn.addEventListener("click", () => { recordsState.folderFilter = ""; renderRecordsBody(outlet); });

  const search = outlet.querySelector("#records-search");
  if (search) search.addEventListener("input", (event) => { recordsState.search = event.target.value; renderRecordsBody(outlet); });

  const refilterDates = () => {
    recordsState.filterFrom = outlet.querySelector("#filter-from").value;
    recordsState.filterTo = outlet.querySelector("#filter-to").value;
    renderRecordsBody(outlet);
  };
  const fromInput = outlet.querySelector("#filter-from");
  if (fromInput) fromInput.addEventListener("change", refilterDates);
  const toInput = outlet.querySelector("#filter-to");
  if (toInput) toInput.addEventListener("change", refilterDates);

  const listBtn = outlet.querySelector("#view-list-btn");
  if (listBtn) listBtn.addEventListener("click", () => { recordsState.viewMode = "list"; renderRecordsBody(outlet); });
  const gridBtn = outlet.querySelector("#view-grid-btn");
  if (gridBtn) gridBtn.addEventListener("click", () => { recordsState.viewMode = "grid"; renderRecordsBody(outlet); });

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

  outlet.querySelectorAll("[data-edit-file]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const file = recordsState.files.find((f) => f.id === btn.dataset.editFile);
      openFileMetadataSheet(file, () => renderRecordsView(outlet));
    });
  });

  outlet.querySelectorAll("[data-delete-file]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = recordsState.files.findIndex((f) => f.id === btn.dataset.deleteFile);
      if (idx === -1) return;
      const removed = recordsState.files[idx];
      recordsState.files.splice(idx, 1);
      renderRecordsBody(outlet);
      showUndoToast(t("records.deletedToast", { title: removed.title }), {
        onUndo: () => { recordsState.files.splice(idx, 0, removed); renderRecordsBody(outlet); },
        onCommit: async () => {
          try {
            await store.call("files.delete", { id: removed.id });
          } catch (err) {
            recordsState.files.splice(idx, 0, removed);
            renderRecordsBody(outlet);
            alert(err.message || t("common.error"));
          }
        }
      });
    });
  });
}

function openFileMetadataSheet(file, onSaved) {
  openSheet(`
    <div class="sheet-handle" aria-hidden="true"></div>
    <h2>${t("records.editMetadata")}</h2>
    <form id="file-meta-form">
      ${formField(t("records.upload.recordTitle"), `<input class="field" name="title" required value="${escapeHtml(file.title)}" />`)}
      ${formField(
        t("records.upload.type"),
        `<select class="field" name="type_v2">
          <option value="">${t("records.needsSorting")}</option>
          ${RECORD_TYPE_V2_ORDER.map((ty) => `<option value="${ty}" ${file.type_v2 === ty ? "selected" : ""}>${t("records.type." + ty)}</option>`).join("")}
        </select>`
      )}
      ${formField(t("records.upload.date"), `<input class="field" type="date" name="date" value="${escapeHtml(dateStrOf(file.date))}" />`)}
      ${formField(t("records.upload.doctor"), `<input class="field" name="doctor" value="${escapeHtml(file.doctor)}" />`)}
      ${formField(t("records.upload.notes"), `<textarea class="field" name="notes" rows="2">${escapeHtml(file.notes)}</textarea>`)}
      <p class="error-text" id="file-meta-error" hidden></p>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="file-meta-cancel">${t("common.cancel")}</button>
        <button type="submit" class="btn btn-primary" id="file-meta-save">${t("common.save")}</button>
      </div>
    </form>
  `, (sheetEl) => {
    sheetEl.querySelector("#file-meta-cancel").addEventListener("click", closeSheet);
    sheetEl.querySelector("#file-meta-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(event.target);
      const saveBtn = sheetEl.querySelector("#file-meta-save");
      saveBtn.disabled = true;
      try {
        await store.call("files.update", {
          id: file.id,
          title: fd.get("title").trim(),
          type_v2: fd.get("type_v2") || "",
          date: fd.get("date"),
          doctor: fd.get("doctor").trim(),
          notes: fd.get("notes").trim()
        });
        closeSheet();
        await onSaved();
      } catch (err) {
        saveBtn.disabled = false;
        const errEl = sheetEl.querySelector("#file-meta-error");
        errEl.textContent = err.message || t("common.error");
        errEl.hidden = false;
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
            `<select class="field" name="type_v2" required>
              ${RECORD_TYPE_V2_ORDER.map((ty) => `<option value="${ty}">${t("records.type." + ty)}</option>`).join("")}
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
          type: "document", // legacy column, kept populated for back-compat; type_v2 is the real category now
          type_v2: fd.get("type_v2"),
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
      <p class="muted">${escapeHtml(formatDisplayDate(file.date))}${file.doctor ? " · " + escapeHtml(file.doctor) : ""}</p>
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
// Bookings — the real tracker for doctor visits/scans/blood tests/vaccines
// (Phase 3). The plain Visits tab (#/visits, Phase 1) still exists for a
// quick appointment with nothing else to track; this is for anything that
// needs status, a report, a bill. Reachable from More.
// ---------------------------------------------------------------------------

const BOOKING_TYPES_LIST = ["doctor_visit", "scan", "blood_test", "vaccine", "other"];
const BOOKING_STATUSES_LIST = ["booked", "done", "waiting_for_report", "report_uploaded", "closed"];
const BOOKING_NEXT_STATUS = { booked: "done", done: "waiting_for_report", waiting_for_report: "report_uploaded", report_uploaded: "closed" };
const BOOKING_TYPE_ICON = { doctor_visit: "🩺", scan: "🩻", blood_test: "🩸", vaccine: "💉", other: "📋" };
const SUGGESTION_TYPES_LIST = ["medicine", "scan", "blood_test", "diet_lifestyle", "follow_up"];
const BILL_STATUSES_LIST = ["not_applicable", "pay_on_visit", "to_collect", "paid", "unpaid"];

const bookingsState = {
  bookings: [], bills: [], loading: true,
  typeFilter: "all", statusFilter: "all", billFilter: "all",
  detail: null, detailSuggestions: [], detailBill: null, detailFiles: [], detailPrevVisitNotes: "", detailSinceLastVisit: []
};

async function renderBookingsView(outlet) {
  bookingsState.loading = true;
  bookingsState.detail = null;
  outlet.innerHTML = genericSkeleton(5);
  try {
    const [bookings, bills] = await Promise.all([store.call("bookings.list", {}), store.call("bills.list", {})]);
    bookingsState.bookings = bookings;
    bookingsState.bills = bills;
    bookingsState.loading = false;
    renderBookingsBody(outlet);
  } catch (err) {
    bookingsState.loading = false;
    outlet.innerHTML = errorMarkup(err);
    attachRetryHandler(outlet, () => renderBookingsView(outlet));
  }
}

function renderBookingsBody(outlet) {
  if (bookingsState.detail) {
    outlet.innerHTML = bookingDetailMarkup(bookingsState.detail);
    attachBookingDetailHandlers(outlet);
    return;
  }
  outlet.innerHTML = bookingsListMarkup();
  attachBookingsListHandlers(outlet);
}

function billForBooking(bookingId) {
  return bookingsState.bills.find((b) => b.booking_id === bookingId) || null;
}

function bookingsListMarkup() {
  const rows = bookingsState.bookings.filter((b) => {
    if (bookingsState.typeFilter !== "all" && b.type !== bookingsState.typeFilter) return false;
    if (bookingsState.statusFilter !== "all" && b.status !== bookingsState.statusFilter) return false;
    if (bookingsState.billFilter === "unpaid") {
      const bill = billForBooking(b.id);
      if (!bill || bill.status !== "unpaid") return false;
    }
    if (bookingsState.billFilter === "pending_report" && b.status !== "waiting_for_report") return false;
    if (bookingsState.billFilter === "pending_prescription" && !(b.type === "doctor_visit" && b.status === "done")) return false;
    return true;
  }).sort((a, b) => String(b.datetime).localeCompare(String(a.datetime)));

  return `
    <button class="btn btn-primary" id="add-booking-btn">${t("bookings.add")}</button>
    <div class="card">
      <p class="field-label">${t("bookings.filter.type")}</p>
      <div class="chip-row">${["all", ...BOOKING_TYPES_LIST].map((ty) => `<button type="button" class="chip ${bookingsState.typeFilter === ty ? "chip-selected" : ""}" data-booking-type-filter="${ty}">${ty === "all" ? t("bookings.filter.all") : t("bookings.type." + ty)}</button>`).join("")}</div>
      <p class="field-label">${t("bookings.filter.status")}</p>
      <div class="chip-row">${["all", ...BOOKING_STATUSES_LIST].map((s) => `<button type="button" class="chip ${bookingsState.statusFilter === s ? "chip-selected" : ""}" data-booking-status-filter="${s}">${s === "all" ? t("bookings.filter.all") : t("bookings.status." + s)}</button>`).join("")}</div>
      <p class="field-label">${t("bookings.filter.bill")}</p>
      <div class="chip-row">
        ${["all", "pending_report", "pending_prescription", "unpaid"].map((f) => `<button type="button" class="chip ${bookingsState.billFilter === f ? "chip-selected" : ""}" data-booking-bill-filter="${f}">${t("bookings.filter.bill." + f)}</button>`).join("")}
      </div>
    </div>
    ${rows.length ? `<div class="card"><ul class="entity-list">${rows.map((b) => bookingRowMarkup(b)).join("")}</ul></div>` : `<div class="card"><p class="empty">${t("bookings.none")}</p></div>`}
  `;
}

function bookingRowMarkup(b) {
  const bill = billForBooking(b.id);
  return `
    <li class="entity-row tap-row" data-open-booking="${escapeHtml(b.id)}">
      <div class="entity-main">
        <strong>${BOOKING_TYPE_ICON[b.type]} ${escapeHtml(b.title)}</strong>
        <span class="muted">${escapeHtml(b.provider || "")}${b.provider ? " · " : ""}${escapeHtml(formatApptDateTime(b.datetime))}</span>
        <span class="badge">${t("bookings.status." + b.status)}</span>
        ${bill ? `<span class="muted">${t("bookings.bill." + bill.status)}${bill.amount ? " · ₹" + escapeHtml(bill.amount) : ""}</span>` : ""}
      </div>
    </li>
  `;
}

function attachBookingsListHandlers(outlet) {
  outlet.querySelector("#add-booking-btn").addEventListener("click", () => openBookingCreateSheet(() => renderBookingsView(outlet)));

  outlet.querySelectorAll("[data-booking-type-filter]").forEach((btn) => {
    btn.addEventListener("click", () => { bookingsState.typeFilter = btn.dataset.bookingTypeFilter; renderBookingsBody(outlet); });
  });
  outlet.querySelectorAll("[data-booking-status-filter]").forEach((btn) => {
    btn.addEventListener("click", () => { bookingsState.statusFilter = btn.dataset.bookingStatusFilter; renderBookingsBody(outlet); });
  });
  outlet.querySelectorAll("[data-booking-bill-filter]").forEach((btn) => {
    btn.addEventListener("click", () => { bookingsState.billFilter = btn.dataset.bookingBillFilter; renderBookingsBody(outlet); });
  });

  outlet.querySelectorAll("[data-open-booking]").forEach((el) => {
    el.addEventListener("click", async () => {
      const booking = bookingsState.bookings.find((b) => b.id === el.dataset.openBooking);
      await openBookingDetail(outlet, booking);
    });
  });
}

function openBookingCreateSheet(onSaved) {
  openSheet(`
    <div class="sheet-handle" aria-hidden="true"></div>
    <h2>${t("bookings.form.titleNew")}</h2>
    <form id="booking-create-form">
      ${formField(t("bookings.form.type"), `<select class="field" name="type">${BOOKING_TYPES_LIST.map((ty) => `<option value="${ty}">${t("bookings.type." + ty)}</option>`).join("")}</select>`)}
      ${formField(t("bookings.form.title"), `<input class="field" name="title" required />`)}
      ${formField(t("bookings.form.provider"), `<input class="field" name="provider" />`)}
      ${formField(t("bookings.form.datetime"), `<input class="field" type="datetime-local" name="datetime" required />`)}
      ${formField(t("bookings.form.bookedVia"), `<select class="field" name="booked_via"><option value="">—</option>${BOOKING_VIA_LIST.map((v) => `<option value="${v}">${t("bookings.via." + v)}</option>`).join("")}</select>`)}
      ${formField(t("bookings.form.location"), `<input class="field" name="location" />`)}
      ${formField(t("bookings.form.approxReportDays"), `<input class="field" type="number" min="0" name="approx_report_days" />`, t("bookings.form.approxReportDaysHint"))}
      <p class="error-text" id="booking-create-error" hidden></p>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="booking-create-cancel">${t("common.cancel")}</button>
        <button type="submit" class="btn btn-primary" id="booking-create-save">${t("common.save")}</button>
      </div>
    </form>
  `, (sheetEl) => {
    sheetEl.querySelector("#booking-create-cancel").addEventListener("click", closeSheet);
    sheetEl.querySelector("#booking-create-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(event.target);
      const payload = {
        type: fd.get("type"), title: fd.get("title").trim(), provider: fd.get("provider").trim(),
        datetime: fd.get("datetime") ? new Date(fd.get("datetime")).toISOString() : "",
        booked_via: fd.get("booked_via") || "", location: fd.get("location").trim(),
        approx_report_days: fd.get("approx_report_days") || ""
      };
      const saveBtn = sheetEl.querySelector("#booking-create-save");
      saveBtn.disabled = true;
      try {
        await store.call("bookings.create", payload);
        closeSheet();
        await onSaved();
      } catch (err) {
        saveBtn.disabled = false;
        const errEl = sheetEl.querySelector("#booking-create-error");
        errEl.textContent = err.message || t("common.error");
        errEl.hidden = false;
      }
    });
  });
}
const BOOKING_VIA_LIST = ["call", "online", "in_person", "walk_in"];

async function openBookingDetail(outlet, booking) {
  outlet.innerHTML = genericSkeleton(5);
  try {
    const [suggestions, files] = await Promise.all([
      store.call("suggestions.list", { booking_id: booking.id }),
      store.call("files.list", { linked_booking_id: booking.id })
    ]);
    bookingsState.detail = booking;
    bookingsState.detailSuggestions = suggestions;
    bookingsState.detailBill = billForBooking(booking.id);
    bookingsState.detailFiles = files;

    // "What the doctor said last time" + "Since last visit" — only
    // meaningful before the visit happens (status still 'booked').
    if (booking.status === "booked") {
      const sameTypePrior = bookingsState.bookings
        .filter((b) => b.type === booking.type && b.status === "closed" && String(b.datetime) < String(booking.datetime))
        .sort((a, b) => String(b.datetime).localeCompare(String(a.datetime)))[0];
      bookingsState.detailPrevVisitNotes = sameTypePrior ? sameTypePrior.notes : "";
      if (sameTypePrior) {
        const [symptoms, medicines] = await Promise.all([
          store.call("symptoms.list", { date_from: dateStrOf(sameTypePrior.datetime), date_to: dateStrOf(booking.datetime) }),
          store.call("medicines.list", {})
        ]);
        const sinceEntries = symptoms.map((s) => ({
          date: dateStrOf(s.date), time: s.time,
          summary: (s.symptom_key === "custom" ? s.custom_name : t("symptom." + s.symptom_key)) + (s.severity ? " · " + t("severity." + s.severity) : "")
        }));
        medicines.forEach((m) => {
          const start = dateStrOf(m.start_date);
          if (start >= dateStrOf(sameTypePrior.datetime) && start <= dateStrOf(booking.datetime)) {
            sinceEntries.push({ date: start, time: "00:00", summary: t("timeline.medicineStarted", { name: m.name }) });
          }
          const stopped = dateStrOf(m.stopped_on);
          if (stopped && stopped >= dateStrOf(sameTypePrior.datetime) && stopped <= dateStrOf(booking.datetime)) {
            sinceEntries.push({ date: stopped, time: "00:01", summary: t("timeline.medicineStopped", { name: m.name }) });
          }
        });
        sinceEntries.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
        bookingsState.detailSinceLastVisit = sinceEntries;
      } else {
        bookingsState.detailSinceLastVisit = [];
      }
    } else {
      bookingsState.detailPrevVisitNotes = "";
      bookingsState.detailSinceLastVisit = [];
    }

    renderBookingsBody(outlet);
  } catch (err) {
    outlet.innerHTML = errorMarkup(err);
    attachRetryHandler(outlet, () => renderBookingsView(outlet));
  }
}

function questionsToItems(text) {
  return String(text || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const done = line.startsWith("[x]");
    return { text: line.replace(/^\[[x ]\]\s*/i, ""), done };
  });
}

function itemsToQuestionsText(items) {
  return items.map((it) => `[${it.done ? "x" : " "}] ${it.text}`).join("\n");
}

function bookingDetailMarkup(b) {
  const items = questionsToItems(b.questions);
  const nextStatus = BOOKING_NEXT_STATUS[b.status];
  const reportDue = b.status === "waiting_for_report" && b.approx_report_days && b.waiting_for_report_at
    ? new Date(new Date(b.waiting_for_report_at).getTime() + Number(b.approx_report_days) * 86400000)
    : null;

  return `
    <button class="btn-link" id="booking-detail-back">${t("common.back")}</button>
    <div class="card">
      <h2>${BOOKING_TYPE_ICON[b.type]} ${escapeHtml(b.title)}</h2>
      <p class="muted">${escapeHtml(b.provider || "")}${b.provider ? " · " : ""}${escapeHtml(formatApptDateTime(b.datetime))}${b.location ? " · " + escapeHtml(b.location) : ""}</p>
      <p><span class="badge">${t("bookings.status." + b.status)}</span></p>
      ${reportDue ? `<p class="muted">${t("bookings.reportExpected", { date: formatDisplayDate(formatDateInput(reportDue)) })}</p>` : ""}
      ${bookingStageDurationsMarkup(b)}
      <div class="form-actions">
        ${nextStatus ? `<button type="button" class="btn btn-secondary" id="booking-advance-status" data-next-status="${nextStatus}">${t("bookings.markAs", { status: t("bookings.status." + nextStatus) })}</button>` : ""}
        ${b.status !== "closed" ? `<button type="button" class="btn btn-primary" id="booking-close-btn">${t("bookings.close")}</button>` : ""}
      </div>
      <p class="error-text" id="booking-close-error" hidden></p>
      <button type="button" class="btn-link btn-link--danger" id="booking-delete-btn">${t("common.delete")}</button>
    </div>

    ${b.status === "booked" ? `
      <div class="card">
        <h2>${t("bookings.prepare.title")}</h2>
        <p class="field-label">${t("bookings.prepare.questions")}</p>
        <ul class="checklist-items" id="booking-questions-list">
          ${items.map((it, i) => `
            <li class="checklist-item">
              <label class="checklist-check">
                <input type="checkbox" data-question-index="${i}" ${it.done ? "checked" : ""} />
                <span>${escapeHtml(it.text)}</span>
              </label>
            </li>
          `).join("")}
        </ul>
        <div class="form-actions">
          <input class="field" id="booking-add-question-input" placeholder="${t("bookings.prepare.addQuestion")}" />
          <button type="button" class="btn btn-secondary" id="booking-add-question-btn">${t("common.add")}</button>
        </div>

        ${bookingsState.detailPrevVisitNotes ? `
          <p class="field-label">${t("bookings.prepare.lastTime")}</p>
          <p class="muted">${escapeHtml(bookingsState.detailPrevVisitNotes)}</p>
        ` : ""}

        ${bookingsState.detailSinceLastVisit.length ? `
          <p class="field-label">${t("bookings.prepare.sinceLastVisit")}</p>
          <ul>${bookingsState.detailSinceLastVisit.map((e) => `<li>${escapeHtml(formatDisplayDate(e.date))} — ${escapeHtml(e.summary)}</li>`).join("")}</ul>
        ` : ""}
      </div>
    ` : ""}

    ${b.status !== "booked" ? `
      <div class="card">
        <h2>${t("bookings.afterVisit.title")}</h2>
        <textarea class="field" id="booking-notes-input" rows="3" placeholder="${t("bookings.afterVisit.notesPlaceholder")}">${escapeHtml(b.notes)}</textarea>
        <div class="form-actions"><button type="button" class="btn btn-secondary" id="booking-notes-save">${t("common.save")}</button></div>

        <p class="field-label">${t("bookings.suggestions.title")}</p>
        ${bookingsState.detailSuggestions.length ? `<ul class="entity-list">${bookingsState.detailSuggestions.map((s) => suggestionRowMarkup(s)).join("")}</ul>` : `<p class="empty">${t("common.none")}</p>`}
        <div class="form-actions">
          <select class="field" id="suggestion-type-input">${SUGGESTION_TYPES_LIST.map((ty) => `<option value="${ty}">${t("bookings.suggestionType." + ty)}</option>`).join("")}</select>
        </div>
        <div class="form-actions">
          <input class="field" id="suggestion-text-input" placeholder="${t("bookings.suggestions.textPlaceholder")}" />
          <button type="button" class="btn btn-secondary" id="suggestion-add-btn">${t("common.add")}</button>
        </div>
      </div>

      <div class="card">
        <h2>${t("bookings.bill.title")}</h2>
        ${billFormMarkup(bookingsState.detailBill)}
      </div>

      <div class="card">
        <h2>${t("bookings.linkedFiles.title")}</h2>
        ${bookingsState.detailFiles.length ? `<ul class="entity-list">${bookingsState.detailFiles.map((f) => `<li class="entity-row"><div class="entity-main"><strong>${recordIcon(f)} ${escapeHtml(f.title)}</strong></div></li>`).join("")}</ul>` : `<p class="empty">${t("bookings.linkedFiles.none")}</p>`}
        <button type="button" class="btn btn-secondary" id="booking-link-file-btn">${t("bookings.linkedFiles.upload")}</button>
      </div>
    ` : ""}
  `;
}

function bookingStageDurationsMarkup(b) {
  const parts = [];
  if (b.booked_at && b.done_at) parts.push(t("bookings.duration.toDone", { d: durationDaysHours(b.booked_at, b.done_at) }));
  if (b.waiting_for_report_at && b.report_uploaded_at) parts.push(t("bookings.duration.reportTook", { d: durationDaysHours(b.waiting_for_report_at, b.report_uploaded_at) }));
  return parts.length ? `<p class="muted">${parts.join(" · ")}</p>` : "";
}

function durationDaysHours(fromIso, toIso) {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (isNaN(ms) || ms < 0) return "";
  const dur = formatDuration(ms);
  return dur.days > 0 ? `${dur.days}d ${dur.hours}h` : `${dur.hours}h`;
}

function suggestionRowMarkup(s) {
  const actionLabel = { medicine: "bookings.suggestions.addAsMedicine", scan: "bookings.suggestions.bookTest", blood_test: "bookings.suggestions.bookTest", follow_up: "bookings.suggestions.setCountdown" }[s.type];
  return `
    <li class="entity-row">
      <div class="entity-main">
        <strong>${t("bookings.suggestionType." + s.type)}</strong>
        <span class="muted">${escapeHtml(s.text)}</span>
        <span class="badge">${t("bookings.suggestionStatus." + s.status)}</span>
      </div>
      <div class="entity-actions">
        ${actionLabel && s.status === "pending" ? `<button class="btn-link" data-suggestion-action="${escapeHtml(s.id)}">${t(actionLabel)}</button>` : ""}
        ${s.status === "pending" ? `<button class="btn-link" data-suggestion-done="${escapeHtml(s.id)}">${t("bookings.suggestions.markDone")}</button>` : ""}
      </div>
    </li>
  `;
}

function billFormMarkup(bill) {
  const b = bill || { status: "not_applicable", amount: "", paid_on: "", notes: "" };
  return `
    <div class="chip-row" id="bill-status-chips">
      ${BILL_STATUSES_LIST.map((s) => `<button type="button" class="chip ${b.status === s ? "chip-selected" : ""}" data-bill-status="${s}">${t("bookings.bill." + s)}</button>`).join("")}
    </div>
    ${formField(t("bookings.bill.amount"), `<input class="field" type="number" min="0" id="bill-amount-input" value="${escapeHtml(b.amount)}" />`)}
    ${formField(t("bookings.bill.paidOn"), `<input class="field" type="date" id="bill-paid-on-input" value="${escapeHtml(b.paid_on)}" />`)}
    <div class="form-actions"><button type="button" class="btn btn-secondary" id="bill-save-btn">${t("common.save")}</button></div>
  `;
}

function attachBookingDetailHandlers(outlet) {
  const b = bookingsState.detail;
  outlet.querySelector("#booking-detail-back").addEventListener("click", () => { bookingsState.detail = null; renderBookingsBody(outlet); });

  const advanceBtn = outlet.querySelector("#booking-advance-status");
  if (advanceBtn) {
    advanceBtn.addEventListener("click", async () => {
      try {
        const updated = await store.call("bookings.update", { id: b.id, status: advanceBtn.dataset.nextStatus });
        Object.assign(b, updated);
        await openBookingDetail(outlet, b);
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  }

  const closeBtn = outlet.querySelector("#booking-close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", async () => {
      const errEl = outlet.querySelector("#booking-close-error");
      errEl.hidden = true;
      try {
        await store.call("bookings.close", { id: b.id });
        await renderBookingsView(outlet);
      } catch (err) {
        errEl.textContent = err.message || t("common.error");
        errEl.hidden = false;
      }
    });
  }

  outlet.querySelector("#booking-delete-btn").addEventListener("click", () => {
    bookingsState.detail = null;
    const idx = bookingsState.bookings.findIndex((x) => x.id === b.id);
    if (idx !== -1) bookingsState.bookings.splice(idx, 1);
    renderBookingsBody(outlet);
    showUndoToast(t("bookings.deletedToast", { title: b.title }), {
      onUndo: () => { if (idx !== -1) bookingsState.bookings.splice(idx, 0, b); bookingsState.detail = b; renderBookingsBody(outlet); },
      onCommit: async () => {
        try { await store.call("bookings.delete", { id: b.id }); } catch (err) { alert(err.message || t("common.error")); }
      }
    });
  });

  // --- Prepare: questions checklist ---
  outlet.querySelectorAll("[data-question-index]").forEach((checkbox) => {
    checkbox.addEventListener("change", async () => {
      const items = questionsToItems(b.questions);
      items[Number(checkbox.dataset.questionIndex)].done = checkbox.checked;
      const text = itemsToQuestionsText(items);
      try {
        const updated = await store.call("bookings.update", { id: b.id, questions: text });
        b.questions = updated.questions;
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  });
  const addQuestionBtn = outlet.querySelector("#booking-add-question-btn");
  if (addQuestionBtn) {
    addQuestionBtn.addEventListener("click", async () => {
      const input = outlet.querySelector("#booking-add-question-input");
      const text = input.value.trim();
      if (!text) return;
      const items = questionsToItems(b.questions);
      items.push({ text, done: false });
      try {
        const updated = await store.call("bookings.update", { id: b.id, questions: itemsToQuestionsText(items) });
        b.questions = updated.questions;
        renderBookingsBody(outlet);
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  }

  // --- After visit: notes ---
  const notesSaveBtn = outlet.querySelector("#booking-notes-save");
  if (notesSaveBtn) {
    notesSaveBtn.addEventListener("click", async () => {
      try {
        const updated = await store.call("bookings.update", { id: b.id, notes: outlet.querySelector("#booking-notes-input").value.trim() });
        b.notes = updated.notes;
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  }

  // --- Suggestions ---
  const suggestionAddBtn = outlet.querySelector("#suggestion-add-btn");
  if (suggestionAddBtn) {
    suggestionAddBtn.addEventListener("click", async () => {
      const text = outlet.querySelector("#suggestion-text-input").value.trim();
      if (!text) return;
      const type = outlet.querySelector("#suggestion-type-input").value;
      try {
        await store.call("suggestions.create", { booking_id: b.id, type, text });
        await openBookingDetail(outlet, b);
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  }
  outlet.querySelectorAll("[data-suggestion-done]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await store.call("suggestions.update", { id: btn.dataset.suggestionDone, status: "done" });
        await openBookingDetail(outlet, b);
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  });
  outlet.querySelectorAll("[data-suggestion-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const suggestion = bookingsState.detailSuggestions.find((s) => s.id === btn.dataset.suggestionAction);
      if (!suggestion) return;
      if (suggestion.type === "medicine") {
        openMedicineSheet({ reason: suggestion.text, source: "suggestion:" + suggestion.id }, async () => {
          await store.call("suggestions.update", { id: suggestion.id, status: "done" });
          await openBookingDetail(outlet, b);
        });
      } else if (suggestion.type === "scan" || suggestion.type === "blood_test") {
        openBookingCreateSheet(async () => {
          await store.call("suggestions.update", { id: suggestion.id, status: "done" });
          await renderBookingsView(outlet);
        });
      } else if (suggestion.type === "follow_up") {
        openCountdownSheet({ title: suggestion.text, kind: "event", target_datetime: suggestion.follow_up_date || "" }, [], async () => {
          await store.call("suggestions.update", { id: suggestion.id, status: "done" });
          await openBookingDetail(outlet, b);
        });
      }
    });
  });

  // --- Bill ---
  let billStatus = (bookingsState.detailBill && bookingsState.detailBill.status) || "not_applicable";
  outlet.querySelectorAll("[data-bill-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      outlet.querySelectorAll("[data-bill-status]").forEach((x) => x.classList.remove("chip-selected"));
      btn.classList.add("chip-selected");
      billStatus = btn.dataset.billStatus;
    });
  });
  const billSaveBtn = outlet.querySelector("#bill-save-btn");
  if (billSaveBtn) {
    billSaveBtn.addEventListener("click", async () => {
      const amount = outlet.querySelector("#bill-amount-input").value;
      const paidOn = outlet.querySelector("#bill-paid-on-input").value;
      try {
        if (bookingsState.detailBill) {
          await store.call("bills.update", { id: bookingsState.detailBill.id, status: billStatus, amount, paid_on: paidOn });
        } else {
          await store.call("bills.create", { booking_id: b.id, status: billStatus, amount, paid_on: paidOn });
        }
        await renderBookingsView(outlet);
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  }

  // --- Linked files: upload + link in one step ---
  const linkFileBtn = outlet.querySelector("#booking-link-file-btn");
  if (linkFileBtn) {
    linkFileBtn.addEventListener("click", () => openLinkedFileUploadSheet(b, () => openBookingDetail(outlet, b)));
  }
}

function openLinkedFileUploadSheet(booking, onSaved) {
  openSheet(`
    <div class="sheet-handle" aria-hidden="true"></div>
    <h2>${t("bookings.linkedFiles.upload")}</h2>
    <label class="btn btn-secondary">
      ${t("records.upload.chooseFile")}
      <input type="file" accept="image/*,application/pdf,.doc,.docx" id="linked-file-input" hidden />
    </label>
    <p class="error-text" id="linked-file-error" hidden></p>
    <div id="linked-file-form-holder"></div>
    <div class="form-actions"><button type="button" class="btn btn-secondary" id="linked-file-cancel">${t("common.cancel")}</button></div>
  `, (sheetEl) => {
    sheetEl.querySelector("#linked-file-cancel").addEventListener("click", closeSheet);
    sheetEl.querySelector("#linked-file-input").addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const errEl = sheetEl.querySelector("#linked-file-error");
      if (file.size > MAX_UPLOAD_BYTES) { errEl.textContent = t("records.upload.tooLarge"); errEl.hidden = false; return; }
      const dataUrl = await readFileAsDataUrl(file);
      const match = /^data:(.*?);base64,(.*)$/.exec(dataUrl);
      const defaultType = booking.type === "doctor_visit" ? "prescription" : "lab_report";
      sheetEl.querySelector("#linked-file-form-holder").innerHTML = `
        <form id="linked-file-form">
          ${formField(t("records.upload.recordTitle"), `<input class="field" name="title" required value="${escapeHtml(file.name.replace(/\.[^.]+$/, ""))}" />`)}
          ${formField(t("records.upload.type"), `<select class="field" name="type_v2">${RECORD_TYPE_V2_ORDER.map((ty) => `<option value="${ty}" ${ty === defaultType ? "selected" : ""}>${t("records.type." + ty)}</option>`).join("")}</select>`)}
          <button type="submit" class="btn btn-primary">${t("common.save")}</button>
        </form>
      `;
      sheetEl.querySelector("#linked-file-form").addEventListener("submit", async (submitEvent) => {
        submitEvent.preventDefault();
        const fd = new FormData(submitEvent.target);
        try {
          await store.call("files.upload", {
            title: fd.get("title").trim(), type: "document", type_v2: fd.get("type_v2"),
            date: formatDateInput(new Date()), filename: file.name,
            mimeType: (match && match[1]) || file.type, base64: match ? match[2] : "",
            linked_booking_id: booking.id
          });
          closeSheet();
          await onSaved();
        } catch (err) {
          errEl.textContent = err.message || t("common.error");
          errEl.hidden = false;
        }
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Reimbursement — bookings + bills across a date range, totals, CSV/print.
// ---------------------------------------------------------------------------

const reimbursementState = { bookings: [], bills: [], files: [], loading: true, dateFrom: "", dateTo: "", typeFilter: "all" };

async function renderReimbursementView(outlet) {
  reimbursementState.loading = true;
  outlet.innerHTML = genericSkeleton(5);
  const now = new Date();
  if (!reimbursementState.dateFrom) reimbursementState.dateFrom = formatDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
  if (!reimbursementState.dateTo) reimbursementState.dateTo = formatDateInput(now);
  try {
    const [bookings, bills, files] = await Promise.all([
      store.call("bookings.list", {}), store.call("bills.list", {}), store.call("files.list", {})
    ]);
    reimbursementState.bookings = bookings;
    reimbursementState.bills = bills;
    reimbursementState.files = files;
    reimbursementState.loading = false;
    renderReimbursementBody(outlet);
  } catch (err) {
    reimbursementState.loading = false;
    outlet.innerHTML = errorMarkup(err);
    attachRetryHandler(outlet, () => renderReimbursementView(outlet));
  }
}

function reimbursementRows() {
  const { dateFrom, dateTo, typeFilter } = reimbursementState;
  return reimbursementState.bookings
    .filter((b) => {
      const d = dateStrOf(b.datetime);
      if (d < dateFrom || d > dateTo) return false;
      if (typeFilter !== "all" && b.type !== typeFilter) return false;
      return true;
    })
    .map((b) => {
      const bill = reimbursementState.bills.find((x) => x.booking_id === b.id);
      const files = reimbursementState.files.filter((f) => f.linked_booking_id === b.id);
      return {
        booking: b, bill,
        hasReport: files.some((f) => f.type_v2 === "lab_report" || f.type_v2 === "scan_report"),
        hasPrescription: files.some((f) => f.type_v2 === "prescription")
      };
    })
    .sort((a, b) => String(b.booking.datetime).localeCompare(String(a.booking.datetime)));
}

function renderReimbursementBody(outlet) {
  const rows = reimbursementRows();
  const grandTotal = rows.reduce((sum, r) => sum + (r.bill && r.bill.amount ? Number(r.bill.amount) : 0), 0);
  const monthlyTotals = {};
  rows.forEach((r) => {
    const month = dateStrOf(r.booking.datetime).slice(0, 7);
    monthlyTotals[month] = (monthlyTotals[month] || 0) + (r.bill && r.bill.amount ? Number(r.bill.amount) : 0);
  });

  outlet.innerHTML = `
    <div class="card">
      <h2>${t("reimbursement.title")}</h2>
      <div class="form-actions">
        <input class="field" type="date" id="reimb-from" value="${escapeHtml(reimbursementState.dateFrom)}" />
        <input class="field" type="date" id="reimb-to" value="${escapeHtml(reimbursementState.dateTo)}" />
      </div>
      <div class="chip-row">${["all", ...BOOKING_TYPES_LIST].map((ty) => `<button type="button" class="chip ${reimbursementState.typeFilter === ty ? "chip-selected" : ""}" data-reimb-type="${ty}">${ty === "all" ? t("bookings.filter.all") : t("bookings.type." + ty)}</button>`).join("")}</div>
      <p><strong>${t("reimbursement.grandTotal", { amount: grandTotal })}</strong></p>
      ${Object.keys(monthlyTotals).sort().map((m) => `<p class="muted">${escapeHtml(m)}: ₹${monthlyTotals[m]}</p>`).join("")}
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="reimb-export-csv">${t("reimbursement.exportCsv")}</button>
        <button type="button" class="btn btn-secondary" id="reimb-print">${t("reimbursement.print")}</button>
      </div>
    </div>
    <div class="card">
      ${rows.length ? `<ul class="entity-list">${rows.map((r) => reimbursementRowMarkup(r)).join("")}</ul>` : `<p class="empty">${t("reimbursement.none")}</p>`}
    </div>
  `;

  outlet.querySelector("#reimb-from").addEventListener("change", (e) => { reimbursementState.dateFrom = e.target.value; renderReimbursementBody(outlet); });
  outlet.querySelector("#reimb-to").addEventListener("change", (e) => { reimbursementState.dateTo = e.target.value; renderReimbursementBody(outlet); });
  outlet.querySelectorAll("[data-reimb-type]").forEach((btn) => {
    btn.addEventListener("click", () => { reimbursementState.typeFilter = btn.dataset.reimbType; renderReimbursementBody(outlet); });
  });
  outlet.querySelector("#reimb-export-csv").addEventListener("click", () => exportReimbursementCsv(rows));
  outlet.querySelector("#reimb-print").addEventListener("click", () => window.print());
}

function reimbursementRowMarkup(r) {
  const b = r.booking;
  const flags = [];
  if (!r.hasReport && (b.type === "scan" || b.type === "blood_test")) flags.push(t("reimbursement.flag.noReport"));
  if (!r.bill || !r.bill.receipt_file_id) if (r.bill && r.bill.status !== "not_applicable") flags.push(t("reimbursement.flag.noReceipt"));
  return `
    <li class="entity-row">
      <div class="entity-main">
        <strong>${BOOKING_TYPE_ICON[b.type]} ${escapeHtml(b.title)} · ${escapeHtml(formatDisplayDate(dateStrOf(b.datetime)))}</strong>
        <span class="muted">${escapeHtml(b.provider || "")} ${r.bill ? "· ₹" + escapeHtml(r.bill.amount || 0) + " (" + t("bookings.bill." + r.bill.status) + ")" : ""}</span>
        ${flags.length ? `<span class="muted dose-state-amber">${flags.join(" · ")}</span>` : ""}
      </div>
    </li>
  `;
}

function exportReimbursementCsv(rows) {
  const header = ["Date", "Type", "Title", "Provider", "Amount", "Bill status", "Report", "Prescription"];
  const lines = [header.join(",")];
  rows.forEach((r) => {
    const b = r.booking;
    lines.push([
      dateStrOf(b.datetime), b.type, csvEscape(b.title), csvEscape(b.provider || ""),
      r.bill && r.bill.amount ? r.bill.amount : "", r.bill ? r.bill.status : "",
      r.hasReport ? "yes" : "no", r.hasPrescription ? "yes" : "no"
    ].join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "reimbursement.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const str = String(value || "");
  return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
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
        <p class="field-label">${t("settings.dating.title")}</p>
        <input type="hidden" name="dating_method" value="${escapeHtml(s.dating_method || "lmp")}" />
        <div class="chip-row">
          <button type="button" class="chip ${s.dating_method !== "usg" ? "chip-selected" : ""}" data-dating-method="lmp">${t("settings.dating.lmp")}</button>
          <button type="button" class="chip ${s.dating_method === "usg" ? "chip-selected" : ""}" data-dating-method="usg">${t("settings.dating.usg")}</button>
        </div>

        <div data-dating-fields="lmp" ${s.dating_method === "usg" ? "hidden" : ""}>
          ${formField(t("settings.dueDate"), `<input class="field" type="date" name="due_date" value="${escapeHtml(s.due_date)}" />`)}
          ${formField(t("settings.lmpDate"), `<input class="field" type="date" name="lmp_date" value="${escapeHtml(s.lmp_date)}" />`, t("settings.lmpHint"))}
        </div>
        <div data-dating-fields="usg" ${s.dating_method === "usg" ? "" : "hidden"}>
          ${formField(t("settings.dating.usgDate"), `<input class="field" type="date" name="usg_date" value="${escapeHtml(s.usg_date)}" />`, t("settings.dating.usgDateHint"))}
          ${formField(t("settings.dating.usgWeeks"), `<input class="field" type="number" min="0" max="45" name="usg_weeks" value="${escapeHtml(s.usg_weeks)}" />`)}
          ${formField(t("settings.dating.usgDays"), `<input class="field" type="number" min="0" max="6" name="usg_days" value="${escapeHtml(s.usg_days)}" />`)}
          ${s.dating_method === "usg" && s.due_date ? `<p class="muted">${t("settings.dating.computedDueDate", { date: formatDisplayDate(s.due_date) })}</p>` : ""}
        </div>
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
      <h2>${t("settings.medicineDetails.title")}</h2>
      <p class="muted">${t("settings.medicineDetails.hint")}</p>
      <form id="medicine-details-settings-form">
        <label class="checkbox-field">
          <input type="checkbox" name="photos_enabled" ${isTruthy(s.photos_enabled) ? "checked" : ""} />
          <span>${t("settings.medicineDetails.photos")}</span>
        </label>
        <label class="checkbox-field">
          <input type="checkbox" name="ingredients_enabled" ${isTruthy(s.ingredients_enabled) ? "checked" : ""} />
          <span>${t("settings.medicineDetails.ingredients")}</span>
        </label>
        <label class="checkbox-field">
          <input type="checkbox" name="expiry_tracking_enabled" ${isTruthy(s.expiry_tracking_enabled) ? "checked" : ""} />
          <span>${t("settings.medicineDetails.expiry")}</span>
        </label>
        ${formField(t("settings.medicineDetails.expiryAlertDays"), `<input class="field" type="number" min="1" name="expiry_alert_days" value="${escapeHtml(s.expiry_alert_days || 30)}" />`)}
        <button type="submit" class="btn btn-secondary">${t("common.save")}</button>
      </form>
    </div>

    <div class="card">
      <h2>${t("settings.account.title")}</h2>
      <p class="muted">${t("settings.account.pinInstructions")}</p>
      <button class="btn btn-secondary" id="settings-signout-btn">${t("settings.account.signOut")}</button>
    </div>

    ${
      store.isMockMode()
        ? `<div class="card"><h2>${t("settings.advanced.title")}</h2><p class="muted">${t("settings.account.mockMode")}</p></div>`
        : advancedUrlCardMarkup()
    }
  `;

  attachSettingsHandlers(outlet);
}

function advancedUrlCardMarkup() {
  const hasOverride = store.hasApiUrlOverride();
  return `
    <div class="card">
      <h2>${t("settings.advanced.title")}</h2>
      <p class="muted">${hasOverride ? t("settings.advanced.usingOverride") : t("settings.advanced.usingDefault")}</p>
      <p class="muted">${escapeHtml(store.getApiUrl())}</p>
      <form id="api-url-override-form">
        ${formField(t("settings.advanced.overrideLabel"), `<input class="field" type="text" inputmode="url" autocomplete="off" name="api_url_override" placeholder="https://script.google.com/macros/s/.../exec" value="${escapeHtml(store.getApiUrlOverride())}" />`, t("settings.advanced.overrideHint"))}
        <p class="error-text" id="api-url-override-error" hidden></p>
        <div class="form-actions">
          ${hasOverride ? `<button type="button" class="btn btn-secondary" id="api-url-reset-btn">${t("settings.advanced.resetToDefault")}</button>` : ""}
          <button type="submit" class="btn btn-primary">${t("settings.advanced.saveOverride")}</button>
        </div>
      </form>
    </div>
  `;
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

function applyDatingMethodVisibility(outlet, method) {
  outlet.querySelectorAll("[data-dating-fields]").forEach((el) => { el.hidden = el.dataset.datingFields !== method; });
}

function attachSettingsHandlers(outlet) {
  const form = outlet.querySelector("#settings-form");

  outlet.querySelectorAll("[data-dating-method]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const method = btn.dataset.datingMethod;
      outlet.querySelectorAll("[data-dating-method]").forEach((b) => b.classList.remove("chip-selected"));
      btn.classList.add("chip-selected");
      form.querySelector('input[name="dating_method"]').value = method;
      applyDatingMethodVisibility(outlet, method);
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    const payload = {};
    ["due_date", "lmp_date", "wife_name", "blood_group", "allergies", "hospital_name", "hospital_phone", "hospital_address", "insurance_info", "language", "dating_method", "usg_date", "usg_weeks", "usg_days"].forEach((key) => {
      payload[key] = (fd.get(key) || "").toString().trim();
    });
    const errEl = outlet.querySelector("#settings-form-error");
    errEl.hidden = true;
    try {
      settingsState.settings = await store.call("settings.set", payload);
      // Full re-render, not just toggling the "Saved" text in place — the
      // USG due-date preview (and the dating-method fields it's nested
      // under) only reflect what's actually stored once this redraws with
      // the fresh settingsState.settings values.
      renderSettingsBody(outlet);
      outlet.querySelector("#settings-form-success").hidden = false;
    } catch (err) {
      errEl.textContent = err.message || t("common.error");
      errEl.hidden = false;
    }
  });

  const medicineDetailsForm = outlet.querySelector("#medicine-details-settings-form");
  if (medicineDetailsForm) {
    medicineDetailsForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(medicineDetailsForm);
      try {
        settingsState.settings = await store.call("settings.set", {
          photos_enabled: fd.get("photos_enabled") === "on",
          ingredients_enabled: fd.get("ingredients_enabled") === "on",
          expiry_tracking_enabled: fd.get("expiry_tracking_enabled") === "on",
          expiry_alert_days: fd.get("expiry_alert_days") || 30
        });
        renderSettingsBody(outlet);
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  }

  outlet.querySelector("#settings-signout-btn").addEventListener("click", () => {
    if (!confirm(t("settings.account.confirmSignOut"))) return;
    // PIN only — any URL override in Settings → Advanced is independent
    // and survives signing out (it's a per-device connection setting, not
    // part of "who's signed in").
    store.stopVersionPolling();
    store.clearPin();
    state.locked = true;
    renderRoute();
  });

  const urlOverrideForm = outlet.querySelector("#api-url-override-form");
  if (urlOverrideForm) {
    urlOverrideForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const url = new FormData(urlOverrideForm).get("api_url_override").trim();
      const errEl = outlet.querySelector("#api-url-override-error");
      if (!store.isValidApiUrl(url)) {
        errEl.textContent = t("settings.advanced.invalidUrl");
        errEl.hidden = false;
        return;
      }
      store.setApiUrlOverride(url);
      renderSettingsBody(outlet);
    });
  }

  const urlResetBtn = outlet.querySelector("#api-url-reset-btn");
  if (urlResetBtn) {
    urlResetBtn.addEventListener("click", () => {
      store.clearApiUrlOverride();
      renderSettingsBody(outlet);
    });
  }

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
// Countdowns — custom countdown/timer entries. Shares store.js's bootstrap
// cache (countdowns + medicines + latest_medicine_doses all come from one
// call) rather than fetching each separately.
// ---------------------------------------------------------------------------

const COUNTDOWN_KINDS = ["event", "course", "interval", "recurring", "countup"];

const countdownsState = {
  boot: null,
  kindFilter: "",
  formItem: null, // null | "new" | existing countdown row
  refreshIntervalId: null
};

async function renderCountdownsView(outlet) {
  outlet.innerHTML = genericSkeleton(6);
  countdownsState.formItem = null;

  const paint = (boot) => {
    countdownsState.boot = boot;
    renderCountdownsBody(outlet);
  };

  try {
    const boot = await store.loadBootstrap(paint);
    paint(boot);
  } catch (err) {
    const cached = store.getCachedBootstrap();
    if (cached) {
      paint(cached);
    } else {
      outlet.innerHTML = errorMarkup(err);
      attachRetryHandler(outlet, () => renderCountdownsView(outlet));
    }
  }
}

function stopCountdownsTimers() {
  if (countdownsState.refreshIntervalId) {
    clearInterval(countdownsState.refreshIntervalId);
    countdownsState.refreshIntervalId = null;
  }
}

function renderCountdownsBody(outlet) {
  stopCountdownsTimers();
  if (!countdownsState.boot) return;

  outlet.innerHTML = countdownsState.formItem !== null
    ? countdownFormMarkup(countdownsState.formItem, countdownsState.boot.medicines || [])
    : countdownsListMarkup(countdownsState.boot);
  attachCountdownsHandlers(outlet);

  // Everything not pinned to Home still refreshes every 30s while this
  // view is open (Home's own pinned items tick every 1s instead).
  if (countdownsState.formItem === null) {
    countdownsState.refreshIntervalId = setInterval(() => {
      outlet.innerHTML = countdownsListMarkup(countdownsState.boot);
      attachCountdownsHandlers(outlet);
    }, 30000);
  }
}

function countdownsListMarkup(boot) {
  const medicinesById = indexById(boot.medicines || []);
  const lastDoseByMedicine = indexById(boot.latest_medicine_doses || [], "medicine_id");
  const now = new Date();

  let rows = boot.countdowns || [];
  if (countdownsState.kindFilter) rows = rows.filter((c) => c.kind === countdownsState.kindFilter);
  rows = [...rows].sort((a, b) => {
    const ca = computeCustomCountdown(a, countdownContext(a, medicinesById, lastDoseByMedicine), now);
    const cb = computeCustomCountdown(b, countdownContext(b, medicinesById, lastDoseByMedicine), now);
    return stateSortRank(ca.state) - stateSortRank(cb.state);
  });

  return `
    <button class="btn btn-primary" id="add-countdown-btn">${t("countdowns.add")}</button>

    <div class="tab-bar">
      <button class="tab-btn ${!countdownsState.kindFilter ? "tab-btn-active" : ""}" data-kind-filter="">${t("countdowns.filter.all")}</button>
      ${COUNTDOWN_KINDS.map((k) => `<button class="tab-btn ${countdownsState.kindFilter === k ? "tab-btn-active" : ""}" data-kind-filter="${k}">${t("countdowns.kind." + k)}</button>`).join("")}
    </div>

    <div class="card">
      ${
        rows.length
          ? `<ul class="entity-list">${rows.map((cd) => countdownRowMarkup(cd, computeCustomCountdown(cd, countdownContext(cd, medicinesById, lastDoseByMedicine), now), medicinesById[cd.linked_medicine_id])).join("")}</ul>`
          : `<p class="empty">${t("countdowns.none")}</p>`
      }
    </div>
  `;
}

function stateSortRank(state) {
  return { overdue: 0, dueSoon: 1, upcoming: 2, done: 3 }[state] ?? 2;
}

function indexById(list, key) {
  const out = {};
  (list || []).forEach((item) => { out[item[key || "id"]] = item; });
  return out;
}

function countdownContext(cd, medicinesById, lastDoseByMedicine) {
  const medicine = medicinesById[cd.linked_medicine_id];
  return {
    dosesPerDay: medicine ? numOrEmpty(medicine.doses_per_day) : null,
    lastDose: lastDoseByMedicine[cd.linked_medicine_id] || null
  };
}

function numOrEmpty(v) {
  return v === "" || v === undefined || v === null ? null : Number(v);
}

function countdownRowMarkup(cd, computed, medicine) {
  const stateLabel = t("countdowns.state." + computed.state);
  return `
    <li class="entity-row countdown-row countdown-state-${computed.state}">
      <div class="entity-main">
        <strong>${escapeHtml(cd.title)}</strong>
        <span class="muted">${t("countdowns.kind." + cd.kind)}${medicine ? " · " + escapeHtml(medicine.name) : ""}</span>
        <span class="countdown-state-badge countdown-state-${computed.state}">${stateLabel}</span>
        <span class="muted">${escapeHtml(countdownDetailLine(cd, computed))}</span>
        ${cd.show_on_home ? `<span class="badge">${t("countdowns.pinnedToHome")}</span>` : ""}
      </div>
      <div class="entity-actions">
        ${!cd.done ? `<button class="btn-link" data-mark-done-countdown="${escapeHtml(cd.id)}">${t("countdowns.markDone")}</button>` : ""}
        <button class="btn-link" data-edit-countdown="${escapeHtml(cd.id)}">${t("common.edit")}</button>
        <button class="btn-link btn-link--danger" data-delete-countdown="${escapeHtml(cd.id)}">${t("common.delete")}</button>
      </div>
    </li>
  `;
}

// One human-readable line summarizing the computed state, per kind.
function countdownDetailLine(cd, computed) {
  if (cd.done) return t("countdowns.state.done");
  switch (cd.kind) {
    case "event":
      return computed.msRemaining === null ? t("countdowns.display.noDate") : formatRemainingLabel(computed.msRemaining);
    case "course": {
      if (computed.daysLeft === null) return t("countdowns.display.noDate");
      const days = t("countdowns.display.daysLeft", { n: computed.daysLeft });
      return computed.dosesLeft !== null ? days + " · " + t("countdowns.display.dosesLeft", { n: computed.dosesLeft }) : days;
    }
    case "interval":
      return computed.msRemaining === null ? t("countdowns.display.noDoseYet") : formatRemainingLabel(computed.msRemaining);
    case "recurring":
      return computed.msRemaining === null ? t("countdowns.display.noDate") : formatRemainingLabel(computed.msRemaining);
    case "countup":
      return computed.msElapsed === null ? t("countdowns.display.noDate") : t("countdowns.display.elapsed", { text: formatMsParts(computed.msElapsed) });
    default:
      return "";
  }
}

function formatRemainingLabel(msRemaining) {
  const text = formatMsParts(msRemaining);
  return msRemaining < 0 ? t("countdowns.display.overdueBy", { text }) : t("countdowns.display.inTime", { text });
}

// "3d 4h", "4h 12m", "12m" — drops leading zero units rather than always
// showing days/hours/minutes, so a same-day countdown doesn't read "0d 4h".
function formatMsParts(ms) {
  const dur = formatDuration(ms);
  const parts = [];
  if (dur.days > 0) parts.push(dur.days + t("countdowns.unit.d"));
  if (dur.days > 0 || dur.hours > 0) parts.push(dur.hours + t("countdowns.unit.h"));
  parts.push(dur.minutes + t("countdowns.unit.m"));
  return parts.join(" ");
}

function countdownFormMarkup(item, medicines) {
  const isNew = item === "new" || !item.id;
  const cd = item === "new" ? { kind: "event", repeat: "none" } : { kind: "event", repeat: "none", ...item };

  return `
    <div class="card">
      <h2>${isNew ? t("countdowns.form.titleNew") : t("countdowns.form.titleEdit")}</h2>
      <form id="countdown-form">
        ${formField(t("countdowns.form.title"), `<input class="field" name="title" required value="${escapeHtml(cd.title)}" />`)}
        ${formField(
          t("countdowns.form.kind"),
          `<select class="field" name="kind" id="countdown-kind-select" ${!isNew ? "disabled" : ""}>
            ${COUNTDOWN_KINDS.map((k) => `<option value="${k}" ${cd.kind === k ? "selected" : ""}>${t("countdowns.kind." + k)}</option>`).join("")}
          </select>`,
          !isNew ? t("countdowns.form.kindLockedHint") : ""
        )}
        ${!isNew ? `<input type="hidden" name="kind" value="${escapeHtml(cd.kind)}" />` : ""}

        <div data-kind-fields="event,course,recurring">
          ${formField(cd.kind === "course" ? t("countdowns.form.endDatetime") : t("countdowns.form.targetDatetime"), `<input class="field" type="datetime-local" name="target_datetime" value="${escapeHtml(toDatetimeLocalValue(cd.target_datetime))}" />`)}
        </div>
        <div data-kind-fields="course,countup">
          ${formField(t("countdowns.form.startDate"), `<input class="field" type="date" name="start_date" value="${escapeHtml(dateStrOf(cd.start_date))}" />`)}
        </div>
        <div data-kind-fields="recurring">
          ${formField(
            t("countdowns.form.repeat"),
            `<select class="field" name="repeat">
              ${["none", "daily", "weekly", "monthly"].map((r) => `<option value="${r}" ${(cd.repeat || "none") === r ? "selected" : ""}>${t("countdowns.form.repeat." + r)}</option>`).join("")}
            </select>`
          )}
        </div>
        <div data-kind-fields="interval">
          ${formField(
            t("countdowns.form.linkedMedicine"),
            `<select class="field" name="linked_medicine_id">
              <option value="">${t("countdowns.form.linkedMedicine.none")}</option>
              ${medicines.map((m) => `<option value="${escapeHtml(m.id)}" ${cd.linked_medicine_id === m.id ? "selected" : ""}>${escapeHtml(m.name)}</option>`).join("")}
            </select>`
          )}
          ${formField(t("countdowns.form.intervalHours"), `<input class="field" type="number" min="0.5" step="0.5" name="interval_hours" value="${escapeHtml(cd.interval_hours)}" />`)}
        </div>
        <div data-kind-fields="course">
          ${formField(
            t("countdowns.form.linkedMedicine") + " (" + t("common.optional") + ")",
            `<select class="field" name="linked_medicine_id">
              <option value="">${t("countdowns.form.linkedMedicine.none")}</option>
              ${medicines.map((m) => `<option value="${escapeHtml(m.id)}" ${cd.linked_medicine_id === m.id ? "selected" : ""}>${escapeHtml(m.name)}</option>`).join("")}
            </select>`
          )}
        </div>

        <label class="checkbox-field">
          <input type="checkbox" name="show_on_home" ${isTruthy(cd.show_on_home) ? "checked" : ""} />
          <span>${t("countdowns.form.showOnHome")}</span>
        </label>
        ${formField(t("countdowns.form.notes"), `<textarea class="field" name="notes" rows="2">${escapeHtml(cd.notes)}</textarea>`)}

        <p class="error-text" id="countdown-form-error" hidden></p>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" id="countdown-form-cancel">${t("common.cancel")}</button>
          <button type="submit" class="btn btn-primary" id="countdown-form-save">${t("common.save")}</button>
        </div>
      </form>
    </div>
  `;
}

function applyCountdownKindVisibility(outlet, kind) {
  outlet.querySelectorAll("[data-kind-fields]").forEach((el) => {
    const kinds = el.dataset.kindFields.split(",");
    el.hidden = !kinds.includes(kind);
  });
}

function attachCountdownsHandlers(outlet) {
  const addBtn = outlet.querySelector("#add-countdown-btn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      countdownsState.formItem = "new";
      renderCountdownsBody(outlet);
    });
  }

  outlet.querySelectorAll("[data-kind-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      countdownsState.kindFilter = btn.dataset.kindFilter;
      renderCountdownsBody(outlet);
    });
  });

  outlet.querySelectorAll("[data-edit-countdown]").forEach((btn) => {
    btn.addEventListener("click", () => {
      countdownsState.formItem = (countdownsState.boot.countdowns || []).find((c) => c.id === btn.dataset.editCountdown) || "new";
      renderCountdownsBody(outlet);
    });
  });

  outlet.querySelectorAll("[data-delete-countdown]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("countdowns.confirmDelete"))) return;
      try {
        await store.call("countdowns.delete", { id: btn.dataset.deleteCountdown });
        await store.loadBootstrap(null, true);
        await renderCountdownsView(outlet);
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  });

  outlet.querySelectorAll("[data-mark-done-countdown]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await store.call("countdowns.markDone", { id: btn.dataset.markDoneCountdown });
        await store.loadBootstrap(null, true);
        await renderCountdownsView(outlet);
      } catch (err) {
        alert(err.message || t("common.error"));
      }
    });
  });

  const kindSelect = outlet.querySelector("#countdown-kind-select");
  if (kindSelect) {
    applyCountdownKindVisibility(outlet, kindSelect.value);
    kindSelect.addEventListener("change", () => applyCountdownKindVisibility(outlet, kindSelect.value));
  } else {
    const hiddenKind = outlet.querySelector('#countdown-form input[name="kind"]');
    if (hiddenKind) applyCountdownKindVisibility(outlet, hiddenKind.value);
  }

  const form = outlet.querySelector("#countdown-form");
  if (form) {
    outlet.querySelector("#countdown-form-cancel").addEventListener("click", () => {
      countdownsState.formItem = null;
      renderCountdownsBody(outlet);
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(form);
      const kind = fd.get("kind");
      const payload = { title: fd.get("title").trim(), kind, show_on_home: fd.get("show_on_home") === "on", notes: fd.get("notes").trim() };

      if (["event", "course", "recurring"].includes(kind)) {
        const localDatetime = fd.get("target_datetime");
        if (localDatetime) {
          const parsed = new Date(localDatetime);
          if (isNaN(parsed.getTime())) {
            showCountdownFormError(outlet, t("appt.form.invalidDate"));
            return;
          }
          payload.target_datetime = parsed.toISOString();
        } else {
          payload.target_datetime = "";
        }
      }
      if (["course", "countup"].includes(kind)) payload.start_date = fd.get("start_date");
      if (kind === "recurring") payload.repeat = fd.get("repeat");
      if (kind === "interval") {
        payload.linked_medicine_id = fd.get("linked_medicine_id");
        payload.interval_hours = fd.get("interval_hours");
      }
      if (kind === "course") payload.linked_medicine_id = fd.get("linked_medicine_id");

      const saveBtn = outlet.querySelector("#countdown-form-save");
      saveBtn.disabled = true;
      try {
        if (countdownsState.formItem === "new") {
          await store.call("countdowns.add", payload);
        } else {
          await store.call("countdowns.update", { id: countdownsState.formItem.id, ...payload });
        }
        await store.loadBootstrap(null, true);
        await renderCountdownsView(outlet);
      } catch (err) {
        saveBtn.disabled = false;
        showCountdownFormError(outlet, err.message || t("common.error"));
      }
    });
  }
}

function showCountdownFormError(outlet, message) {
  const errEl = outlet.querySelector("#countdown-form-error");
  if (!errEl) return;
  errEl.textContent = message;
  errEl.hidden = false;
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
      <li><button data-nav="#/countdowns">${t("more.countdowns")}</button></li>
      <li><button data-nav="#/water">${t("more.water")}</button></li>
      <li><button data-nav="#/food">${t("more.food")}</button></li>
      <li><button data-nav="#/timeline">${t("more.timeline")}</button></li>
      <li><button data-nav="#/bookings">${t("more.bookings")}</button></li>
      <li><button data-nav="#/reimbursement">${t("more.reimbursement")}</button></li>
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
