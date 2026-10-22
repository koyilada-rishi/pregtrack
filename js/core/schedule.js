// Pregnancy Care Tracker — schedule.js
//
// Pure, network-free medicine-scheduling math: which doses are due today,
// when the next dose of an interval/PRN medicine is, how far through a
// course a medicine is, how many days of stock are left, and the due state
// of a weekly/monthly shot. Everything here takes plain data (a medicine
// row, its MedicineLog entries, the device clock) and returns plain data —
// no DOM, no fetch, no localStorage, nothing Apps-Script-specific. app.js
// owns rendering and the timers that re-call this on a schedule.
//
// All times are local device time (Asia/Kolkata in practice, but nothing
// here hardcodes that — it just uses the Date object's local getters/
// setters, same convention as js/countdown.js).
//
// An old Medicines row with no schedule_type at all is treated as 'daily'
// (effectiveScheduleType) using its existing times/frequency columns —
// this is where that documented back-compat behavior actually lives.

import { parseLocalDateOnly } from "./countdown.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

const WEEKDAY_CODES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function numOrNull(value) {
  if (value === "" || value === undefined || value === null) return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

function isTruthy(value) {
  return value === true || String(value).toUpperCase() === "TRUE";
}

// "YYYY-MM-DD" for a local Date, matching the backend's formatISODate.
export function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function combineDateAndTime(dateStr, timeStr) {
  const date = parseLocalDateOnly(dateStr);
  if (!date) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || "").trim());
  if (!match) return null;
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return date;
}

function daysBetweenLocal(fromDate, toDate) {
  const from = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const to = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

// Old rows (pre-v3) have no schedule_type — treated as 'daily'.
export function effectiveScheduleType(medicine) {
  return (medicine && medicine.schedule_type) || "daily";
}

// "08:00,13:00,18:00" -> ["08:00","13:00","18:00"], trimmed, invalid/blank
// entries dropped, order preserved.
export function parseTimesList(medicine) {
  const raw = (medicine && medicine.times) || "";
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{1,2}:\d{2}$/.test(s));
}

export function parseWeekdaysList(medicine) {
  const raw = (medicine && medicine.weekdays) || "";
  return String(raw)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => WEEKDAY_CODES.includes(s));
}

// Last day of (year, month) — e.g. clampMonthDay(2026, 1, 31) (Feb) -> 28.
export function clampMonthDay(year, month, day) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return Math.max(1, Math.min(day || 1, lastDay));
}

// Doses a medicine's own schedule implies per day — used by both course
// length estimates (when only total_doses is set, not end_date) and stock
// math. Returns null when there's no sensible per-day rate (PRN, or an
// interval medicine with no interval_hours set yet).
export function dosesPerDayForMedicine(medicine) {
  const type = effectiveScheduleType(medicine);
  if (type === "interval") {
    const hours = numOrNull(medicine.interval_hours);
    return hours && hours > 0 ? 24 / hours : null;
  }
  if (type === "weekly") return 1 / (7 * (numOrNull(medicine.every_n_weeks) || 1));
  if (type === "monthly") return 1 / 30;
  if (type === "prn") return null;
  if (type === "every_n_days") return 1 / (numOrNull(medicine.interval_days) || 1);
  const times = parseTimesList(medicine);
  if (times.length) return times.length;
  const legacy = numOrNull(medicine.doses_per_day);
  return legacy && legacy > 0 ? legacy : 1;
}

function isWithinDateRange(medicine, dateStr) {
  if (medicine.start_date && dateStr < String(medicine.start_date).substring(0, 10)) return false;
  if (medicine.end_date && dateStr > String(medicine.end_date).substring(0, 10)) return false;
  return true;
}

