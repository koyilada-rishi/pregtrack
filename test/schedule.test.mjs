// Standalone Node test for js/schedule.js — no DOM, no network, no Apps
// Script runtime needed, since the module itself has none of those
// dependencies. Run with: node test/schedule.test.mjs
import * as schedule from "../js/core/schedule.js";

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log("ok   " + label); }
  else { fail++; console.error("FAIL " + label); }
}

const {
  formatLocalDate, effectiveScheduleType, parseTimesList, parseWeekdaysList, clampMonthDay,
  dosesPerDayForMedicine, isScheduledOnDate, dueStatus, slotsForDay, nextDose, courseProgress,
  stockDaysLeft, weeklyMonthlyDueState, canTakeNow, packStatus, timeOfDayBucket
} = schedule;

// --- basics ---

check("effectiveScheduleType defaults a schedule_type-less row to daily", effectiveScheduleType({}) === "daily");
check("effectiveScheduleType respects an explicit schedule_type", effectiveScheduleType({ schedule_type: "weekly" }) === "weekly");
check("parseTimesList splits and trims", JSON.stringify(parseTimesList({ times: " 08:00, 13:00 ,20:00" })) === JSON.stringify(["08:00", "13:00", "20:00"]));
check("parseTimesList drops garbage entries", JSON.stringify(parseTimesList({ times: "08:00,not-a-time," })) === JSON.stringify(["08:00"]));
check("parseWeekdaysList lowercases and filters", JSON.stringify(parseWeekdaysList({ weekdays: "Mon, thu, bogus" })) === JSON.stringify(["mon", "thu"]));
check("clampMonthDay clamps 31 to 28 in a non-leap February", clampMonthDay(2026, 1, 31) === 28);
check("clampMonthDay clamps 31 to 29 in a leap February", clampMonthDay(2028, 1, 31) === 29);
check("clampMonthDay leaves a valid day alone", clampMonthDay(2026, 0, 15) === 15);

// --- zero/missing values: nothing here should throw or produce NaN ---

check("dosesPerDayForMedicine({}) defaults to 1 (daily, no times set)", dosesPerDayForMedicine({}) === 1);
check("isScheduledOnDate({}) treats a blank row as daily (scheduled every day), not a crash", isScheduledOnDate({}, "2026-10-19") === true);
check("nextDose with no interval_hours returns null", nextDose({}, [], new Date(2026, 9, 19)) === null);
check("courseProgress with no start_date returns null", courseProgress({}, new Date(2026, 9, 19)) === null);
check("stockDaysLeft with no stock_count returns null", stockDaysLeft({}, [], new Date(2026, 9, 19)) === null);
check("dueStatus with a blank time doesn't throw", dueStatus({}, "2026-10-19", "", null, new Date(2026, 9, 19)) === "upcoming");

// --- 1. every 8h from 06:00, taken late at 15:10 -> next 23:10 (from_last) ---

{
  const med = { schedule_type: "interval", anchor_mode: "from_last", interval_hours: 8, start_date: "2026-10-19", times: "06:00" };
  const logs = [{ medicine_id: "m1", date: "2026-10-19", time: "06:00", status: "taken", taken_at: new Date(2026, 9, 19, 15, 10) }];
  const now = new Date(2026, 9, 19, 16, 0);
  const next = nextDose(med, logs, now);
  check("from_last: next dose is last taken (15:10) + 8h = 23:10", next && next.getHours() === 23 && next.getMinutes() === 10);
}

// from_last, never taken yet -> start_date at the first configured time.
{
  const med = { schedule_type: "interval", anchor_mode: "from_last", interval_hours: 8, start_date: "2026-10-19", times: "06:00" };
  const next = nextDose(med, [], new Date(2026, 9, 19, 7, 0));
  check("from_last with no prior dose anchors to start_date's first time", next && next.getHours() === 6 && next.getMinutes() === 0 && next.getDate() === 19);
}

