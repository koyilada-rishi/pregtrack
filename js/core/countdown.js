// Pregnancy Care Tracker — countdown.js
//
// Pure, network-free countdown math: weeks+days pregnant, days/hours/
// minutes/seconds to the due date, trimester, a reusable duration
// formatter, and the custom-countdown kinds (event/course/interval/
// recurring/countup) plus per-medicine stock math. Everything here takes a
// Date (the device clock, injected as a parameter so it stays testable)
// and returns plain data — no DOM, no fetch, no localStorage. app.js owns
// the 1s/30s timers that call into this and update the Home/Meds/
// Countdowns screens.
//
// Daily/weekly/monthly rollover (nextRecurringOccurrence) deliberately uses
// calendar-based Date methods (setDate/setMonth), not raw millisecond
// addition — that's what keeps it correct across a DST transition in a
// timezone that has one (a calendar day isn't always 24h there). Asia/
// Kolkata itself has no DST, so this app never actually exercises that
// edge, but the math doesn't assume otherwise.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

// Parses a "YYYY-MM-DD" string as a local-midnight Date (not UTC — a plain
// date string should mean the same calendar day regardless of the device's
// timezone, which `new Date("YYYY-MM-DD")` does NOT guarantee since that
// form is parsed as UTC midnight).
export function parseLocalDateOnly(str) {
  if (!str) return null;
  const parts = String(str).substring(0, 10).split("-");
  if (parts.length !== 3) return null;
  const y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return isNaN(date.getTime()) ? null : date;
}

// {weeks, days, trimester, dueDate, msToDueDate, isOverdue} or null if
// neither a due date nor an LMP is set. msToDueDate is signed (negative
// once overdue) and ms-precise, for the seconds-level ticking display.
export function computeCountdown(settings, now) {
  const due = parseLocalDateOnly(settings && settings.due_date);
  let lmp = parseLocalDateOnly(settings && settings.lmp_date);
  if (!lmp && due) {
    lmp = new Date(due.getTime() - 280 * MS_PER_DAY); // 40 weeks before the due date
  }
  if (!lmp) return null;

  const daysSinceLmp = Math.max(0, Math.floor((now.getTime() - lmp.getTime()) / MS_PER_DAY));
  const msToDueDate = due ? due.getTime() - now.getTime() : null;

  return {
    weeks: Math.floor(daysSinceLmp / 7),
    days: daysSinceLmp % 7,
    trimester: daysSinceLmp < 13 * 7 ? 1 : daysSinceLmp < 28 * 7 ? 2 : 3,
    dueDate: due,
    msToDueDate,
    isOverdue: msToDueDate !== null && msToDueDate < 0
  };
}

// Breaks an absolute duration (ms) into {days, hours, minutes, seconds,
// totalMs}. Always non-negative — callers track the sign (overdue vs.
// upcoming) themselves via isOverdue / their own comparison, since "4 days
// overdue" and "4 days to go" share the same magnitude formatting.
export function formatDuration(ms) {
  const abs = Math.abs(ms);
  const days = Math.floor(abs / MS_PER_DAY);
  const hours = Math.floor((abs % MS_PER_DAY) / MS_PER_HOUR);
  const minutes = Math.floor((abs % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds = Math.floor((abs % MS_PER_MINUTE) / 1000);
  return { days, hours, minutes, seconds, totalMs: abs };
}

// For "time to next appointment" / any other future-timestamp countdown —
// same shape as computeCountdown's duration half, standalone.
export function msUntil(isoOrDate, now) {
  const target = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (isNaN(target.getTime())) return null;
  return target.getTime() - now.getTime();
}

// True if a medicine's scheduled "HH:MM" time today has already passed —
// used to visually flag overdue (vs. simply upcoming-today) doses. Pure
// string/number comparison against the device clock's current time, no
// date parsing needed since both are "today".
export function isTimePastToday(hhmm, now) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!match) return false;
  const scheduledMinutes = Number(match[1]) * 60 + Number(match[2]);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes > scheduledMinutes;
}

// ---------------------------------------------------------------------------
// Custom countdowns (event / course / interval / recurring / countup) and
// per-medicine stock math.
// ---------------------------------------------------------------------------

const DUE_SOON_WINDOW_MS = MS_PER_DAY; // "due soon" = within 24h

// Shared color-coding classifier: 'done' | 'overdue' | 'dueSoon' | 'upcoming'.
// msRemaining may be null (not enough data to compute a time) — treated as
// 'upcoming' rather than erroring, so an incomplete row still renders.
export function classifyCountdownState(msRemaining, done) {
  if (done) return "done";
  if (msRemaining === null || msRemaining === undefined || isNaN(msRemaining)) return "upcoming";
  if (msRemaining < 0) return "overdue";
  if (msRemaining <= DUE_SOON_WINDOW_MS) return "dueSoon";
  return "upcoming";
}

export function isCountdownDone(countdown) {
  return countdown.done === true || String(countdown.done).toUpperCase() === "TRUE";
}

