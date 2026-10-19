// Pregnancy Care Tracker — quickadd.js
//
// Pure, network-free natural-language parsing for the Home "Quick Add" box
// — no DOM/fetch/localStorage, same rule as schedule.js/countdown.js.
// Everything here is deterministic keyword + regex matching in Asia/
// Kolkata local time (the device clock, injected as `now`, never read
// internally) — there is no fuzzy matching, no guessing of doses or
// schedules, and no randomness. parseQuickAdd() is the one entry point
// app.js actually calls; everything else is exported for standalone
// testing (see test/quickadd.test.mjs).
//
// Design rule this file must never violate: if something wasn't actually
// typed, it is never invented. A field nothing matched is left blank (the
// caller/UI highlights it for her to fill in), not defaulted to a guess —
// the one deliberate exception is the four vague time-of-day words
// (morning/afternoon/evening/night), which map to a fixed slot time
// because the work order explicitly asks for that mapping; those are
// flagged with `timeIsVague: true` so the UI can show it was inferred.

import { parseLocalDateOnly } from "./countdown.js";
import { formatLocalDate } from "./schedule.js";

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_ABBREV = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const VAGUE_TIME_MAP = { morning: "08:00", afternoon: "13:00", evening: "18:00", night: "21:00", tonight: "21:00" };

const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fortnight: 14
};

// ---------------------------------------------------------------------------
// Date / time / duration extraction — each returns null if nothing matched,
// or { value, matchText } where matchText is the exact substring matched
// (so the caller can strip it out of the text when deriving a title/name).
// ---------------------------------------------------------------------------

export function parseRelativeDate(text, now) {
  const lower = text.toLowerCase();

  const dayAfterTomorrow = /\bday after tomorrow\b/.exec(lower);
  if (dayAfterTomorrow) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
    return { value: formatLocalDate(d), matchText: dayAfterTomorrow[0] };
  }

  const tomorrow = /\btomorrow\b/.exec(lower);
  if (tomorrow) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return { value: formatLocalDate(d), matchText: tomorrow[0] };
  }

  const yesterday = /\byesterday\b/.exec(lower);
  if (yesterday) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return { value: formatLocalDate(d), matchText: yesterday[0] };
  }

  const today = /\btoday\b/.exec(lower);
  if (today) {
    return { value: formatLocalDate(now), matchText: today[0] };
  }

  // "next monday", "monday" — both mean the next occurrence of that
  // weekday strictly after today (never today itself, even if today
  // happens to be that weekday — she'd say "today" for that).
  const weekdayMatch = /\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/.exec(lower);
  if (weekdayMatch) {
    const name = weekdayMatch[2];
    const targetDow = WEEKDAY_NAMES.indexOf(name) !== -1 ? WEEKDAY_NAMES.indexOf(name) : WEEKDAY_ABBREV.indexOf(name);
    let daysAhead = (targetDow - now.getDay() + 7) % 7;
    if (daysAhead === 0) daysAhead = 7;
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead);
    return { value: formatLocalDate(d), matchText: weekdayMatch[0] };
  }

  // "next week" with no weekday named — a generic placeholder a week out.
  const nextWeek = /\bnext week\b/.exec(lower);
  if (nextWeek) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
    return { value: formatLocalDate(d), matchText: nextWeek[0] };
  }

  return null;
}

export function parseClockTime(text) {
  const lower = text.toLowerCase();

  if (/\bnoon\b/.test(lower)) {
    const m = /\bnoon\b/.exec(lower);
    return { value: "12:00", matchText: m[0] };
  }
  if (/\bmidnight\b/.test(lower)) {
    const m = /\bmidnight\b/.exec(lower);
    return { value: "00:00", matchText: m[0] };
  }

  // "5pm", "5:30 pm", "5.30pm" — 12-hour with am/pm, the unambiguous case.
  const ampm = /\b(\d{1,2})([:.](\d{2}))?\s*(am|pm)\b/i.exec(text);
  if (ampm) {
    let hour = Number(ampm[1]) % 12;
    if (/pm/i.test(ampm[4])) hour += 12;
    const minute = ampm[3] ? Number(ampm[3]) : 0;
    if (hour <= 23 && minute <= 59) {
      return { value: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, matchText: ampm[0] };
    }
  }

  // Bare 24h "17:00" / "17.00" — only a real time (not e.g. a phone number
  // fragment), hour 00-23, minute 00-59, and not immediately followed by
  // more digits (so "17:0000" or a longer number doesn't false-match).
  const bare24h = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b(?!\d)/.exec(text);
  if (bare24h) {
    return { value: `${bare24h[1].padStart(2, "0")}:${bare24h[2]}`, matchText: bare24h[0] };
  }

  return null;
}