// anchor_mode 'fixed': a late dose does NOT shift the grid.
{
  const med = { schedule_type: "interval", anchor_mode: "fixed", interval_hours: 8, start_date: "2026-10-19", times: "06:00" };
  const logs = [{ medicine_id: "m1", date: "2026-10-19", time: "06:00", status: "taken", taken_at: new Date(2026, 9, 19, 15, 10) }];
  const next = nextDose(med, logs, new Date(2026, 9, 19, 16, 0));
  check("fixed grid: next slot is 22:00 (06:00 + 2*8h), unaffected by the late 15:10 dose", next && next.getHours() === 22 && next.getMinutes() === 0);
}

// --- 2. Mon/Thu, 10-day course ---

{
  // Find a real Monday deterministically rather than hardcoding a date.
  let monday = new Date(2026, 9, 1);
  while (monday.getDay() !== 1) monday = new Date(monday.getTime() + 24 * 60 * 60 * 1000);
  const mondayStr = formatLocalDate(monday);
  const endDate = new Date(monday.getTime() + 9 * 24 * 60 * 60 * 1000); // 10-day course inclusive
  const med = { schedule_type: "weekdays", weekdays: "mon,thu", start_date: mondayStr, end_date: formatLocalDate(endDate), times: "09:00" };

  check("weekdays: scheduled on the Monday itself", isScheduledOnDate(med, mondayStr) === true);
  const tuesday = formatLocalDate(new Date(monday.getTime() + 24 * 60 * 60 * 1000));
  check("weekdays: NOT scheduled on the Tuesday", isScheduledOnDate(med, tuesday) === false);
  const thursday = formatLocalDate(new Date(monday.getTime() + 3 * 24 * 60 * 60 * 1000));
  check("weekdays: scheduled on the Thursday", isScheduledOnDate(med, thursday) === true);

  const progress = courseProgress(med, new Date(thursday + "T12:00:00".slice(0, 0)) || new Date(monday.getTime() + 3 * 24 * 60 * 60 * 1000));
  check("weekdays course: dayOfCourse counts every calendar day, not just scheduled ones", progress.dayOfCourse === 4);
  check("weekdays course: totalDays comes from end_date (10 inclusive days)", progress.totalDays === 10);
}

// --- 3. weekly shot on Sundays ---

{
  let wednesday = new Date(2026, 9, 1);
  while (wednesday.getDay() !== 3) wednesday = new Date(wednesday.getTime() + 24 * 60 * 60 * 1000);
  // Starts today (as a real medicine row always has a start_date — the
  // backend defaults it to the creation day) so there's no prior Sunday
  // before the medicine even existed for "overdue" to misfire on.
  const med = { schedule_type: "weekly", weekdays: "sun", times: "10:00", start_date: formatLocalDate(wednesday) };

  const state = weeklyMonthlyDueState(med, [], wednesday);
  check("weekly Sunday shot from a Wednesday: next due date is a Sunday", state.date && state.date.getDay() === 0);
  check("weekly Sunday shot from a Wednesday: due_soon or upcoming, never overdue with no prior history", state.state !== "overdue");
}

// --- 4. monthly on the 31st in a short month ---

{
  const med = { schedule_type: "monthly", month_day: 31, times: "09:00" };
  check("monthly-on-31st is scheduled on Feb 28 in a non-leap year", isScheduledOnDate(med, "2026-02-28") === true);
  check("monthly-on-31st is scheduled on Jan 31", isScheduledOnDate(med, "2026-01-31") === true);
  check("monthly-on-31st is NOT scheduled on Jan 30", isScheduledOnDate(med, "2026-01-30") === false);
  check("monthly-on-31st is scheduled on Apr 30 (Apr has no 31st)", isScheduledOnDate(med, "2026-04-30") === true);
}

// --- 5. 14-day antibiotic day count ---