// Whether a daily/weekdays/every_n_days/weekly/monthly medicine has a
// scheduled slot on this calendar date at all (not yet which time-of-day —
// see slotsForDay). Always false for interval/prn, which aren't date-gated
// the same way.
export function isScheduledOnDate(medicine, dateStr) {
  const date = parseLocalDateOnly(dateStr);
  if (!date || !isWithinDateRange(medicine, dateStr)) return false;

  const type = effectiveScheduleType(medicine);
  switch (type) {
    case "daily":
      return true;
    case "weekdays":
      return parseWeekdaysList(medicine).includes(WEEKDAY_CODES[date.getDay()]);
    case "weekly":
      return parseWeekdaysList(medicine).includes(WEEKDAY_CODES[date.getDay()]);
    case "every_n_days": {
      const start = parseLocalDateOnly(medicine.start_date) || date;
      const n = numOrNull(medicine.interval_days) || 1;
      const diff = daysBetweenLocal(start, date);
      return diff >= 0 && diff % n === 0;
    }
    case "monthly": {
      const targetDay = clampMonthDay(date.getFullYear(), date.getMonth(), numOrNull(medicine.month_day) || 1);
      return date.getDate() === targetDay;
    }
    default: // interval, prn — no calendar-date gating
      return false;
  }
}

// A medicine row is "given" on a date if any of its logs that day are
// status:'taken' (or the legacy taken:true, for rows written before the
// status column existed).
function wasGivenOn(logs, dateStr) {
  return (logs || []).some((l) => String(l.date).substring(0, 10) === dateStr && (l.status === "taken" || isTruthy(l.taken)));
}

function findLogForSlot(logs, dateStr, time) {
  return (logs || []).find((l) => String(l.date).substring(0, 10) === dateStr && String(l.time) === String(time)) || null;
}

// Per-slot status for a dose that hasn't been explicitly logged yet:
// 'upcoming' (not due), 'due_now' (within the grace window), 'late' (past
// grace but still today), 'missed' (a past day, never logged).
export function dueStatus(medicine, dateStr, time, log, now) {
  if (log) {
    if (log.status === "taken" || (log.status === undefined && isTruthy(log.taken))) return "taken";
    if (log.status === "skipped") return "skipped";
    if (log.status === "missed") return "missed";
  }
  const scheduled = combineDateAndTime(dateStr, time);
  if (!scheduled) return "upcoming";
  const graceMs = (numOrNull(medicine.grace_minutes) ?? 60) * 60 * 1000;
  const diffMs = now.getTime() - scheduled.getTime();
  if (diffMs < 0) return "upcoming";
  if (diffMs <= graceMs) return "due_now";
  const todayStr = formatLocalDate(now);
  return dateStr < todayStr ? "missed" : "late";
}

// Every dose slot for a daily/weekdays/every_n_days/weekly/monthly medicine
// on one calendar date, each with its current status. Empty for
// interval/prn medicines (use nextDose/canTakeNow for those instead) or any
// date the medicine isn't scheduled on.
export function slotsForDay(medicine, dateStr, logs, now) {
  if (!isScheduledOnDate(medicine, dateStr)) return [];
  const times = parseTimesList(medicine);
  return times.map((time) => {
    const log = findLogForSlot(logs, dateStr, time);
    return { time, log, status: dueStatus(medicine, dateStr, time, log, now) };
  });
}

function latestTakenLog(logs) {
  let best = null;
  (logs || []).forEach((l) => {
    const taken = l.status === "taken" || (l.status === undefined && isTruthy(l.taken));
    if (!taken) return;
    const at = l.taken_at ? new Date(l.taken_at) : combineDateAndTime(String(l.date).substring(0, 10), l.time);
    if (!at || isNaN(at.getTime())) return;
    if (!best || at.getTime() > best.getTime()) best = at;
  });
  return best;
}

