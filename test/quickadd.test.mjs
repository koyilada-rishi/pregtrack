// Standalone Node test for js/quickadd.js — the Quick Add natural-language
// parser. No DOM, no network. Run with: node test/quickadd.test.mjs
import { parseQuickAdd, parseRelativeDate, parseClockTime, parseVagueTime, parseDuration } from "../js/quickadd.js";
import { formatLocalDate } from "../js/schedule.js";

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log("ok   " + label); }
  else { fail++; console.error("FAIL " + label); }
}

// Fixed reference "now": 2026-10-19, 09:00, whatever weekday that happens
// to be — every weekday-name test below finds the real next occurrence
// programmatically rather than assuming which day of the week this is.
const NOW = new Date(2026, 9, 19, 9, 0);

function nextOccurrenceOf(targetDow, now) {
  let d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  do { d = new Date(d.getTime() + 86400000); } while (d.getDay() !== targetDow);
  return d;
}

const addDaysTo = (date, n) => formatLocalDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + n));

// --- Group A: relative dates ---

check("'today'", parseRelativeDate("today", NOW).value === formatLocalDate(NOW));
check("'tomorrow'", parseRelativeDate("tomorrow", NOW).value === addDaysTo(NOW, 1));
check("'day after tomorrow'", parseRelativeDate("day after tomorrow", NOW).value === addDaysTo(NOW, 2));
check("'yesterday'", parseRelativeDate("yesterday", NOW).value === addDaysTo(NOW, -1));
{
  const thursday = nextOccurrenceOf(4, NOW);
  check("bare weekday name ('Thursday') finds the next real Thursday", parseRelativeDate("Thursday", NOW).value === formatLocalDate(thursday));
}
{
  const monday = nextOccurrenceOf(1, NOW);
  check("'next monday' finds the next real Monday", parseRelativeDate("next monday", NOW).value === formatLocalDate(monday));
}
check("'next week' (no weekday) is +7 days", parseRelativeDate("next week", NOW).value === addDaysTo(NOW, 7));
check("'Tomorrow Morning' date part still matches case-insensitively", parseRelativeDate("Tomorrow Morning", NOW).value === addDaysTo(NOW, 1));
{
  const monday = nextOccurrenceOf(1, NOW);
  check("weekday abbreviation ('mon') works", parseRelativeDate("mon appointment", NOW).value === formatLocalDate(monday));
}
check("no date mentioned returns null", parseRelativeDate("take folic acid", NOW) === null);

// --- Group B: clock times ---

check("'5pm'", parseClockTime("appointment at 5pm").value === "17:00");
check("'5:30pm'", parseClockTime("5:30pm").value === "17:30");
check("'5.30pm'", parseClockTime("5.30pm").value === "17:30");
check("'11am'", parseClockTime("11am").value === "11:00");
check("'noon'", parseClockTime("meet at noon").value === "12:00");
check("'midnight'", parseClockTime("midnight").value === "00:00");
check("bare 24h '17:00'", parseClockTime("17:00").value === "17:00");
check("no time mentioned returns null", parseClockTime("take folic acid tomorrow") === null);

// --- Group C: vague time-of-day ---

check("'morning' -> 08:00, flagged vague", parseVagueTime("morning").value === "08:00");
check("'afternoon' -> 13:00", parseVagueTime("afternoon").value === "13:00");
check("'evening' -> 18:00", parseVagueTime("evening").value === "18:00");
check("'night'/'tonight' -> 21:00", parseVagueTime("night").value === "21:00" && parseVagueTime("tonight").value === "21:00");

// --- Group D: durations ---

check("'for 5 days'", parseDuration("for 5 days").value === 5);
check("'for a week'", parseDuration("for a week").value === 7);
check("'for 2 weeks'", parseDuration("for 2 weeks").value === 14);
check("'for ten days'", parseDuration("for ten days").value === 10);

// --- Group E: booking intent ---