{
  const med = { schedule_type: "daily", start_date: "2026-10-01", end_date: "2026-10-14", times: "08:00,20:00" };
  const progress = courseProgress(med, new Date(2026, 9, 4));
  check("14-day course: Day 4 of 14", progress.dayOfCourse === 4 && progress.totalDays === 14);
  check("14-day course: 11 days left (today counts as remaining)", progress.daysLeft === 11);
  check("14-day course: not ended on day 4", progress.isEnded === false);
}

// --- 6. PRN 6h gap and max 3/day ---

{
  const med = { schedule_type: "prn", prn_min_gap_hours: 6, prn_max_per_day: 3 };
  const today = "2026-10-19";
  const logs = [
    { medicine_id: "p1", date: today, time: "08:00", status: "taken", taken_at: new Date(2026, 9, 19, 8, 0) },
    { medicine_id: "p1", date: today, time: "14:00", status: "taken", taken_at: new Date(2026, 9, 19, 14, 0) }
  ];
  const soonAfter = canTakeNow(med, logs, new Date(2026, 9, 19, 15, 0)); // 1h after last dose, gap not satisfied
  check("PRN: blocked by the 6h gap just 1h after the last dose", soonAfter.allowed === false && soonAfter.needsConfirm === true);

  const afterGap = canTakeNow(med, logs, new Date(2026, 9, 19, 20, 1)); // >6h after 14:00
  check("PRN: allowed again once the 6h gap has passed (2 taken today, under the cap)", afterGap.allowed === true);

  const thirdLog = [...logs, { medicine_id: "p1", date: today, time: "20:30", status: "taken", taken_at: new Date(2026, 9, 19, 20, 30) }];
  const atCap = canTakeNow(med, thirdLog, new Date(2026, 9, 19, 23, 0)); // gap satisfied, but 3/3 already taken today
  check("PRN: at the daily cap needs a confirm, but is NOT force-blocked", atCap.needsConfirm === true && atCap.allowed === false);
  check("PRN: reports today's count and the configured cap for the confirm copy", atCap.takenToday === 3 && atCap.maxPerDay === 3);
}

// --- 7. course ending mid-week ---

{
  const med = { schedule_type: "daily", start_date: "2026-10-12", end_date: "2026-10-16", times: "09:00" }; // Mon-Fri
  const lastDay = courseProgress(med, new Date(2026, 9, 16));
  check("course ending mid-week: not ended on its last day", lastDay.isEnded === false && lastDay.daysLeft === 1);
  const dayAfter = courseProgress(med, new Date(2026, 9, 17));
  check("course ending mid-week: ended the day after end_date", dayAfter.isEnded === true && dayAfter.daysLeft === 0);
}

// --- 8. multiple doses in a day ---

{
  const med = { schedule_type: "daily", start_date: "2026-10-01", times: "08:00,14:00,20:00", grace_minutes: 60 };
  const logs = [{ medicine_id: "m1", date: "2026-10-19", time: "08:00", status: "taken", taken_at: new Date(2026, 9, 19, 8, 5) }];
  const slots = slotsForDay(med, "2026-10-19", logs, new Date(2026, 9, 19, 14, 10));
  check("multiple doses: 3 slots for the day", slots.length === 3);
  check("multiple doses: 08:00 shows taken", slots[0].status === "taken");
  check("multiple doses: 14:00 (just now, within grace) shows due_now", slots[1].status === "due_now");
  check("multiple doses: 20:00 (hours away) shows upcoming", slots[2].status === "upcoming");
}

// A dose well past its grace window, still today, is 'late'; the same slot
// on a past day with no log is 'missed'.
{
  const med = { schedule_type: "daily", start_date: "2026-10-01", times: "08:00", grace_minutes: 60 };
  const lateToday = dueStatus(med, "2026-10-19", "08:00", null, new Date(2026, 9, 19, 11, 0));
  check("dueStatus: 3h past a 60-minute grace window, still today, is late", lateToday === "late");
  const missedYesterday = dueStatus(med, "2026-10-18", "08:00", null, new Date(2026, 9, 19, 11, 0));
  check("dueStatus: an unlogged slot from a past day is missed", missedYesterday === "missed");
}

