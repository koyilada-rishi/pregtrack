// Pregnancy Care Tracker — countdown.js
//
// Pure, network-free countdown math: weeks+days pregnant, days/hours/
// minutes/seconds to the due date, trimester, and a reusable duration
// formatter for "time to next appointment". Everything here takes a
// Date (the device clock, injected as a parameter so it stays testable)
// and returns plain data — no DOM, no fetch, no localStorage. app.js owns
// the 1s/30s timers that call into this and update the Home screen.

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