{
  const thursday = nextOccurrenceOf(4, NOW);
  const r = parseQuickAdd("appointment Thursday 5pm", NOW);
  check("'appointment Thursday 5pm' -> booking/doctor_visit", r.intent === "booking" && r.fields.type === "doctor_visit");
  check("'appointment Thursday 5pm' -> correct date+time", r.date === formatLocalDate(thursday) && r.time === "17:00");
}
check("'scan next monday' -> booking/scan", parseQuickAdd("scan next monday", NOW).fields.type === "scan");
{
  const r = parseQuickAdd("blood test tomorrow morning", NOW);
  check("'blood test tomorrow morning' -> booking/blood_test, vague morning time", r.intent === "booking" && r.fields.type === "blood_test" && r.time === "08:00" && r.timeIsVague === true);
}
check("'vaccine shot next week' -> booking/vaccine", parseQuickAdd("vaccine shot next week", NOW).fields.type === "vaccine");
check("'doctor checkup on friday' -> booking/doctor_visit", parseQuickAdd("doctor checkup on friday", NOW).fields.type === "doctor_visit");

// --- Group F: medicine intent ---

{
  const r = parseQuickAdd("start Pantop tomorrow", NOW);
  check("'start Pantop tomorrow' -> medicine, name mentions Pantop", r.intent === "medicine" && r.fields.name.toLowerCase().includes("pantop"));
  check("'start Pantop tomorrow' -> startDate is tomorrow", r.fields.startDate === addDaysTo(NOW, 1));
  check("'start Pantop tomorrow' -> no duration typed, no end date invented", r.fields.endDate === null);
}
{
  const r = parseQuickAdd("take Pantop 8pm", NOW);
  check("'take Pantop 8pm' -> medicine with times=20:00", r.intent === "medicine" && r.fields.times === "20:00" && r.fields.name.toLowerCase().includes("pantop"));
}
{
  const r = parseQuickAdd("start iron tablet for 5 days", NOW);
  check("'start iron tablet for 5 days' -> medicine, 5-day end date computed", r.intent === "medicine" && r.fields.endDate === addDaysTo(NOW, 4));
}
check("'stop crocin' -> medicine, name mentions Crocin", parseQuickAdd("stop crocin", NOW).fields.name.toLowerCase().includes("crocin"));
check("'take folic acid' -> medicine, no date typed, no start date invented beyond today", parseQuickAdd("take folic acid", NOW).fields.startDate === formatLocalDate(NOW));

// --- Group G: question for the doctor ---

check("'remember to ask about the glucose test results' -> question", parseQuickAdd("remember to ask about the glucose test results", NOW).intent === "question");
check("'ask the doctor about diet' -> question", parseQuickAdd("ask the doctor about diet", NOW).intent === "question");
check("'remember to ask about delivery date' -> question", parseQuickAdd("remember to ask about delivery date", NOW).intent === "question");

// --- Group H: symptom intent ---

{
  const r = parseQuickAdd("nausea in the morning", NOW);
  check("'nausea in the morning' -> symptom/nausea, vague morning time", r.intent === "symptom" && r.fields.symptomKey === "nausea" && r.time === "08:00");
}
{
  const r = parseQuickAdd("mild cramps today", NOW);
  check("'mild cramps today' -> symptom/cramps, dated today", r.intent === "symptom" && r.fields.symptomKey === "cramps" && r.date === formatLocalDate(NOW));
}
check("'spotting this morning' -> symptom/spotting", parseQuickAdd("spotting this morning", NOW).fields.symptomKey === "spotting");
check("'feeling nauseous' resolves to symptom, not checkin (symptom takes priority)", parseQuickAdd("feeling nauseous", NOW).intent === "symptom");

// --- Group I: check-in intent ---

{
  const r = parseQuickAdd("feeling good today", NOW);
  check("'feeling good today' -> checkin, mood 4, dated today", r.intent === "checkin" && r.fields.mood === 4 && r.date === formatLocalDate(NOW));
}
check("'mood is great' -> checkin, mood 5", parseQuickAdd("mood is great", NOW).fields.mood === 5);
check("'feeling low' -> checkin, mood 2 (no symptom-keyword overlap)", (() => {
  const r = parseQuickAdd("feeling low", NOW);
  return r.intent === "checkin" && r.fields.mood === 2;
})());