export function parseVagueTime(text) {
  const lower = text.toLowerCase();
  const match = /\b(morning|afternoon|evening|night|tonight)\b/.exec(lower);
  if (!match) return null;
  return { value: VAGUE_TIME_MAP[match[1]], matchText: match[0] };
}

export function parseDuration(text) {
  const lower = text.toLowerCase();
  const match = /\bfor\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fortnight|\d+)\s*(day|days|week|weeks)?\b/.exec(lower);
  if (!match) return null;
  const raw = match[1];
  const num = NUMBER_WORDS[raw] !== undefined ? NUMBER_WORDS[raw] : Number(raw);
  if (!num || isNaN(num)) return null;
  const unit = match[2] || "day";
  const days = raw === "fortnight" ? 14 : (unit.startsWith("week") ? num * 7 : num);
  return { value: days, matchText: match[0] };
}

// ---------------------------------------------------------------------------
// Intent keyword tables. Each is an array of regexes tried in order; the
// first one that matches wins for that intent (we only need to know
// *whether* the intent matched and what substring to strip, not score
// multiple hits within the same intent).
// ---------------------------------------------------------------------------

const BOOKING_TYPE_PATTERNS = [
  { type: "scan", re: /\b(scan|ultrasound|usg|sonography)\b/i },
  { type: "blood_test", re: /\b(blood test|blood work|lab test)\b/i },
  { type: "vaccine", re: /\b(vaccine|vaccination|tt shot|tetanus shot|injection shot)\b/i },
  { type: "doctor_visit", re: /\b(appointment|doctor|checkup|check-up|visit|gynae|gynecologist|gynaecologist|obgyn)\b/i }
];

const MEDICINE_TRIGGER_RE = /\b(take|start|stop|began|stopped)\b/i;
const MEDICINE_NOUN_RE = /\b(medicine|tablet|tab|pill|dose|capsule)\b/i;

const QUESTION_RE = /\b(ask (the )?doctor|question for (the )?doctor|remember to ask|ask about)\b/i;

const SYMPTOM_SYNONYMS = [
  { key: "nausea", re: /\bnause(a|ous)\b/i },
  { key: "vomiting", re: /\b(vomit(ing|ed)?|threw up)\b/i },
  { key: "spotting", re: /\bspotting\b/i },
  { key: "bleeding", re: /\bbleed(ing)?\b/i },
  { key: "headache", re: /\bheadache\b/i },
  { key: "dizziness", re: /\b(dizzy|dizziness|lightheaded)\b/i },
  { key: "tiredness", re: /\b(tired|exhausted|fatigue)\b/i },
  { key: "back_pain", re: /\bback (pain|ache)\b/i },
  { key: "cramps", re: /\bcramps?\b/i },
  { key: "heartburn", re: /\b(heartburn|acidity)\b/i },
  { key: "swelling", re: /\bswelling|swollen\b/i },
  { key: "constipation", re: /\bconstipat(ed|ion)\b/i },
  { key: "fever", re: /\bfever\b/i }
];

const CHECKIN_RE = /\b(feeling|mood|i feel|felt)\b/i;
const CHECKIN_MOOD_WORDS = [
  { re: /\b(terrible|awful|horrible)\b/i, mood: 1 },
  { re: /\b(bad|low|sad|down)\b/i, mood: 2 },
  { re: /\b(okay|ok|fine|alright|so-so)\b/i, mood: 3 },
  { re: /\bgood\b/i, mood: 4 },
  { re: /\b(great|amazing|wonderful|fantastic)\b/i, mood: 5 }
];

const FOOD_TRIGGER_RE = /\b(ate|eating|had|eat)\b/i;
const MEAL_WORDS = [
  { meal: "Breakfast", re: /\bbreakfast\b/i },
  { meal: "Lunch", re: /\blunch\b/i },
  { meal: "Dinner", re: /\bdinner\b/i },
  { meal: "Snack", re: /\bsnack\b/i }
];