// Next dose instant for an 'interval' medicine. anchor_mode 'from_last':
// last *actually taken* instant + interval_hours (never taken yet ->
// start_date at the first configured time). anchor_mode 'fixed' (default):
// a fixed grid of times ticking off from start_date regardless of when
// doses were actually taken, so a late dose doesn't shift later ones.
export function nextDose(medicine, logs, now) {
  const intervalHours = numOrNull(medicine.interval_hours);
  if (!intervalHours || intervalHours <= 0) return null;
  const intervalMs = intervalHours * MS_PER_HOUR;

  if (medicine.anchor_mode === "from_last") {
    const last = latestTakenLog(logs);
    if (last) return new Date(last.getTime() + intervalMs);
    const start = parseLocalDateOnly(medicine.start_date);
    if (!start) return null;
    const firstTime = parseTimesList(medicine)[0] || "00:00";
    return combineDateAndTime(formatLocalDate(start), firstTime);
  }

  // Fixed grid: anchor = start_date at the first configured time, then
  // repeat every intervalMs forever. Find the next grid point at/after now.
  const start = parseLocalDateOnly(medicine.start_date);
  if (!start) return null;
  const firstTime = parseTimesList(medicine)[0] || "00:00";
  const anchor = combineDateAndTime(formatLocalDate(start), firstTime);
  if (!anchor) return null;
  const elapsedMs = now.getTime() - anchor.getTime();
  const stepsPassed = Math.floor(elapsedMs / intervalMs);
  const nextStep = elapsedMs < 0 ? 0 : stepsPassed + 1;
  return new Date(anchor.getTime() + nextStep * intervalMs);
}

// Day count / days-left for a course (anything with a start_date). Prefers
// end_date when set; otherwise estimates the course length from
// total_doses and the medicine's own per-day rate. Returns null if there's
// no start_date at all (not a course-style medicine).
export function courseProgress(medicine, now) {
  const start = parseLocalDateOnly(medicine.start_date);
  if (!start) return null;

  const today = parseLocalDateOnly(formatLocalDate(now));
  const dayOfCourse = Math.max(1, daysBetweenLocal(start, today) + 1);

  let totalDays = null;
  if (medicine.end_date) {
    const end = parseLocalDateOnly(medicine.end_date);
    if (end) totalDays = daysBetweenLocal(start, end) + 1;
  } else {
    const totalDoses = numOrNull(medicine.total_doses);
    const perDay = dosesPerDayForMedicine(medicine);
    if (totalDoses && perDay) totalDays = Math.ceil(totalDoses / perDay);
  }

  const daysLeft = totalDays !== null ? Math.max(0, totalDays - dayOfCourse + 1) : null;
  const isEnded = totalDays !== null && dayOfCourse > totalDays;
  return { dayOfCourse, totalDays, daysLeft, isEnded };
}

// Days of stock left, accounting for schedule type (weekly/monthly use a
// fractional daily rate; PRN uses a trailing-average rate since there's no
// fixed cadence to divide by). Null whenever there isn't enough information
// to give a non-misleading number — same "omit rather than guess" rule as
// js/countdown.js's computeStockCountdown.
export function stockDaysLeft(medicine, logs, now) {
  const stockCount = numOrNull(medicine.stock_count);
  if (stockCount === null) return null;

  const type = effectiveScheduleType(medicine);
  let perDay;
  if (type === "prn") {
    const cutoff = now.getTime() - 14 * MS_PER_DAY;
    const takenRecently = (logs || []).filter((l) => {
      const taken = l.status === "taken" || (l.status === undefined && isTruthy(l.taken));
      if (!taken) return false;
      const at = l.taken_at ? new Date(l.taken_at) : combineDateAndTime(String(l.date).substring(0, 10), l.time);
      return at && !isNaN(at.getTime()) && at.getTime() >= cutoff;
    });
    if (!takenRecently.length) return null;
    perDay = takenRecently.length / 14;
  } else {
    perDay = dosesPerDayForMedicine(medicine);
  }
  if (!perDay || perDay <= 0) return null;
  return stockCount / perDay;
}

// Finds the next (or, if today is scheduled and not yet given, today's)
// scheduled date for a weekly/monthly medicine, searching forward from
// today. Bounded to just over a year so a monthly medicine's worst case
// (searching for the 31st) always terminates.
function nextScheduledDateOnOrAfter(medicine, fromDate) {
  let d = new Date(fromDate.getTime());
  for (let i = 0; i < 400; i++) {
    const ds = formatLocalDate(d);
    if (isScheduledOnDate(medicine, ds)) return d;
    d = new Date(d.getTime() + MS_PER_DAY);
  }
  return null;
}