// --- 9. device clock change (clock rolled backward relative to data) ---

{
  const med = { schedule_type: "interval", anchor_mode: "from_last", interval_hours: 8, start_date: "2026-10-19", times: "06:00" };
  const logs = [{ medicine_id: "m1", date: "2026-10-19", time: "06:00", status: "taken", taken_at: new Date(2026, 9, 19, 15, 10) }];
  const past = nextDose(med, logs, new Date(2020, 0, 1)); // "now" far before the logged dose
  check("clock rolled back: from_last still returns the anchor-based instant, no crash/NaN", past && !isNaN(past.getTime()) && past.getHours() === 23);

  const weeklyMed = { schedule_type: "weekly", weekdays: "sun" };
  const stateFarFuture = weeklyMonthlyDueState(weeklyMed, [], new Date(2099, 0, 1));
  check("weekly due-state with a far-future now doesn't throw or hang", stateFarFuture && stateFarFuture.date instanceof Date);
}

// --- 10. stock days left: daily, weekly, monthly, PRN average, interval ---

check("stockDaysLeft: daily with 2x/day times, 10 in stock -> 5 days", stockDaysLeft({ stock_count: 10, times: "08:00,20:00" }, [], new Date()) === 5);
check("stockDaysLeft: weekly shot, 4 in stock -> 28 days", stockDaysLeft({ schedule_type: "weekly", stock_count: 4 }, [], new Date()) === 28);
check("stockDaysLeft: monthly, 2 in stock -> 60 days", stockDaysLeft({ schedule_type: "monthly", stock_count: 2 }, [], new Date()) === 60);
check("stockDaysLeft: interval every 8h, 9 in stock -> 3 days", stockDaysLeft({ schedule_type: "interval", interval_hours: 8, stock_count: 9 }, [], new Date()) === 3);
{
  const prnLogs = [1, 2, 3, 4].map((d) => ({ status: "taken", taken_at: new Date(2026, 9, 19 - d, 9, 0) })); // 4 doses over the last 14 days
  const days = stockDaysLeft({ schedule_type: "prn", stock_count: 7 }, prnLogs, new Date(2026, 9, 19));
  check("stockDaysLeft: PRN uses a trailing 14-day average rate", Math.abs(days - 7 / (4 / 14)) < 0.001);
}
check("stockDaysLeft: PRN with no recent doses is null, not a guess", stockDaysLeft({ schedule_type: "prn", stock_count: 7 }, [], new Date()) === null);

// --- 11. pack tick-all and single-untick ---

{
  const date = "2026-10-19", time = "20:00";
  const allTakenLogs = {
    a: [{ date, time, status: "taken" }],
    b: [{ date, time, status: "taken" }]
  };
  const allTaken = packStatus(["a", "b"], allTakenLogs, date, time);
  check("pack: tick-all state when every member is taken", allTaken.allTaken === true);

  const oneUntickedLogs = { a: [{ date, time, status: "taken" }], b: [] };
  const oneUnticked = packStatus(["a", "b"], oneUntickedLogs, date, time);
  check("pack: single-untick breaks allTaken", oneUnticked.allTaken === false);
  check("pack: untouched member still correctly taken", oneUnticked.memberStatuses.a === "taken");
  check("pack: unticked member shows pending", oneUnticked.memberStatuses.b === "pending");
}

// --- timeOfDayBucket ---

check("timeOfDayBucket: 07:30 is morning", timeOfDayBucket("07:30") === "morning");
check("timeOfDayBucket: 13:00 is afternoon", timeOfDayBucket("13:00") === "afternoon");
check("timeOfDayBucket: 18:30 is evening", timeOfDayBucket("18:30") === "evening");
check("timeOfDayBucket: 23:00 is night", timeOfDayBucket("23:00") === "night");
check("timeOfDayBucket: 02:00 is night", timeOfDayBucket("02:00") === "night");

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