// --- Group J: food intent ---

{
  const r = parseQuickAdd("ate idli for breakfast", NOW);
  check("'ate idli for breakfast' -> food/Breakfast, items mention idli", r.intent === "food" && r.fields.meal === "Breakfast" && r.fields.items.toLowerCase().includes("idli"));
}
check("'had dinner - dal rice' -> food/Dinner", parseQuickAdd("had dinner - dal rice", NOW).fields.meal === "Dinner");
check("'lunch: khichdi' -> food/Lunch (meal word alone, no trigger verb needed)", parseQuickAdd("lunch: khichdi", NOW).fields.meal === "Lunch");
{
  const r = parseQuickAdd("ate mango", NOW);
  check("'ate mango' -> food, no meal word, items mention mango", r.intent === "food" && r.fields.meal === null && r.fields.items.toLowerCase().includes("mango"));
}

// --- Group K: water intent ---

check("'drank a glass of water' -> water", parseQuickAdd("drank a glass of water", NOW).intent === "water");
check("'water' alone -> water", parseQuickAdd("water", NOW).intent === "water");

// --- Group L: note fallback + genuine ambiguity ---

{
  const r = parseQuickAdd("remember to buy baby clothes", NOW);
  check("no keywords at all -> plain note, nothing invented, full text kept", r.intent === "note" && r.fields.text === "remember to buy baby clothes");
}
check("'ask doctor about back pain' is genuinely ambiguous (question vs. symptom) -> buttons, not a guess", parseQuickAdd("ask doctor about back pain", NOW).intent === "ambiguous");
{
  const r = parseQuickAdd("take her to the scan tomorrow", NOW);
  check("'take her to the scan tomorrow' resolves to booking/scan, not misread as medicine", r.intent === "booking" && r.fields.type === "scan");
}
check("empty input -> note, never throws", (() => { const r = parseQuickAdd("", NOW); return r.intent === "note"; })());

// --- Extra Indian-phrasing / combined cases ---

{
  const r = parseQuickAdd("appointment day after tomorrow evening", NOW);
  check("'appointment day after tomorrow evening' -> booking, +2 days, vague evening", r.intent === "booking" && r.date === addDaysTo(NOW, 2) && r.time === "18:00" && r.timeIsVague === true);
}
{
  const r = parseQuickAdd("scan on thursday at 11am", NOW);
  const thursday = nextOccurrenceOf(4, NOW);
  check("'scan on thursday at 11am' -> booking/scan, correct date+time", r.fields.type === "scan" && r.date === formatLocalDate(thursday) && r.time === "11:00");
}
{
  const r = parseQuickAdd("take pantop daily morning", NOW);
  check("'take pantop daily morning' -> medicine with a vague morning time, name non-empty", r.intent === "medicine" && r.fields.name.length > 0 && r.time === "08:00" && r.timeIsVague === true);
}

// Safety: never invent a dose/schedule beyond what's typed.
check("medicine draft never fabricates an end date when no duration was typed", parseQuickAdd("start folic acid", NOW).fields.endDate === null);
check("medicine draft never fabricates a time when none was typed", parseQuickAdd("start folic acid", NOW).fields.times === "");

// --- forcedIntent (ambiguous-case buttons: she picks the intent herself) ---

{
  const r = parseQuickAdd("ask doctor about back pain", NOW, "question");
  check("forcedIntent 'question' on an ambiguous sentence", r.intent === "question" && r.fields.category === "question" && r.fields.text.length > 0);
}
{
  const r = parseQuickAdd("ask doctor about back pain", NOW, "symptom");
  check("forcedIntent 'symptom' never guesses which symptom — always 'other'", r.intent === "symptom" && r.fields.symptomKey === "other");
}
{
  const r = parseQuickAdd("some unrecognized text", NOW, "booking");
  check("forcedIntent 'booking' on plain text still produces a usable title", r.intent === "booking" && r.fields.title.length > 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
