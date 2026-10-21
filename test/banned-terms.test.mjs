// Enforces the project's tone rule: the app records what she or her
// doctor entered, or what a document says — it never advises, warns,
// predicts or judges. Run with: node test/banned-terms.test.mjs
//
// Scans every STRING VALUE in js/i18n.js (the string table every piece of
// UI text is supposed to go through — see i18n.js's own header comment)
// plus the static content files under data/, for a fixed list of banned
// words/phrases, matched on word boundaries (so "normal" fails but
// "abnormal" — already banned on its own — doesn't double-fail as a
// false "normal" match inside it, and a word used only as part of a CSS
// class name or code identifier never reaches this scan at all, since
// those aren't string VALUES in i18n.js).
//
// A term can legitimately appear if every occurrence is listed in
// ALLOWLIST below with the exact key it's allowed in and why — add an
// entry there instead of weakening the regex, so the allowlist stays a
// visible, reviewable audit trail rather than a silent escape hatch.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log("ok   " + label); }
  else { fail++; console.error("FAIL " + label); }
}

const BANNED_TERMS = [
  "warning", "alert", "risk", "may", "might", "could", "should",
  "normal", "abnormal", "safe", "unsafe", "thriving", "concern",
  "urgent", "overdue", "late", "missed", "low stock", "danger",
  "consult", "insurance", "coverage", "claim", "HSA", "$", "USD"
];

// Per-key exceptions: {key, term} pairs that are allowed to contain a
// banned word because, in context, it isn't advice/judgment/a dollar
// amount — e.g. "skipped" (her own deliberate record, not an app verdict)
// isn't on the banned list at all, so nothing is allowlisted here yet.
// Keep this empty unless a real, reviewed exception is needed.
const ALLOWLIST = [
  // Plain English "could not" in a network-error message ("Could not reach
  // the server") — a technical status, not a hedge about her or the baby.
  { key: "firstRun.error.network", term: "could" }
];

function isAllowed(key, term) {
  return ALLOWLIST.some((a) => a.key === key && a.term.toLowerCase() === term.toLowerCase());
}

function termRegex(term) {
  // "$" and other non-word terms don't have word boundaries to anchor on;
  // word-boundary-match everything else so "should" doesn't also flag
  // unrelated text and multi-word phrases like "low stock" still work.
  if (/^[a-zA-Z ]+$/.test(term)) {
    return new RegExp("\\b" + term.replace(/ /g, "\\s+") + "\\b", "i");
  }
  return new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

function scanStrings(label, entries) {
  // entries: [{key, value}]
  const violations = [];
  entries.forEach(({ key, value }) => {
    if (typeof value !== "string") return;
    BANNED_TERMS.forEach((term) => {
      if (isAllowed(key, term)) return;
      if (termRegex(term).test(value)) violations.push(`${key} contains "${term}": "${value}"`);
    });
  });
  check(`${label}: no banned terms (${entries.length} strings scanned)`, violations.length === 0);
  if (violations.length) violations.forEach((v) => console.error("     " + v));
  return violations;
}

// --- js/i18n.js: every "key": "value" pair in the STRINGS.en table -------

const i18nSrc = fs.readFileSync(path.join(root, "js/i18n.js"), "utf8");
// Deliberately simple and strict rather than a full JS parser: matches
// exactly the `"some.key": "some value"` shape every real string in this
// file uses (confirmed by the sibling i18n-coverage check this project
// already runs by hand each round) — a value spanning multiple lines or
// using single quotes would silently not match, which is a gap worth
// knowing about but not one any current string actually hits.
const i18nEntries = [...i18nSrc.matchAll(/"([a-zA-Z0-9_.]+)":\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => ({
  key: m[1],
  value: m[2].replace(/\\"/g, '"')
}));
check("i18n.js: parsed a sane number of string entries", i18nEntries.length > 400);
scanStrings("js/i18n.js", i18nEntries);

// --- data/weeks.json: size_comparison + development text only ------------

const weeksData = JSON.parse(fs.readFileSync(path.join(root, "data/weeks.json"), "utf8"));
check("weeks.json: only the allowed neutral fields exist per week", weeksData.weeks.every((w) =>
  Object.keys(w).every((k) => ["week", "trimester", "size_comparison", "length_cm", "weight_g", "development"].includes(k))
));
scanStrings("data/weeks.json", weeksData.weeks.flatMap((w) => [
  { key: `week ${w.week} size_comparison`, value: w.size_comparison },
  { key: `week ${w.week} development`, value: w.development }
]));

// --- js/store.js: mock fixture display text (names/notes/labels) ---------

const storeSrc = fs.readFileSync(path.join(root, "js/store.js"), "utf8");
const mockStringEntries = [...storeSrc.matchAll(/(name|notes|title|text|symptom|note|items|craving_or_aversion|reason|instructions|stop_note)\s*:\s*"((?:[^"\\]|\\.)*)"/g)]
  .map((m, i) => ({ key: `store.js mock ${m[1]} #${i}`, value: m[2].replace(/\\"/g, '"') }));
scanStrings("js/store.js mock data", mockStringEntries);

// --- data/weeks.json/food-adjacent banned files must not exist at all ----

check("data/warnings.json was removed (red-flag symptom lists are banned)", !fs.existsSync(path.join(root, "data/warnings.json")));
check("data/food.json was removed (built-in eat/avoid lists are banned)", !fs.existsSync(path.join(root, "data/food.json")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
