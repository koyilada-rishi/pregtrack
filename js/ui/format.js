// Shared formatting + small markup helpers used across views: escaping,
// date/currency display, loading skeletons, error cards, and the generic
// data-nav button wiring every view uses for its "back"/link buttons.

import { t } from "../core/i18n.js";

export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

export function genericSkeleton(lines) {
  return `
    <div class="card">
      ${Array.from({ length: lines })
        .map((_, i) => `<div class="skeleton skeleton-line ${i % 3 === 2 ? "skeleton-line--short" : i % 2 ? "skeleton-line--wide" : "skeleton-line--full"}"></div>`)
        .join("")}
    </div>
  `;
}

export function errorMarkup(err) {
  return `
    <div class="card">
      <p class="error-text">${escapeHtml((err && err.message) || t("common.error"))}</p>
      <button class="btn btn-secondary" id="retry-btn">${t("common.retry")}</button>
    </div>
  `;
}

export function attachRetryHandler(outlet, retryFn) {
  const btn = outlet.querySelector("#retry-btn");
  if (btn) btn.addEventListener("click", retryFn);
}

export function attachNavButtons(outlet) {
  outlet.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => { location.hash = btn.dataset.nav; });
  });
}

// Renders a labeled form field, with an optional small hint line underneath.
export function formField(label, inputHtml, hint) {
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
export function formatDateInput(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Normalizes a date-ish value (Date, ISO string, or "YYYY-MM-DD") from the
// API into a plain "YYYY-MM-DD" string for display and comparison.
export function dateStrOf(value) {
  if (!value) return "";
  if (value instanceof Date) return formatDateInput(value);
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.substring(0, 10);
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? "" : formatDateInput(parsed);
}

export function formatDisplayDate(dateStr) {
  try {
    return new Intl.DateTimeFormat("en-IN", { month: "short", day: "numeric", year: "numeric" }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

// All money in the app is ₹ via Intl en-IN — e.g. ₹1,25,000.00, Indian
// digit grouping, never $/USD. Blank/non-numeric amounts show as "" rather
// than "₹0" or "₹NaN", so an unset amount stays visibly unset.
export function formatINR(amount) {
  if (amount === "" || amount === null || amount === undefined) return "";
  const n = Number(amount);
  if (isNaN(n)) return "";
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n);
  } catch {
    return "₹" + n.toFixed(2);
  }
}