const WATER_RE = /\b(glass(es)? of water|drank water|drink water|water)\b/i;

// ---------------------------------------------------------------------------
// Main entry point.
// ---------------------------------------------------------------------------

// Removes every matched substring from `text` once each (case-insensitive,
// first occurrence), then trims leftover connector words/punctuation —
// what remains is used as the free-text title/name/items for whichever
// intent needs one.
function stripMatches(text, matchTexts) {
  let result = text;
  matchTexts.filter(Boolean).forEach((m) => {
    const idx = result.toLowerCase().indexOf(m.toLowerCase());
    if (idx !== -1) result = result.slice(0, idx) + result.slice(idx + m.length);
  });
  return result
    .replace(/\b(at|on|by|to|for|and|the|a|an|is|was)\b/gi, " ")
    .replace(/[,.;:!]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(str) {
  return str.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// forcedIntent: used when she picks one of the ambiguous-case buttons
// (Booking/Medicine/Question/Symptom/Note) herself — skips keyword
// detection entirely and just builds that intent's fields from whatever
// date/time/duration were found plus the rest of the text verbatim. This
// is also how a forced symptom draft always starts as symptomKey:'other'
// (never guesses which specific symptom) — she picks the real one in the
// confirmation card.
function buildForcedFields(forcedIntent, rawText, now, date, time, duration) {
  const remaining = stripMatches(rawText, [date && date.matchText, time && time.matchText, duration && duration.matchText]) || rawText;
  switch (forcedIntent) {
    case "booking": return { type: "doctor_visit", title: remaining ? titleCase(remaining) : "" };
    case "medicine": return {
      name: remaining ? titleCase(remaining) : "",
      startDate: date ? date.value : formatLocalDate(now),
      endDate: duration ? addDays(date ? date.value : formatLocalDate(now), duration.value - 1) : null,
      times: time ? time.value : ""
    };
    case "question": return { category: "question", text: remaining || rawText };
    case "symptom": return { symptomKey: "other", note: remaining };
    case "checkin": return { mood: null, note: remaining };
    case "food": return { meal: null, items: remaining };
    case "water": return {};
    default: return { text: rawText };
  }
}

export function parseQuickAdd(text, now, forcedIntent) {
  const rawText = String(text || "").trim();
  const date = parseRelativeDate(rawText, now);
  const clockTime = parseClockTime(rawText);
  const vagueTime = clockTime ? null : parseVagueTime(rawText);
  const duration = parseDuration(rawText);
  const time = clockTime || vagueTime;

  const dateTimeDurationMatches = [date && date.matchText, time && time.matchText, duration && duration.matchText];

  if (forcedIntent) {
    return {
      rawText, intent: forcedIntent,
      date: date ? date.value : null, time: time ? time.value : null,
      timeIsVague: !!vagueTime, durationDays: duration ? duration.value : null, candidates: [],
      fields: buildForcedFields(forcedIntent, rawText, now, date, time, duration)
    };
  }

  // Which intents does the text match? Collect every hit, then decide.
  const hits = {};

  if (QUESTION_RE.test(rawText)) hits.question = { matchText: QUESTION_RE.exec(rawText)[0] };

  const bookingType = BOOKING_TYPE_PATTERNS.find((p) => {
    if (!p.re.test(rawText)) return false;
    // Bare "doctor" is too weak a signal once the text already reads as a
    // question-for-the-doctor phrase ("ask the doctor about diet") — in
    // that case require one of the stronger, unambiguously-a-visit words.
    if (p.type === "doctor_visit" && hits.question) {
      return /\b(appointment|checkup|check-up|visit|gynae|gynecologist|gynaecologist|obgyn)\b/i.test(rawText);
    }
    return true;
  });
  if (bookingType) hits.booking = { matchText: bookingType.re.exec(rawText)[0], type: bookingType.type };

  if (MEDICINE_TRIGGER_RE.test(rawText) && (MEDICINE_NOUN_RE.test(rawText) || !hits.booking)) {
    // "take"/"start" is a weak signal on its own (lots of sentences use
    // "take" loosely) — only count it without a medicine noun present if
    // nothing stronger (booking) already matched, so "take her to the
    // scan" doesn't get mis-read as a medicine.
    const trigger = MEDICINE_TRIGGER_RE.exec(rawText);
    hits.medicine = { matchText: trigger[0] };
  }

  const symptomHit = SYMPTOM_SYNONYMS.find((s) => s.re.test(rawText));
  if (symptomHit) hits.symptom = { matchText: symptomHit.re.exec(rawText)[0], symptomKey: symptomHit.key };

  if (!symptomHit && CHECKIN_RE.test(rawText)) {
    const moodHit = CHECKIN_MOOD_WORDS.find((w) => w.re.test(rawText));
    hits.checkin = { matchText: CHECKIN_RE.exec(rawText)[0], mood: moodHit ? moodHit.mood : null };
  }

  if (FOOD_TRIGGER_RE.test(rawText) || MEAL_WORDS.some((m) => m.re.test(rawText))) {
    const mealHit = MEAL_WORDS.find((m) => m.re.test(rawText));
    const trigger = FOOD_TRIGGER_RE.exec(rawText);
    hits.food = { matchText: (trigger && trigger[0]) || (mealHit && mealHit.re.exec(rawText)[0]), meal: mealHit ? mealHit.meal : null };
  }

  if (WATER_RE.test(rawText)) hits.water = { matchText: WATER_RE.exec(rawText)[0] };

  const matchedIntents = Object.keys(hits);
  let intent;
  if (matchedIntents.length === 0) intent = "note";
  else if (matchedIntents.length === 1) intent = matchedIntents[0];
  else intent = "ambiguous";

  const base = {
    rawText,
    intent,
    date: date ? date.value : null,
    time: time ? time.value : null,
    timeIsVague: !!vagueTime,
    durationDays: duration ? duration.value : null,
    candidates: matchedIntents
  };

  if (intent === "ambiguous" || intent === "note") {
    // Verbatim — nothing was confidently recognized here, so nothing is
    // cleaned up or removed either. "Unmatched text is saved as a
    // timeline note so nothing is lost" means exactly that: byte-for-byte.
    return { ...base, fields: { text: rawText } };
  }

  if (intent === "booking") {
    const remaining = stripMatches(rawText, [...dateTimeDurationMatches, hits.booking.matchText]);
    return {
      ...base,
      fields: {
        type: hits.booking.type,
        title: remaining ? titleCase(remaining) : titleCase(hits.booking.matchText)
      }
    };
  }

  if (intent === "medicine") {
    const remaining = stripMatches(rawText, [...dateTimeDurationMatches, hits.medicine.matchText]);
    return {
      ...base,
      fields: {
        name: remaining ? titleCase(remaining) : "",
        startDate: date ? date.value : formatLocalDate(now),
        // -1: "for 5 days" starting today means today + 4 more days (5
        // days total, inclusive), same inclusive-day-count convention
        // app.js's resolvePresetEndDate() uses for the Add Medicine sheet.
        endDate: duration ? addDays(date ? date.value : formatLocalDate(now), duration.value - 1) : null,
        times: time ? time.value : ""
      }
    };
  }

  if (intent === "question") {
    const remaining = stripMatches(rawText, [...dateTimeDurationMatches, hits.question.matchText]);
    return { ...base, fields: { category: "question", text: remaining || rawText } };
  }

  if (intent === "symptom") {
    const remaining = stripMatches(rawText, [...dateTimeDurationMatches, hits.symptom.matchText]);
    return { ...base, fields: { symptomKey: hits.symptom.symptomKey, note: remaining } };
  }

  if (intent === "checkin") {
    const remaining = stripMatches(rawText, [...dateTimeDurationMatches, hits.checkin.matchText]);
    return { ...base, fields: { mood: hits.checkin.mood, note: remaining } };
  }

  if (intent === "food") {
    const remaining = stripMatches(rawText, [...dateTimeDurationMatches, hits.food.matchText]);
    return { ...base, fields: { meal: hits.food.meal, items: remaining } };
  }

  if (intent === "water") {
    return { ...base, fields: {} };
  }

  return { ...base, fields: { text: rawText } };
}

function addDays(dateStr, days) {
  const d = parseLocalDateOnly(dateStr);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return formatLocalDate(d);
}