function toDateOrNull(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function numOrNull(value) {
  if (value === "" || value === undefined || value === null) return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

// kind: "event" — a single target_datetime.
export function computeEventCountdown(countdown, now) {
  const target = toDateOrNull(countdown.target_datetime);
  const msRemaining = target ? target.getTime() - now.getTime() : null;
  return { state: classifyCountdownState(msRemaining, isCountdownDone(countdown)), msRemaining, target };
}

// kind: "course" — start_date through target_datetime (the course's end).
// dosesPerDay is optional context (typically the linked medicine's
// doses_per_day, looked up by the caller) — when known, estimates doses
// left as ceil(daysLeft * dosesPerDay); otherwise just the day count.
export function computeCourseCountdown(countdown, dosesPerDay, now) {
  const end = toDateOrNull(countdown.target_datetime);
  const msRemaining = end ? end.getTime() - now.getTime() : null;
  const daysLeft = msRemaining !== null ? Math.ceil(msRemaining / MS_PER_DAY) : null;
  const dosesLeft = daysLeft !== null && daysLeft > 0 && dosesPerDay ? Math.ceil(daysLeft * dosesPerDay) : null;
  return { state: classifyCountdownState(msRemaining, isCountdownDone(countdown)), msRemaining, daysLeft, dosesLeft };
}

// Per-medicine stock math (not a Countdowns kind — shown directly in the
// Medicines view for any medicine with stock tracking filled in). Returns
// null if stock isn't tracked for this medicine (stock_count or
// doses_per_day missing), so the view can just omit the figure rather than
// show a misleading "0 days left".
export function computeStockCountdown(medicine) {
  const stockCount = numOrNull(medicine.stock_count);
  const dosesPerDay = numOrNull(medicine.doses_per_day);
  if (stockCount === null || !dosesPerDay || dosesPerDay <= 0) return null;

  const refillAlertDays = numOrNull(medicine.refill_alert_days);
  const alertThreshold = refillAlertDays === null ? 3 : refillAlertDays;
  const daysLeft = stockCount / dosesPerDay;

  return {
    daysLeft,
    needsRefill: daysLeft <= alertThreshold,
    outOfStock: stockCount <= 0
  };
}

// kind: "interval" — next dose = the medicine's last *taken* dose + the
// countdown's interval_hours. lastDose is {date, time} (e.g. from
// bootstrap's latest_medicine_doses) or null/undefined if the medicine has
// never been logged — in that case there's nothing to anchor to yet, so
// this returns a null-state result rather than guessing.
export function computeIntervalCountdown(countdown, lastDose, now) {
  const intervalMs = Number(countdown.interval_hours || 0) * MS_PER_HOUR;
  const anchor = lastDose && lastDose.date ? combineDateAndTime(lastDose.date, lastDose.time) : null;

  if (!anchor || !intervalMs) {
    return { state: "upcoming", msRemaining: null, nextDose: null };
  }

  const nextDose = new Date(anchor.getTime() + intervalMs);
  const msRemaining = nextDose.getTime() - now.getTime();
  return { state: classifyCountdownState(msRemaining, false), msRemaining, nextDose };
}

function combineDateAndTime(dateStr, timeStr) {
  const date = parseLocalDateOnly(dateStr);
  if (!date) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || "").trim());
  if (match) date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return date;
}

// kind: "recurring" — an anchor target_datetime that repeats daily/weekly/
// monthly, rolled forward to the next occurrence at or after `now`.
// Exported standalone (not just via computeRecurringCountdown) because it's
// the one piece of this file worth testing in real isolation — the rollover
// logic, not the wrapping/classification around it.
export function nextRecurringOccurrence(anchor, repeat, now) {
  if (!anchor) return null;
  let next = new Date(anchor.getTime());
  if (!["daily", "weekly", "monthly"].includes(repeat)) return next; // 'none'/unrecognized: don't loop

  // Bounded: each step moves `next` strictly forward by a fixed positive
  // amount and `now` is fixed, so this always terminates.
  while (next.getTime() <= now.getTime()) {
    if (repeat === "daily") next.setDate(next.getDate() + 1);
    else if (repeat === "weekly") next.setDate(next.getDate() + 7);
    else next.setMonth(next.getMonth() + 1); // monthly
  }
  return next;
}

export function computeRecurringCountdown(countdown, now) {
  const anchor = toDateOrNull(countdown.target_datetime);
  if (!anchor) return { state: "upcoming", msRemaining: null, nextOccurrence: null };

  const next = nextRecurringOccurrence(anchor, countdown.repeat, now);
  const msRemaining = next.getTime() - now.getTime();
  return { state: classifyCountdownState(msRemaining, isCountdownDone(countdown)), msRemaining, nextOccurrence: next };
}

// kind: "countup" — elapsed time since start_date (local midnight). Always
// "counting up", so there's no overdue/dueSoon state, just done or not.
export function computeCountupCountdown(countdown, now) {
  const start = parseLocalDateOnly(countdown.start_date);
  const msElapsed = start ? now.getTime() - start.getTime() : null;
  return { state: isCountdownDone(countdown) ? "done" : "upcoming", msElapsed };
}

// Single entry point app.js actually calls — dispatches by countdown.kind.
// context: { dosesPerDay, lastDose } — both optional, only relevant to
// course/interval respectively; the caller looks these up (e.g. from the
// linked medicine and bootstrap's latest_medicine_doses) since this module
// has no data access of its own.
export function computeCustomCountdown(countdown, context, now) {
  context = context || {};
  switch (countdown.kind) {
    case "event":
      return computeEventCountdown(countdown, now);
    case "course":
      return computeCourseCountdown(countdown, context.dosesPerDay, now);
    case "interval":
      return computeIntervalCountdown(countdown, context.lastDose, now);
    case "recurring":
      return computeRecurringCountdown(countdown, now);
    case "countup":
      return computeCountupCountdown(countdown, now);
    default:
      return { state: "upcoming", msRemaining: null };
  }
}
