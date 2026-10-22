// MamaCare icons — a self-hosted Material Symbols Outlined SUBSET
// (css/fonts/material-symbols-subset.woff2, see css/tokens.css's
// @font-face), referenced by exact Unicode codepoint rather than by typing
// the icon's ligature name as text. Subsetting a ligature icon font down
// to just the glyphs an app uses is only actually small if you subset by
// codepoint — ligature substitution chains pull in a long chain of
// intermediate glyphs per character, so a handful of icon names by text
// cost nearly the whole 4000-glyph font, while the same icons addressed by
// codepoint cost a few KB. That's why this map exists instead of writing
// `<span class="material-symbols-outlined">notifications</span>` directly.
//
// Add a new icon: look up its codepoint at fonts.google.com/icons (or the
// google/material-design-icons codepoints file), add it below, then
// re-run the subsetting command in DEVELOPMENT.md against the full
// Material Symbols Outlined font so the glyph actually exists in the
// woff2 — adding a name here alone does not add its glyph.
const ICON_CODEPOINTS = {
  account_circle: "f20b",
  add: "e145",
  add_circle: "e990",
  arrow_back: "e5c4",
  arrow_forward: "e5c8",
  bedtime: "f159",
  calendar_clock: "f540",
  calendar_today: "e935",
  celebration: "ea65",
  check: "e668",
  check_circle: "f0be",
  chevron_right: "e5cc",
  close: "e5cd",
  delete: "e92e",
  document_scanner: "e5fa",
  done_all: "e877",
  edit: "f097",
  emergency: "e1eb",
  expand_more: "e5cf",
  favorite: "e87e",
  folder_open: "e2c8",
  folder_shared: "e2c9",
  group: "ea21",
  history: "e8b3",
  hub: "e9f4",
  insights: "f092",
  keyboard_arrow_down: "e313",
  keyboard_arrow_right: "e315",
  local_drink: "e544",
  location_on: "f1db",
  logout: "e9ba",
  medication: "f033",
  mic: "e31d",
  more_vert: "e5d4",
  notifications: "e7f5",
  photo_camera: "e412",
  pill: "e11f",
  prescriptions: "e121",
  radiology: "e125",
  receipt_long: "ef6e",
  restaurant: "e56c",
  schedule: "efd6",
  search: "ef7a",
  sentiment_dissatisfied: "e811",
  sentiment_neutral: "e812",
  sentiment_satisfied: "e813",
  sentiment_very_dissatisfied: "e814",
  sentiment_very_satisfied: "e815",
  settings: "e8b8",
  sort: "e164",
  spa: "eb4c",
  stethoscope: "f805",
  task_alt: "e2e6",
  tune: "e429",
  vaccines: "e138",
  vital_signs: "e650",
  warning: "f083",
  water_drop: "e798"
};

// Renders one icon glyph as a <span>. `cls` is appended to the base "icon"
// class (e.g. for sizing/color utility classes); aria-hidden because every
// call site is expected to pair this with visible or aria-label text —
// icons are never the only content of an interactive element without one.
export function icon(name, cls) {
  const codepoint = ICON_CODEPOINTS[name];
  if (!codepoint) {
    console.warn("Unknown icon:", name);
    return "";
  }
  const char = String.fromCodePoint(parseInt(codepoint, 16));
  return `<span class="icon${cls ? " " + cls : ""}" aria-hidden="true">${char}</span>`;
}