// The most recent scheduled date at or before `fromDate` (inclusive),
// searching backward — used to detect an overdue weekly/monthly shot (a
// past scheduled date that was never given).
function previousScheduledDateOnOrBefore(medicine, fromDate) {
  let d = new Date(fromDate.getTime());
  for (let i = 0; i < 400; i++) {
    const ds = formatLocalDate(d);
    if (isScheduledOnDate(medicine, ds)) return d;
    d = new Date(d.getTime() - MS_PER_DAY);
    const start = parseLocalDateOnly(medicine.start_date);
    if (start && d.getTime() < start.getTime()) return null;
  }
  return null;
}

// Due state for a weekly/monthly medicine: 'overdue' (a past scheduled date
// was never given), 'due_today', 'due_soon' (<=2 days out), or 'upcoming'.
// Next due date always comes from the SCHEDULED calendar cadence, not from
// when it was last actually given — a late shot doesn't push later ones out.
export function weeklyMonthlyDueState(medicine, logs, now) {
  const today = parseLocalDateOnly(formatLocalDate(now));
  const prev = previousScheduledDateOnOrBefore(medicine, today);
  if (prev && formatLocalDate(prev) !== formatLocalDate(today) && !wasGivenOn(logs, formatLocalDate(prev))) {
    return { state: "overdue", date: prev, daysUntil: -daysBetweenLocal(prev, today) };
  }

  const next = nextScheduledDateOnOrAfter(medicine, today);
  if (!next) return { state: "upcoming", date: null, daysUntil: null };
  const daysUntil = daysBetweenLocal(today, next);
  if (daysUntil === 0) {
    return { state: wasGivenOn(logs, formatLocalDate(next)) ? "done" : "due_today", date: next, daysUntil: 0 };
  }
  if (daysUntil <= 2) return { state: "due_soon", date: next, daysUntil };
  return { state: "upcoming", date: next, daysUntil };
}

// PRN ("as needed") gating. Never actually blocks logging — `allowed` is
// advisory, and `atLimit`/`gapRemainingMs` just tell the UI when to show an
// explicit "you've already had N today, log anyway?" confirm instead of a
// plain one-tap log.
export function canTakeNow(medicine, logs, now) {
  const minGapMs = (numOrNull(medicine.prn_min_gap_hours) || 0) * MS_PER_HOUR;
  const maxPerDay = numOrNull(medicine.prn_max_per_day);
  const todayStr = formatLocalDate(now);

  const takenToday = (logs || []).filter((l) => {
    const taken = l.status === "taken" || (l.status === undefined && isTruthy(l.taken));
    return taken && String(l.date).substring(0, 10) === todayStr;
  }).length;

  const last = latestTakenLog(logs);
  const nextAllowedAt = last && minGapMs ? new Date(last.getTime() + minGapMs) : null;
  const gapOk = !nextAllowedAt || now.getTime() >= nextAllowedAt.getTime();
  const atLimit = maxPerDay !== null && takenToday >= maxPerDay;

  return {
    allowed: gapOk && !atLimit,
    needsConfirm: !gapOk || atLimit,
    nextAllowedAt: gapOk ? null : nextAllowedAt,
    takenToday,
    maxPerDay
  };
}

// Per-member tick state for a Pack at one date+time slot, plus whether
// every member has been ticked (for a "Tick all" button's own checked
// state). memberIds: array of medicine ids; logsByMedicineId: { id: logs[] }.
export function packStatus(memberIds, logsByMedicineId, dateStr, time) {
  const memberStatuses = {};
  (memberIds || []).forEach((id) => {
    const log = findLogForSlot((logsByMedicineId && logsByMedicineId[id]) || [], dateStr, time);
    memberStatuses[id] = log ? dueStatus({}, dateStr, time, log, new Date()) : "pending";
  });
  const allTaken = (memberIds || []).length > 0 && (memberIds || []).every((id) => memberStatuses[id] === "taken");
  return { memberStatuses, allTaken };
}

// Morning/Afternoon/Evening/Night bucket for a "HH:MM" time — used to
// group Home's "Today's medicines" card the way the UI spec asks for.
export function timeOfDayBucket(hhmm) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!match) return "morning";
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (minutes >= 4 * 60 && minutes < 12 * 60) return "morning";
  if (minutes >= 12 * 60 && minutes < 17 * 60) return "afternoon";
  if (minutes >= 17 * 60 && minutes < 21 * 60) return "evening";
  return "night";
}
